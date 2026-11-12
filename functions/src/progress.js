/**
 * Progress tracking Cloud Functions.
 *
 * Architecture:
 *   contentItems (student-writable) ──trigger──▶ recalculate courseProgress
 *   courseProgress (server-writable only) ──trigger──▶ update user.examReadiness
 *   streaks (server-writable only) ──trigger──▶ mirror to user.currentStreak
 *   module content changes ──trigger──▶ refresh totals in courseProgress for
 *     all enrolled students + set contentUpdatedAt
 *
 * Students write ONLY to progress/{uid}/contentItems/{id}.
 * Everything else is computed server-side.
 */

const { onDocumentWritten, onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const {
  computeModuleSummary,
  mergeSegments,
  sumSegments,
  findContentItemWithType,
  evaluateVideoProgress,
} = require("./progressHelpers");

const db = admin.firestore();

// ── Constants ────────────────────────────────────────────────────────────────

const COURSE_PROGRESS_SUBCOLLECTION = "courseProgress";
const DEFAULT_VIDEO_COMPLETION_THRESHOLD = 90;
const MAX_STREAK_HISTORY_ENTRIES = 90;

// ─────────────────────────────────────────────────────────────────────────────
// 1. onContentItemWrite → recalculate courseProgress + streak
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Triggered whenever a student writes to their contentItems subcollection.
 * Recalculates the parent courseProgress doc and updates the streak.
 */
exports.onContentItemWrite = onDocumentWritten(
  {
    document: "progress/{userId}/contentItems/{contentId}",
    cpu: 0.5,
    memory: "256MiB",
    maxInstances: 50,
  },
  async (event) => {
    const { userId } = event.params;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return; // deletion (e.g. from recursiveDelete) — skip

    const courseId = after.courseId;
    if (!courseId) {
      logger.warn(`contentItem ${event.params.contentId} missing courseId`);
      return;
    }

    try {
      // Always record daily activity — it's cheap (returns early when
      // lastActivityDate === today) and skipping it would starve streaks
      // during long video sessions.
      await recordDailyActivity(userId);

      // Write amplification guard: skip full recalculation if nothing
      // meaningful changed. Heartbeats that only update lastAccessedAt
      // or videoProgress.lastServerCheckAt don't need a full recalc.
      const statusChanged = before?.status !== after.status;
      const completionChanged = (before?.completedAt?.toMillis?.() ?? null) !== (after.completedAt?.toMillis?.() ?? null);
      const moduleChanged = before?.moduleId !== after.moduleId;
      const opened = !before || (after.viewCount ?? 0) !== (before.viewCount ?? 0);

      if (statusChanged || completionChanged || moduleChanged || opened) {
        await recalculateCourseProgress(userId, courseId);
      }
    } catch (err) {
      logger.error(`Error processing contentItem write for ${userId}/${courseId}:`, err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. onCourseProgressWrite → update user.examReadiness
// ─────────────────────────────────────────────────────────────────────────────

exports.onCourseProgressWrite = onDocumentWritten(
  {
    document: `progress/{userId}/${COURSE_PROGRESS_SUBCOLLECTION}/{courseId}`,
    cpu: 0.5,
    memory: "256MiB",
    maxInstances: 30,
  },
  async (event) => {
    const { userId } = event.params;

    // Skip delete events (e.g. from recursiveDelete during user deletion)
    if (!event.data?.after?.exists) return;

    try {
      // Read assigned courses from user doc so unstarted courses count as 0%.
      const userDoc = await db.doc(`users/${userId}`).get();
      if (!userDoc.exists) {
        logger.info(`Skipping examReadiness update — user ${userId} doc gone`);
        return;
      }
      const assignedCourseIds = userDoc.data().assignedCourseIds ?? [];

      const snap = await db
        .collection(`progress/${userId}/${COURSE_PROGRESS_SUBCOLLECTION}`)
        .get();

      // Index existing courseProgress docs by courseId
      const byId = new Map();
      snap.forEach((d) => byId.set(d.id, d.data()));

      let weightedSum = 0;
      let totalWeight = 0;
      let completed = 0;
      let maxActivityMs = 0;

      // Loop over assigned courses, not just existing progress docs.
      // Unstarted courses contribute weight * 0% to the average.
      for (const cid of assignedCourseIds) {
        const cp = byId.get(cid);
        const w = (cp && typeof cp.weight === "number") ? cp.weight : 1;
        weightedSum += w * (cp?.completionPercentage ?? 0);
        totalWeight += w;
        if (cp?.status === "completed") completed++;
        const t = cp?.lastActivityAt?.toMillis?.() ?? 0;
        if (t > maxActivityMs) maxActivityMs = t;
      }

      const examReadiness = totalWeight > 0
        ? Math.round(weightedSum / totalWeight)
        : 0;

      const userUpdate = {
        examReadiness,
        totalCoursesCompleted: completed,
      };
      // Only set lastActivityAt if we have a real timestamp from course progress
      if (maxActivityMs > 0) {
        userUpdate.lastActivityAt = admin.firestore.Timestamp.fromMillis(maxActivityMs);
      }

      await db.doc(`users/${userId}`).update(userUpdate);

      logger.info(`Updated examReadiness=${examReadiness} for user ${userId} (${assignedCourseIds.length} assigned, ${byId.size} started)`);
    } catch (err) {
      // Grpc code 5 = NOT_FOUND — user doc was deleted; swallow.
      if (err.code === 5) {
        logger.info(`Skipping examReadiness update — user ${userId} doc gone`);
        return;
      }
      logger.error(`Error updating examReadiness for ${userId}:`, err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. onStreakWrite → mirror to user doc
// ─────────────────────────────────────────────────────────────────────────────

exports.onStreakWrite = onDocumentWritten(
  {
    document: "streaks/{userId}",
    cpu: 0.5,
    memory: "256MiB",
    maxInstances: 20,
  },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return; // deletion — skip

    try {
      // update() instead of set({merge:true}) — won't recreate a deleted user doc.
      await db.doc(`users/${event.params.userId}`).update(
        {
          currentStreak: after.currentStreak ?? 0,
          lastActivityDate: after.lastActivityDate ?? null,
        }
      );
    } catch (err) {
      // Grpc code 5 = NOT_FOUND — user doc was deleted; swallow.
      if (err.code === 5) {
        logger.info(`Skipping streak mirror — user ${event.params.userId} doc gone`);
        return;
      }
      logger.error(`Error mirroring streak for ${event.params.userId}:`, err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3b. onUserAssignmentChange → recompute examReadiness when assignedCourseIds changes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When a user's assignedCourseIds changes (admin assigns or unassigns a course),
 * recompute examReadiness so the score reflects the new denominator.
 * Without this, unassigning a course would leave a stale score.
 */
exports.onUserAssignmentChange = onDocumentUpdated(
  {
    document: "users/{userId}",
    cpu: 0.5,
    memory: "256MiB",
    maxInstances: 20,
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    // Only fire when assignedCourseIds actually changed
    const prevIds = JSON.stringify((before.assignedCourseIds ?? []).sort());
    const newIds = JSON.stringify((after.assignedCourseIds ?? []).sort());
    if (prevIds === newIds) return;

    const userId = event.params.userId;
    // Only for students
    if (after.role !== "student") return;

    try {
      const assignedCourseIds = after.assignedCourseIds ?? [];
      const snap = await db
        .collection(`progress/${userId}/${COURSE_PROGRESS_SUBCOLLECTION}`)
        .get();

      const byId = new Map();
      snap.forEach((d) => byId.set(d.id, d.data()));

      let weightedSum = 0;
      let totalWeight = 0;
      let completed = 0;

      for (const cid of assignedCourseIds) {
        const cp = byId.get(cid);
        const w = (cp && typeof cp.weight === "number") ? cp.weight : 1;
        weightedSum += w * (cp?.completionPercentage ?? 0);
        totalWeight += w;
        if (cp?.status === "completed") completed++;
      }

      const examReadiness = totalWeight > 0
        ? Math.round(weightedSum / totalWeight)
        : 0;

      await db.doc(`users/${userId}`).update({
        examReadiness,
        totalCoursesCompleted: completed,
      });

      logger.info(`Recomputed examReadiness=${examReadiness} for user ${userId} after assignment change`);
    } catch (err) {
      if (err.code === 5) return; // user deleted mid-update
      logger.error(`Error recomputing readiness on assignment change for ${userId}:`, err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. onModuleContentChange → refresh totals + set contentUpdatedAt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When a module's `content` field changes (admin adds/removes videos, PDFs, etc.),
 * update `contentUpdatedAt` on the module and refresh the totals in every
 * enrolled student's courseProgress doc.
 *
 * We compare before/after content arrays to avoid false triggers on title edits.
 */
exports.onModuleContentChange = onDocumentWritten(
  {
    document: "modules/{moduleId}",
    cpu: 0.5,
    memory: "512MiB",
    maxInstances: 20,
    timeoutSeconds: 540,
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // Deletion or creation with no content — skip
    if (!after) return;

    // Detect whether the *content* actually changed (not just title/description)
    const contentBefore = before?.content || {};
    const contentAfter = after.content || {};

    // Build Sets of content IDs for before/after to detect adds vs removals
    const getContentIdSet = (c) => {
      const ids = new Set();
      for (const type of ["videos", "pdfs", "notes", "audios", "images", "links"]) {
        for (const item of c[type] || []) {
          ids.add(`${type}:${item.id}`);
        }
      }
      return ids;
    };

    const beforeSet = getContentIdSet(contentBefore);
    const afterSet = getContentIdSet(contentAfter);

    // Check if content IDs actually changed
    const added = [...afterSet].filter((id) => !beforeSet.has(id));
    const removed = [...beforeSet].filter((id) => !afterSet.has(id));

    if (added.length === 0 && removed.length === 0) {
      // Content didn't change — skip (this was a title/description edit)
      return;
    }

    const courseId = after.courseId;
    const moduleId = event.params.moduleId;

    logger.info(
      `Content changed in module ${moduleId}: +${added.length} added, -${removed.length} removed`
    );

    try {
      // 4a. Only bump contentUpdatedAt when content was ADDED (not removal-only).
      // This prevents the "Updated" badge from firing when content is removed,
      // which would create an un-clearable badge (nothing new for the student
      // to complete).
      if (added.length > 0) {
        await db.doc(`modules/${moduleId}`).update({
          contentUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // 4b. Find all students enrolled in this course
      if (!courseId) return;

      const usersSnap = await db
        .collection("users")
        .where("role", "==", "student")
        .where("assignedCourseIds", "array-contains", courseId)
        .get();

      if (usersSnap.empty) return;

      // 4c. Refresh only students who already have a courseProgress doc.
      // Students who haven't started should NOT get a doc created by an
      // admin edit — that would mark them as active and create orphan docs.
      const userIds = usersSnap.docs.map((d) => d.id);
      const CHUNK_SIZE = 10;
      for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
        const chunk = userIds.slice(i, i + CHUNK_SIZE);
        // Batch-read courseProgress docs to check existence
        const cpRefs = chunk.map((uid) =>
          db.doc(`progress/${uid}/${COURSE_PROGRESS_SUBCOLLECTION}/${courseId}`)
        );
        const cpSnaps = await db.getAll(...cpRefs);
        const startedUids = chunk.filter((_, idx) => cpSnaps[idx].exists);

        if (startedUids.length === 0) continue;

        await Promise.all(
          startedUids.map((uid) =>
            recalculateCourseProgress(uid, courseId).catch((err) => {
              logger.warn(`Failed to refresh progress for ${uid}/${courseId}:`, err.message);
            })
          )
        );
      }

      logger.info(`Refreshed progress totals for ${userIds.length} enrolled students in course ${courseId}`);
    } catch (err) {
      logger.error(`Error handling module content change for ${moduleId}:`, err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Callable: recordProgress (validated content-item write for mobile app)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callable function for the mobile app to record progress.
 * Validates the data and writes to contentItems on behalf of the student.
 *
 * This is the ONLY write path for contentItems. The mobile app writes
 * position-only data to the `resume` subcollection for resume UX;
 * this callable records status, segments, and completedAt.
 *
 * Call on: pause, exit, completion, and roughly every minute.
 */
exports.recordProgress = onCall(
  {
    enforceAppCheck: false,
    cpu: 0.5,
    memory: "256MiB",
    maxInstances: 50,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const userId = request.auth.uid;
    const payload = request.data && typeof request.data === "object" ? request.data : {};
    const { courseId, moduleId, contentId, contentType, action } = payload;
    const progressData = payload.data && typeof payload.data === "object" ? payload.data : {};

    // Validate required fields
    if (!courseId || !moduleId || !contentId || !contentType || !action) {
      throw new HttpsError("invalid-argument",
        "Missing required fields: courseId, moduleId, contentId, contentType, action");
    }

    // Validate field shapes (no slashes — prevents path traversal)
    for (const [name, val] of [["courseId", courseId], ["moduleId", moduleId], ["contentId", contentId]]) {
      if (typeof val !== "string" || val.includes("/") || val.length > 128) {
        throw new HttpsError("invalid-argument", `Invalid ${name}.`);
      }
    }

    const validTypes = ["video", "pdf", "note", "audio", "image", "link"];
    if (!validTypes.includes(contentType)) {
      throw new HttpsError("invalid-argument", `Invalid contentType: ${contentType}`);
    }

    const validActions = ["start", "update_position", "complete"];
    if (!validActions.includes(action)) {
      throw new HttpsError("invalid-argument", `Invalid action: ${action}`);
    }

    // Verify the student's user doc exists (catches disabled users mid-delete)
    const userDoc = await db.doc(`users/${userId}`).get();
    if (!userDoc.exists) {
      throw new HttpsError("not-found", "User not found.");
    }

    const userData = userDoc.data();
    const assignedCourseIds = userData.assignedCourseIds || [];
    if (!assignedCourseIds.includes(courseId)) {
      throw new HttpsError("permission-denied", "Not enrolled in this course.");
    }

    // Verify the content item exists in the module
    const moduleDoc = await db.doc(`modules/${moduleId}`).get();
    if (!moduleDoc.exists) {
      throw new HttpsError("not-found", "Module not found.");
    }

    const moduleData = moduleDoc.data();
    if (moduleData.courseId !== courseId) {
      throw new HttpsError("invalid-argument", "Module does not belong to this course.");
    }

    // Find the content item in the module — also returns the canonical type
    // so we can reject type mismatches (B1: prevents completing videos via "note" action)
    const found = findContentItemWithType(moduleData.content, contentId);
    if (!found) {
      throw new HttpsError("not-found", "Content item not found in module.");
    }
    if (found.type !== contentType) {
      throw new HttpsError("invalid-argument",
        `Content type mismatch: item is ${found.type}, request says ${contentType}.`);
    }
    const serverContentItem = found.item;

    const now = admin.firestore.Timestamp.now();
    const contentItemRef = db.doc(`progress/${userId}/contentItems/${contentId}`);

    // Pre-fetch threshold outside the transaction (cached, read-only)
    const threshold = contentType === "video" ? await getVideoThreshold() : 0;

    // Wrap the contentItems read+write in a transaction so two concurrent
    // calls (retry overlapping original, or two devices) can't both receive
    // the full wall-clock allowance from the same `existing` snapshot.
    //
    // B2: Completion is monotonic — once completed, status stays "completed"
    // and completedAt is never re-stamped. Reopening finished content does
    // NOT un-complete it.
    const result = await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(contentItemRef);
      const existing = existingSnap.exists ? existingSnap.data() : null;

      // B2: preserve existing completion — never regress
      let status = existing?.status === "completed" ? "completed" : "in_progress";
      let completedAt = existing?.completedAt ?? null;
      const markDone = () => {
        status = "completed";
        if (!completedAt) completedAt = now; // only stamp once
      };

      let capped = false;
      const updatePayload = {
        userId,
        courseId,
        moduleId,
        contentId,
        contentType,
        lastAccessedAt: now,
        firstAccessedAt: existing?.firstAccessedAt || now,
        viewCount: (existing?.viewCount || 0) + (action === "start" ? 1 : 0),
        totalTimeSpent: existing?.totalTimeSpent || 0,
      };

      if (contentType === "video") {
        // B2: always evaluate video progress, even on "start" with no payload,
        // so lastServerCheckAt is set for the first heartbeat.
        let videoResult;
        try {
          videoResult = evaluateVideoProgress({
            existing,
            incomingSegments: progressData.watchedSegments,
            serverDuration: serverContentItem.duration || 0,
            nowMs: Date.now(),
            threshold,
            action,
            currentPosition: progressData.currentPosition ?? existing?.videoProgress?.currentPosition ?? 0,
          });
        } catch (err) {
          throw new HttpsError("invalid-argument", err.message);
        }

        if (videoResult.completedAt) markDone();
        capped = videoResult.capped;

        if (videoResult.needsDurationWarning) {
          logger.warn(
            `Video completion denied for ${contentId} — no server-known duration. ` +
            `Add duration to the content item in module ${moduleId}.`
          );
        }

        updatePayload.videoProgress = {
          currentPosition: videoResult.currentPosition,
          totalDuration: videoResult.totalDuration,
          percentageWatched: videoResult.percentageWatched,
          watchedSegments: videoResult.watchedSegments,
          lastWatchedAt: now,
          lastServerCheckAt: admin.firestore.Timestamp.fromMillis(videoResult.lastServerCheckAt),
        };
      } else if (contentType === "pdf") {
        // B2: track high-water-mark page — never regress
        const okPage = (n) => Number.isInteger(n) && n >= 1 && n <= 5000;
        const prev = existing?.documentProgress;
        const totalPages = serverContentItem.pageCount
          ?? prev?.totalPages
          ?? (okPage(progressData.totalPages) ? progressData.totalPages : null);
        const furthest = Math.max(
          prev?.currentPage ?? 0,
          okPage(progressData.currentPage) ? progressData.currentPage : 0
        );
        if (totalPages && furthest >= totalPages) markDone();

        updatePayload.documentProgress = {
          currentPage: furthest,
          totalPages: totalPages ?? 0,
          percentageRead: totalPages
            ? Math.min(100, Math.round((furthest / totalPages) * 100))
            : 0,
          lastReadAt: now,
        };
      } else if (action === "complete") {
        // Non-video, non-PDF: explicit "complete" action
        markDone();
      }

      updatePayload.status = status;
      updatePayload.completedAt = completedAt;

      tx.set(contentItemRef, updatePayload, { merge: true });

      return { status, capped };
    });

    // B3: Initialize courseProgress doc only on "start" action.
    // Uses create() which is atomic — if two concurrent calls both reach here,
    // the second one gets ALREADY_EXISTS and is safely caught.
    if (action === "start") {
      try {
        await initializeCourseProgressDoc(userId, courseId);
      } catch (initErr) {
        // Safe: another concurrent call already created it (race condition guard).
        // Firestore may use numeric code 6 or string "already-exists".
        if (initErr.code !== 6 && initErr.code !== "already-exists") throw initErr;
        logger.info(`courseProgress doc already exists for ${userId}/${courseId}`);
      }
    }

    // The onContentItemWrite trigger handles recalculation and streak.

    return { success: true, status: result.status, capped: result.capped };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS (server-side only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recalculate courseProgress from contentItems for a given user + course.
 * This is the server-side authoritative version.
 *
 * Bails out if the user doc doesn't exist (deletion cascade).
 */
async function recalculateCourseProgress(userId, courseId) {
  // Guard: don't create/update progress if the user was deleted.
  const userSnap = await db.doc(`users/${userId}`).get();
  if (!userSnap.exists) {
    logger.info(`Skipping recalculation — user ${userId} doc gone`);
    return;
  }

  const cpRef = db.doc(`progress/${userId}/${COURSE_PROGRESS_SUBCOLLECTION}/${courseId}`);

  // Ensure doc exists (race-safe: catch ALREADY_EXISTS)
  const cpSnap = await cpRef.get();
  if (!cpSnap.exists) {
    try {
      await initializeCourseProgressDoc(userId, courseId);
    } catch (initErr) {
      if (initErr.code !== 6 && initErr.code !== "already-exists") throw initErr;
    }
  }

  // Get all content items for this course
  const itemsSnap = await db
    .collection(`progress/${userId}/contentItems`)
    .where("courseId", "==", courseId)
    .get();

  const contentByModule = {};
  itemsSnap.forEach((d) => {
    const data = d.data();
    if (!contentByModule[data.moduleId]) contentByModule[data.moduleId] = [];
    contentByModule[data.moduleId].push(data);
  });

  // Get live modules for fresh totals
  const modulesSnap = await db
    .collection("modules")
    .where("courseId", "==", courseId)
    .orderBy("order", "asc")
    .get();

  const now = admin.firestore.Timestamp.now();
  const moduleProgress = {};
  const prevModuleProgress = cpSnap.exists ? (cpSnap.data().moduleProgress || {}) : {};
  let totalItems = 0;
  let completedItems = 0;
  let latestAccess = null;

  modulesSnap.forEach((modDoc) => {
    const mod = modDoc.data();
    const modId = modDoc.id;
    const content = mod.content || {};
    const items = contentByModule[modId] || [];
    const prevMp = prevModuleProgress[modId] || null;

    const result = computeModuleSummary(content, items, prevMp);
    moduleProgress[modId] = result.summary;
    totalItems += result.modTotal;
    completedItems += result.modCompleted;

    // Track latest access across all modules for resume
    for (const item of result.liveItems) {
      const t = item.lastAccessedAt?.toMillis?.() ?? 0;
      if (!latestAccess || t > latestAccess.at) {
        latestAccess = { moduleId: modId, contentId: item.contentId, contentType: item.contentType, at: t };
      }
    }
  });

  const overallPct = totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : 0;
  let courseStatus = "not_started";
  if (completedItems >= totalItems && totalItems > 0) courseStatus = "completed";
  else if (completedItems > 0) courseStatus = "in_progress";

  // B4: Derive lastActivityAt from actual content item timestamps, not `now`.
  // This prevents admin module edits from marking every student as "active just now".
  const prevData = cpSnap.exists ? cpSnap.data() : {};
  const derivedLastActivity = latestAccess?.at
    ? admin.firestore.Timestamp.fromMillis(latestAccess.at)
    : (prevData.lastActivityAt ?? now);

  // B4: Preserve completedAt — only stamp it once, never re-stamp on recalculation.
  const derivedCompletedAt = courseStatus === "completed"
    ? (prevData.completedAt ?? now)
    : null;

  const newData = {
    status: courseStatus,
    completionPercentage: overallPct,
    moduleProgress,
    lastAccessedModuleId: latestAccess?.moduleId ?? null,
    lastAccessedContentId: latestAccess?.contentId ?? null,
    lastAccessedContentType: latestAccess?.contentType ?? null,
    lastActivityAt: derivedLastActivity,
    updatedAt: now,
    completedAt: derivedCompletedAt,
  };

  // Skip no-op writes: if status, percentage, and resume pointer haven't
  // changed, don't write. This reduces write amplification from heartbeats.
  if (
    prevData.status === newData.status &&
    prevData.completionPercentage === newData.completionPercentage &&
    prevData.lastAccessedContentId === newData.lastAccessedContentId &&
    prevData.lastAccessedModuleId === newData.lastAccessedModuleId
  ) {
    return; // nothing meaningful changed
  }

  await cpRef.update(newData);
}

/**
 * Create an initial courseProgress doc with empty module summaries.
 */
async function initializeCourseProgressDoc(userId, courseId) {
  const modulesSnap = await db
    .collection("modules")
    .where("courseId", "==", courseId)
    .orderBy("order", "asc")
    .get();

  const moduleProgress = {};
  modulesSnap.forEach((modDoc) => {
    const mod = modDoc.data();
    const content = mod.content || {};
    moduleProgress[modDoc.id] = {
      status: "not_started",
      completionPercentage: 0,
      lastAccessedAt: null,
      completedAt: null,
      videosWatched: 0, videosTotal: content.videos?.length ?? 0,
      pdfsRead: 0, pdfsTotal: content.pdfs?.length ?? 0,
      notesRead: 0, notesTotal: content.notes?.length ?? 0,
      audiosListened: 0, audiosTotal: content.audios?.length ?? 0,
      imagesViewed: 0, imagesTotal: content.images?.length ?? 0,
      linksViewed: 0, linksTotal: content.links?.length ?? 0,
    };
  });

  const now = admin.firestore.Timestamp.now();
  // B3: Use create() instead of set() — atomic, throws ALREADY_EXISTS if the
  // doc was created by a concurrent call. This prevents overwriting progress
  // (resetting to 0) and losing admin-managed `weight`.
  await db.doc(`progress/${userId}/${COURSE_PROGRESS_SUBCOLLECTION}/${courseId}`).create({
    userId,
    courseId,
    status: "not_started",
    completionPercentage: 0,
    weight: 1,
    moduleProgress,
    lastAccessedModuleId: null,
    lastAccessedContentId: null,
    lastAccessedContentType: null,
    startedAt: now,
    lastActivityAt: null, // not `now` — student hasn't done anything yet
    completedAt: null,
    updatedAt: now,
  });
}

/**
 * Record daily activity for streak tracking.
 */
async function recordDailyActivity(userId) {
  try {
    // Read timezone from user doc
    const userDoc = await db.doc(`users/${userId}`).get();
    const timezone = userDoc.exists ? userDoc.data().timezone : null;

    const now = admin.firestore.Timestamp.now();
    const nowDate = now.toDate();
    const todayStr = formatDateInTimezone(nowDate, timezone);

    const ref = db.doc(`streaks/${userId}`);

    // Use a transaction to prevent concurrent streak updates from racing.
    // Two triggers firing near-simultaneously would both read the same state
    // and the second write could overwrite the first's increment.
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);

      if (!existing.exists) {
        tx.set(ref, {
          userId,
          currentStreak: 1,
          longestStreak: 1,
          lastActivityDate: todayStr,
          streakHistory: [{ date: todayStr, minutesActive: 0, contentItemsCompleted: 0 }],
          updatedAt: now,
        });
        return;
      }

      const data = existing.data();
      if (data.lastActivityDate === todayStr) {
        // Same day — no streak change. Don't write updatedAt either,
        // because that triggers onStreakWrite for nothing.
        return;
      }

      // Compute yesterday from the same nowDate to avoid midnight boundary mismatch (H4)
      const yesterdayDate = new Date(nowDate.getTime() - 86400000);
      const yesterdayStr = formatDateInTimezone(yesterdayDate, timezone);
      const newStreak = data.lastActivityDate === yesterdayStr ? data.currentStreak + 1 : 1;
      const newLongest = Math.max(newStreak, data.longestStreak);

      const history = [
        ...(data.streakHistory || []),
        { date: todayStr, minutesActive: 0, contentItemsCompleted: 0 },
      ].slice(-MAX_STREAK_HISTORY_ENTRIES);

      tx.update(ref, {
        currentStreak: newStreak,
        longestStreak: newLongest,
        lastActivityDate: todayStr,
        streakHistory: history,
        updatedAt: now,
      });
    });
  } catch (err) {
    logger.warn(`Non-fatal: streak update failed for ${userId}:`, err.message);
  }
}

/** Read video threshold from appConfig, with caching. */
let _cachedThreshold = null;
let _thresholdReadAt = 0;
async function getVideoThreshold() {
  const now = Date.now();
  if (_cachedThreshold !== null && now - _thresholdReadAt < 5 * 60 * 1000) {
    return _cachedThreshold;
  }
  try {
    const snap = await db.doc("appConfig/progressSettings").get();
    _cachedThreshold = snap.exists
      ? (snap.data().videoCompletionThreshold ?? DEFAULT_VIDEO_COMPLETION_THRESHOLD)
      : DEFAULT_VIDEO_COMPLETION_THRESHOLD;
  } catch {
    _cachedThreshold = DEFAULT_VIDEO_COMPLETION_THRESHOLD;
  }
  _thresholdReadAt = now;
  return _cachedThreshold;
}

/** Format Date to YYYY-MM-DD in given timezone, falling back to UTC. */
function formatDateInTimezone(date, timezone) {
  try {
    if (timezone) {
      return date.toLocaleDateString("en-CA", { timeZone: timezone });
    }
  } catch { /* fall through */ }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
