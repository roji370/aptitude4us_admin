/**
 * Data Purge Cloud Functions
 *
 * Automatically deletes all user data/metadata 30 days after their last
 * subscription expires or is cancelled. Uses a two-phase approach:
 *
 * Phase 1 (scheduledDataPurgeCheck):
 *   Scans for users whose subscriptions have all been expired/cancelled for
 *   ≥ 30 days and queues them in a `pendingDeletions` collection.
 *
 * Phase 2 (executePendingDeletions):
 *   Processes the `pendingDeletions` queue: purges Firestore data, Storage
 *   files, Firebase Auth records, and writes an audit log entry.
 *
 * Admin controls:
 *   - cancelPendingDeletion: removes a user from the deletion queue
 *   - exemptUserFromDeletion: permanently exempts a user from auto-deletion
 */

const admin = require("firebase-admin");
const { onCall } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const GRACE_PERIOD_DAYS = 30;
const BATCH_SIZE = 500; // Firestore batch limit
const USERS_PER_INVOCATION = 10; // Process 10 users per run to stay under timeout
const MAX_RETRY_ATTEMPTS = 3; // Max retries for failed purges

// ---------------------------------------------------------------------------
// Phase 1: Scan for users eligible for deletion
// ---------------------------------------------------------------------------

/**
 * Runs daily. Finds users whose ALL subscriptions are expired/cancelled and
 * the most recent one lapsed ≥ 30 days ago. Queues them in `pendingDeletions`.
 */
const scheduledDataPurgeCheck = async () => {
  try {
    const db = admin.firestore();
    const now = new Date();
    const cutoffDate = new Date(
      now.getTime() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
    );

    logger.info(
      `[DataPurge] Starting purge check. Cutoff date: ${cutoffDate.toISOString()}`
    );

    // Step 1: Find all subscriptions that expired/cancelled ≥ 30 days ago
    const expiredSnapshot = await db
      .collection("subscriptions")
      .where("status", "in", ["expired", "cancelled"])
      .get();

    if (expiredSnapshot.empty) {
      logger.info("[DataPurge] No expired/cancelled subscriptions found");
      return { usersQueued: 0 };
    }

    // Step 2: Group by userId and find the most recent lapse date
    const userLapseDates = new Map(); // userId -> most recent lapse date

    for (const doc of expiredSnapshot.docs) {
      const data = doc.data();
      const userId = data.userId;
      if (!userId) continue;

      // Determine lapse date: use cancelledAt for cancelled subs,
      // effectiveEndDate for expired subs
      let lapseDate;
      if (data.status === "cancelled" && data.cancelledAt) {
        lapseDate = data.cancelledAt.toDate();
      } else if (data.effectiveEndDate) {
        lapseDate = data.effectiveEndDate.toDate();
      } else if (data.endDate) {
        lapseDate = data.endDate.toDate();
      } else {
        continue; // Skip if no date available
      }

      // Track the MOST RECENT lapse date per user (we only purge when ALL
      // subs have been lapsed for ≥ 30 days, so the latest one matters)
      const existing = userLapseDates.get(userId);
      if (!existing || lapseDate > existing) {
        userLapseDates.set(userId, lapseDate);
      }
    }

    logger.info(
      `[DataPurge] Found ${userLapseDates.size} users with expired/cancelled subs`
    );

    // Step 3: For each candidate user, verify they have NO active subs
    // and their most recent lapse is ≥ 30 days old
    let usersQueued = 0;

    for (const [userId, latestLapseDate] of userLapseDates.entries()) {
      try {
        // Skip if lapse date is within grace period
        if (latestLapseDate > cutoffDate) {
          continue;
        }

        // Check if already queued
        const pendingDoc = await db
          .collection("pendingDeletions")
          .doc(userId)
          .get();
        if (pendingDoc.exists) {
          continue; // Already queued
        }

        // Check user document
        const userDoc = await db.collection("users").doc(userId).get();

        // Skip if user doc doesn't exist (already manually deleted)
        if (!userDoc.exists) {
          logger.info(
            `[DataPurge] User ${userId} doc doesn't exist, skipping`
          );
          continue;
        }

        const userData = userDoc.data();

        // Never purge admin accounts
        if (userData.role === "admin") {
          logger.info(
            `[DataPurge] User ${userId} is an admin, skipping`
          );
          continue;
        }

        // Check for exemption
        if (userData.exemptFromDeletion === true) {
          logger.info(
            `[DataPurge] User ${userId} is exempt from deletion, skipping`
          );
          continue;
        }

        // Check if admin previously cancelled a deletion for this user.
        // Don't re-queue if the cancellation is more recent than the lapse.
        if (userData.lastDeletionCancelledAt) {
          const cancelledAt = userData.lastDeletionCancelledAt.toDate();
          if (cancelledAt > latestLapseDate) {
            logger.info(
              `[DataPurge] User ${userId} had deletion cancelled after lapse, skipping`
            );
            continue;
          }
        }

        // Check for any active subscription
        const activeSubsSnapshot = await db
          .collection("subscriptions")
          .where("userId", "==", userId)
          .where("status", "==", "active")
          .limit(1)
          .get();

        if (!activeSubsSnapshot.empty) {
          continue; // User still has an active subscription
        }

        // Queue for deletion
        const userEmail = userData.email || "unknown";
        const userName = userData.displayName || "unknown";

        await db
          .collection("pendingDeletions")
          .doc(userId)
          .set({
            userId,
            email: userEmail,
            displayName: userName,
            reason: "subscription_lapsed_30_days",
            latestLapseDate:
              admin.firestore.Timestamp.fromDate(latestLapseDate),
            queuedAt: admin.firestore.FieldValue.serverTimestamp(),
            scheduledDeletionDate:
              admin.firestore.FieldValue.serverTimestamp(),
            status: "pending",
            retryCount: 0,
          });

        usersQueued++;
        logger.info(
          `[DataPurge] Queued user ${userId} (${userEmail}) for deletion. ` +
            `Latest lapse: ${latestLapseDate.toISOString()}`
        );
      } catch (userError) {
        logger.error(
          `[DataPurge] Error processing user ${userId}:`,
          userError
        );
        // Continue with other users
      }
    }

    logger.info(
      `[DataPurge] Purge check complete. ${usersQueued} users queued for deletion`
    );
    return { usersQueued };
  } catch (error) {
    logger.error("[DataPurge] Error in scheduledDataPurgeCheck:", error);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Phase 2: Execute pending deletions
// ---------------------------------------------------------------------------

/**
 * Runs daily (1 hour after the check). Processes `pendingDeletions` docs
 * and purges all user data.
 */
const executePendingDeletions = async () => {
  try {
    const db = admin.firestore();

    // Fetch pending deletions (include 'pending' and retryable 'failed')
    const pendingSnapshot = await db
      .collection("pendingDeletions")
      .where("status", "in", ["pending", "failed"])
      .limit(USERS_PER_INVOCATION)
      .get();

    if (pendingSnapshot.empty) {
      logger.info("[DataPurge] No pending deletions to process");
      return { usersProcessed: 0 };
    }

    logger.info(
      `[DataPurge] Processing ${pendingSnapshot.size} pending deletions`
    );

    let usersProcessed = 0;
    let usersFailed = 0;
    let usersSkipped = 0;

    for (const pendingDoc of pendingSnapshot.docs) {
      const pendingData = pendingDoc.data();
      const userId = pendingData.userId;
      const retryCount = pendingData.retryCount || 0;

      // Skip permanently failed purges that exceeded retry limit
      if (retryCount >= MAX_RETRY_ATTEMPTS) {
        logger.warn(
          `[DataPurge] User ${userId} exceeded max retries (${MAX_RETRY_ATTEMPTS}), skipping. ` +
            `Requires manual intervention.`
        );
        // Mark as permanently failed
        await pendingDoc.ref.update({
          status: "permanently_failed",
          error: `Exceeded max retry attempts (${MAX_RETRY_ATTEMPTS}). Requires manual intervention.`,
        });
        usersSkipped++;
        continue;
      }

      // Re-verify the user hasn't re-subscribed or been exempted since queuing
      // (guards against race condition between scan and execution)
      try {
        const userDoc = await db.collection("users").doc(userId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          if (userData.exemptFromDeletion === true) {
            logger.info(
              `[DataPurge] User ${userId} was exempted since queuing, removing from queue`
            );
            await pendingDoc.ref.delete();
            usersSkipped++;
            continue;
          }
          if (userData.role === "admin") {
            logger.info(
              `[DataPurge] User ${userId} is admin, removing from queue`
            );
            await pendingDoc.ref.delete();
            usersSkipped++;
            continue;
          }
        }

        // Double-check no active subscription appeared since queuing
        const activeSubsSnapshot = await db
          .collection("subscriptions")
          .where("userId", "==", userId)
          .where("status", "==", "active")
          .limit(1)
          .get();
        if (!activeSubsSnapshot.empty) {
          logger.info(
            `[DataPurge] User ${userId} re-subscribed since queuing, removing from queue`
          );
          await pendingDoc.ref.delete();
          usersSkipped++;
          continue;
        }
      } catch (verifyError) {
        logger.warn(
          `[DataPurge] Error verifying user ${userId} before purge (proceeding anyway):`,
          verifyError
        );
      }

      try {
        // Mark as in-progress to prevent duplicate processing
        await pendingDoc.ref.update({
          status: "in_progress",
          lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        logger.info(`[DataPurge] Purging data for user ${userId} (attempt ${retryCount + 1})`);
        const deletionCounts = await purgeUserData(userId);

        // Write audit log
        await db.collection("deletionAuditLog").add({
          userId,
          email: pendingData.email || "unknown",
          displayName: pendingData.displayName || "unknown",
          reason: pendingData.reason,
          latestLapseDate: pendingData.latestLapseDate,
          queuedAt: pendingData.queuedAt,
          deletedAt: admin.firestore.FieldValue.serverTimestamp(),
          deletionCounts,
          attempts: retryCount + 1,
        });

        // Remove from pending queue
        await pendingDoc.ref.delete();

        usersProcessed++;
        logger.info(
          `[DataPurge] Successfully purged user ${userId}. Counts:`,
          deletionCounts
        );
      } catch (userError) {
        usersFailed++;
        logger.error(
          `[DataPurge] Failed to purge user ${userId} (attempt ${retryCount + 1}):`,
          userError
        );

        // Mark as failed with retry count so it can be retried next run
        try {
          await pendingDoc.ref.update({
            status: "failed",
            error: userError.message || "Unknown error",
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            retryCount: retryCount + 1,
          });
        } catch (updateError) {
          logger.error(
            `[DataPurge] Failed to update failure status for ${userId}:`,
            updateError
          );
        }
      }
    }

    logger.info(
      `[DataPurge] Execution complete. Processed: ${usersProcessed}, Failed: ${usersFailed}`
    );
    return { usersProcessed, usersFailed, usersSkipped };
  } catch (error) {
    logger.error("[DataPurge] Error in executePendingDeletions:", error);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Core purge logic — deletes ALL data for a single user
// ---------------------------------------------------------------------------

async function purgeUserData(userId) {
  const db = admin.firestore();
  const counts = {
    userDoc: 0,
    progress: 0,
    tokens: 0,
    fcmTokens: 0,
    subscriptions: 0,
    loginLogs: 0,
    loginEvents: 0,
    notifications: 0,
    userTokens: 0,
    userContentViews: 0,
    contentViews: 0,
    messages: 0,
    chats: 0,
    communityChat: 0,
    pastQuestions: 0,
    contentUpdates: 0,
    typingStatus: 0,
    notificationTracking: 0,
    userProgress: 0,
    authRecord: 0,
    storageFiles: 0,
  };

  // -----------------------------------------------------------------------
  // 1. Delete subcollections under users/{userId}
  // -----------------------------------------------------------------------

  // users/{userId}/progress/*
  counts.progress = await deleteSubcollection(
    db,
    `users/${userId}/progress`
  );

  // users/{userId}/tokens/*
  counts.tokens = await deleteSubcollection(
    db,
    `users/${userId}/tokens`
  );

  // users/{userId}/fcm_tokens/*
  counts.fcmTokens = await deleteSubcollection(
    db,
    `users/${userId}/fcm_tokens`
  );

  // -----------------------------------------------------------------------
  // 2. Delete documents in top-level collections where userId is a field
  // -----------------------------------------------------------------------

  // subscriptions
  counts.subscriptions = await deleteByQuery(
    db,
    "subscriptions",
    "userId",
    userId
  );

  // login_logs (admin app uses this name)
  counts.loginLogs += await deleteByQuery(
    db,
    "login_logs",
    "userId",
    userId
  );

  // loginLogs (some references use camelCase)
  counts.loginLogs += await deleteByQuery(
    db,
    "loginLogs",
    "userId",
    userId
  );

  // login_events (Flutter app uses this)
  counts.loginEvents = await deleteByQuery(
    db,
    "login_events",
    "userId",
    userId
  );

  // user_tokens (flat FCM token collection)
  counts.userTokens = await deleteByQuery(
    db,
    "user_tokens",
    "userId",
    userId
  );

  // contentViews
  counts.contentViews = await deleteByQuery(
    db,
    "contentViews",
    "userId",
    userId
  );

  // user_content_views — documents use {userId}_{contentId} pattern
  counts.userContentViews = await deleteByQuery(
    db,
    "user_content_views",
    "userId",
    userId
  );

  // typing_status/{userId}
  try {
    const typingDoc = db.collection("typing_status").doc(userId);
    const typingSnap = await typingDoc.get();
    if (typingSnap.exists) {
      await typingDoc.delete();
      counts.typingStatus = 1;
    }
  } catch (e) {
    logger.warn(`[DataPurge] Error deleting typing_status for ${userId}:`, e);
  }

  // user_progress (top-level progress tracking collection)
  counts.userProgress = await deleteByQuery(
    db,
    "user_progress",
    "userId",
    userId
  );

  // -----------------------------------------------------------------------
  // 3. Anonymize chat messages (replace sender info with "Deleted User")
  // -----------------------------------------------------------------------

  // messages (direct chat)
  counts.messages = await anonymizeChatMessages(db, "messages", userId);

  // chats (legacy chat system — uses 'userId' field instead of 'senderId')
  counts.chats = await anonymizeLegacyChatMessages(db, userId);

  // communityChat
  counts.communityChat = await anonymizeChatMessages(
    db,
    "communityChat",
    userId
  );

  // pastQuestions
  counts.pastQuestions = await anonymizeChatMessages(
    db,
    "pastQuestions",
    userId
  );

  // -----------------------------------------------------------------------
  // 4. Clean up notifications (remove userId from recipients arrays)
  // -----------------------------------------------------------------------
  counts.notifications = await cleanupNotifications(db, userId);

  // -----------------------------------------------------------------------
  // 5. Clean up contentUpdates (remove userId from notifiedUsers arrays)
  // -----------------------------------------------------------------------
  counts.contentUpdates = await cleanupContentUpdates(db, userId);

  // -----------------------------------------------------------------------
  // 6. Clean up notification_tracking
  // -----------------------------------------------------------------------
  counts.notificationTracking = await cleanupNotificationTracking(db, userId);

  // -----------------------------------------------------------------------
  // 7. Delete Cloud Storage files
  // -----------------------------------------------------------------------
  counts.storageFiles = await deleteStorageFiles(userId);

  // -----------------------------------------------------------------------
  // 8. Delete the user document itself
  // -----------------------------------------------------------------------
  try {
    const userDocRef = db.collection("users").doc(userId);
    const userSnap = await userDocRef.get();
    if (userSnap.exists) {
      await userDocRef.delete();
      counts.userDoc = 1;
    } else {
      logger.info(`[DataPurge] User doc already deleted for ${userId}`);
    }
  } catch (e) {
    logger.warn(`[DataPurge] Error deleting user doc for ${userId}:`, e);
  }

  // -----------------------------------------------------------------------
  // 9. Delete Firebase Auth record
  // -----------------------------------------------------------------------
  try {
    await admin.auth().deleteUser(userId);
    counts.authRecord = 1;
  } catch (e) {
    // User may have already been deleted from Auth
    if (e.code === "auth/user-not-found") {
      logger.info(
        `[DataPurge] Auth record already deleted for ${userId}`
      );
    } else {
      // Log but don't throw — partial cleanup is better than no cleanup
      logger.error(
        `[DataPurge] Error deleting auth record for ${userId}:`,
        e
      );
    }
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Helper: Delete all docs in a subcollection
// ---------------------------------------------------------------------------
async function deleteSubcollection(db, path) {
  let deletedCount = 0;
  try {
    const snapshot = await db.collection(path).get();
    if (snapshot.empty) return 0;

    // Process batches sequentially to avoid overwhelming Firestore
    let batch = db.batch();
    let opCount = 0;

    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
      opCount++;
      deletedCount++;

      if (opCount >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }
  } catch (e) {
    logger.warn(`[DataPurge] Error deleting subcollection ${path}:`, e);
  }
  return deletedCount;
}

// ---------------------------------------------------------------------------
// Helper: Delete all docs matching a field query
// ---------------------------------------------------------------------------
async function deleteByQuery(db, collectionName, field, value) {
  let deletedCount = 0;
  try {
    const snapshot = await db
      .collection(collectionName)
      .where(field, "==", value)
      .get();

    if (snapshot.empty) return 0;

    // Process batches sequentially to avoid overwhelming Firestore
    let batch = db.batch();
    let opCount = 0;

    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
      opCount++;
      deletedCount++;

      if (opCount >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }
  } catch (e) {
    logger.warn(
      `[DataPurge] Error deleting from ${collectionName} where ${field}==${value}:`,
      e
    );
  }
  return deletedCount;
}

// ---------------------------------------------------------------------------
// Helper: Anonymize chat messages instead of deleting them
// ---------------------------------------------------------------------------
async function anonymizeChatMessages(db, collectionName, userId) {
  let updatedCount = 0;
  try {
    const snapshot = await db
      .collection(collectionName)
      .where("senderId", "==", userId)
      .get();

    if (snapshot.empty) return 0;

    // Process batches sequentially
    let batch = db.batch();
    let opCount = 0;

    for (const doc of snapshot.docs) {
      batch.update(doc.ref, {
        senderName: "Deleted User",
        senderDisplayName: "Deleted User",
        senderEmail: null,
        senderPhotoUrl: null,
        // Keep senderId for data integrity but it will no longer resolve
      });
      opCount++;
      updatedCount++;

      if (opCount >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }
  } catch (e) {
    logger.warn(
      `[DataPurge] Error anonymizing ${collectionName} for ${userId}:`,
      e
    );
  }
  return updatedCount;
}

// ---------------------------------------------------------------------------
// Helper: Anonymize legacy 'chats' collection (uses 'userId' instead of 'senderId')
// ---------------------------------------------------------------------------
async function anonymizeLegacyChatMessages(db, userId) {
  let updatedCount = 0;
  try {
    const snapshot = await db
      .collection("chats")
      .where("userId", "==", userId)
      .get();

    if (snapshot.empty) return 0;

    let batch = db.batch();
    let opCount = 0;

    for (const doc of snapshot.docs) {
      batch.update(doc.ref, {
        displayName: "Deleted User",
        userName: "Deleted User",
        email: null,
        photoUrl: null,
        // Keep userId for data integrity
      });
      opCount++;
      updatedCount++;

      if (opCount >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }
  } catch (e) {
    logger.warn(
      `[DataPurge] Error anonymizing legacy chats for ${userId}:`,
      e
    );
  }
  return updatedCount;
}

// ---------------------------------------------------------------------------
// Helper: Clean up notification recipient arrays
// ---------------------------------------------------------------------------
async function cleanupNotifications(db, userId) {
  let updatedCount = 0;
  try {
    const snapshot = await db
      .collection("notifications")
      .where("recipients", "array-contains", userId)
      .get();

    if (snapshot.empty) return 0;

    let batch = db.batch();
    let opCount = 0;

    for (const doc of snapshot.docs) {
      batch.update(doc.ref, {
        recipients: admin.firestore.FieldValue.arrayRemove(userId),
      });
      opCount++;
      updatedCount++;

      if (opCount >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }
  } catch (e) {
    logger.warn(
      `[DataPurge] Error cleaning notifications for ${userId}:`,
      e
    );
  }
  return updatedCount;
}

// ---------------------------------------------------------------------------
// Helper: Clean up contentUpdates notifiedUsers arrays
// ---------------------------------------------------------------------------
async function cleanupContentUpdates(db, userId) {
  let updatedCount = 0;
  try {
    const snapshot = await db
      .collection("contentUpdates")
      .where("notifiedUsers", "array-contains", userId)
      .get();

    if (snapshot.empty) return 0;

    let batch = db.batch();
    let opCount = 0;

    for (const doc of snapshot.docs) {
      batch.update(doc.ref, {
        notifiedUsers: admin.firestore.FieldValue.arrayRemove(userId),
        seenBy: admin.firestore.FieldValue.arrayRemove(userId),
      });
      opCount++;
      updatedCount++;

      if (opCount >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }
  } catch (e) {
    logger.warn(
      `[DataPurge] Error cleaning contentUpdates for ${userId}:`,
      e
    );
  }
  return updatedCount;
}

// ---------------------------------------------------------------------------
// Helper: Clean up notification_tracking
// ---------------------------------------------------------------------------
async function cleanupNotificationTracking(db, userId) {
  let updatedCount = 0;
  try {
    const snapshot = await db
      .collection("notification_tracking")
      .where("assignedUsers", "array-contains", userId)
      .get();

    if (snapshot.empty) return 0;

    let batch = db.batch();
    let opCount = 0;

    for (const doc of snapshot.docs) {
      batch.update(doc.ref, {
        assignedUsers: admin.firestore.FieldValue.arrayRemove(userId),
      });
      opCount++;
      updatedCount++;

      if (opCount >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }
  } catch (e) {
    logger.warn(
      `[DataPurge] Error cleaning notification_tracking for ${userId}:`,
      e
    );
  }
  return updatedCount;
}

// ---------------------------------------------------------------------------
// Helper: Delete Cloud Storage files for a user
// ---------------------------------------------------------------------------
async function deleteStorageFiles(userId) {
  let deletedCount = 0;
  try {
    const bucket = admin.storage().bucket();

    // Delete profile pictures: users/{userId}/profile/*
    try {
      const [profileFiles] = await bucket.getFiles({
        prefix: `users/${userId}/profile/`,
      });
      for (const file of profileFiles) {
        await file.delete();
        deletedCount++;
      }
    } catch (e) {
      logger.warn(
        `[DataPurge] Error deleting profile files for ${userId}:`,
        e
      );
    }

    // Delete chat attachments: attachments/*/{userId}/*
    // We need to check multiple chat types
    const chatTypes = ["direct", "community", "pastQuestions"];
    for (const chatType of chatTypes) {
      try {
        const [attachmentFiles] = await bucket.getFiles({
          prefix: `attachments/${chatType}/${userId}/`,
        });
        for (const file of attachmentFiles) {
          await file.delete();
          deletedCount++;
        }
      } catch (e) {
        logger.warn(
          `[DataPurge] Error deleting ${chatType} attachments for ${userId}:`,
          e
        );
      }
    }
  } catch (e) {
    logger.warn(
      `[DataPurge] Error accessing storage for ${userId}:`,
      e
    );
  }
  return deletedCount;
}

// ---------------------------------------------------------------------------
// Admin callable: Cancel a pending deletion
// ---------------------------------------------------------------------------
const cancelPendingDeletion = onCall(
  {
    enforceAppCheck: false,
    cpu: 0.5,
    memory: "256MiB",
  },
  async (request) => {
    const { data, auth } = request;

    if (!auth) {
      throw new Error("Unauthorized. User must be authenticated.");
    }

    // Verify caller is admin
    const callerDoc = await admin
      .firestore()
      .collection("users")
      .doc(auth.uid)
      .get();
    if (!callerDoc.exists || callerDoc.data().role !== "admin") {
      throw new Error(
        "Permission denied. Only administrators can cancel deletions."
      );
    }

    const { userId } = data;
    if (!userId) {
      throw new Error("User ID is required.");
    }

    const db = admin.firestore();
    const pendingRef = db.collection("pendingDeletions").doc(userId);
    const pendingDoc = await pendingRef.get();

    if (!pendingDoc.exists) {
      return {
        success: false,
        message: `No pending deletion found for user ${userId}`,
      };
    }

    // Race condition guard: don't cancel if purge is already in progress
    if (pendingDoc.data().status === "in_progress") {
      return {
        success: false,
        message: `Cannot cancel — data purge is already in progress for user ${userId}. The deletion cannot be reversed.`,
      };
    }

    // Delete the pending deletion doc
    await pendingRef.delete();

    // Record cancellation on user doc to prevent immediate re-queueing
    // by the next cron scan
    try {
      await db.collection("users").doc(userId).update({
        lastDeletionCancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        deletionCancelledBy: auth.uid,
      });
    } catch (userUpdateError) {
      // User doc may have already been deleted — non-fatal
      logger.warn(
        `[DataPurge] Could not update user doc after cancel for ${userId}:`,
        userUpdateError
      );
    }

    logger.info(
      `[DataPurge] Admin ${auth.uid} cancelled pending deletion for user ${userId}`
    );

    return {
      success: true,
      message: `Pending deletion cancelled for user ${userId}`,
    };
  }
);

// ---------------------------------------------------------------------------
// Admin callable: Exempt a user from auto-deletion
// ---------------------------------------------------------------------------
const exemptUserFromDeletion = onCall(
  {
    enforceAppCheck: false,
    cpu: 0.5,
    memory: "256MiB",
  },
  async (request) => {
    const { data, auth } = request;

    if (!auth) {
      throw new Error("Unauthorized. User must be authenticated.");
    }

    // Verify caller is admin
    const callerDoc = await admin
      .firestore()
      .collection("users")
      .doc(auth.uid)
      .get();
    if (!callerDoc.exists || callerDoc.data().role !== "admin") {
      throw new Error(
        "Permission denied. Only administrators can exempt users."
      );
    }

    const { userId, exempt } = data;
    if (!userId) {
      throw new Error("User ID is required.");
    }

    const db = admin.firestore();

    // Set or remove exemption flag on user document
    await db
      .collection("users")
      .doc(userId)
      .update({
        exemptFromDeletion: exempt !== false, // default to true
        exemptedBy: auth.uid,
        exemptedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    // If exempting, also cancel any pending deletion
    if (exempt !== false) {
      const pendingRef = db.collection("pendingDeletions").doc(userId);
      const pendingDoc = await pendingRef.get();
      if (pendingDoc.exists) {
        await pendingRef.delete();
        logger.info(
          `[DataPurge] Also cancelled pending deletion for exempted user ${userId}`
        );
      }
    }

    logger.info(
      `[DataPurge] Admin ${auth.uid} set exemption=${exempt !== false} for user ${userId}`
    );

    return {
      success: true,
      message: `User ${userId} exemption set to ${exempt !== false}`,
    };
  }
);

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  scheduledDataPurgeCheck,
  executePendingDeletions,
  cancelPendingDeletion,
  exemptUserFromDeletion,
};
