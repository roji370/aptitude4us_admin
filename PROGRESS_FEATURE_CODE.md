# Student Progress Tracking — Complete Feature Code

Generated: Wed Nov 11 18:20:47 IST 2026

---

## Cloud Functions — progress.js
`/Users/rojinroy/Projects/aptitude4us_admin/functions/src/progress.js`

```
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

const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const {
  computeModuleSummary,
  mergeSegments,
  sumSegments,
  findContentItem,
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
    const after = event.data?.after?.data();
    if (!after) return; // deletion (e.g. from recursiveDelete) — skip

    const courseId = after.courseId;
    if (!courseId) {
      logger.warn(`contentItem ${event.params.contentId} missing courseId`);
      return;
    }

    try {
      // recalculateCourseProgress has its own user-doc existence guard.
      await recalculateCourseProgress(userId, courseId);
      await recordDailyActivity(userId);
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
      const snap = await db
        .collection(`progress/${userId}/${COURSE_PROGRESS_SUBCOLLECTION}`)
        .get();

      let weightedSum = 0;
      let totalWeight = 0;
      let completed = 0;

      snap.forEach((d) => {
        const data = d.data();
        const w = typeof data.weight === "number" ? data.weight : 1;
        weightedSum += w * (data.completionPercentage ?? 0);
        totalWeight += w;
        if (data.status === "completed") completed++;
      });

      const examReadiness = totalWeight > 0
        ? Math.round(weightedSum / totalWeight)
        : 0;

      // Use update() — if the user doc was deleted mid-cascade, this
      // throws NOT_FOUND (code 5) instead of recreating a stub doc.
      await db.doc(`users/${userId}`).update({
        examReadiness,
        totalCoursesCompleted: completed,
        lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`Updated examReadiness=${examReadiness} for user ${userId}`);
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

      // 4c. Refresh each student's courseProgress
      const promises = [];
      usersSnap.forEach((userDoc) => {
        promises.push(
          recalculateCourseProgress(userDoc.id, courseId).catch((err) => {
            logger.warn(`Failed to refresh progress for ${userDoc.id}/${courseId}:`, err.message);
          })
        );
      });

      await Promise.all(promises);
      logger.info(`Refreshed progress totals for ${promises.length} students in course ${courseId}`);
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
    const { courseId, moduleId, contentId, contentType, action, data: progressData } = request.data;

    // Validate required fields
    if (!courseId || !moduleId || !contentId || !contentType || !action) {
      throw new HttpsError("invalid-argument",
        "Missing required fields: courseId, moduleId, contentId, contentType, action");
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

    // Find the content item in the module to get server-side totalDuration
    const serverContentItem = findContentItem(moduleData.content, contentId);
    if (!serverContentItem) {
      throw new HttpsError("not-found", "Content item not found in module.");
    }

    const now = admin.firestore.Timestamp.now();
    const contentItemRef = db.doc(`progress/${userId}/contentItems/${contentId}`);

    // Pre-fetch threshold outside the transaction (cached, read-only)
    const threshold = contentType === "video" ? await getVideoThreshold() : 0;

    // Wrap the contentItems read+write in a transaction so two concurrent
    // calls (retry overlapping original, or two devices) can't both receive
    // the full wall-clock allowance from the same `existing` snapshot.
    const result = await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(contentItemRef);
      const existing = existingSnap.exists ? existingSnap.data() : null;

      let status = "in_progress";
      let completedAt = null;
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

      // For non-video types, explicit "complete" action grants completion.
      if (action === "complete" && contentType !== "video") {
        status = "completed";
        completedAt = now;
      }

      if (contentType === "video" && progressData) {
        let videoResult;
        try {
          videoResult = evaluateVideoProgress({
            existing,
            incomingSegments: progressData.watchedSegments,
            serverDuration: serverContentItem.duration || 0,
            nowMs: Date.now(),
            threshold,
            action,
            currentPosition: progressData.currentPosition,
          });
        } catch (err) {
          throw new HttpsError("invalid-argument", err.message);
        }

        if (videoResult.completedAt) {
          status = "completed";
          completedAt = now;
        }
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
      }

      if (contentType === "pdf" && progressData) {
        const currentPage = progressData.currentPage || 1;
        const totalPages = progressData.totalPages || 1;
        if (currentPage >= totalPages) {
          status = "completed";
          completedAt = now;
        }
        updatePayload.documentProgress = {
          currentPage,
          totalPages,
          percentageRead: Math.round((currentPage / totalPages) * 100),
          lastReadAt: now,
        };
      }

      updatePayload.status = status;
      updatePayload.completedAt = completedAt;

      tx.set(contentItemRef, updatePayload, { merge: true });

      return { status, capped };
    });

    // Initialize courseProgress doc if it doesn't exist yet.
    // Uses create() which is atomic — if two concurrent calls both reach here,
    // the second one gets ALREADY_EXISTS and is safely caught.
    const cpRef = db.doc(`progress/${userId}/${COURSE_PROGRESS_SUBCOLLECTION}/${courseId}`);
    const cpSnap = await cpRef.get();
    if (!cpSnap.exists) {
      try {
        await initializeCourseProgressDoc(userId, courseId);
      } catch (initErr) {
        // Safe: another concurrent call already created it (race condition guard).
        if (initErr.code !== 6 /* ALREADY_EXISTS */) throw initErr;
        logger.info(`courseProgress doc already created by concurrent call for ${userId}/${courseId}`);
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
      if (initErr.code !== 6 /* ALREADY_EXISTS */) throw initErr;
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

  await cpRef.update({
    status: courseStatus,
    completionPercentage: overallPct,
    moduleProgress,
    lastAccessedModuleId: latestAccess?.moduleId ?? null,
    lastAccessedContentId: latestAccess?.contentId ?? null,
    lastAccessedContentType: latestAccess?.contentType ?? null,
    lastActivityAt: now,
    updatedAt: now,
    completedAt: courseStatus === "completed" ? now : null,
  });
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
  await db.doc(`progress/${userId}/${COURSE_PROGRESS_SUBCOLLECTION}/${courseId}`).set({
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
    lastActivityAt: now,
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
        tx.update(ref, { updatedAt: now });
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

function getYesterdayInTimezone(timezone) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return formatDateInTimezone(yesterday, timezone);
}
```

---

## Cloud Functions — progressHelpers.js
`/Users/rojinroy/Projects/aptitude4us_admin/functions/src/progressHelpers.js`

```
/**
 * Pure helper functions for progress computation.
 * No Firestore, no admin SDK — safe to import in unit tests.
 */

const CONTENT_TYPES = ["videos", "pdfs", "notes", "audios", "images", "links"];

/**
 * Compute a module progress summary from content items and module content.
 *
 * @param {Object} content - The module's content map ({videos: [], pdfs: [], ...})
 * @param {Array} items - All contentItems docs for this module (may include orphans)
 * @param {Object|null} prevModuleProgress - Previous moduleProgress entry (for completedAt preservation)
 * @returns {{ summary: Object, modTotal: number, modCompleted: number, liveItems: Array }}
 */
function computeModuleSummary(content, items, prevModuleProgress) {
  const videosTotal = content.videos?.length ?? 0;
  const pdfsTotal = content.pdfs?.length ?? 0;
  const notesTotal = content.notes?.length ?? 0;
  const audiosTotal = content.audios?.length ?? 0;
  const imagesTotal = content.images?.length ?? 0;
  const linksTotal = content.links?.length ?? 0;
  const modTotal = videosTotal + pdfsTotal + notesTotal + audiosTotal + imagesTotal + linksTotal;

  // Build a Set of live content IDs from the module's content arrays.
  // Only count contentItems whose ID is in this set — orphans from
  // deleted content should not inflate completed counts or feed the
  // "Updated" badge's completedAt max.
  const liveContentIds = new Set();
  for (const type of CONTENT_TYPES) {
    for (const ci of content[type] || []) {
      liveContentIds.add(ci.id);
    }
  }
  const liveItems = items.filter((i) => liveContentIds.has(i.contentId));

  const videosWatched = liveItems.filter((i) => i.contentType === "video" && i.status === "completed").length;
  const pdfsRead = liveItems.filter((i) => i.contentType === "pdf" && i.status === "completed").length;
  const notesRead = liveItems.filter((i) => i.contentType === "note" && i.status === "completed").length;
  const audiosListened = liveItems.filter((i) => i.contentType === "audio" && i.status === "completed").length;
  const imagesViewed = liveItems.filter((i) => i.contentType === "image" && i.status === "completed").length;
  const linksViewed = liveItems.filter((i) => i.contentType === "link" && i.status === "completed").length;
  const modCompletedRaw = videosWatched + pdfsRead + notesRead + audiosListened + imagesViewed + linksViewed;
  const modCompleted = Math.min(modCompletedRaw, modTotal);

  const pct = modTotal > 0 ? Math.min(100, Math.round((modCompleted / modTotal) * 100)) : 0;
  let modStatus = "not_started";
  if (modCompleted >= modTotal && modTotal > 0) modStatus = "completed";
  else if (modCompleted > 0 || liveItems.length > 0) modStatus = "in_progress";

  // Find module-level last access and completion timestamps.
  // Only use liveItems — orphans from deleted content should not
  // inflate completedAt or lastAccessed.
  let moduleLastAccessed = null;
  const prevCompleted = prevModuleProgress?.completedAt || null;
  let moduleCompletedAt = null;

  for (const item of liveItems) {
    const t = item.lastAccessedAt?.toMillis?.() ?? 0;
    if (!moduleLastAccessed || t > moduleLastAccessed.toMillis()) {
      moduleLastAccessed = item.lastAccessedAt;
    }
    // When status is "completed", set completedAt to the max of live items'
    // completedAt — this is the NEW completion time, not preserved from before.
    if (modStatus === "completed" && item.completedAt) {
      const ct = item.completedAt.toMillis?.() ?? 0;
      if (!moduleCompletedAt || ct > moduleCompletedAt.toMillis()) {
        moduleCompletedAt = item.completedAt;
      }
    }
  }

  // If module was previously completed but now regressed (new content added),
  // preserve the old completedAt so the "Updated" badge can fire.
  if (modStatus !== "completed" && !moduleCompletedAt && prevCompleted) {
    moduleCompletedAt = prevCompleted;
  }

  return {
    summary: {
      status: modStatus,
      completionPercentage: pct,
      lastAccessedAt: moduleLastAccessed,
      completedAt: moduleCompletedAt,
      videosWatched, videosTotal,
      pdfsRead, pdfsTotal,
      notesRead, notesTotal,
      audiosListened, audiosTotal,
      imagesViewed, imagesTotal,
      linksViewed, linksTotal,
    },
    modTotal,
    modCompleted,
    liveItems,
  };
}

/**
 * Merge overlapping watched segments into non-overlapping intervals.
 */
function mergeSegments(segments) {
  const valid = segments.filter((s) => s.end > s.start);
  if (valid.length === 0) return [];

  valid.sort((a, b) => a.start - b.start);
  const merged = [{ ...valid[0] }];

  for (let i = 1; i < valid.length; i++) {
    const last = merged[merged.length - 1];
    if (valid[i].start <= last.end) {
      last.end = Math.max(last.end, valid[i].end);
    } else {
      merged.push({ ...valid[i] });
    }
  }
  return merged;
}

/** Sum total watched seconds from a segments array. */
function sumSegments(segments) {
  if (!segments || segments.length === 0) return 0;
  return segments.reduce((s, seg) => s + ((seg.end || 0) - (seg.start || 0)), 0);
}

/**
 * Find a content item by ID across all content arrays in a module's content map.
 * Returns the item object or null.
 */
function findContentItem(content, contentId) {
  if (!content) return null;
  for (const type of CONTENT_TYPES) {
    const arr = content[type] || [];
    const found = arr.find((item) => item.id === contentId);
    if (found) return found;
  }
  return null;
}

/**
 * Evaluate video progress: validate segments, enforce wall-clock cap,
 * compute percentage, and determine completion status.
 *
 * Pure function — throws plain Error (caller wraps as HttpsError).
 *
 * @param {Object} opts
 * @param {Object|null} opts.existing - Previous contentItem data (null on first call)
 * @param {Array} opts.incomingSegments - New segments from the client
 * @param {number} opts.serverDuration - Duration from the module's content item (0 if unknown)
 * @param {number} opts.nowMs - Current time in milliseconds (Date.now())
 * @param {number} opts.threshold - Completion threshold percentage (e.g. 90)
 * @param {string} opts.action - The action: "start", "update_position", or "complete"
 * @param {number} [opts.currentPosition] - Client-reported playback position
 * @returns {{ status: string, completedAt: boolean, watchedSegments: Array,
 *             percentageWatched: number, totalDuration: number, currentPosition: number,
 * @returns {{ status: string, completedAt: boolean, watchedSegments: Array,
 *             percentageWatched: number, totalDuration: number, currentPosition: number,
 *             lastServerCheckAt: number, capped: boolean, needsDurationWarning: boolean }}
 * @throws {Error} on invalid segments or over-duration (malformed data, not rate issues)
 */
function evaluateVideoProgress({
  existing,
  incomingSegments,
  serverDuration,
  nowMs,
  threshold,
  action,
  currentPosition = 0,
}) {
  const prevSegments = existing?.videoProgress?.watchedSegments || [];
  const newSegments = incomingSegments || [];

  // Validate segment shape (malformed data → throw)
  for (const seg of newSegments) {
    if (
      typeof seg.start !== "number" ||
      typeof seg.end !== "number" ||
      seg.start < 0 ||
      seg.end < seg.start
    ) {
      throw new Error("Invalid segment data.");
    }
  }

  // Validate server duration if provided
  const hasServerDuration =
    Number.isFinite(serverDuration) && serverDuration > 0;
  const totalDuration = hasServerDuration ? serverDuration : 0;

  const merged = mergeSegments([...prevSegments, ...newSegments]);
  let watchedSeconds = merged.reduce(
    (s, seg) => s + (seg.end - seg.start),
    0
  );

  // Wall-clock cap: credit up to maxAdded of new watched seconds.
  // Instead of throwing, trim excess and signal capped: true.
  // This handles legitimate offline/backgrounded playback gracefully —
  // a network blip shouldn't look like cheating.
  //
  // lastServerCheckAt is updated on every call (start, heartbeat, etc.),
  // so elapsed is always bounded. We cap elapsed at 300s (5 min) so a
  // day-old record can't claim the whole video in one call.
  const prevSeconds = sumSegments(prevSegments);
  const added = watchedSeconds - prevSeconds;

  const lastCheckMs =
    existing?.videoProgress?.lastServerCheckAt?.toMillis?.() ??
    existing?.videoProgress?.lastServerCheckAt ??
    null;
  const rawElapsed = lastCheckMs ? (nowMs - lastCheckMs) / 1000 : 0;
  const elapsed = Math.min(rawElapsed, 300); // cap at 5 minutes
  const maxAdded = lastCheckMs ? elapsed * 2 + 5 : 15; // first call: 15s

  let capped = false;
  let finalSegments = merged;
  if (added > maxAdded) {
    // Trim: credit only maxAdded worth of NEW coverage, preserving
    // all previously credited segments. This is safe for cumulative
    // sending — re-sending the same list adds 0 new seconds.
    const trimResult = trimSegmentsWithBudget(merged, mergeSegments(prevSegments.map((s) => ({ ...s }))), maxAdded);
    finalSegments = trimResult.segments;
    watchedSeconds = sumSegments(finalSegments);
    capped = true;
  }

  // Reject if total watched exceeds video duration (10% tolerance).
  // This is malformed data — not a rate issue — so we still throw.
  if (totalDuration > 0 && watchedSeconds > totalDuration * 1.1) {
    throw new Error("Watched segments exceed video duration.");
  }

  const pct =
    totalDuration > 0
      ? Math.min(100, Math.round((watchedSeconds / totalDuration) * 100))
      : 0;

  let status = "in_progress";
  let completedAt = false;
  if (hasServerDuration && pct >= threshold) {
    status = "completed";
    completedAt = true;
  }

  return {
    status,
    completedAt,
    watchedSegments: finalSegments,
    percentageWatched: pct,
    totalDuration,
    currentPosition: currentPosition || 0,
    lastServerCheckAt: nowMs,
    capped,
    needsDurationWarning: !hasServerDuration && action === "complete",
  };
}

/**
 * Subtract existing coverage from incoming segments.
 * Both inputs must be sorted, merged (non-overlapping).
 * Returns the portions of `incoming` that are NOT covered by `existing`.
 */
function subtractCoverage(incoming, existing) {
  const out = [];
  for (const seg of incoming) {
    let cur = seg.start;
    for (const ex of existing) {
      if (ex.end <= cur) continue;
      if (ex.start >= seg.end) break;
      if (ex.start > cur) out.push({ start: cur, end: ex.start });
      cur = Math.max(cur, ex.end);
      if (cur >= seg.end) break;
    }
    if (cur < seg.end) out.push({ start: cur, end: seg.end });
  }
  return out;
}

/**
 * Take the earliest `budget` seconds from a sorted, merged segment array.
 * Truncates the segment that straddles the budget boundary.
 */
function takeEarliest(segments, budget) {
  const result = [];
  let remaining = budget;
  for (const seg of segments) {
    if (remaining <= 0) break;
    const len = seg.end - seg.start;
    if (len <= remaining) {
      result.push({ ...seg });
      remaining -= len;
    } else {
      result.push({ start: seg.start, end: seg.start + remaining });
      remaining = 0;
    }
  }
  return result;
}

/**
 * Trim incoming segments so that only `maxAdded` NEW seconds are credited.
 *
 * With cumulative sending, the client re-sends the full merged segment list
 * on every heartbeat. We must only trim the *new* coverage (portions not
 * in `existingSegments`), and always preserve all previously credited
 * coverage. This ensures:
 * - Retries are idempotent (re-sending identical list adds 0 new seconds).
 * - Previously credited coverage never shrinks.
 * - Only the earliest new coverage is credited up to the budget.
 *
 * @param {Array} allMerged - The merged union of existing + incoming segments
 * @param {Array} existingSegments - Previously stored segments (sorted, merged)
 * @param {number} maxAdded - Maximum new seconds to credit
 * @returns {Array} Final segment list (existing + allowed new coverage, merged)
 */
function trimSegmentsWithBudget(allMerged, existingSegments, maxAdded) {
  // Find the new coverage: portions of allMerged not covered by existingSegments
  const freshCoverage = subtractCoverage(allMerged, existingSegments);
  const freshTotal = sumSegments(freshCoverage);

  if (freshTotal <= maxAdded) {
    // All new coverage fits within budget — return allMerged as-is
    return { segments: allMerged, capped: false };
  }

  // Take only the earliest `maxAdded` seconds of new coverage
  const allowedFresh = takeEarliest(freshCoverage, maxAdded);

  // Merge existing + allowed fresh into a single sorted list
  const combined = [...existingSegments.map((s) => ({ ...s })), ...allowedFresh];
  const result = mergeSegments(combined);

  return { segments: result, capped: true };
}

/**
 * Legacy: Trim a sorted, merged segment array so total watched seconds ≤ maxTotal.
 * Truncates the last segment that would exceed the budget.
 *
 * @deprecated Use trimSegmentsWithBudget for cumulative sending.
 * Kept for backward compatibility in tests.
 */
function trimSegmentsToTotal(segments, maxTotal) {
  const result = [];
  let remaining = maxTotal;
  for (const seg of segments) {
    const len = seg.end - seg.start;
    if (remaining <= 0) break;
    if (len <= remaining) {
      result.push({ ...seg });
      remaining -= len;
    } else {
      result.push({ start: seg.start, end: seg.start + remaining });
      remaining = 0;
    }
  }
  return result;
}

module.exports = {
  computeModuleSummary,
  mergeSegments,
  sumSegments,
  findContentItem,
  evaluateVideoProgress,
  trimSegmentsToTotal,
  trimSegmentsWithBudget,
  subtractCoverage,
  takeEarliest,
};

```

---

## Firestore Security Rules
`/Users/rojinroy/Projects/aptitude4us_admin/firestore.rules`

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function isAuthenticated() {
      return request.auth != null;
    }
    function isAdmin() {
      return isAuthenticated() && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    // Users collection rules
    match /users/{userId} {
      allow read: if isAuthenticated() && request.auth.uid == userId;
      allow read: if isAdmin();
      allow read: if request.auth.token.role == 'admin';
      // User docs are created server-side by the createUser Cloud Function.
      // Block client-side create to prevent privilege escalation
      // (a student could create their doc with role: 'admin').
      allow create: if false;
      // Allow-list: students may only touch these safe profile fields.
      // Everything else (role, assignedCourseIds, examReadiness,
      // currentStreak, totalCoursesCompleted) is server-managed.
      allow update: if isAuthenticated() && request.auth.uid == userId
        && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(['displayName', 'photoURL', 'timezone', 'fcmToken', 'lastLoginAt'])
        && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['timezone'])
            || (request.resource.data.timezone is string
                && request.resource.data.timezone.size() < 64));
      allow delete: if false;
      
      // User token subcollections
      match /tokens/{tokenId} {
        allow read, write: if isAuthenticated() && request.auth.uid == userId;
      }
      
      match /fcm_tokens/{tokenId} {
        allow read, write: if isAuthenticated() && request.auth.uid == userId;
      }
    }

    // Courses collection rules (merged)
    match /courses/{courseId} {
      allow read: if isAuthenticated();
      allow write: if isAdmin();
    }

    // Modules collection
    match /modules/{moduleId} {
      allow read: if isAuthenticated();
      allow write: if isAdmin();
    }

    // Content collection
    match /content/{contentId} {
      allow read: if isAuthenticated();
      allow write: if isAdmin();
    }

    // User progress tracking (legacy flat collection)
    match /user_progress/{progressId} {
      allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;
      allow update, delete: if isAuthenticated() && resource.data.userId == request.auth.uid;
      allow read: if isAuthenticated() && resource.data.userId == request.auth.uid;
    }

    // Student progress tracking (hierarchical structure)
    // Subcollection is named `courseProgress` (not `courses`) to avoid
    // collection-group query collisions with the top-level courses collection.
    //
    // Write architecture:
    //   contentItems → student-writable (position data, low security risk)
    //   courseProgress → server-only (computed by Cloud Functions from contentItems)
    //   streaks → server-only (computed by Cloud Functions)
    match /progress/{userId} {
      allow read: if isAuthenticated() && request.auth.uid == userId;
      allow read: if request.auth.token.role == 'admin';
      
      // courseProgress: students READ ONLY; Cloud Functions (admin SDK) write.
      // Admins can write for weight management and manual corrections.
      match /courseProgress/{courseId} {
        allow read: if isAuthenticated() && request.auth.uid == userId;
        allow read, write: if request.auth.token.role == 'admin';
        // Students cannot write — all courseProgress writes come from
        // the onContentItemWrite Cloud Function via admin SDK.
      }
      
      // contentItems: server-only (written by recordProgress callable + Cloud Functions).
      // Students read their own; admins read+write.
      match /contentItems/{contentId} {
        allow read: if isAuthenticated() && request.auth.uid == userId;
        allow read, write: if request.auth.token.role == 'admin';
        // No student write — all writes go through the recordProgress callable
        // which uses the admin SDK and bypasses these rules.
      }
      
      // resume: low-trust, client-writable position data (video currentPosition,
      // PDF currentPage). No triggers — read by mobile app for resume UX only.
      // Narrow field allow-list + type checks prevent storing anything dangerous.
      match /resume/{contentId} {
        allow read: if isAuthenticated() && request.auth.uid == userId;
        allow create, update: if isAuthenticated() && request.auth.uid == userId
          && request.resource.data.userId == request.auth.uid
          && request.resource.data.contentId == contentId
          && request.resource.data.keys().hasOnly(
              ['userId', 'courseId', 'moduleId', 'contentId', 'contentType',
               'currentPosition', 'currentPage', 'updatedAt'])
          && request.resource.data.courseId is string
          && request.resource.data.moduleId is string
          && request.resource.data.contentType is string
          && (!('currentPosition' in request.resource.data)
              || (request.resource.data.currentPosition is number
                  && request.resource.data.currentPosition >= 0))
          && (!('currentPage' in request.resource.data)
              || (request.resource.data.currentPage is number
                  && request.resource.data.currentPage >= 0));
        allow read, write: if request.auth.token.role == 'admin';
      }
    }

    // Collection-group rule for courseProgress (needed for admin
    // getCourseLearnerProgress queries across all students).
    match /{path=**}/courseProgress/{courseId} {
      allow read: if request.auth.token.role == 'admin';
    }

    // Student streaks: students READ ONLY; Cloud Functions write.
    match /streaks/{userId} {
      allow read: if isAuthenticated() && request.auth.uid == userId;
      allow read: if request.auth.token.role == 'admin';
      // No client write — recordDailyActivity runs server-side.
    }

    // Progress settings (video completion threshold, etc.)
    match /appConfig/progressSettings {
      allow read: if isAuthenticated();
      allow write: if request.auth.token.role == 'admin';
    }

    // Messages collection rules (new chat system)
    match /messages/{messageId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated();
      allow update: if isAuthenticated() && (isAdmin() || resource.data.senderId == request.auth.uid);
      allow delete: if isAdmin();
    }

    // Keep existing chat rules during transition
    match /chats/{messageId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated();
      allow update: if isAuthenticated() && (isAdmin() || resource.data.userId == request.auth.uid);
      allow delete: if false;
    }

    // Notifications rules
    match /notifications/{notificationId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated();
      allow update: if isAuthenticated() && 
        (isAdmin() || (resource.data.recipients.size() == 0 || resource.data.recipients.hasAny([request.auth.uid])));
      allow delete: if isAdmin();
    }

    // User tokens for FCM (flat collection structure)
    match /user_tokens/{tokenId} {
      // Allow authenticated users to manage their tokens
      // More permissive to handle token cleanup and registration
      allow create: if isAuthenticated();
      allow read: if isAuthenticated();
      allow update: if isAuthenticated();
      allow delete: if isAuthenticated();
      // Admins can do anything
      allow read, write: if isAdmin();
    }

    // Typing status for chat
    match /typing_status/{userId} {
      allow read, write: if isAuthenticated();
    }

    // Content views for analytics
    match /contentViews/{viewId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated();
      allow delete: if isAdmin();
    }

    // User content views for one-time view enforcement
    // Document ID format: {userId}_{contentId}
    match /user_content_views/{viewId} {
      // Allow reading own records.
      // NOTE: resource is null when the document doesn't exist (first-time check).
      // We must guard against that to avoid a null-dereference denial, which
      // would also break transaction.get() inside markContentAsViewed() and
      // prevent the one-time view record from ever being written.
      allow read: if isAuthenticated() &&
        (resource == null || resource.data.userId == request.auth.uid);

      // Users can only create records for themselves.
      allow create: if isAuthenticated()
        && request.resource.data.userId == request.auth.uid
        && request.resource.data.viewed == true; // Must always write viewed=true

      // Users can never delete or reset viewed records — that would allow re-access.
      // Only admins can modify or delete (e.g. to manually reset for a student).
      allow update, delete: if isAdmin();
    }

    // Community Chat rules
    match /communityChat/{messageId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated();
      allow update: if isAuthenticated() && 
        (isAdmin() || resource.data.senderId == request.auth.uid);
      allow delete: if false;
    }
    
    // Past Questions rules
    match /pastQuestions/{messageId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated();
      allow update: if isAuthenticated() && 
        (isAdmin() || resource.data.senderId == request.auth.uid);
      allow delete: if false;
    }
    
    // Content Updates rules (for course/module update notifications)
    match /contentUpdates/{updateId} {
      // Students can read their own updates
      allow read: if isAuthenticated() && 
        resource.data.notifiedUsers.hasAny([request.auth.uid]);
      // Only cloud functions can create updates
      allow create: if false;
      // Students can update only to mark as seen
      allow update: if isAuthenticated() && 
        resource.data.notifiedUsers.hasAny([request.auth.uid]) &&
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['seenBy']);
      // No deletion allowed
      allow delete: if false;
    }
    
    // CRITICAL: Subscriptions collection rules (REQUIRED for subscription validation)
    match /subscriptions/{subscriptionId} {
      // Users can read their own subscriptions
      allow read: if isAuthenticated() && 
                  (resource.data.userId == request.auth.uid || isAdmin());
      // Only admins can create, update, or delete subscriptions
      allow write: if isAdmin();
    }
    
    // Subscription plans collection
    match /subscriptionPlans/{planId} {
      // All authenticated users can read subscription plans
      allow read: if isAuthenticated();
      // Only admins can create, update, or delete subscription plans
      allow write: if isAdmin();
    }
    
    // Login events collection
    match /login_events/{eventId} {
      allow create: if isAuthenticated();
      allow read: if isAdmin();
      allow read: if request.auth.token.role == 'admin';
      allow update, delete: if false;
    }
    
    // App configuration (version control, etc.)
    // Allow all users to read app config (needed for version checking)
    match /appConfig/{configId} {
      allow read: if true;  // Anyone can read (even before authentication)
      allow write: if isAdmin();
    }
    
    // Pending deletions collection (30-day auto-delete tracking)
    // Admins can read to see pending deletions in the UI
    // Only Cloud Functions can write (via the admin wildcard below)
    match /pendingDeletions/{userId} {
      allow read: if isAdmin();
      allow read: if request.auth.token.role == 'admin';
      allow write: if false; // Cloud Functions use Admin SDK, bypasses rules
    }
    
    // Deletion audit log (records of purged users)
    // Admins can read for compliance/audit purposes
    // Only Cloud Functions can write
    match /deletionAuditLog/{logId} {
      allow read: if isAdmin();
      allow read: if request.auth.token.role == 'admin';
      allow write: if false; // Cloud Functions use Admin SDK, bypasses rules
    }
    
    // Allow access to any remaining collections for admins
    // Uses custom claim instead of isAdmin() get() to avoid per-request Firestore read.
    // DEPLOY PREREQUISITE: Run backfillAdminClaims.js first and have admins re-login.
    match /{document=**} {
      allow read, write: if request.auth.token.role == 'admin';
    }
  }
}```

---

## Firestore Indexes
`/Users/rojinroy/Projects/aptitude4us_admin/firestore.indexes.json`

```
{
  "indexes": [
    {
      "collectionGroup": "chats",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "userId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "contentUpdates",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "notifiedUsers",
          "arrayConfig": "CONTAINS"
        },
        {
          "fieldPath": "courseId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "moduleId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "contentUpdates",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "notifiedUsers",
          "arrayConfig": "CONTAINS"
        },
        {
          "fieldPath": "courseId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "moduleId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "type",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "contentUpdates",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "notifiedUsers",
          "arrayConfig": "CONTAINS"
        },
        {
          "fieldPath": "courseId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "courses",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "isActive",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "createdAt",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "messages",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "receiverId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "messages",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "senderId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "modules",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        {
          "fieldPath": "courseId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "order",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "_name_",
          "order": "ASCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "modules",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "courseId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "_name_",
          "order": "ASCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "modules",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "courseId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "order",
          "order": "ASCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "modules",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "isPublished",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "order",
          "order": "ASCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "notification_tracking",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "courseId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "type",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "notification_tracking",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "type",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "notifications",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "forAllAdmins",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "createdAt",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "_name_",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "notifications",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "forAllAdmins",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "createdAt",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "notifications",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "recipients",
          "arrayConfig": "CONTAINS"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "notifications",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "targetApp",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "type",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "notifications",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "type",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "createdAt",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "notifications",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "type",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "subscriptionPlans",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "isActive",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "price",
          "order": "ASCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "subscriptions",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "status",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "endDate",
          "order": "ASCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "subscriptions",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "userId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "createdAt",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "user_tokens",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "isActive",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "userId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "user_tokens",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "userId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "token",
          "order": "ASCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "users",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "role",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "_name_",
          "order": "ASCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "users",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "role",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "createdAt",
          "order": "DESCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "users",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "role",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "displayName",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "_name_",
          "order": "ASCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "subscriptions",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "status",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "effectiveEndDate",
          "order": "ASCENDING"
        }
      ]
    },
    {
      "collectionGroup": "subscriptions",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "userId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "status",
          "order": "ASCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "pendingDeletions",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "status",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "scheduledDeletionDate",
          "order": "ASCENDING"
        }
      ],
      "density": "SPARSE_ALL"
    },
    {
      "collectionGroup": "users",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "role",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "currentStreak",
          "order": "DESCENDING"
        }
      ]
    },
    {
      "collectionGroup": "users",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "role",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "examReadiness",
          "order": "ASCENDING"
        }
      ]
    },
    {
      "collectionGroup": "courseProgress",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        {
          "fieldPath": "courseId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "completionPercentage",
          "order": "DESCENDING"
        }
      ]
    },
    {
      "collectionGroup": "contentItems",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        {
          "fieldPath": "courseId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "moduleId",
          "order": "ASCENDING"
        }
      ]
    }
  ],
  "fieldOverrides": [
    {
      "collectionGroup": "courseProgress",
      "fieldPath": "courseId",
      "indexes": [
        {
          "order": "ASCENDING",
          "queryScope": "COLLECTION"
        },
        {
          "order": "DESCENDING",
          "queryScope": "COLLECTION"
        },
        {
          "order": "ASCENDING",
          "queryScope": "COLLECTION_GROUP"
        }
      ]
    }
  ]
}```

---

## Admin — TypeScript Interfaces
`/Users/rojinroy/Projects/aptitude4us_admin/src/types/progress.ts`

```
import { Timestamp } from 'firebase/firestore';

// ─── Status Types ───────────────────────────────────────────────────────────

export type ContentStatus = 'not_started' | 'in_progress' | 'completed';
export type CourseStatus = 'not_started' | 'in_progress' | 'completed' | 'reviewing';

/**
 * "Updated" means the admin changed content *after* the student completed
 * the module.  Derived at read-time by comparing
 * `moduleProgress[id].completedAt` < module document's `updatedAt`.
 * NOT a persisted status — it's computed in the UI / service layer.
 */
export type ModuleDisplayStatus = ContentStatus | 'updated';

// ─── Module-Level Progress (denormalized inside CourseProgress) ──────────────

export interface ModuleProgressSummary {
  status: ContentStatus;
  completionPercentage: number;       // 0-100
  lastAccessedAt: Timestamp | null;
  completedAt: Timestamp | null;      // when the student finished this module

  // Per-content-type counters (denormalized for fast reads)
  videosWatched: number;
  videosTotal: number;
  pdfsRead: number;
  pdfsTotal: number;
  notesRead: number;
  notesTotal: number;
  audiosListened: number;
  audiosTotal: number;
  imagesViewed: number;
  imagesTotal: number;
  linksViewed: number;
  linksTotal: number;
}

// ─── Course-Level Progress ──────────────────────────────────────────────────
// Firestore path: progress/{userId}/courseProgress/{courseId}

export interface CourseProgress {
  userId: string;
  courseId: string;

  // Overall course progress
  status: CourseStatus;
  completionPercentage: number;       // 0-100, computed

  // Optional weight for exam-readiness calculation (defaults to 1)
  weight: number;

  // Module-level progress map (moduleId → summary)
  moduleProgress: Record<string, ModuleProgressSummary>;

  // Resume point — where the student left off
  lastAccessedModuleId: string | null;
  lastAccessedContentId: string | null;
  lastAccessedContentType: 'video' | 'pdf' | 'note' | 'audio' | 'image' | 'link' | null;

  // Timestamps
  startedAt: Timestamp;
  lastActivityAt: Timestamp;
  completedAt: Timestamp | null;
  updatedAt: Timestamp;
}

// ─── Video-Specific Progress ────────────────────────────────────────────────

/** A non-overlapping, sorted interval of seconds that have been watched. */
export interface WatchedSegment {
  start: number;
  end: number;
}

export interface VideoProgressData {
  currentPosition: number;            // seconds into the video
  totalDuration: number;              // total video length in seconds
  percentageWatched: number;          // 0-100 (based on merged segments)
  /** Merged, non-overlapping intervals of seconds actually watched. */
  watchedSegments: WatchedSegment[];
  lastWatchedAt: Timestamp;
}

// ─── Document/PDF-Specific Progress ─────────────────────────────────────────

export interface DocumentProgressData {
  currentPage: number;
  totalPages: number;
  percentageRead: number;             // 0-100
  lastReadAt: Timestamp;
}

// ─── Content Item Progress ──────────────────────────────────────────────────
// Firestore path: progress/{userId}/contentItems/{contentItemId}

export interface ContentItemProgress {
  userId: string;
  courseId: string;
  moduleId: string;
  contentId: string;
  contentType: 'video' | 'pdf' | 'note' | 'audio' | 'image' | 'link';

  // Completion
  status: ContentStatus;
  completedAt: Timestamp | null;

  // Type-specific progress (only one will be set)
  videoProgress?: VideoProgressData;
  documentProgress?: DocumentProgressData;

  // Common engagement metrics
  viewCount: number;                  // number of times opened
  totalTimeSpent: number;             // seconds
  firstAccessedAt: Timestamp;
  lastAccessedAt: Timestamp;
}

// ─── Streaks ────────────────────────────────────────────────────────────────
// Firestore path: streaks/{userId}

export interface StreakDayEntry {
  date: string;                       // "YYYY-MM-DD"
  minutesActive: number;
  contentItemsCompleted: number;
}

export interface StudentStreak {
  userId: string;
  currentStreak: number;              // consecutive days
  longestStreak: number;
  lastActivityDate: string;           // "YYYY-MM-DD" for easy comparison
  /** Capped at MAX_STREAK_HISTORY_ENTRIES to keep document size bounded. */
  streakHistory: StreakDayEntry[];
  updatedAt: Timestamp;
}

// ─── Aggregate / Report Types (used by admin UI) ────────────────────────────

export interface StudentProgressReport {
  user: {
    uid: string;
    displayName: string;
    email: string;
  };
  examReadiness: number;              // 0-100
  streak: StudentStreak | null;
  courses: Array<CourseProgress & {
    courseTitle: string;
    courseCategory: string;
    /** Module document updatedAt timestamps, keyed by moduleId.
     *  Used to compute "Updated" badges. */
    moduleUpdatedAtMap: Record<string, Timestamp>;
  }>;
  totalContentCompleted: number;
  totalTimeSpent: number;             // seconds
  lastActivityAt: Timestamp | null;
}

/** Lightweight summary for list views (e.g., Dashboard "at risk" students) */
export interface StudentProgressSummary {
  userId: string;
  displayName: string;
  email: string;
  examReadiness: number;
  currentStreak: number;
  coursesEnrolled: number;
  coursesCompleted: number;
  coursesInProgress: number;
  lastActivityAt: Timestamp | null;
}

/** Per-student row in the course learner-progress table */
export interface CourseLearnerProgress {
  userId: string;
  displayName: string;
  email: string;
  courseProgress: CourseProgress;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Default percentage of video that must be watched to count as "completed".
 * Prefer reading from appConfig/progressSettings at runtime when available.
 */
export const DEFAULT_VIDEO_COMPLETION_THRESHOLD = 90;

/** Maximum number of streak history entries to keep per user document. */
export const MAX_STREAK_HISTORY_ENTRIES = 90;

/**
 * Minimum seconds between Firestore writes for video-progress updates.
 * Client-side throttle to control write costs.
 */
export const VIDEO_PROGRESS_WRITE_INTERVAL_SECONDS = 15;
```

---

## Admin — Progress Service
`/Users/rojinroy/Projects/aptitude4us_admin/src/services/progressService.ts`

```
/**
 * Progress Service — Client-side (admin panel + mobile app).
 *
 * Write architecture:
 *   - Students write to `resume` subcollection (position only, no triggers).
 *   - Actual progress is recorded via the `recordProgress` callable Cloud Function.
 *   - Cloud Functions handle: contentItems, courseProgress, streaks, examReadiness.
 *   - Admin reads everything via these functions.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  CourseProgress,
  ContentItemProgress,
  StudentStreak,
  StudentProgressReport,
  StudentProgressSummary,
  CourseLearnerProgress,
  WatchedSegment,
  VIDEO_PROGRESS_WRITE_INTERVAL_SECONDS,
} from '../types/progress';
import { getCourseById, getModulesByCourseId } from './courseService';

// ─── Firestore sub-collection name ──────────────────────────────────────────
const COURSE_PROGRESS_SUBCOLLECTION = 'courseProgress';

// ─── Client-side write throttle for video resume position ───────────────────
const _lastVideoWriteTimestamps: Record<string, number> = {};

// ─────────────────────────────────────────────────────────────────────────────
// READ FUNCTIONS (used by both admin panel and mobile app)
// ─────────────────────────────────────────────────────────────────────────────

export const getStudentCourseProgress = async (
  userId: string,
  courseId: string
): Promise<CourseProgress | null> => {
  try {
    const ref = doc(db, 'progress', userId, COURSE_PROGRESS_SUBCOLLECTION, courseId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as CourseProgress;
  } catch (error) {
    console.error('Error getting student course progress:', error);
    throw error;
  }
};

export const getAllStudentProgress = async (
  userId: string
): Promise<CourseProgress[]> => {
  try {
    const ref = collection(db, 'progress', userId, COURSE_PROGRESS_SUBCOLLECTION);
    const snap = await getDocs(ref);
    return snap.docs.map((d) => d.data() as CourseProgress);
  } catch (error) {
    console.error('Error getting all student progress:', error);
    throw error;
  }
};

export const getContentItemProgress = async (
  userId: string,
  contentId: string
): Promise<ContentItemProgress | null> => {
  try {
    const ref = doc(db, 'progress', userId, 'contentItems', contentId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as ContentItemProgress;
  } catch (error) {
    console.error('Error getting content item progress:', error);
    throw error;
  }
};

export const getModuleContentProgress = async (
  userId: string,
  moduleId: string
): Promise<ContentItemProgress[]> => {
  try {
    const ref = collection(db, 'progress', userId, 'contentItems');
    const q = query(ref, where('moduleId', '==', moduleId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ContentItemProgress);
  } catch (error) {
    console.error('Error getting module content progress:', error);
    throw error;
  }
};

export const getStudentStreak = async (
  userId: string
): Promise<StudentStreak | null> => {
  try {
    const ref = doc(db, 'streaks', userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as StudentStreak;
  } catch (error) {
    console.error('Error getting student streak:', error);
    throw error;
  }
};

/**
 * Compute exam-readiness from courseProgress docs (client-side read).
 * The authoritative value lives on user.examReadiness (written by Cloud Function).
 */
export const computeExamReadiness = async (userId: string): Promise<number> => {
  try {
    const allProgress = await getAllStudentProgress(userId);
    if (allProgress.length === 0) return 0;

    let totalWeight = 0;
    let weightedSum = 0;
    for (const cp of allProgress) {
      const w = cp.weight ?? 1;
      weightedSum += cp.completionPercentage * w;
      totalWeight += w;
    }
    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  } catch (error) {
    console.error('Error computing exam readiness:', error);
    return 0;
  }
};

/**
 * Build a full progress report for the admin's student-detail view.
 * Includes module `contentUpdatedAt` for "Updated" badge derivation.
 */
export const getStudentProgressReport = async (
  userId: string
): Promise<StudentProgressReport | null> => {
  try {
    const userSnap = await getDoc(doc(db, 'users', userId));
    if (!userSnap.exists()) return null;
    const userData = userSnap.data();

    const allProgress = await getAllStudentProgress(userId);

    const enrichedCourses = await Promise.all(
      allProgress.map(async (cp) => {
        const course = await getCourseById(cp.courseId);
        const modules = await getModulesByCourseId(cp.courseId);

        // Only use contentUpdatedAt — no fallback to updatedAt.
        // If contentUpdatedAt is undefined, the module has never had a tracked
        // content change, so no "Updated" badge should show.
        const moduleUpdatedAtMap: Record<string, Timestamp> = {};
        for (const mod of modules) {
          if (mod.contentUpdatedAt) {
            moduleUpdatedAtMap[mod.id] = Timestamp.fromDate(mod.contentUpdatedAt);
          }
        }

        return {
          ...cp,
          courseTitle: course?.title ?? 'Unknown Course',
          courseCategory: course?.category ?? '',
          moduleUpdatedAtMap,
        };
      })
    );

    const streak = await getStudentStreak(userId);

    const totalContentCompleted = enrichedCourses.reduce((sum, cp) => {
      return (
        sum +
        Object.values(cp.moduleProgress || {}).reduce(
          (ms, mp) =>
            ms + mp.videosWatched + mp.pdfsRead + mp.notesRead + mp.audiosListened,
          0
        )
      );
    }, 0);

    const examReadiness = userData.examReadiness ?? (await computeExamReadiness(userId));

    const lastActivityAt =
      enrichedCourses.length > 0
        ? enrichedCourses.reduce(
            (latest, c) =>
              c.lastActivityAt &&
              (!latest || c.lastActivityAt.toMillis() > latest.toMillis())
                ? c.lastActivityAt
                : latest,
            null as Timestamp | null
          )
        : null;

    return {
      user: {
        uid: userId,
        displayName: userData.displayName || '',
        email: userData.email || '',
      },
      examReadiness,
      streak,
      courses: enrichedCourses,
      totalContentCompleted,
      totalTimeSpent: 0,
      lastActivityAt,
    };
  } catch (error) {
    console.error('Error getting student progress report:', error);
    throw error;
  }
};

export const getStudentProgressSummaries = async (
  userIds: string[]
): Promise<StudentProgressSummary[]> => {
  try {
    const summaries: StudentProgressSummary[] = [];

    for (const userId of userIds) {
      const userSnap = await getDoc(doc(db, 'users', userId));
      if (!userSnap.exists()) continue;

      const userData = userSnap.data();
      const allProgress = await getAllStudentProgress(userId);
      const streak = await getStudentStreak(userId);

      summaries.push({
        userId,
        displayName: userData.displayName || '',
        email: userData.email || '',
        examReadiness: userData.examReadiness ?? 0,
        currentStreak: streak?.currentStreak ?? 0,
        coursesEnrolled: allProgress.length,
        coursesCompleted: allProgress.filter((cp) => cp.status === 'completed').length,
        coursesInProgress: allProgress.filter((cp) => cp.status === 'in_progress').length,
        lastActivityAt: allProgress.reduce(
          (latest, c) =>
            c.lastActivityAt && (!latest || c.lastActivityAt.toMillis() > latest.toMillis())
              ? c.lastActivityAt
              : latest,
          null as Timestamp | null
        ),
      });
    }
    return summaries;
  } catch (error) {
    console.error('Error getting student progress summaries:', error);
    throw error;
  }
};

export const getCourseLearnerProgress = async (
  courseId: string
): Promise<CourseLearnerProgress[]> => {
  try {
    const usersRef = collection(db, 'users');
    const q = query(
      usersRef,
      where('role', '==', 'student'),
      where('assignedCourseIds', 'array-contains', courseId)
    );
    const usersSnap = await getDocs(q);

    const results: CourseLearnerProgress[] = [];

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const progressSnap = await getDoc(
        doc(db, 'progress', userDoc.id, COURSE_PROGRESS_SUBCOLLECTION, courseId)
      );

      results.push({
        userId: userDoc.id,
        displayName: userData.displayName || '',
        email: userData.email || '',
        courseProgress: progressSnap.exists()
          ? (progressSnap.data() as CourseProgress)
          : createEmptyCourseProgress(userDoc.id, courseId),
      });
    }
    return results;
  } catch (error) {
    console.error('Error getting course learner progress:', error);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// WRITE FUNCTIONS (contentItems only — mobile app)
// courseProgress & streaks are computed by Cloud Functions.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record video watch position — writes to the `resume` subcollection only.
 * This is a low-trust, no-trigger write for the mobile app's resume UX.
 * Throttled client-side.
 *
 * Actual progress (status, completedAt, segments) is recorded by calling
 * the `recordProgress` Cloud Function on pause, exit, or completion.
 */
export const updateVideoProgress = async (
  userId: string,
  courseId: string,
  moduleId: string,
  contentId: string,
  currentPosition: number,
  _totalDuration: number,
  force = false
): Promise<void> => {
  const throttleKey = `${userId}:${contentId}`;
  const now = Date.now();
  const lastWrite = _lastVideoWriteTimestamps[throttleKey] ?? 0;

  if (!force && now - lastWrite < VIDEO_PROGRESS_WRITE_INTERVAL_SECONDS * 1000) {
    return;
  }
  _lastVideoWriteTimestamps[throttleKey] = now;

  try {
    const ref = doc(db, 'progress', userId, 'resume', contentId);
    const ts = Timestamp.now();

    await setDoc(ref, {
      userId,
      courseId,
      moduleId,
      contentId,
      contentType: 'video',
      currentPosition,
      updatedAt: ts,
    }, { merge: true });
  } catch (error) {
    console.error('Error updating video resume position:', error);
    throw error;
  }
};

/**
 * Record PDF/document reading position — writes to the `resume` subcollection only.
 * Actual completion is tracked by the `recordProgress` Cloud Function.
 */
export const updateDocumentProgress = async (
  userId: string,
  courseId: string,
  moduleId: string,
  contentId: string,
  currentPage: number,
  _totalPages: number
): Promise<void> => {
  try {
    const ref = doc(db, 'progress', userId, 'resume', contentId);
    const ts = Timestamp.now();

    await setDoc(ref, {
      userId,
      courseId,
      moduleId,
      contentId,
      contentType: 'pdf',
      currentPage,
      updatedAt: ts,
    }, { merge: true });
  } catch (error) {
    console.error('Error updating document resume position:', error);
    throw error;
  }
};

/**
 * Admin utility: force-resync a student's progress.
 * This triggers a write to contentItems which fires the Cloud Function.
 * For a true resync, call the recordProgress callable or manually trigger
 * a content-item update.
 */
export const resyncStudentProgress = async (
  userId: string,
  courseId: string
): Promise<void> => {
  // Touch any existing content item to re-trigger the Cloud Function.
  // If no content items exist, there's nothing to resync.
  const itemsRef = collection(db, 'progress', userId, 'contentItems');
  const q = query(itemsRef, where('courseId', '==', courseId));
  const snap = await getDocs(q);

  if (!snap.empty) {
    const firstItem = snap.docs[0];
    await setDoc(firstItem.ref, { lastAccessedAt: Timestamp.now() }, { merge: true });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function createEmptyCourseProgress(userId: string, courseId: string): CourseProgress {
  const now = Timestamp.now();
  return {
    userId,
    courseId,
    status: 'not_started',
    completionPercentage: 0,
    weight: 1,
    moduleProgress: {},
    lastAccessedModuleId: null,
    lastAccessedContentId: null,
    lastAccessedContentType: null,
    startedAt: now,
    lastActivityAt: now,
    completedAt: null,
    updatedAt: now,
  };
}

export function mergeSegments(segments: WatchedSegment[]): WatchedSegment[] {
  const valid = segments.filter((s) => s.end > s.start);
  if (valid.length === 0) return [];
  valid.sort((a, b) => a.start - b.start);

  const merged: WatchedSegment[] = [{ ...valid[0] }];
  for (let i = 1; i < valid.length; i++) {
    const last = merged[merged.length - 1];
    if (valid[i].start <= last.end) {
      last.end = Math.max(last.end, valid[i].end);
    } else {
      merged.push({ ...valid[i] });
    }
  }
  return merged;
}
```

---

## Admin — Dashboard Widgets
`/Users/rojinroy/Projects/aptitude4us_admin/src/components/DashboardProgressWidgets.tsx`

```
import React, { useState, useEffect, useCallback } from 'react';
import {
  Typography,
  Box,
  Card,
  Avatar,
  Chip,
  Skeleton,
  CircularProgress,
  List,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Button,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  WarningAmber as WarningAmberIcon,
  LocalFireDepartment as LocalFireDepartmentIcon,
  TrendingUp as TrendingUpIcon,
  Refresh as RefreshIcon,
  ErrorOutlineOutlined as ErrorOutlineIcon,
} from '@mui/icons-material';
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  getAggregateFromServer,
  average,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useNavigate } from 'react-router-dom';

// ── Config constants ────────────────────────────────────────────────────────────
const AT_RISK_INACTIVITY_DAYS = 7;
const AT_RISK_READINESS_THRESHOLD = 40;

// ── Types ───────────────────────────────────────────────────────────────────────
interface DashboardProgressWidgetsProps {
  loading: boolean;
}

interface AtRiskStudent {
  id: string;
  name: string;
  reason: string;
}

interface StreakStudent {
  id: string;
  name: string;
  streak: number;
}

interface ReadinessData {
  avg: number;
  count: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

const getReadinessColor = (value: number): string => {
  if (value >= 70) return '#16A34A';
  if (value >= 40) return '#D97706';
  return '#DC2626';
};

const getReadinessLabel = (value: number): string => {
  if (value >= 70) return 'On Track';
  if (value >= 40) return 'Needs Focus';
  return 'At Risk';
};

// ── Card style (matches Dashboard KPI cards) ────────────────────────────────────
const cardSx = {
  p: 2.5,
  borderRadius: 3.5,
  backgroundColor: '#FFFFFF',
  border: '1px solid #E2E8F0',
  boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
  height: '100%',
  display: 'flex',
  flexDirection: 'column' as const,
};

// ── Component ───────────────────────────────────────────────────────────────────
const DashboardProgressWidgets: React.FC<DashboardProgressWidgetsProps> = ({ loading: parentLoading }) => {
  const navigate = useNavigate();

  // Per-widget state
  const [atRiskStudents, setAtRiskStudents] = useState<AtRiskStudent[]>([]);
  const [atRiskLoading, setAtRiskLoading] = useState(true);
  const [atRiskError, setAtRiskError] = useState<string | null>(null);

  const [streakStudents, setStreakStudents] = useState<StreakStudent[]>([]);
  const [streakLoading, setStreakLoading] = useState(true);
  const [streakError, setStreakError] = useState<string | null>(null);

  const [readiness, setReadiness] = useState<ReadinessData>({ avg: 0, count: 0 });
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState<string | null>(null);

  // ── At-Risk Students ────────────────────────────────────────────────
  const fetchAtRisk = useCallback(async () => {
    try {
      setAtRiskLoading(true);
      setAtRiskError(null);

      const q = query(collection(db, 'users'), where('role', '==', 'student'));
      const snapshot = await getDocs(q);

      const now = new Date();
      const cutoff = new Date(now.getTime() - AT_RISK_INACTIVITY_DAYS * 24 * 60 * 60 * 1000);

      const results: AtRiskStudent[] = [];

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const name = data.displayName || data.name || 'Unknown';
        const lastActivity = data.lastActivityAt?.toDate?.() ?? null;
        const examReadiness: number | undefined = data.examReadiness;

        if (!lastActivity) {
          results.push({ id: doc.id, name, reason: 'Never started' });
        } else if (lastActivity < cutoff) {
          const daysInactive = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
          results.push({ id: doc.id, name, reason: `Inactive ${daysInactive}d` });
        } else if (examReadiness !== undefined && examReadiness < AT_RISK_READINESS_THRESHOLD) {
          results.push({ id: doc.id, name, reason: `Readiness ${Math.round(examReadiness)}%` });
        }
      });

      setAtRiskStudents(results.slice(0, 5));
    } catch (err) {
      console.error('Error fetching at-risk students:', err);
      setAtRiskError('Failed to load at-risk data');
    } finally {
      setAtRiskLoading(false);
    }
  }, []);

  // ── Most Active (Streaks) ───────────────────────────────────────────
  const fetchStreaks = useCallback(async () => {
    try {
      setStreakLoading(true);
      setStreakError(null);

      const q = query(
        collection(db, 'users'),
        where('role', '==', 'student'),
        orderBy('currentStreak', 'desc'),
        limit(10),
      );
      const snapshot = await getDocs(q);

      const results: StreakStudent[] = snapshot.docs
        .map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            name: data.displayName || data.name || 'Unknown',
            streak: data.currentStreak ?? 0,
          };
        })
        .filter((s) => s.streak > 0)
        .slice(0, 5);

      setStreakStudents(results);
    } catch (err) {
      console.error('Error fetching streak students:', err);
      setStreakError('Failed to load streak data');
    } finally {
      setStreakLoading(false);
    }
  }, []);

  // ── Average Readiness ───────────────────────────────────────────────
  const fetchReadiness = useCallback(async () => {
    try {
      setReadinessLoading(true);
      setReadinessError(null);

      const q = query(collection(db, 'users'), where('role', '==', 'student'));

      const [aggregateSnapshot, countSnapshot] = await Promise.all([
        getAggregateFromServer(q, { avgReadiness: average('examReadiness') }),
        getDocs(q),
      ]);

      const avg = aggregateSnapshot.data().avgReadiness ?? 0;
      setReadiness({ avg: Math.round(avg), count: countSnapshot.size });
    } catch (err) {
      console.error('Error fetching readiness data:', err);
      setReadinessError('Failed to load readiness');
    } finally {
      setReadinessLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.allSettled([fetchAtRisk(), fetchStreaks(), fetchReadiness()]);
  }, [fetchAtRisk, fetchStreaks, fetchReadiness]);

  // ── Shared sub-components ─────────────────────────────────────────────────
  const renderCardHeader = (
    title: string,
    icon: React.ReactNode,
    iconBgColor: string,
    iconColor: string,
    badge?: string,
  ) => (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
      <Box>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            fontSize: '0.6875rem',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: '#64748B',
          }}
        >
          {title}
        </Typography>
        {badge && (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              mt: 0.5,
              fontWeight: 700,
              color: '#071A52',
              fontSize: '1.125rem',
              letterSpacing: '-0.01em',
            }}
          >
            {badge}
          </Typography>
        )}
      </Box>
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: 2.5,
          backgroundColor: iconBgColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: iconColor,
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
    </Box>
  );

  const renderSkeletonList = (count = 3) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
      {[...Array(count)].map((_, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Skeleton variant="circular" width={36} height={36} />
          <Box sx={{ flex: 1 }}>
            <Skeleton width="60%" height={16} />
            <Skeleton width="40%" height={14} sx={{ mt: 0.5 }} />
          </Box>
        </Box>
      ))}
    </Box>
  );

  const renderErrorState = (message: string, onRetry: () => void) => (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minHeight: 120,
        gap: 1.5,
        py: 2,
      }}
    >
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          backgroundColor: '#FEF2F2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ErrorOutlineIcon sx={{ fontSize: 22, color: '#DC2626' }} />
      </Box>
      <Typography
        variant="body2"
        sx={{
          color: '#64748B',
          textAlign: 'center',
          fontSize: '0.8125rem',
          fontWeight: 500,
          lineHeight: 1.4,
        }}
      >
        {message}
      </Typography>
      <Button
        variant="outlined"
        size="small"
        onClick={onRetry}
        startIcon={<RefreshIcon sx={{ fontSize: 14 }} />}
        sx={{
          borderColor: '#E2E8F0',
          color: '#071A52',
          fontWeight: 600,
          fontSize: '0.75rem',
          height: 30,
          borderRadius: '6px',
          textTransform: 'none',
          '&:hover': { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
        }}
      >
        Retry
      </Button>
    </Box>
  );

  const renderEmpty = (message: string) => (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minHeight: 120,
      }}
    >
      <Typography variant="body2" sx={{ color: '#94A3B8', textAlign: 'center', fontSize: '0.8125rem' }}>
        {message}
      </Typography>
    </Box>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ mb: 3 }}>
      {/* Section Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
        }}
      >
        <Box>
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 700,
              color: '#071A52',
              fontSize: '0.9375rem',
              letterSpacing: '-0.01em',
            }}
          >
            Progress Insights
          </Typography>
          <Typography variant="caption" sx={{ color: '#94A3B8', fontSize: '0.75rem' }}>
            Student engagement and readiness overview
          </Typography>
        </Box>
        <Tooltip title="Refresh progress data">
          <IconButton
            size="small"
            onClick={() => {
              Promise.allSettled([fetchAtRisk(), fetchStreaks(), fetchReadiness()]);
            }}
            sx={{
              border: '1px solid #E2E8F0',
              borderRadius: 2,
              color: '#64748B',
              width: 32,
              height: 32,
              '&:hover': { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1' },
            }}
          >
            <RefreshIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Cards Grid */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            lg: 'repeat(3, 1fr)',
          },
          gap: 2.5,
        }}
      >
        {/* Card 1: At-Risk Students */}
        <Card sx={cardSx}>
          {renderCardHeader(
            'At Risk',
            <WarningAmberIcon sx={{ fontSize: 22 }} />,
            '#FEF3C7',
            '#D97706',
            atRiskLoading
              ? undefined
              : `${atRiskStudents.length} student${atRiskStudents.length !== 1 ? 's' : ''}`,
          )}

          {atRiskLoading || parentLoading ? (
            renderSkeletonList(3)
          ) : atRiskError ? (
            renderErrorState(atRiskError, fetchAtRisk)
          ) : atRiskStudents.length === 0 ? (
            renderEmpty('No at-risk students 🎉')
          ) : (
            <List disablePadding sx={{ mx: -1 }}>
              {atRiskStudents.map((student) => (
                <ListItemButton
                  key={student.id}
                  onClick={() => navigate(`/users/${student.id}`)}
                  sx={{
                    borderRadius: 2,
                    py: 1,
                    px: 1,
                    '&:hover': { backgroundColor: '#F8FAFC' },
                  }}
                >
                  <ListItemAvatar sx={{ minWidth: 44 }}>
                    <Avatar
                      sx={{
                        width: 36,
                        height: 36,
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        backgroundColor: 'rgba(217, 119, 6, 0.10)',
                        color: '#92400E',
                        border: '1px solid rgba(217, 119, 6, 0.20)',
                      }}
                    >
                      {getInitials(student.name)}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={student.name}
                    primaryTypographyProps={{
                      variant: 'body2',
                      fontWeight: 600,
                      color: '#071A52',
                      fontSize: '0.84375rem',
                      noWrap: true,
                    }}
                  />
                  <Chip
                    label={student.reason}
                    size="small"
                    sx={{
                      height: 22,
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      backgroundColor: '#FEF3C7',
                      color: '#92400E',
                      border: '1px solid #FDE68A',
                      '& .MuiChip-label': { px: 1 },
                      flexShrink: 0,
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Card>

        {/* Card 2: Most Active (Streaks) */}
        <Card sx={cardSx}>
          {renderCardHeader(
            'Most Active',
            <LocalFireDepartmentIcon sx={{ fontSize: 22 }} />,
            '#FEF3C7',
            '#D97706',
          )}

          {streakLoading || parentLoading ? (
            renderSkeletonList(3)
          ) : streakError ? (
            renderErrorState(streakError, fetchStreaks)
          ) : streakStudents.length === 0 ? (
            renderEmpty('No streak data yet')
          ) : (
            <List disablePadding sx={{ mx: -1 }}>
              {streakStudents.map((student, index) => (
                <ListItemButton
                  key={student.id}
                  onClick={() => navigate(`/users/${student.id}`)}
                  sx={{
                    borderRadius: 2,
                    py: 1,
                    px: 1,
                    '&:hover': { backgroundColor: '#F8FAFC' },
                  }}
                >
                  <ListItemAvatar sx={{ minWidth: 44 }}>
                    <Avatar
                      sx={{
                        width: 36,
                        height: 36,
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        backgroundColor:
                          index === 0
                            ? 'rgba(217, 119, 6, 0.15)'
                            : 'rgba(217, 119, 6, 0.08)',
                        color: '#92400E',
                        border:
                          index === 0
                            ? '1.5px solid rgba(217, 119, 6, 0.30)'
                            : '1px solid rgba(217, 119, 6, 0.15)',
                      }}
                    >
                      {getInitials(student.name)}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={student.name}
                    primaryTypographyProps={{
                      variant: 'body2',
                      fontWeight: 600,
                      color: '#071A52',
                      fontSize: '0.84375rem',
                      noWrap: true,
                    }}
                  />
                  <Chip
                    label={`🔥 ${student.streak}d`}
                    size="small"
                    sx={{
                      height: 22,
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      backgroundColor: index === 0 ? '#FEF3C7' : '#FFFBEB',
                      color: '#92400E',
                      border: `1px solid ${index === 0 ? '#FDE68A' : '#FEF3C7'}`,
                      '& .MuiChip-label': { px: 1 },
                      flexShrink: 0,
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Card>

        {/* Card 3: Average Readiness */}
        <Card sx={cardSx}>
          {renderCardHeader(
            'Avg. Exam Readiness',
            <TrendingUpIcon sx={{ fontSize: 22 }} />,
            'rgba(0, 107, 95, 0.10)',
            '#006B5F',
          )}

          {readinessLoading || parentLoading ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                minHeight: 140,
                gap: 1.5,
              }}
            >
              <Skeleton variant="circular" width={100} height={100} />
              <Skeleton width={90} height={14} />
            </Box>
          ) : readinessError ? (
            renderErrorState(readinessError, fetchReadiness)
          ) : (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                minHeight: 140,
                gap: 1.5,
              }}
            >
              <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                {/* Background track */}
                <CircularProgress
                  variant="determinate"
                  value={100}
                  size={100}
                  thickness={4}
                  sx={{ color: '#F1F5F9', position: 'absolute' }}
                />
                {/* Foreground value */}
                <CircularProgress
                  variant="determinate"
                  value={Math.min(readiness.avg, 100)}
                  size={100}
                  thickness={4}
                  sx={{
                    color: getReadinessColor(readiness.avg),
                    '& .MuiCircularProgress-circle': {
                      strokeLinecap: 'round',
                    },
                  }}
                />
                <Box
                  sx={{
                    top: 0,
                    left: 0,
                    bottom: 0,
                    right: 0,
                    position: 'absolute',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Typography
                    variant="h4"
                    sx={{
                      fontWeight: 800,
                      color: getReadinessColor(readiness.avg),
                      fontSize: '1.5rem',
                      letterSpacing: '-0.02em',
                      lineHeight: 1,
                    }}
                  >
                    {readiness.avg}%
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ textAlign: 'center' }}>
                <Chip
                  label={getReadinessLabel(readiness.avg)}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    backgroundColor:
                      readiness.avg >= 70
                        ? 'rgba(167, 255, 131, 0.35)'
                        : readiness.avg >= 40
                          ? '#FEF3C7'
                          : '#FEF2F2',
                    color:
                      readiness.avg >= 70
                        ? '#065F46'
                        : readiness.avg >= 40
                          ? '#92400E'
                          : '#991B1B',
                    mb: 0.75,
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    color: '#94A3B8',
                    fontSize: '0.75rem',
                  }}
                >
                  across {readiness.count} student{readiness.count !== 1 ? 's' : ''}
                </Typography>
              </Box>
            </Box>
          )}
        </Card>
      </Box>
    </Box>
  );
};

export default DashboardProgressWidgets;
```

---

## Admin — Student Progress Section
`/Users/rojinroy/Projects/aptitude4us_admin/src/components/StudentProgressSection.tsx`

```
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  CircularProgress,
  Alert,
  Chip,
  LinearProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
  IconButton,
  Divider,
  Grid,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  PlayCircle as VideoIcon,
  Description as PdfIcon,
  StickyNote2 as NoteIcon,
  Headphones as AudioIcon,
  CheckCircle as CompletedIcon,
  HourglassTop as InProgressIcon,
  RadioButtonUnchecked as NotStartedIcon,
  TrendingUp as ReadinessIcon,
  LocalFireDepartment as StreakIcon,
  Refresh as RefreshIcon,
  AccessTime as LastActiveIcon,
  NewReleases as UpdatedIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  getStudentProgressReport,
  resyncStudentProgress,
} from '../services/progressService';
import type {
  StudentProgressReport,
  ModuleProgressSummary,
  CourseStatus,
  ContentStatus,
  ModuleDisplayStatus,
} from '../types/progress';
import { Timestamp } from 'firebase/firestore';

interface StudentProgressSectionProps {
  userId: string;
  displayName?: string;
}

/**
 * Determine the display status for a module, including the derived "updated" state.
 * A module shows "Updated" when the admin changed content AFTER the student completed it.
 * We check completedAt (not status) because status may regress to in_progress
 * when new content is added — but the student DID finish the old content.
 */
function getModuleDisplayStatus(
  mp: ModuleProgressSummary,
  moduleUpdatedAt: Timestamp | undefined
): ModuleDisplayStatus {
  if (
    mp.completedAt &&
    moduleUpdatedAt &&
    moduleUpdatedAt.toMillis() > mp.completedAt.toMillis()
  ) {
    return 'updated';
  }
  return mp.status;
}

const StudentProgressSection: React.FC<StudentProgressSectionProps> = ({
  userId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  displayName,
}) => {
  const navigate = useNavigate();
  const [report, setReport] = useState<StudentProgressReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const loadProgress = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getStudentProgressReport(userId);
      setReport(data);
    } catch (err) {
      console.error('Error loading progress:', err);
      setError('Failed to load student progress data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getStudentProgressReport(userId);
        if (!cancelled) setReport(data);
      } catch (err) {
        console.error('Error loading progress:', err);
        if (!cancelled) setError('Failed to load student progress data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [userId]);

  const handleResync = async (courseId: string) => {
    try {
      setSyncing(courseId);
      await resyncStudentProgress(userId, courseId);
      await loadProgress();
    } catch (err) {
      console.error('Error resyncing:', err);
      setError('Failed to resync progress.');
    } finally {
      setSyncing(null);
    }
  };

  // ── Loading / Error / Empty states ──────────────────────────────────────

  if (loading) {
    return (
      <Paper elevation={0} sx={{ p: 3.5, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper elevation={0} sx={{ p: 3.5, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
        <Alert severity="error">{error}</Alert>
      </Paper>
    );
  }

  if (!report || report.courses.length === 0) {
    return (
      <Paper elevation={0} sx={{ p: 3.5, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
        <Typography
          variant="h6"
          sx={{ fontWeight: 600, color: '#071A52', mb: 1, display: 'flex', alignItems: 'center' }}
        >
          <ReadinessIcon sx={{ mr: 1, color: '#006B5F' }} />
          Learning Progress
        </Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          No progress data available yet. Progress will appear once the student starts accessing
          course content.
        </Alert>
      </Paper>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────

  return (
    <Paper
      elevation={0}
      sx={{ p: 3.5, borderRadius: '16px', border: '1px solid #E2E8F0', bgcolor: '#FFFFFF' }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography
          variant="h6"
          sx={{ fontWeight: 600, color: '#071A52', display: 'flex', alignItems: 'center' }}
        >
          <ReadinessIcon sx={{ mr: 1, color: '#006B5F' }} />
          Learning Progress
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            size="small"
            endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
            onClick={() => navigate(`/users/${userId}/progress`)}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              color: '#006B5F',
              fontSize: '0.8125rem',
              '&:hover': { bgcolor: 'rgba(0, 107, 95, 0.06)' },
            }}
          >
            View Full Progress
          </Button>
          <Tooltip title="Refresh progress data">
            <IconButton onClick={loadProgress} size="small">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <SummaryCard
            value={`${report.examReadiness}%`}
            label="Exam Readiness"
            bgcolor="rgba(0, 107, 95, 0.06)"
            borderColor="rgba(0, 107, 95, 0.15)"
            valueColor="#006B5F"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <SummaryCard
            value={
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <StreakIcon sx={{ mr: 0.5, fontSize: '1.5rem' }} />
                {report.streak?.currentStreak ?? 0}
              </Box>
            }
            label="Day Streak"
            bgcolor="rgba(255, 152, 0, 0.06)"
            borderColor="rgba(255, 152, 0, 0.15)"
            valueColor="#E65100"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <SummaryCard
            value={`${report.courses.filter((c) => c.status === 'completed').length}/${report.courses.length}`}
            label="Courses Done"
            bgcolor="rgba(7, 26, 82, 0.04)"
            borderColor="rgba(7, 26, 82, 0.12)"
            valueColor="#071A52"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <SummaryCard
            value={report.totalContentCompleted}
            label="Items Completed"
            bgcolor="rgba(7, 26, 82, 0.04)"
            borderColor="rgba(7, 26, 82, 0.12)"
            valueColor="#071A52"
          />
        </Grid>
      </Grid>

      {/* Last Activity */}
      {report.lastActivityAt && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, color: 'text.secondary' }}>
          <LastActiveIcon sx={{ fontSize: 16, mr: 0.5 }} />
          <Typography variant="body2">Last active: {formatTimestamp(report.lastActivityAt)}</Typography>
        </Box>
      )}

      <Divider sx={{ mb: 2 }} />

      {/* Per-Course Progress */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#071A52', mb: 1.5 }}>
        Course Progress Breakdown
      </Typography>

      {report.courses.map((course) => (
        <Accordion
          key={course.courseId}
          elevation={0}
          sx={{
            border: '1px solid #E2E8F0',
            borderRadius: '12px !important',
            mb: 1.5,
            '&:before': { display: 'none' },
            '&.Mui-expanded': { mb: 1.5 },
          }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1.5 }}>
              {getStatusIcon(course.status)}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: 600, color: '#071A52' }}
                    noWrap
                  >
                    {course.courseTitle}
                  </Typography>
                  <StatusBadge status={course.status} />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LinearProgress
                    variant="determinate"
                    value={course.completionPercentage}
                    sx={{
                      flex: 1,
                      height: 6,
                      borderRadius: 3,
                      bgcolor: 'rgba(7, 26, 82, 0.08)',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: getProgressColor(course.completionPercentage),
                        borderRadius: 3,
                      },
                    }}
                  />
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 600, color: '#071A52', minWidth: 35 }}
                  >
                    {course.completionPercentage}%
                  </Typography>
                </Box>
              </Box>
              <Tooltip title="Resync progress from content items">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleResync(course.courseId);
                  }}
                  disabled={syncing === course.courseId}
                >
                  {syncing === course.courseId ? (
                    <CircularProgress size={16} />
                  ) : (
                    <RefreshIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </Box>
          </AccordionSummary>

          <AccordionDetails sx={{ px: 2, pt: 0 }}>
            {Object.entries(course.moduleProgress || {}).length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                No module progress data yet.
              </Typography>
            ) : (
              Object.entries(course.moduleProgress).map(([moduleId, mp]) => (
                <ModuleProgressRow
                  key={moduleId}
                  moduleId={moduleId}
                  progress={mp}
                  displayStatus={getModuleDisplayStatus(
                    mp,
                    course.moduleUpdatedAtMap?.[moduleId]
                  )}
                />
              ))
            )}
          </AccordionDetails>
        </Accordion>
      ))}
    </Paper>
  );
};

// ─── Sub-Components ──────────────────────────────────────────────────────────

interface SummaryCardProps {
  value: React.ReactNode;
  label: string;
  bgcolor: string;
  borderColor: string;
  valueColor: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ value, label, bgcolor, borderColor, valueColor }) => (
  <Box sx={{ p: 2, borderRadius: '12px', bgcolor, border: `1px solid ${borderColor}`, textAlign: 'center' }}>
    <Typography variant="h4" sx={{ fontWeight: 700, color: valueColor }}>
      {value}
    </Typography>
    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
      {label}
    </Typography>
  </Box>
);

interface ModuleProgressRowProps {
  moduleId: string;
  progress: ModuleProgressSummary;
  displayStatus: ModuleDisplayStatus;
}

const ModuleProgressRow: React.FC<ModuleProgressRowProps> = ({
  moduleId,
  progress,
  displayStatus,
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        py: 1.5,
        px: 1,
        borderBottom: '1px solid #F1F5F9',
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      {getStatusIcon(displayStatus, 18)}
      <Box sx={{ flex: 1, ml: 1.5, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 500, color: '#071A52' }} noWrap>
            {moduleId}
          </Typography>
          <StatusBadge status={displayStatus} size="small" />
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, mt: 0.5, flexWrap: 'wrap' }}>
          <ContentCounter
            icon={<VideoIcon sx={{ fontSize: 14 }} />}
            done={progress.videosWatched}
            total={progress.videosTotal}
            label="Videos"
          />
          <ContentCounter
            icon={<PdfIcon sx={{ fontSize: 14 }} />}
            done={progress.pdfsRead}
            total={progress.pdfsTotal}
            label="PDFs"
          />
          <ContentCounter
            icon={<NoteIcon sx={{ fontSize: 14 }} />}
            done={progress.notesRead}
            total={progress.notesTotal}
            label="Notes"
          />
          {progress.audiosTotal > 0 && (
            <ContentCounter
              icon={<AudioIcon sx={{ fontSize: 14 }} />}
              done={progress.audiosListened}
              total={progress.audiosTotal}
              label="Audio"
            />
          )}
        </Box>
      </Box>
      <Box sx={{ textAlign: 'right', ml: 1 }}>
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, color: getProgressColor(progress.completionPercentage) }}
        >
          {progress.completionPercentage}%
        </Typography>
        {progress.lastAccessedAt && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {formatTimestamp(progress.lastAccessedAt)}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

interface ContentCounterProps {
  icon: React.ReactNode;
  done: number;
  total: number;
  label: string;
}

const ContentCounter: React.FC<ContentCounterProps> = ({ icon, done, total, label }) => {
  if (total === 0) return null;
  return (
    <Tooltip title={`${done}/${total} ${label}`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
        {icon}
        <Typography
          variant="caption"
          sx={{
            color: done === total ? '#006B5F' : 'text.secondary',
            fontWeight: done === total ? 600 : 400,
          }}
        >
          {done}/{total}
        </Typography>
      </Box>
    </Tooltip>
  );
};

interface StatusBadgeProps {
  status: CourseStatus | ContentStatus | ModuleDisplayStatus;
  size?: 'small' | 'medium';
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'medium' }) => {
  const config: Record<string, { label: string; color: string; bgcolor: string }> = {
    completed: {
      label: 'Completed',
      color: '#006B5F',
      bgcolor: 'rgba(0, 107, 95, 0.1)',
    },
    in_progress: {
      label: 'In Progress',
      color: '#1565C0',
      bgcolor: 'rgba(21, 101, 192, 0.1)',
    },
    not_started: {
      label: 'Not Started',
      color: '#757575',
      bgcolor: 'rgba(0, 0, 0, 0.06)',
    },
    reviewing: {
      label: 'Reviewing',
      color: '#E65100',
      bgcolor: 'rgba(230, 81, 0, 0.1)',
    },
    updated: {
      label: 'Updated',
      color: '#6A1B9A',
      bgcolor: 'rgba(106, 27, 154, 0.1)',
    },
  };

  const c = config[status] || config.not_started;

  return (
    <Chip
      label={c.label}
      size="small"
      sx={{
        fontWeight: 600,
        fontSize: size === 'small' ? '0.65rem' : '0.7rem',
        color: c.color,
        bgcolor: c.bgcolor,
        borderRadius: '6px',
        height: size === 'small' ? 18 : 22,
      }}
    />
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStatusIcon(status: string, size = 22): React.ReactNode {
  switch (status) {
    case 'completed':
      return <CompletedIcon sx={{ fontSize: size, color: '#006B5F' }} />;
    case 'in_progress':
      return <InProgressIcon sx={{ fontSize: size, color: '#1565C0' }} />;
    case 'updated':
      return <UpdatedIcon sx={{ fontSize: size, color: '#6A1B9A' }} />;
    default:
      return <NotStartedIcon sx={{ fontSize: size, color: '#BDBDBD' }} />;
  }
}

function getProgressColor(pct: number): string {
  if (pct >= 100) return '#006B5F';
  if (pct >= 60) return '#1565C0';
  if (pct >= 30) return '#E65100';
  return '#757575';
}

function formatTimestamp(ts: Timestamp | null): string {
  if (!ts) return '';
  try {
    const date = ts.toDate();
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours === 0) {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        return diffMins <= 1 ? 'Just now' : `${diffMins}m ago`;
      }
      return `${diffHours}h ago`;
    }
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return '';
  }
}

export default StudentProgressSection;
```

---

## Admin — Student Progress Detail Page
`/Users/rojinroy/Projects/aptitude4us_admin/src/pages/StudentProgressDetail.tsx`

```
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  CircularProgress,
  Alert,
  Chip,
  LinearProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
  IconButton,
  Divider,
  Grid,
  Collapse,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  PlayCircle as VideoIcon,
  Description as PdfIcon,
  StickyNote2 as NoteIcon,
  Headphones as AudioIcon,
  Image as ImageIcon,
  Link as LinkIcon,
  CheckCircle as CompletedIcon,
  HourglassTop as InProgressIcon,
  RadioButtonUnchecked as NotStartedIcon,
  NewReleases as UpdatedIcon,
  ArrowBack as ArrowBackIcon,
  Refresh as RefreshIcon,
  AccessTime as AccessTimeIcon,
  LocalFireDepartment as StreakIcon,
} from '@mui/icons-material';
import {
  getStudentProgressReport,
  getModuleContentProgress,
  resyncStudentProgress,
} from '../services/progressService';
import type {
  StudentProgressReport,
  ModuleProgressSummary,
  ContentItemProgress,
  ModuleDisplayStatus,
  CourseStatus,
  ContentStatus,
} from '../types/progress';
import { Timestamp } from 'firebase/firestore';

// ─── Helper Functions ────────────────────────────────────────────────────────

function getModuleDisplayStatus(
  mp: ModuleProgressSummary,
  moduleUpdatedAt: Timestamp | undefined
): ModuleDisplayStatus {
  if (
    mp.completedAt &&
    moduleUpdatedAt &&
    moduleUpdatedAt.toMillis() > mp.completedAt.toMillis()
  ) {
    return 'updated';
  }
  return mp.status;
}

function getStatusIcon(status: string, size = 22): React.ReactNode {
  switch (status) {
    case 'completed':
      return <CompletedIcon sx={{ fontSize: size, color: '#006B5F' }} />;
    case 'in_progress':
      return <InProgressIcon sx={{ fontSize: size, color: '#1565C0' }} />;
    case 'updated':
      return <UpdatedIcon sx={{ fontSize: size, color: '#6A1B9A' }} />;
    default:
      return <NotStartedIcon sx={{ fontSize: size, color: '#BDBDBD' }} />;
  }
}

function getProgressColor(pct: number): string {
  if (pct >= 100) return '#006B5F';
  if (pct >= 60) return '#1565C0';
  if (pct >= 30) return '#E65100';
  return '#757575';
}

function formatTimestamp(ts: Timestamp | null): string {
  if (!ts) return '';
  try {
    const date = ts.toDate();
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours === 0) {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        return diffMins <= 1 ? 'Just now' : `${diffMins}m ago`;
      }
      return `${diffHours}h ago`;
    }
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return '';
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getContentTypeIcon(contentType: string, size = 16): React.ReactNode {
  switch (contentType) {
    case 'video':
      return <VideoIcon sx={{ fontSize: size, color: '#1565C0' }} />;
    case 'pdf':
      return <PdfIcon sx={{ fontSize: size, color: '#E65100' }} />;
    case 'note':
      return <NoteIcon sx={{ fontSize: size, color: '#006B5F' }} />;
    case 'audio':
      return <AudioIcon sx={{ fontSize: size, color: '#6A1B9A' }} />;
    case 'image':
      return <ImageIcon sx={{ fontSize: size, color: '#0277BD' }} />;
    case 'link':
      return <LinkIcon sx={{ fontSize: size, color: '#757575' }} />;
    default:
      return <PdfIcon sx={{ fontSize: size, color: '#757575' }} />;
  }
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

interface SummaryCardProps {
  value: React.ReactNode;
  label: string;
  bgcolor: string;
  borderColor: string;
  valueColor: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ value, label, bgcolor, borderColor, valueColor }) => (
  <Box sx={{ p: 2, borderRadius: '12px', bgcolor, border: `1px solid ${borderColor}`, textAlign: 'center' }}>
    <Typography variant="h4" sx={{ fontWeight: 700, color: valueColor }}>
      {value}
    </Typography>
    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
      {label}
    </Typography>
  </Box>
);

interface StatusBadgeProps {
  status: CourseStatus | ContentStatus | ModuleDisplayStatus;
  size?: 'small' | 'medium';
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'medium' }) => {
  const config: Record<string, { label: string; color: string; bgcolor: string }> = {
    completed: {
      label: 'Completed',
      color: '#006B5F',
      bgcolor: 'rgba(0, 107, 95, 0.1)',
    },
    in_progress: {
      label: 'In Progress',
      color: '#1565C0',
      bgcolor: 'rgba(21, 101, 192, 0.1)',
    },
    not_started: {
      label: 'Not Started',
      color: '#757575',
      bgcolor: 'rgba(0, 0, 0, 0.06)',
    },
    reviewing: {
      label: 'Reviewing',
      color: '#E65100',
      bgcolor: 'rgba(230, 81, 0, 0.1)',
    },
    updated: {
      label: 'Updated',
      color: '#6A1B9A',
      bgcolor: 'rgba(106, 27, 154, 0.1)',
    },
  };

  const c = config[status] || config.not_started;

  return (
    <Chip
      label={c.label}
      size="small"
      sx={{
        fontWeight: 600,
        fontSize: size === 'small' ? '0.65rem' : '0.7rem',
        color: c.color,
        bgcolor: c.bgcolor,
        borderRadius: '6px',
        height: size === 'small' ? 18 : 22,
      }}
    />
  );
};

interface ContentCounterProps {
  icon: React.ReactNode;
  done: number;
  total: number;
  label: string;
}

const ContentCounter: React.FC<ContentCounterProps> = ({ icon, done, total, label }) => {
  if (total === 0) return null;
  return (
    <Tooltip title={`${done}/${total} ${label}`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
        {icon}
        <Typography
          variant="caption"
          sx={{
            color: done === total ? '#006B5F' : 'text.secondary',
            fontWeight: done === total ? 600 : 400,
          }}
        >
          {done}/{total}
        </Typography>
      </Box>
    </Tooltip>
  );
};

// ─── Content Item Row ────────────────────────────────────────────────────────

interface ContentItemRowProps {
  item: ContentItemProgress;
}

const ContentItemRow: React.FC<ContentItemRowProps> = ({ item }) => {
  const renderProgressDetail = () => {
    switch (item.contentType) {
      case 'video': {
        const vp = item.videoProgress;
        if (!vp) return <Typography variant="caption" color="text.secondary">Views: {item.viewCount}</Typography>;
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary">
              {Math.round(vp.percentageWatched)}% watched
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Position: {formatDuration(vp.currentPosition)} / {formatDuration(vp.totalDuration)}
            </Typography>
            <Box sx={{ width: 80 }}>
              <LinearProgress
                variant="determinate"
                value={Math.min(vp.percentageWatched, 100)}
                sx={{
                  height: 4,
                  borderRadius: 2,
                  bgcolor: 'rgba(7, 26, 82, 0.08)',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: getProgressColor(vp.percentageWatched),
                    borderRadius: 2,
                  },
                }}
              />
            </Box>
          </Box>
        );
      }
      case 'pdf': {
        const dp = item.documentProgress;
        if (!dp) return <Typography variant="caption" color="text.secondary">Views: {item.viewCount}</Typography>;
        return (
          <Typography variant="caption" color="text.secondary">
            Page {dp.currentPage}/{dp.totalPages} ({Math.round(dp.percentageRead)}% read)
          </Typography>
        );
      }
      default:
        return (
          <Typography variant="caption" color="text.secondary">
            Views: {item.viewCount}
          </Typography>
        );
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        py: 1,
        px: 1.5,
        borderBottom: '1px solid #F1F5F9',
        '&:last-child': { borderBottom: 'none' },
        bgcolor: 'rgba(0, 0, 0, 0.01)',
      }}
    >
      {getContentTypeIcon(item.contentType)}
      <Box sx={{ flex: 1, ml: 1.5, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 500, color: '#071A52' }} noWrap>
            {item.contentId}
          </Typography>
          <StatusBadge status={item.status} size="small" />
        </Box>
        <Box sx={{ mt: 0.25 }}>
          {renderProgressDetail()}
        </Box>
      </Box>
      {item.lastAccessedAt && (
        <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1, whiteSpace: 'nowrap' }}>
          {formatTimestamp(item.lastAccessedAt)}
        </Typography>
      )}
    </Box>
  );
};

// ─── Module Row with Expandable Content ──────────────────────────────────────

interface ModuleRowProps {
  userId: string;
  moduleId: string;
  progress: ModuleProgressSummary;
  displayStatus: ModuleDisplayStatus;
}

const ModuleRow: React.FC<ModuleRowProps> = ({ userId, moduleId, progress, displayStatus }) => {
  const [expanded, setExpanded] = useState(false);
  const [contentItems, setContentItems] = useState<ContentItemProgress[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const handleToggle = useCallback(async () => {
    const newExpanded = !expanded;
    setExpanded(newExpanded);

    if (newExpanded && !loaded) {
      try {
        setLoadingContent(true);
        setContentError(null);
        const items = await getModuleContentProgress(userId, moduleId);
        setContentItems(items);
        setLoaded(true);
      } catch (err) {
        console.error('Error loading content items:', err);
        setContentError('Failed to load content items.');
      } finally {
        setLoadingContent(false);
      }
    }
  }, [expanded, loaded, userId, moduleId]);

  return (
    <Box
      sx={{
        borderBottom: '1px solid #F1F5F9',
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      {/* Module summary row */}
      <Box
        onClick={handleToggle}
        sx={{
          display: 'flex',
          alignItems: 'center',
          py: 1.5,
          px: 1,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'rgba(7, 26, 82, 0.02)' },
          transition: 'background-color 0.15s',
        }}
      >
        {getStatusIcon(displayStatus, 18)}
        <Box sx={{ flex: 1, ml: 1.5, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 500, color: '#071A52' }} noWrap>
              {moduleId}
            </Typography>
            <StatusBadge status={displayStatus} size="small" />
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5, mt: 0.5, flexWrap: 'wrap' }}>
            <ContentCounter
              icon={<VideoIcon sx={{ fontSize: 14 }} />}
              done={progress.videosWatched}
              total={progress.videosTotal}
              label="Videos"
            />
            <ContentCounter
              icon={<PdfIcon sx={{ fontSize: 14 }} />}
              done={progress.pdfsRead}
              total={progress.pdfsTotal}
              label="PDFs"
            />
            <ContentCounter
              icon={<NoteIcon sx={{ fontSize: 14 }} />}
              done={progress.notesRead}
              total={progress.notesTotal}
              label="Notes"
            />
            {progress.audiosTotal > 0 && (
              <ContentCounter
                icon={<AudioIcon sx={{ fontSize: 14 }} />}
                done={progress.audiosListened}
                total={progress.audiosTotal}
                label="Audio"
              />
            )}
          </Box>
        </Box>
        <Box sx={{ textAlign: 'right', ml: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box>
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, color: getProgressColor(progress.completionPercentage) }}
            >
              {progress.completionPercentage}%
            </Typography>
            {progress.lastAccessedAt && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                {formatTimestamp(progress.lastAccessedAt)}
              </Typography>
            )}
          </Box>
          <ExpandMoreIcon
            sx={{
              fontSize: 18,
              color: 'text.secondary',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          />
        </Box>
      </Box>

      {/* Expandable content items */}
      <Collapse in={expanded}>
        <Box sx={{ pl: 4, pr: 1, pb: 1 }}>
          {loadingContent && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={20} />
            </Box>
          )}
          {contentError && (
            <Alert severity="error" sx={{ my: 1 }}>
              {contentError}
            </Alert>
          )}
          {loaded && contentItems.length === 0 && !loadingContent && (
            <Typography variant="caption" color="text.secondary" sx={{ py: 1, display: 'block' }}>
              No content items tracked yet.
            </Typography>
          )}
          {contentItems.map((item) => (
            <ContentItemRow key={item.contentId} item={item} />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
};

// ─── Streak History Heatmap ──────────────────────────────────────────────────

interface StreakHeatmapProps {
  streakHistory: Array<{ date: string; minutesActive: number }>;
}

const StreakHeatmap: React.FC<StreakHeatmapProps> = ({ streakHistory }) => {
  // Take last 30 entries
  const last30 = streakHistory.slice(-30);

  return (
    <Paper
      elevation={0}
      sx={{ p: 3, borderRadius: '16px', border: '1px solid #E2E8F0', bgcolor: '#FFFFFF' }}
    >
      <Typography variant="h6" sx={{ fontWeight: 600, color: '#071A52', mb: 2, display: 'flex', alignItems: 'center' }}>
        <StreakIcon sx={{ mr: 1, color: '#E65100' }} />
        Streak History (Last 30 Days)
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {last30.map((entry) => {
          const isActive = entry.minutesActive > 0;
          const dateLabel = new Date(entry.date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          });
          return (
            <Tooltip
              key={entry.date}
              title={`${dateLabel}: ${entry.minutesActive} min active`}
            >
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: '4px',
                  bgcolor: isActive
                    ? entry.minutesActive >= 60
                      ? '#006B5F'
                      : entry.minutesActive >= 30
                        ? 'rgba(0, 107, 95, 0.6)'
                        : 'rgba(0, 107, 95, 0.3)'
                    : '#E2E8F0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'default',
                  transition: 'transform 0.1s',
                  '&:hover': { transform: 'scale(1.2)' },
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: '0.55rem',
                    color: isActive ? '#FFFFFF' : '#94A3B8',
                    fontWeight: 600,
                  }}
                >
                  {new Date(entry.date).getDate()}
                </Typography>
              </Box>
            </Tooltip>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
        <Typography variant="caption" color="text.secondary">Less</Typography>
        <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: '#E2E8F0' }} />
        <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: 'rgba(0, 107, 95, 0.3)' }} />
        <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: 'rgba(0, 107, 95, 0.6)' }} />
        <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: '#006B5F' }} />
        <Typography variant="caption" color="text.secondary">More</Typography>
      </Box>
    </Paper>
  );
};

// ─── Main Page Component ─────────────────────────────────────────────────────

const StudentProgressDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<StudentProgressReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const loadProgress = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getStudentProgressReport(id);
      if (!data) {
        setError('Student progress data not found.');
        return;
      }
      setReport(data);
    } catch (err) {
      console.error('Error loading progress report:', err);
      setError('Failed to load student progress data.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!id) return;
      try {
        setLoading(true);
        setError(null);
        const data = await getStudentProgressReport(id);
        if (!cancelled) {
          if (!data) {
            setError('Student progress data not found.');
          } else {
            setReport(data);
          }
        }
      } catch (err) {
        console.error('Error loading progress report:', err);
        if (!cancelled) setError('Failed to load student progress data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id]);

  const handleResync = async (courseId: string) => {
    if (!id) return;
    try {
      setSyncing(courseId);
      await resyncStudentProgress(id, courseId);
      await loadProgress();
    } catch (err) {
      console.error('Error resyncing:', err);
      setError('Failed to resync progress.');
    } finally {
      setSyncing(null);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────

  if (error && !report) {
    return (
      <Box sx={{ mt: 4 }}>
        <Alert severity="error">{error}</Alert>
        <Button
          sx={{ mt: 2 }}
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(`/users/${id}`)}
        >
          Back to User
        </Button>
      </Box>
    );
  }

  const coursesCompleted = report?.courses.filter((c) => c.status === 'completed').length ?? 0;
  const coursesTotal = report?.courses.length ?? 0;

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* Non-blocking error */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Header bar */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', sm: 'center' },
          gap: 2,
          mb: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <IconButton
            onClick={() => navigate(`/users/${id}`)}
            sx={{
              mr: 1.5,
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              color: '#071A52',
              '&:hover': {
                bgcolor: 'rgba(7, 26, 82, 0.04)',
                borderColor: '#CBD5E1',
              },
            }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Box>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700, color: '#071A52' }}>
              Student Progress
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
              {report?.user.displayName || 'Unknown Student'} — {report?.user.email || ''}
            </Typography>
          </Box>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadProgress}
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            borderColor: '#E2E8F0',
            color: '#071A52',
            borderRadius: '8px',
            '&:hover': {
              borderColor: '#CBD5E1',
              bgcolor: 'rgba(7, 26, 82, 0.04)',
            },
          }}
        >
          Refresh
        </Button>
      </Box>

      {/* Summary Stats Row */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <SummaryCard
            value={`${report?.examReadiness ?? 0}%`}
            label="Exam Readiness"
            bgcolor="rgba(0, 107, 95, 0.06)"
            borderColor="rgba(0, 107, 95, 0.15)"
            valueColor="#006B5F"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <SummaryCard
            value={
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <StreakIcon sx={{ mr: 0.5, fontSize: '1.5rem' }} />
                {report?.streak?.currentStreak ?? 0}
              </Box>
            }
            label="Day Streak"
            bgcolor="rgba(255, 152, 0, 0.06)"
            borderColor="rgba(255, 152, 0, 0.15)"
            valueColor="#E65100"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <SummaryCard
            value={`${coursesCompleted}/${coursesTotal}`}
            label="Courses Done"
            bgcolor="rgba(7, 26, 82, 0.04)"
            borderColor="rgba(7, 26, 82, 0.12)"
            valueColor="#071A52"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <SummaryCard
            value={report?.totalContentCompleted ?? 0}
            label="Items Completed"
            bgcolor="rgba(7, 26, 82, 0.04)"
            borderColor="rgba(7, 26, 82, 0.12)"
            valueColor="#071A52"
          />
        </Grid>
      </Grid>

      {/* Last Activity */}
      {report?.lastActivityAt && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, color: 'text.secondary' }}>
          <AccessTimeIcon sx={{ fontSize: 16, mr: 0.5 }} />
          <Typography variant="body2">Last active: {formatTimestamp(report.lastActivityAt)}</Typography>
        </Box>
      )}

      <Divider sx={{ mb: 3 }} />

      {/* Per-Course Accordions */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#071A52', mb: 1.5 }}>
        Course Progress Breakdown
      </Typography>

      {report?.courses.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No course progress data available yet.
        </Alert>
      )}

      {report?.courses.map((course) => (
        <Accordion
          key={course.courseId}
          elevation={0}
          sx={{
            border: '1px solid #E2E8F0',
            borderRadius: '12px !important',
            mb: 1.5,
            '&:before': { display: 'none' },
            '&.Mui-expanded': { mb: 1.5 },
          }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1.5 }}>
              {getStatusIcon(course.status)}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: 600, color: '#071A52' }}
                    noWrap
                  >
                    {course.courseTitle}
                  </Typography>
                  <StatusBadge status={course.status} />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LinearProgress
                    variant="determinate"
                    value={course.completionPercentage}
                    sx={{
                      flex: 1,
                      height: 6,
                      borderRadius: 3,
                      bgcolor: 'rgba(7, 26, 82, 0.08)',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: getProgressColor(course.completionPercentage),
                        borderRadius: 3,
                      },
                    }}
                  />
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 600, color: '#071A52', minWidth: 35 }}
                  >
                    {course.completionPercentage}%
                  </Typography>
                </Box>
              </Box>
              <Tooltip title="Resync progress from content items">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleResync(course.courseId);
                  }}
                  disabled={syncing === course.courseId}
                >
                  {syncing === course.courseId ? (
                    <CircularProgress size={16} />
                  ) : (
                    <RefreshIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </Box>
          </AccordionSummary>

          <AccordionDetails sx={{ px: 2, pt: 0 }}>
            {Object.entries(course.moduleProgress || {}).length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                No module progress data yet.
              </Typography>
            ) : (
              Object.entries(course.moduleProgress).map(([moduleId, mp]) => (
                <ModuleRow
                  key={moduleId}
                  userId={id!}
                  moduleId={moduleId}
                  progress={mp}
                  displayStatus={getModuleDisplayStatus(
                    mp,
                    course.moduleUpdatedAtMap?.[moduleId]
                  )}
                />
              ))
            )}
          </AccordionDetails>
        </Accordion>
      ))}

      {/* Streak History */}
      {report?.streak && report.streak.streakHistory && report.streak.streakHistory.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <StreakHeatmap streakHistory={report.streak.streakHistory} />
        </Box>
      )}
    </Box>
  );
};

export default StudentProgressDetail;
```

---

## Admin — Course Learner Progress Tab
`/Users/rojinroy/Projects/aptitude4us_admin/src/components/CourseLearnerProgressTab.tsx`

```
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Chip,
  Button,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TableSortLabel,
  LinearProgress,
  CircularProgress,
  Alert,
  InputAdornment,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
  People as PeopleIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import { getCourseLearnerProgress } from '../services/progressService';
import type { CourseLearnerProgress } from '../types/progress';

interface CourseLearnerProgressTabProps {
  courseId: string;
}

type SortKey = 'name' | 'status' | 'completion' | 'lastActivity';
type SortDirection = 'asc' | 'desc';

const statusOrder: Record<string, number> = {
  completed: 0,
  in_progress: 1,
  reviewing: 2,
  not_started: 3,
};

const formatRelativeTime = (timestamp: Timestamp | null): string => {
  if (!timestamp) return 'Never';
  const now = Date.now();
  const then = timestamp.toMillis();
  const diffMs = now - then;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffSeconds < 60) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  return `${diffMonths}mo ago`;
};

const getStatusLabel = (status: string): string => {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'in_progress':
      return 'In Progress';
    case 'reviewing':
      return 'In Progress';
    case 'not_started':
    default:
      return 'Not Started';
  }
};

const getStatusStyle = (status: string): { color: string; bgcolor: string } => {
  switch (status) {
    case 'completed':
      return { color: '#006B5F', bgcolor: 'rgba(0, 107, 95, 0.1)' };
    case 'in_progress':
    case 'reviewing':
      return { color: '#1565C0', bgcolor: 'rgba(21, 101, 192, 0.1)' };
    case 'not_started':
    default:
      return { color: '#757575', bgcolor: 'rgba(0, 0, 0, 0.06)' };
  }
};

const CourseLearnerProgressTab: React.FC<CourseLearnerProgressTabProps> = ({ courseId }) => {
  const navigate = useNavigate();

  const [students, setStudents] = useState<CourseLearnerProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('completion');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getCourseLearnerProgress(courseId);
        setStudents(data);
      } catch (err) {
        console.error('Failed to load learner progress:', err);
        setError('Failed to load learner progress. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [courseId]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCourseLearnerProgress(courseId);
      setStudents(data);
    } catch (err) {
      console.error('Failed to load learner progress:', err);
      setError('Failed to load learner progress. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  // Filtered students
  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return students;
    const q = searchQuery.toLowerCase().trim();
    return students.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q)
    );
  }, [students, searchQuery]);

  // Sorted students
  const sortedStudents = useMemo(() => {
    const sorted = [...filteredStudents];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.displayName.localeCompare(b.displayName);
          break;
        case 'status':
          cmp =
            (statusOrder[a.courseProgress.status] ?? 99) -
            (statusOrder[b.courseProgress.status] ?? 99);
          break;
        case 'completion':
          cmp = a.courseProgress.completionPercentage - b.courseProgress.completionPercentage;
          break;
        case 'lastActivity': {
          const aTime = a.courseProgress.lastActivityAt?.toMillis?.() ?? 0;
          const bTime = b.courseProgress.lastActivityAt?.toMillis?.() ?? 0;
          cmp = aTime - bTime;
          break;
        }
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredStudents, sortKey, sortDirection]);

  // Paginated students
  const paginatedStudents = useMemo(() => {
    const start = page * rowsPerPage;
    return sortedStudents.slice(start, start + rowsPerPage);
  }, [sortedStudents, page, rowsPerPage]);

  // Aggregated stats
  const stats = useMemo(() => {
    const total = students.length;
    if (total === 0) {
      return { avgCompletion: 0, completed: 0, inProgress: 0, notStarted: 0, total: 0 };
    }
    let sumCompletion = 0;
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;

    for (const s of students) {
      sumCompletion += s.courseProgress.completionPercentage;
      switch (s.courseProgress.status) {
        case 'completed':
          completed++;
          break;
        case 'in_progress':
        case 'reviewing':
          inProgress++;
          break;
        case 'not_started':
        default:
          notStarted++;
          break;
      }
    }

    return {
      avgCompletion: Math.round(sumCompletion / total),
      completed,
      inProgress,
      notStarted,
      total,
    };
  }, [students]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection(key === 'completion' ? 'desc' : 'asc');
    }
  };

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleRowClick = (userId: string) => {
    navigate(`/users/${userId}/progress`);
  };

  // Loading state
  if (loading) {
    return (
      <Paper
        elevation={0}
        sx={{
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
          p: 6,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <CircularProgress size={40} sx={{ color: '#071A52' }} />
      </Paper>
    );
  }

  // Error state
  if (error) {
    return (
      <Paper
        elevation={0}
        sx={{
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
          p: 3,
        }}
      >
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={handleRefresh}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      </Paper>
    );
  }

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: '16px',
        border: '1px solid #E2E8F0',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          px: 3,
          py: 2.5,
          borderBottom: '1px solid #E2E8F0',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <PeopleIcon sx={{ color: '#071A52', fontSize: 22 }} />
          <Typography variant="h6" sx={{ fontWeight: 700, color: '#071A52', fontSize: '1.0625rem' }}>
            Learner Progress
          </Typography>
          <Chip
            label={`${stats.total} student${stats.total !== 1 ? 's' : ''}`}
            size="small"
            sx={{
              height: 24,
              fontSize: '0.75rem',
              fontWeight: 700,
              backgroundColor: 'rgba(7, 26, 82, 0.08)',
              color: '#071A52',
            }}
          />
        </Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={<RefreshIcon sx={{ fontSize: 17 }} />}
          onClick={handleRefresh}
          sx={{
            borderColor: '#E2E8F0',
            color: '#071A52',
            fontWeight: 600,
            fontSize: '0.8125rem',
            borderRadius: '8px',
            backgroundColor: '#FFFFFF',
            '&:hover': { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
          }}
        >
          Refresh
        </Button>
      </Box>

      {/* Empty state */}
      {students.length === 0 ? (
        <Box sx={{ p: 3 }}>
          <Alert severity="info">No students enrolled in this course yet.</Alert>
        </Box>
      ) : (
        <>
          {/* Summary bar */}
          <Box
            sx={{
              display: 'flex',
              gap: 2,
              px: 3,
              py: 2,
              borderBottom: '1px solid #E2E8F0',
              flexWrap: 'wrap',
            }}
          >
            <Paper
              elevation={0}
              sx={{
                flex: 1,
                minWidth: 140,
                p: 2,
                borderRadius: '12px',
                backgroundColor: 'rgba(7, 26, 82, 0.03)',
                border: '1px solid #E2E8F0',
                textAlign: 'center',
              }}
            >
              <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>
                Avg. Completion
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#071A52', mt: 0.5 }}>
                {stats.avgCompletion}%
              </Typography>
            </Paper>
            <Paper
              elevation={0}
              sx={{
                flex: 1,
                minWidth: 140,
                p: 2,
                borderRadius: '12px',
                backgroundColor: 'rgba(0, 107, 95, 0.04)',
                border: '1px solid #E2E8F0',
                textAlign: 'center',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                <CheckCircleIcon sx={{ fontSize: 14, color: '#006B5F' }} />
                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>
                  Completed
                </Typography>
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#006B5F', mt: 0.5 }}>
                {stats.completed}
                <Typography component="span" variant="body2" sx={{ color: '#94A3B8', fontWeight: 600, ml: 0.5 }}>
                  / {stats.total}
                </Typography>
              </Typography>
            </Paper>
            <Paper
              elevation={0}
              sx={{
                flex: 1,
                minWidth: 140,
                p: 2,
                borderRadius: '12px',
                backgroundColor: 'rgba(21, 101, 192, 0.04)',
                border: '1px solid #E2E8F0',
                textAlign: 'center',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                <ScheduleIcon sx={{ fontSize: 14, color: '#1565C0' }} />
                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>
                  In Progress
                </Typography>
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#1565C0', mt: 0.5 }}>
                {stats.inProgress}
                <Typography component="span" variant="body2" sx={{ color: '#94A3B8', fontWeight: 600, ml: 0.5 }}>
                  / {stats.total}
                </Typography>
              </Typography>
            </Paper>
            <Paper
              elevation={0}
              sx={{
                flex: 1,
                minWidth: 140,
                p: 2,
                borderRadius: '12px',
                backgroundColor: 'rgba(0, 0, 0, 0.02)',
                border: '1px solid #E2E8F0',
                textAlign: 'center',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                <RadioButtonUncheckedIcon sx={{ fontSize: 14, color: '#757575' }} />
                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>
                  Not Started
                </Typography>
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#757575', mt: 0.5 }}>
                {stats.notStarted}
                <Typography component="span" variant="body2" sx={{ color: '#94A3B8', fontWeight: 600, ml: 0.5 }}>
                  / {stats.total}
                </Typography>
              </Typography>
            </Paper>
          </Box>

          {/* Search filter */}
          <Box sx={{ px: 3, py: 2, borderBottom: '1px solid #E2E8F0' }}>
            <TextField
              size="small"
              placeholder="Search by student name or email…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(0);
              }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 20, color: '#94A3B8' }} />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{
                width: '100%',
                maxWidth: 400,
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                  backgroundColor: '#F8FAFC',
                  '& fieldset': { borderColor: '#E2E8F0' },
                  '&:hover fieldset': { borderColor: '#CBD5E1' },
                  '&.Mui-focused fieldset': { borderColor: '#071A52' },
                },
              }}
            />
          </Box>

          {/* Table */}
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: 'rgba(7, 26, 82, 0.03)' }}>
                  <TableCell sx={{ fontWeight: 700, color: '#071A52', fontSize: '0.8125rem' }}>
                    <TableSortLabel
                      active={sortKey === 'name'}
                      direction={sortKey === 'name' ? sortDirection : 'asc'}
                      onClick={() => handleSort('name')}
                    >
                      Student
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, color: '#071A52', fontSize: '0.8125rem' }}>
                    <TableSortLabel
                      active={sortKey === 'status'}
                      direction={sortKey === 'status' ? sortDirection : 'asc'}
                      onClick={() => handleSort('status')}
                    >
                      Status
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, color: '#071A52', fontSize: '0.8125rem', minWidth: 180 }}>
                    <TableSortLabel
                      active={sortKey === 'completion'}
                      direction={sortKey === 'completion' ? sortDirection : 'desc'}
                      onClick={() => handleSort('completion')}
                    >
                      Completion
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, color: '#071A52', fontSize: '0.8125rem' }}>
                    <TableSortLabel
                      active={sortKey === 'lastActivity'}
                      direction={sortKey === 'lastActivity' ? sortDirection : 'asc'}
                      onClick={() => handleSort('lastActivity')}
                    >
                      Last Activity
                    </TableSortLabel>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedStudents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 4, color: '#64748B' }}>
                      <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                        No students match your search.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedStudents.map((student) => {
                    const status = student.courseProgress.status;
                    const completion = student.courseProgress.completionPercentage;
                    const statusStyle = getStatusStyle(status);

                    return (
                      <TableRow
                        key={student.userId}
                        hover
                        onClick={() => handleRowClick(student.userId)}
                        sx={{
                          cursor: 'pointer',
                          '&:hover': { bgcolor: 'rgba(7, 26, 82, 0.02)' },
                        }}
                      >
                        {/* Student name + email */}
                        <TableCell>
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 700, color: '#071A52', lineHeight: 1.4 }}
                          >
                            {student.displayName || 'Unnamed Student'}
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#64748B' }}>
                            {student.email}
                          </Typography>
                        </TableCell>

                        {/* Status badge */}
                        <TableCell>
                          <Chip
                            label={getStatusLabel(status)}
                            size="small"
                            sx={{
                              height: 24,
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              color: statusStyle.color,
                              backgroundColor: statusStyle.bgcolor,
                            }}
                          />
                        </TableCell>

                        {/* Completion % with progress bar */}
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Box sx={{ flex: 1 }}>
                              <LinearProgress
                                variant="determinate"
                                value={completion}
                                sx={{
                                  height: 6,
                                  borderRadius: 3,
                                  backgroundColor: '#E2E8F0',
                                  '& .MuiLinearProgress-bar': {
                                    borderRadius: 3,
                                    backgroundColor:
                                      status === 'completed'
                                        ? '#006B5F'
                                        : status === 'not_started'
                                          ? '#BDBDBD'
                                          : '#1565C0',
                                  },
                                }}
                              />
                            </Box>
                            <Typography
                              variant="body2"
                              sx={{
                                fontWeight: 700,
                                color: '#071A52',
                                minWidth: 40,
                                textAlign: 'right',
                                fontSize: '0.8125rem',
                              }}
                            >
                              {completion}%
                            </Typography>
                          </Box>
                        </TableCell>

                        {/* Last activity */}
                        <TableCell>
                          <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.8125rem' }}>
                            {formatRelativeTime(student.courseProgress.lastActivityAt)}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination */}
          <TablePagination
            component="div"
            count={filteredStudents.length}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[10, 25, 50]}
            labelDisplayedRows={({ from, to, count }) =>
              `${from}–${to} of ${count} loaded student${count !== 1 ? 's' : ''}`
            }
            sx={{
              borderTop: '1px solid #E2E8F0',
              '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
                fontSize: '0.8125rem',
                color: '#64748B',
              },
            }}
          />
        </>
      )}
    </Paper>
  );
};

export default CourseLearnerProgressTab;
```

---

## Tests — Progress Logic Unit Tests
`/Users/rojinroy/Projects/aptitude4us_admin/tests/logic/progress.logic.test.js`

```
/**
 * Pure logic tests for progress computation helpers.
 *
 * These do NOT require the Firestore emulator — they test extracted pure
 * functions with plain objects that mimic Firestore Timestamp.
 *
 * Run:
 *   npx jest tests/logic/progress.logic.test.js
 */

const {
  computeModuleSummary,
  mergeSegments,
  sumSegments,
  findContentItem,
  evaluateVideoProgress,
  trimSegmentsToTotal,
  trimSegmentsWithBudget,
  subtractCoverage,
  takeEarliest,
} = require("../../functions/src/progressHelpers");

// ── Timestamp helper ─────────────────────────────────────────────────────────
// Mimic Firestore Timestamp with toMillis()
const ts = (ms) => ({ toMillis: () => ms });

// ── mergeSegments ────────────────────────────────────────────────────────────

describe("mergeSegments", () => {
  test("empty input", () => {
    expect(mergeSegments([])).toEqual([]);
  });

  test("single segment", () => {
    expect(mergeSegments([{ start: 0, end: 10 }])).toEqual([
      { start: 0, end: 10 },
    ]);
  });

  test("non-overlapping segments stay separate", () => {
    const result = mergeSegments([
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ]);
    expect(result).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ]);
  });

  test("overlapping segments merge", () => {
    const result = mergeSegments([
      { start: 0, end: 10 },
      { start: 5, end: 20 },
    ]);
    expect(result).toEqual([{ start: 0, end: 20 }]);
  });

  test("adjacent segments merge", () => {
    const result = mergeSegments([
      { start: 0, end: 10 },
      { start: 10, end: 20 },
    ]);
    expect(result).toEqual([{ start: 0, end: 20 }]);
  });

  test("unsorted segments are sorted before merge", () => {
    const result = mergeSegments([
      { start: 10, end: 20 },
      { start: 0, end: 5 },
      { start: 3, end: 12 },
    ]);
    expect(result).toEqual([{ start: 0, end: 20 }]);
  });

  test("zero-length segments are filtered out", () => {
    const result = mergeSegments([
      { start: 5, end: 5 },
      { start: 0, end: 10 },
    ]);
    expect(result).toEqual([{ start: 0, end: 10 }]);
  });
});

// ── sumSegments ──────────────────────────────────────────────────────────────

describe("sumSegments", () => {
  test("null/empty returns 0", () => {
    expect(sumSegments(null)).toBe(0);
    expect(sumSegments([])).toBe(0);
  });

  test("sums correctly", () => {
    expect(
      sumSegments([
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ])
    ).toBe(20);
  });
});

// ── findContentItem ──────────────────────────────────────────────────────────

describe("findContentItem", () => {
  const content = {
    videos: [{ id: "v1", title: "A" }],
    pdfs: [{ id: "p1", title: "B" }],
    notes: [],
    audios: [],
    images: [],
    links: [{ id: "l1" }],
  };

  test("finds video", () => {
    expect(findContentItem(content, "v1")).toEqual({ id: "v1", title: "A" });
  });

  test("finds pdf", () => {
    expect(findContentItem(content, "p1")).toEqual({ id: "p1", title: "B" });
  });

  test("returns null for unknown id", () => {
    expect(findContentItem(content, "unknown")).toBeNull();
  });

  test("returns null for null content", () => {
    expect(findContentItem(null, "v1")).toBeNull();
  });
});

// ── computeModuleSummary ─────────────────────────────────────────────────────

describe("computeModuleSummary", () => {
  // Shared content fixture: 2 videos, 1 pdf
  const moduleContent = {
    videos: [{ id: "v1" }, { id: "v2" }],
    pdfs: [{ id: "p1" }],
    notes: [],
    audios: [],
    images: [],
    links: [],
  };

  const mkItem = (id, type, status, completedAt, lastAccessedAt) => ({
    contentId: id,
    contentType: type,
    status,
    completedAt: completedAt ? ts(completedAt) : null,
    lastAccessedAt: lastAccessedAt ? ts(lastAccessedAt) : null,
  });

  // ── Scenario 1: All completed ──────────────────────────────────────────

  test("all items completed → status completed, 100%", () => {
    const items = [
      mkItem("v1", "video", "completed", 1000, 1000),
      mkItem("v2", "video", "completed", 2000, 2000),
      mkItem("p1", "pdf", "completed", 3000, 3000),
    ];

    const { summary, modTotal, modCompleted } = computeModuleSummary(
      moduleContent,
      items,
      null
    );

    expect(summary.status).toBe("completed");
    expect(summary.completionPercentage).toBe(100);
    expect(summary.completedAt.toMillis()).toBe(3000); // max
    expect(modTotal).toBe(3);
    expect(modCompleted).toBe(3);
    expect(summary.videosWatched).toBe(2);
    expect(summary.videosTotal).toBe(2);
    expect(summary.pdfsRead).toBe(1);
    expect(summary.pdfsTotal).toBe(1);
  });

  // ── Scenario 2: Partially completed ────────────────────────────────────

  test("partial completion → in_progress", () => {
    const items = [
      mkItem("v1", "video", "completed", 1000, 1000),
      mkItem("v2", "video", "in_progress", null, 2000),
    ];

    const { summary } = computeModuleSummary(moduleContent, items, null);

    expect(summary.status).toBe("in_progress");
    expect(summary.completionPercentage).toBe(33); // 1/3
    expect(summary.completedAt).toBeNull();
  });

  // ── Scenario 3: No items → not_started ─────────────────────────────────

  test("no items → not_started, 0%", () => {
    const { summary } = computeModuleSummary(moduleContent, [], null);

    expect(summary.status).toBe("not_started");
    expect(summary.completionPercentage).toBe(0);
    expect(summary.completedAt).toBeNull();
  });

  // ── Scenario 4: Empty module (no content) ──────────────────────────────

  test("empty module → not_started, 0%, regardless of items", () => {
    const emptyContent = {
      videos: [],
      pdfs: [],
      notes: [],
      audios: [],
      images: [],
      links: [],
    };
    const items = [mkItem("orphan", "video", "completed", 1000, 1000)];

    const { summary, modTotal } = computeModuleSummary(
      emptyContent,
      items,
      null
    );

    expect(summary.status).toBe("not_started");
    expect(modTotal).toBe(0);
  });

  // ── Scenario 5: Orphaned items are excluded ────────────────────────────

  test("orphaned items (deleted content) are excluded from counts", () => {
    // v1 and p1 are live; orphan_v is NOT in moduleContent
    const items = [
      mkItem("v1", "video", "completed", 1000, 1000),
      mkItem("p1", "pdf", "completed", 2000, 2000),
      mkItem("orphan_v", "video", "completed", 3000, 3000), // orphan
    ];

    const { summary, modCompleted } = computeModuleSummary(
      moduleContent,
      items,
      null
    );

    // Only 2 of 3 live items completed (v1, p1), modTotal is 3 (v1,v2,p1)
    expect(modCompleted).toBe(2);
    expect(summary.status).toBe("in_progress");
    expect(summary.completionPercentage).toBe(67); // 2/3
    // Orphan's completedAt (3000) must NOT be used
    expect(summary.completedAt).toBeNull();
  });

  // ── Scenario 6: Add content → regression from completed ────────────────

  test("regression: new content added → preserves old completedAt", () => {
    // Module had 2 videos, student completed both. Admin adds v3 (in new content).
    const newContent = {
      videos: [{ id: "v1" }, { id: "v2" }, { id: "v3" }],
      pdfs: [],
      notes: [],
      audios: [],
      images: [],
      links: [],
    };

    const items = [
      mkItem("v1", "video", "completed", 1000, 1000),
      mkItem("v2", "video", "completed", 2000, 2000),
      // v3 has no item yet
    ];

    // Previous progress had completedAt from when it was 2/2
    const prevMp = { completedAt: ts(2000) };

    const { summary } = computeModuleSummary(newContent, items, prevMp);

    expect(summary.status).toBe("in_progress"); // 2/3
    expect(summary.completionPercentage).toBe(67);
    // Old completedAt preserved for "Updated" badge
    expect(summary.completedAt.toMillis()).toBe(2000);
  });

  // ── Scenario 7: Re-complete after regression ───────────────────────────

  test("re-completion: student finishes new content → new completedAt", () => {
    const newContent = {
      videos: [{ id: "v1" }, { id: "v2" }, { id: "v3" }],
      pdfs: [],
      notes: [],
      audios: [],
      images: [],
      links: [],
    };

    const items = [
      mkItem("v1", "video", "completed", 1000, 1000),
      mkItem("v2", "video", "completed", 2000, 2000),
      mkItem("v3", "video", "completed", 5000, 5000), // newly completed
    ];

    const prevMp = { completedAt: ts(2000) };

    const { summary } = computeModuleSummary(newContent, items, prevMp);

    expect(summary.status).toBe("completed");
    expect(summary.completionPercentage).toBe(100);
    // completedAt is the NEW max (5000), not preserved old (2000)
    expect(summary.completedAt.toMillis()).toBe(5000);
  });

  // ── Scenario 8: Remove content → still completed ──────────────────────

  test("removal: content removed, remaining all done → stays completed", () => {
    // Module originally had v1, v2, p1. Admin removed p1.
    const reducedContent = {
      videos: [{ id: "v1" }, { id: "v2" }],
      pdfs: [],
      notes: [],
      audios: [],
      images: [],
      links: [],
    };

    const items = [
      mkItem("v1", "video", "completed", 1000, 1000),
      mkItem("v2", "video", "completed", 2000, 2000),
      mkItem("p1", "pdf", "completed", 3000, 3000), // orphan now
    ];

    const { summary, modTotal, modCompleted } = computeModuleSummary(
      reducedContent,
      items,
      null
    );

    expect(modTotal).toBe(2);
    expect(modCompleted).toBe(2);
    expect(summary.status).toBe("completed");
    expect(summary.completionPercentage).toBe(100);
    // completedAt is max of live items only (2000, not 3000 from orphan)
    expect(summary.completedAt.toMillis()).toBe(2000);
  });

  // ── Scenario 9: Clamping ───────────────────────────────────────────────

  test("completed count clamped to module total", () => {
    // Edge case: more completed live items than modTotal (shouldn't happen,
    // but defense in depth). This would only occur if content types mismatch.
    const content = {
      videos: [{ id: "v1" }],
      pdfs: [],
      notes: [],
      audios: [],
      images: [],
      links: [],
    };

    // v1 exists in content; item has wrong contentType but matches id
    const items = [
      mkItem("v1", "video", "completed", 1000, 1000),
    ];

    const { summary, modCompleted, modTotal } = computeModuleSummary(
      content,
      items,
      null
    );

    expect(modTotal).toBe(1);
    expect(modCompleted).toBe(1); // min(1, 1)
    expect(summary.completionPercentage).toBe(100);
  });

  // ── Scenario 10: in_progress items with no completions ─────────────────

  test("in_progress items with no completions → in_progress status", () => {
    const items = [
      mkItem("v1", "video", "in_progress", null, 1000),
    ];

    const { summary } = computeModuleSummary(moduleContent, items, null);

    expect(summary.status).toBe("in_progress");
    expect(summary.completionPercentage).toBe(0);
    expect(summary.completedAt).toBeNull();
    expect(summary.lastAccessedAt.toMillis()).toBe(1000);
  });

  // ── Scenario 11: Mixed content types ───────────────────────────────────

  test("all content types counted correctly", () => {
    const fullContent = {
      videos: [{ id: "v1" }],
      pdfs: [{ id: "p1" }],
      notes: [{ id: "n1" }],
      audios: [{ id: "a1" }],
      images: [{ id: "i1" }],
      links: [{ id: "l1" }],
    };

    const items = [
      mkItem("v1", "video", "completed", 1000, 1000),
      mkItem("p1", "pdf", "completed", 1000, 1000),
      mkItem("n1", "note", "completed", 1000, 1000),
      mkItem("a1", "audio", "completed", 1000, 1000),
      mkItem("i1", "image", "completed", 1000, 1000),
      mkItem("l1", "link", "completed", 1000, 1000),
    ];

    const { summary, modTotal, modCompleted } = computeModuleSummary(
      fullContent,
      items,
      null
    );

    expect(modTotal).toBe(6);
    expect(modCompleted).toBe(6);
    expect(summary.videosWatched).toBe(1);
    expect(summary.pdfsRead).toBe(1);
    expect(summary.notesRead).toBe(1);
    expect(summary.audiosListened).toBe(1);
    expect(summary.imagesViewed).toBe(1);
    expect(summary.linksViewed).toBe(1);
    expect(summary.status).toBe("completed");
  });
});


// ── trimSegmentsToTotal ──────────────────────────────────────────────────────

describe("trimSegmentsToTotal", () => {
  test("no trimming needed", () => {
    const segs = [{ start: 0, end: 10 }, { start: 20, end: 30 }];
    expect(trimSegmentsToTotal(segs, 50)).toEqual(segs);
  });

  test("trims last segment", () => {
    const segs = [{ start: 0, end: 10 }, { start: 20, end: 30 }];
    const result = trimSegmentsToTotal(segs, 15);
    expect(result).toEqual([{ start: 0, end: 10 }, { start: 20, end: 25 }]);
  });

  test("drops segments beyond budget", () => {
    const segs = [{ start: 0, end: 10 }, { start: 20, end: 30 }, { start: 40, end: 50 }];
    const result = trimSegmentsToTotal(segs, 12);
    expect(result).toEqual([{ start: 0, end: 10 }, { start: 20, end: 22 }]);
  });

  test("zero budget returns empty", () => {
    expect(trimSegmentsToTotal([{ start: 0, end: 10 }], 0)).toEqual([]);
  });
});

// ── evaluateVideoProgress (security-critical) ────────────────────────────────

describe("evaluateVideoProgress", () => {
  const mkExisting = (segments, lastServerCheckAtMs) => ({
    videoProgress: {
      watchedSegments: segments,
      lastServerCheckAt: lastServerCheckAtMs ? ts(lastServerCheckAtMs) : null,
    },
  });

  const THRESHOLD = 90;
  const VIDEO_DURATION = 300;

  // ── Trimming (not throwing) on wall-clock cap ────────────────────────

  test("first call: {0, duration} trimmed to 15s, capped=true", () => {
    const result = evaluateVideoProgress({
      existing: null,
      incomingSegments: [{ start: 0, end: VIDEO_DURATION }],
      serverDuration: VIDEO_DURATION,
      nowMs: Date.now(),
      threshold: THRESHOLD,
      action: "update_position",
    });

    expect(result.capped).toBe(true);
    expect(result.status).toBe("in_progress");
    expect(sumSegments(result.watchedSegments)).toBe(15);
    expect(result.watchedSegments).toEqual([{ start: 0, end: 15 }]);
    expect(result.percentageWatched).toBe(5);
  });

  test("first call: small segment (10s) not capped", () => {
    const result = evaluateVideoProgress({
      existing: null,
      incomingSegments: [{ start: 0, end: 10 }],
      serverDuration: VIDEO_DURATION,
      nowMs: Date.now(),
      threshold: THRESHOLD,
      action: "update_position",
    });

    expect(result.capped).toBe(false);
    expect(result.percentageWatched).toBe(3);
  });

  test("start with empty segments accepted", () => {
    const result = evaluateVideoProgress({
      existing: null,
      incomingSegments: [],
      serverDuration: VIDEO_DURATION,
      nowMs: Date.now(),
      threshold: THRESHOLD,
      action: "start",
    });

    expect(result.capped).toBe(false);
    expect(result.status).toBe("in_progress");
    expect(result.watchedSegments).toHaveLength(0);
  });

  // ── Normal playback ──────────────────────────────────────────────────

  test("heartbeat after 60s with 55s of segments accepted", () => {
    const startTime = 1000000;
    const heartbeatTime = startTime + 60000;

    const result = evaluateVideoProgress({
      existing: mkExisting([], startTime),
      incomingSegments: [{ start: 0, end: 55 }],
      serverDuration: VIDEO_DURATION,
      nowMs: heartbeatTime,
      threshold: THRESHOLD,
      action: "update_position",
    });

    expect(result.capped).toBe(false);
    expect(result.percentageWatched).toBe(18);
  });

  // ── Day-old record: elapsed capped at 300s → maxAdded=605 ───────────

  test("day-old record: >605s trimmed", () => {
    const dayAgo = Date.now() - 86400 * 1000;

    const result = evaluateVideoProgress({
      existing: mkExisting([], dayAgo),
      incomingSegments: [{ start: 0, end: 700 }],
      serverDuration: 1800,
      nowMs: Date.now(),
      threshold: THRESHOLD,
      action: "update_position",
    });

    expect(result.capped).toBe(true);
    expect(sumSegments(result.watchedSegments)).toBe(605);
  });

  test("day-old record: 300s within 605s cap, not trimmed", () => {
    const dayAgo = Date.now() - 86400 * 1000;

    const result = evaluateVideoProgress({
      existing: mkExisting([], dayAgo),
      incomingSegments: [{ start: 0, end: 300 }],
      serverDuration: 1800,
      nowMs: Date.now(),
      threshold: THRESHOLD,
      action: "update_position",
    });

    expect(result.capped).toBe(false);
    expect(result.percentageWatched).toBe(17);
  });

  // ── Concurrent call safety (pure function level) ─────────────────────

  test("two calls at same nowMs: second gets only 5s allowance", () => {
    const nowMs = Date.now();

    const first = evaluateVideoProgress({
      existing: null,
      incomingSegments: [{ start: 0, end: 10 }],
      serverDuration: VIDEO_DURATION,
      nowMs,
      threshold: THRESHOLD,
      action: "start",
    });

    // Simulate: first result written, second call reads it
    const afterFirst = {
      videoProgress: {
        watchedSegments: first.watchedSegments,
        lastServerCheckAt: first.lastServerCheckAt,
      },
    };

    const second = evaluateVideoProgress({
      existing: afterFirst,
      incomingSegments: [{ start: 10, end: 100 }],
      serverDuration: VIDEO_DURATION,
      nowMs,
      threshold: THRESHOLD,
      action: "update_position",
    });

    expect(second.capped).toBe(true);
    expect(sumSegments(second.watchedSegments)).toBe(15);
  });

  // ── Completion ───────────────────────────────────────────────────────

  test("completion fires at threshold", () => {
    const checkTime = Date.now() - 30000;

    const result = evaluateVideoProgress({
      existing: mkExisting([{ start: 0, end: 250 }], checkTime),
      incomingSegments: [{ start: 250, end: 275 }],
      serverDuration: VIDEO_DURATION,
      nowMs: Date.now(),
      threshold: THRESHOLD,
      action: "update_position",
    });

    expect(result.status).toBe("completed");
    expect(result.completedAt).toBe(true);
    expect(result.percentageWatched).toBe(92);
  });

  test("just below threshold stays in_progress", () => {
    const checkTime = Date.now() - 30000;

    const result = evaluateVideoProgress({
      existing: mkExisting([{ start: 0, end: 250 }], checkTime),
      incomingSegments: [{ start: 250, end: 268 }],
      serverDuration: VIDEO_DURATION,
      nowMs: Date.now(),
      threshold: THRESHOLD,
      action: "update_position",
    });

    expect(result.status).toBe("in_progress");
    expect(result.percentageWatched).toBe(89);
  });

  // ── No server duration ───────────────────────────────────────────────

  test("no server duration: in_progress with action=complete", () => {
    const result = evaluateVideoProgress({
      existing: null,
      incomingSegments: [],
      serverDuration: 0,
      nowMs: Date.now(),
      threshold: THRESHOLD,
      action: "complete",
    });

    expect(result.status).toBe("in_progress");
    expect(result.needsDurationWarning).toBe(true);
  });

  test("no server duration: segments recorded, 0%", () => {
    const result = evaluateVideoProgress({
      existing: null,
      incomingSegments: [{ start: 0, end: 5 }],
      serverDuration: 0,
      nowMs: Date.now(),
      threshold: THRESHOLD,
      action: "update_position",
    });

    expect(result.status).toBe("in_progress");
    expect(result.percentageWatched).toBe(0);
    expect(result.watchedSegments).toEqual([{ start: 0, end: 5 }]);
  });

  test("NaN duration treated as no duration", () => {
    const result = evaluateVideoProgress({
      existing: null,
      incomingSegments: [],
      serverDuration: NaN,
      nowMs: Date.now(),
      threshold: THRESHOLD,
      action: "complete",
    });

    expect(result.status).toBe("in_progress");
    expect(result.needsDurationWarning).toBe(true);
    expect(result.totalDuration).toBe(0);
  });

  // ── Over-duration (still throws) ─────────────────────────────────────

  test("segments exceeding 110% of duration rejected", () => {
    const checkTime = Date.now() - 60000;

    expect(() =>
      evaluateVideoProgress({
        existing: mkExisting([{ start: 0, end: 300 }], checkTime),
        incomingSegments: [{ start: 300, end: 340 }],
        serverDuration: VIDEO_DURATION,
        nowMs: Date.now(),
        threshold: THRESHOLD,
        action: "update_position",
      })
    ).toThrow("Watched segments exceed video duration.");
  });

  // ── Invalid segments (still throws) ──────────────────────────────────

  test("negative start rejected", () => {
    expect(() =>
      evaluateVideoProgress({
        existing: null,
        incomingSegments: [{ start: -1, end: 5 }],
        serverDuration: VIDEO_DURATION,
        nowMs: Date.now(),
        threshold: THRESHOLD,
        action: "update_position",
      })
    ).toThrow("Invalid segment data.");
  });

  test("end < start rejected", () => {
    expect(() =>
      evaluateVideoProgress({
        existing: null,
        incomingSegments: [{ start: 10, end: 5 }],
        serverDuration: VIDEO_DURATION,
        nowMs: Date.now(),
        threshold: THRESHOLD,
        action: "update_position",
      })
    ).toThrow("Invalid segment data.");
  });

  test("non-number segment rejected", () => {
    expect(() =>
      evaluateVideoProgress({
        existing: null,
        incomingSegments: [{ start: "0", end: "10" }],
        serverDuration: VIDEO_DURATION,
        nowMs: Date.now(),
        threshold: THRESHOLD,
        action: "update_position",
      })
    ).toThrow("Invalid segment data.");
  });

  // ── Metadata ─────────────────────────────────────────────────────────

  test("lastServerCheckAt always set to nowMs", () => {
    const nowMs = 1700000000000;
    const result = evaluateVideoProgress({
      existing: null,
      incomingSegments: [],
      serverDuration: VIDEO_DURATION,
      nowMs,
      threshold: THRESHOLD,
      action: "start",
    });

    expect(result.lastServerCheckAt).toBe(nowMs);
  });

  test("segments from multiple calls merge correctly", () => {
    const checkTime = Date.now() - 60000;

    const result = evaluateVideoProgress({
      existing: mkExisting([{ start: 0, end: 50 }, { start: 100, end: 150 }], checkTime),
      incomingSegments: [{ start: 40, end: 110 }],
      serverDuration: VIDEO_DURATION,
      nowMs: Date.now(),
      threshold: THRESHOLD,
      action: "update_position",
    });

    expect(result.watchedSegments).toEqual([{ start: 0, end: 150 }]);
    expect(result.percentageWatched).toBe(50);
  });
});

// ── subtractCoverage ─────────────────────────────────────────────────────────

describe("subtractCoverage", () => {
  test("no existing coverage — returns incoming unchanged", () => {
    const result = subtractCoverage(
      [{ start: 0, end: 60 }],
      []
    );
    expect(result).toEqual([{ start: 0, end: 60 }]);
  });

  test("fully covered — returns empty", () => {
    const result = subtractCoverage(
      [{ start: 10, end: 50 }],
      [{ start: 0, end: 60 }]
    );
    expect(result).toEqual([]);
  });

  test("partial overlap at start — returns uncovered tail", () => {
    const result = subtractCoverage(
      [{ start: 0, end: 60 }],
      [{ start: 0, end: 30 }]
    );
    expect(result).toEqual([{ start: 30, end: 60 }]);
  });

  test("partial overlap in middle — splits into two", () => {
    const result = subtractCoverage(
      [{ start: 0, end: 100 }],
      [{ start: 30, end: 60 }]
    );
    expect(result).toEqual([
      { start: 0, end: 30 },
      { start: 60, end: 100 },
    ]);
  });

  test("multiple existing segments punch holes in incoming", () => {
    const result = subtractCoverage(
      [{ start: 0, end: 120 }],
      [{ start: 20, end: 40 }, { start: 80, end: 100 }]
    );
    expect(result).toEqual([
      { start: 0, end: 20 },
      { start: 40, end: 80 },
      { start: 100, end: 120 },
    ]);
  });

  test("non-overlapping incoming and existing", () => {
    const result = subtractCoverage(
      [{ start: 100, end: 200 }],
      [{ start: 0, end: 50 }]
    );
    expect(result).toEqual([{ start: 100, end: 200 }]);
  });

  test("identical segments — returns empty", () => {
    const result = subtractCoverage(
      [{ start: 300, end: 400 }],
      [{ start: 300, end: 400 }]
    );
    expect(result).toEqual([]);
  });
});

// ── takeEarliest ─────────────────────────────────────────────────────────────

describe("takeEarliest", () => {
  test("budget larger than total — returns all", () => {
    const segs = [{ start: 0, end: 30 }, { start: 50, end: 70 }];
    expect(takeEarliest(segs, 100)).toEqual([
      { start: 0, end: 30 },
      { start: 50, end: 70 },
    ]);
  });

  test("budget smaller than first segment — truncates it", () => {
    const result = takeEarliest([{ start: 0, end: 60 }], 25);
    expect(result).toEqual([{ start: 0, end: 25 }]);
  });

  test("budget straddles second segment", () => {
    const result = takeEarliest(
      [{ start: 0, end: 30 }, { start: 50, end: 80 }],
      45
    );
    expect(result).toEqual([
      { start: 0, end: 30 },
      { start: 50, end: 65 },
    ]);
  });

  test("budget zero — returns empty", () => {
    expect(takeEarliest([{ start: 0, end: 60 }], 0)).toEqual([]);
  });
});

// ── trimSegmentsWithBudget ───────────────────────────────────────────────────

describe("trimSegmentsWithBudget", () => {
  test("no new coverage (identical resend) — not capped, returns allMerged", () => {
    const existing = [{ start: 0, end: 60 }];
    const allMerged = [{ start: 0, end: 60 }];
    const { segments, capped } = trimSegmentsWithBudget(allMerged, existing, 15);
    expect(capped).toBe(false);
    expect(sumSegments(segments)).toBe(60);
  });

  test("new coverage within budget — not capped", () => {
    const existing = [{ start: 0, end: 60 }];
    const allMerged = [{ start: 0, end: 70 }]; // 10 new seconds
    const { segments, capped } = trimSegmentsWithBudget(allMerged, existing, 15);
    expect(capped).toBe(false);
    expect(segments).toEqual([{ start: 0, end: 70 }]);
  });

  test("new coverage exceeds budget — capped, preserves existing", () => {
    const existing = [{ start: 300, end: 400 }]; // 100s existing
    const allMerged = [{ start: 0, end: 120 }, { start: 300, end: 400 }]; // 120 new + 100 existing
    const { segments, capped } = trimSegmentsWithBudget(allMerged, existing, 65);
    expect(capped).toBe(true);
    // Existing [300,400] must be fully preserved
    const has300400 = segments.some((s) => s.start <= 300 && s.end >= 400);
    expect(has300400).toBe(true);
    // Only 65 new seconds from [0,120] → [0,65]
    expect(segments).toEqual([
      { start: 0, end: 65 },
      { start: 300, end: 400 },
    ]);
    expect(sumSegments(segments)).toBe(165); // 100 existing + 65 new
  });

  test("existing coverage never shrinks", () => {
    const existing = [{ start: 0, end: 100 }, { start: 200, end: 300 }];
    const allMerged = [{ start: 0, end: 100 }, { start: 150, end: 250 }, { start: 200, end: 300 }];
    // New coverage: [150,200] = 50s. Budget = 20.
    const { segments, capped } = trimSegmentsWithBudget(allMerged, existing, 20);
    expect(capped).toBe(true);
    // Existing 200s must be fully preserved
    expect(sumSegments(segments)).toBe(220); // 200 existing + 20 new
    // The 20 new seconds come from [150, 170]
    expect(segments).toEqual([
      { start: 0, end: 100 },
      { start: 150, end: 170 },
      { start: 200, end: 300 },
    ]);
  });

  test("trimmed payload followed by retry converges", () => {
    // Simulate: first call gets capped, second call re-sends same list
    const existing1 = []; // nothing exists yet
    const allMerged1 = [{ start: 0, end: 100 }]; // 100 new seconds
    const budget1 = 15; // first call allowance

    const result1 = trimSegmentsWithBudget(allMerged1, existing1, budget1);
    expect(result1.capped).toBe(true);
    expect(result1.segments).toEqual([{ start: 0, end: 15 }]);

    // Second call: existing now includes what was credited
    const existing2 = result1.segments;
    const allMerged2 = [{ start: 0, end: 100 }]; // same cumulative list
    const budget2 = 125; // more time has passed

    const result2 = trimSegmentsWithBudget(allMerged2, existing2, budget2);
    expect(result2.capped).toBe(false);
    expect(result2.segments).toEqual([{ start: 0, end: 100 }]); // fully credited
  });

  test("rewatch of earlier segment does not shrink coverage", () => {
    // Student watched [0,60] and [100,200]. Now re-watches [0,30].
    // With a small budget, existing must never lose coverage.
    const existing = [{ start: 0, end: 60 }, { start: 100, end: 200 }];
    const allMerged = [{ start: 0, end: 60 }, { start: 100, end: 200 }]; // no new coverage
    const { segments, capped } = trimSegmentsWithBudget(allMerged, existing, 5);
    expect(capped).toBe(false); // no new coverage → not capped
    expect(sumSegments(segments)).toBe(160); // unchanged
  });
});

// ── evaluateVideoProgress with cumulative sending ────────────────────────────

describe("evaluateVideoProgress — cumulative sending", () => {
  const VIDEO_DURATION = 300;
  const THRESHOLD = 90;
  const mkExisting = (segs, lastCheckMs) => ({
    videoProgress: {
      watchedSegments: segs,
      lastServerCheckAt: ts(lastCheckMs),
    },
  });

  test("re-sending identical segments adds 0 and is not capped", () => {
    const nowMs = Date.now();
    const checkTime = nowMs - 60000; // 60s ago
    const segs = [{ start: 0, end: 50 }];

    const result = evaluateVideoProgress({
      existing: mkExisting(segs, checkTime),
      incomingSegments: segs, // identical
      serverDuration: VIDEO_DURATION,
      nowMs,
      threshold: THRESHOLD,
      action: "update_position",
    });

    expect(result.capped).toBe(false);
    expect(sumSegments(result.watchedSegments)).toBe(50);
  });

  test("capped call preserves existing coverage", () => {
    const nowMs = Date.now();
    const checkTime = nowMs - 5000; // 5s ago → maxAdded = 5*2+5 = 15

    const result = evaluateVideoProgress({
      existing: mkExisting([{ start: 200, end: 260 }], checkTime),
      incomingSegments: [{ start: 0, end: 100 }, { start: 200, end: 260 }],
      serverDuration: VIDEO_DURATION,
      nowMs,
      threshold: THRESHOLD,
      action: "update_position",
    });

    expect(result.capped).toBe(true);
    // Existing [200,260] must be fully preserved
    const existingPreserved = result.watchedSegments.some(
      (s) => s.start <= 200 && s.end >= 260
    );
    expect(existingPreserved).toBe(true);
    // New coverage: only 15s of [0,100] → [0,15]
    expect(result.watchedSegments).toEqual([
      { start: 0, end: 15 },
      { start: 200, end: 260 },
    ]);
  });
});
```

---

## Tests — Firestore Rules Tests
`/Users/rojinroy/Projects/aptitude4us_admin/tests/rules/progress.rules.test.js`

```
/**
 * Firestore Security Rules Tests — Progress Tracking.
 *
 * Tests the claim-based rules for contentItems, resume, courseProgress,
 * streaks, and user-doc field restrictions.
 *
 * Setup:
 *   cd /path/to/project
 *   firebase emulators:exec --only firestore "npx jest tests/rules"
 *
 * NOTE: These tests require the Firestore emulator to be running.
 * Use firebase emulators:exec which handles startup/shutdown automatically.
 *
 * IMPORTANT: Do NOT seed a users/a1 doc for the admin. This forces the
 * admin-only rules to rely on claims (request.auth.token.role), not the
 * get()-based isAdmin() wildcard. If the wildcard is removed, these tests
 * still pass. If a rule accidentally depends on the wildcard, the test fails.
 */

const fs = require("fs");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-progress-test",
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
    },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
});

afterAll(async () => {
  await env.cleanup();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Student context (no custom claims). */
const student = (uid = "s1") => env.authenticatedContext(uid).firestore();

/** Admin context (claim only — NO users doc seeded). */
const adminDb = () =>
  env.authenticatedContext("a1", { role: "admin" }).firestore();

/** Unauthenticated context. */
const unauth = () => env.unauthenticatedContext().firestore();

/** Seed data bypassing security rules. */
const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));

const { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc } =
  require("firebase/firestore");
const { collectionGroup, query, where } = require("firebase/firestore");

// ── Users ────────────────────────────────────────────────────────────────────

describe("users collection", () => {
  test("student cannot self-create a user doc", async () => {
    await assertFails(
      setDoc(doc(student(), "users/s1"), {
        displayName: "Student",
        role: "student",
      })
    );
  });

  test("student cannot create doc with role: admin", async () => {
    await assertFails(
      setDoc(doc(student(), "users/s1"), { role: "admin" })
    );
  });

  test("student can update displayName", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), {
        displayName: "Old",
        role: "student",
        email: "s@test.com",
      })
    );
    await assertSucceeds(
      updateDoc(doc(student(), "users/s1"), { displayName: "New" })
    );
  });

  test("student can update timezone with valid string", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), { displayName: "A", role: "student" })
    );
    await assertSucceeds(
      updateDoc(doc(student(), "users/s1"), { timezone: "America/New_York" })
    );
  });

  test("student cannot update examReadiness", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), { displayName: "A", role: "student" })
    );
    await assertFails(
      updateDoc(doc(student(), "users/s1"), { examReadiness: 100 })
    );
  });

  test("student cannot update currentStreak", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), { displayName: "A", role: "student" })
    );
    await assertFails(
      updateDoc(doc(student(), "users/s1"), { currentStreak: 999 })
    );
  });

  test("student cannot update role", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), { displayName: "A", role: "student" })
    );
    await assertFails(
      updateDoc(doc(student(), "users/s1"), { role: "admin" })
    );
  });

  test("student cannot update assignedCourseIds", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), { displayName: "A", role: "student" })
    );
    await assertFails(
      updateDoc(doc(student(), "users/s1"), { assignedCourseIds: ["c1"] })
    );
  });

  test("student cannot update totalCoursesCompleted", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), { displayName: "A", role: "student" })
    );
    await assertFails(
      updateDoc(doc(student(), "users/s1"), { totalCoursesCompleted: 99 })
    );
  });

  test("student cannot read another student's doc", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s2"), { displayName: "B", role: "student" })
    );
    await assertFails(getDoc(doc(student("s1"), "users/s2")));
  });

  test("admin (claim-only) can read any user doc", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), { displayName: "A", role: "student" })
    );
    await assertSucceeds(getDoc(doc(adminDb(), "users/s1")));
  });
});

// ── contentItems (server-only) ───────────────────────────────────────────────

describe("contentItems (server-only writes)", () => {
  test("student cannot write contentItem", async () => {
    await assertFails(
      setDoc(doc(student(), "progress/s1/contentItems/c1"), {
        userId: "s1",
        courseId: "x",
        moduleId: "m",
        status: "completed",
      })
    );
  });

  test("student can read own contentItem", async () => {
    await seed((db) =>
      setDoc(doc(db, "progress/s1/contentItems/c1"), {
        userId: "s1",
        courseId: "x",
        status: "in_progress",
      })
    );
    await assertSucceeds(
      getDoc(doc(student(), "progress/s1/contentItems/c1"))
    );
  });

  test("student cannot read another student's contentItem", async () => {
    await seed((db) =>
      setDoc(doc(db, "progress/s2/contentItems/c1"), {
        userId: "s2",
        courseId: "x",
      })
    );
    await assertFails(
      getDoc(doc(student("s1"), "progress/s2/contentItems/c1"))
    );
  });

  test("admin can write contentItem", async () => {
    await assertSucceeds(
      setDoc(doc(adminDb(), "progress/s1/contentItems/c1"), {
        userId: "s1",
        courseId: "x",
        status: "completed",
      })
    );
  });
});

// ── resume (client-writable, narrow allow-list) ──────────────────────────────

describe("resume subcollection", () => {
  const validResume = {
    userId: "s1",
    courseId: "course1",
    moduleId: "mod1",
    contentId: "c1",
    contentType: "video",
    currentPosition: 120,
    updatedAt: new Date(),
  };

  test("student can write valid resume doc", async () => {
    await assertSucceeds(
      setDoc(doc(student(), "progress/s1/resume/c1"), validResume)
    );
  });

  test("resume rejects extra fields (e.g. status)", async () => {
    await assertFails(
      setDoc(doc(student(), "progress/s1/resume/c1"), {
        ...validResume,
        status: "completed",
      })
    );
  });

  test("resume rejects negative currentPosition", async () => {
    await assertFails(
      setDoc(doc(student(), "progress/s1/resume/c1"), {
        ...validResume,
        currentPosition: -5,
      })
    );
  });

  test("resume rejects mismatched contentId", async () => {
    await assertFails(
      setDoc(doc(student(), "progress/s1/resume/c1"), {
        ...validResume,
        contentId: "wrong_id",
      })
    );
  });

  test("student cannot write another student's resume", async () => {
    await assertFails(
      setDoc(doc(student("s2"), "progress/s1/resume/c1"), {
        ...validResume,
        userId: "s1",
      })
    );
  });

  test("student cannot write resume with spoofed userId", async () => {
    await assertFails(
      setDoc(doc(student(), "progress/s1/resume/c1"), {
        ...validResume,
        userId: "someone_else",
      })
    );
  });
});

// ── courseProgress (server-only writes) ───────────────────────────────────────

describe("courseProgress", () => {
  beforeEach(async () => {
    await seed((db) =>
      setDoc(doc(db, "progress/s1/courseProgress/course1"), {
        courseId: "course1",
        weight: 1,
        completionPercentage: 50,
        status: "in_progress",
      })
    );
  });

  test("student can read own courseProgress", async () => {
    await assertSucceeds(
      getDoc(doc(student(), "progress/s1/courseProgress/course1"))
    );
  });

  test("student cannot write courseProgress", async () => {
    await assertFails(
      updateDoc(doc(student(), "progress/s1/courseProgress/course1"), {
        completionPercentage: 100,
      })
    );
  });

  test("student cannot write weight", async () => {
    await assertFails(
      updateDoc(doc(student(), "progress/s1/courseProgress/course1"), {
        weight: 999,
      })
    );
  });

  test("student cannot read another student's courseProgress", async () => {
    await assertFails(
      getDoc(doc(student("s2"), "progress/s1/courseProgress/course1"))
    );
  });

  test("admin (claim-only) can read courseProgress", async () => {
    await assertSucceeds(
      getDoc(doc(adminDb(), "progress/s1/courseProgress/course1"))
    );
  });

  test("admin can write weight", async () => {
    await assertSucceeds(
      updateDoc(doc(adminDb(), "progress/s1/courseProgress/course1"), {
        weight: 2,
      })
    );
  });

  test("admin can run collection-group query on courseProgress", async () => {
    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(adminDb(), "courseProgress"),
          where("courseId", "==", "course1")
        )
      )
    );
  });

  test("student cannot run collection-group query on courseProgress", async () => {
    await assertFails(
      getDocs(
        query(
          collectionGroup(student(), "courseProgress"),
          where("courseId", "==", "course1")
        )
      )
    );
  });
});

// ── Streaks ──────────────────────────────────────────────────────────────────

describe("streaks", () => {
  beforeEach(async () => {
    await seed((db) =>
      setDoc(doc(db, "streaks/s1"), { currentStreak: 5, userId: "s1" })
    );
  });

  test("student can read own streak", async () => {
    await assertSucceeds(getDoc(doc(student(), "streaks/s1")));
  });

  test("student cannot write streak", async () => {
    await assertFails(
      updateDoc(doc(student(), "streaks/s1"), { currentStreak: 999 })
    );
  });

  test("student cannot read another student's streak", async () => {
    await assertFails(getDoc(doc(student("s2"), "streaks/s1")));
  });

  test("admin can read streak", async () => {
    await assertSucceeds(getDoc(doc(adminDb(), "streaks/s1")));
  });
});

// ── appConfig/progressSettings ───────────────────────────────────────────────

describe("appConfig/progressSettings", () => {
  test("authenticated user can read", async () => {
    await seed((db) =>
      setDoc(doc(db, "appConfig/progressSettings"), {
        videoCompletionThreshold: 90,
      })
    );
    await assertSucceeds(
      getDoc(doc(student(), "appConfig/progressSettings"))
    );
  });

  test("student cannot write", async () => {
    await assertFails(
      setDoc(doc(student(), "appConfig/progressSettings"), {
        videoCompletionThreshold: 1,
      })
    );
  });

  test("admin can write", async () => {
    await assertSucceeds(
      setDoc(doc(adminDb(), "appConfig/progressSettings"), {
        videoCompletionThreshold: 85,
      })
    );
  });
});

```

---

## Flutter — Progress Models
`/Users/rojinroy/Projects/aptitude4us_app/lib/models/progress_models.dart`

```
```

---

## Flutter — Progress Service
`/Users/rojinroy/Projects/aptitude4us_app/lib/services/progress_service.dart`

```
```

---

## Flutter — Progress Trackers
`/Users/rojinroy/Projects/aptitude4us_app/lib/services/progress_tracker.dart`

```
```

---

## Flutter — Progress Provider
`/Users/rojinroy/Projects/aptitude4us_app/lib/providers/progress_provider.dart`

```
```

---

## Flutter — Timezone Service
`/Users/rojinroy/Projects/aptitude4us_app/lib/services/timezone_service.dart`

```
```

---

## Flutter — Progress Tracker Tests
`/Users/rojinroy/Projects/aptitude4us_app/test/progress_tracker_test.dart`

```
```

---

## Flutter — Progress Models
`/Users/rojinroy/Projects/aptitude4us_app/lib/models/progress_models.dart`

```
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

// ---------------------------------------------------------------------------
// Progress data models — mirrors the Firestore schema defined in the admin
// project's Cloud Functions (functions/src/progress.js).
// ---------------------------------------------------------------------------

/// Video watched segment: a contiguous range of seconds the student has watched.
class WatchedSegment {
  final double start;
  final double end;

  const WatchedSegment({required this.start, required this.end});

  factory WatchedSegment.fromJson(Map<String, dynamic> json) {
    return WatchedSegment(
      start: (json['start'] as num).toDouble(),
      end: (json['end'] as num).toDouble(),
    );
  }

  Map<String, dynamic> toJson() => {'start': start, 'end': end};

  /// Duration in seconds.
  double get duration => end - start;
}

/// Per-module completion summary (denormalized inside CourseProgress).
class ModuleProgressSummary {
  final String status; // 'not_started' | 'in_progress' | 'completed'
  final double completionPercentage;
  final int videosWatched;
  final int videosTotal;
  final int pdfsRead;
  final int pdfsTotal;
  final int notesRead;
  final int notesTotal;
  final int audiosListened;
  final int audiosTotal;
  final int imagesViewed;
  final int imagesTotal;
  final int linksViewed;
  final int linksTotal;
  final DateTime? lastAccessedAt;
  final DateTime? completedAt;

  const ModuleProgressSummary({
    required this.status,
    required this.completionPercentage,
    this.videosWatched = 0,
    this.videosTotal = 0,
    this.pdfsRead = 0,
    this.pdfsTotal = 0,
    this.notesRead = 0,
    this.notesTotal = 0,
    this.audiosListened = 0,
    this.audiosTotal = 0,
    this.imagesViewed = 0,
    this.imagesTotal = 0,
    this.linksViewed = 0,
    this.linksTotal = 0,
    this.lastAccessedAt,
    this.completedAt,
  });

  factory ModuleProgressSummary.fromJson(Map<String, dynamic> json) {
    return ModuleProgressSummary(
      status: json['status'] ?? 'not_started',
      completionPercentage: (json['completionPercentage'] as num?)?.toDouble() ?? 0,
      videosWatched: json['videosWatched'] ?? 0,
      videosTotal: json['videosTotal'] ?? 0,
      pdfsRead: json['pdfsRead'] ?? 0,
      pdfsTotal: json['pdfsTotal'] ?? 0,
      notesRead: json['notesRead'] ?? 0,
      notesTotal: json['notesTotal'] ?? 0,
      audiosListened: json['audiosListened'] ?? 0,
      audiosTotal: json['audiosTotal'] ?? 0,
      imagesViewed: json['imagesViewed'] ?? 0,
      imagesTotal: json['imagesTotal'] ?? 0,
      linksViewed: json['linksViewed'] ?? 0,
      linksTotal: json['linksTotal'] ?? 0,
      lastAccessedAt: _parseTimestamp(json['lastAccessedAt']),
      completedAt: _parseTimestamp(json['completedAt']),
    );
  }

  /// Total items completed across all content types.
  int get totalCompleted =>
      videosWatched + pdfsRead + notesRead + audiosListened + imagesViewed + linksViewed;

  /// Total items across all content types.
  int get totalItems =>
      videosTotal + pdfsTotal + notesTotal + audiosTotal + imagesTotal + linksTotal;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ModuleProgressSummary &&
          status == other.status &&
          completionPercentage == other.completionPercentage &&
          videosWatched == other.videosWatched &&
          videosTotal == other.videosTotal &&
          pdfsRead == other.pdfsRead &&
          pdfsTotal == other.pdfsTotal &&
          notesRead == other.notesRead &&
          notesTotal == other.notesTotal &&
          audiosListened == other.audiosListened &&
          audiosTotal == other.audiosTotal &&
          imagesViewed == other.imagesViewed &&
          imagesTotal == other.imagesTotal &&
          linksViewed == other.linksViewed &&
          linksTotal == other.linksTotal;

  @override
  int get hashCode => Object.hash(
        status, completionPercentage,
        videosWatched, videosTotal,
        pdfsRead, pdfsTotal,
        notesRead, notesTotal,
        audiosListened, audiosTotal,
        imagesViewed, imagesTotal,
        linksViewed, linksTotal,
      );
}

/// Per-course progress document: `progress/{userId}/courseProgress/{courseId}`.
class CourseProgress {
  final String userId;
  final String courseId;
  final String status; // 'not_started' | 'in_progress' | 'completed' | 'reviewing'
  final double completionPercentage;
  final double weight;
  final Map<String, ModuleProgressSummary> moduleProgress;
  final String? lastAccessedModuleId;
  final String? lastAccessedContentId;
  final String? lastAccessedContentType;
  final DateTime? startedAt;
  final DateTime? lastActivityAt;
  final DateTime? updatedAt;
  final DateTime? completedAt;

  const CourseProgress({
    required this.userId,
    required this.courseId,
    required this.status,
    required this.completionPercentage,
    this.weight = 1,
    this.moduleProgress = const {},
    this.lastAccessedModuleId,
    this.lastAccessedContentId,
    this.lastAccessedContentType,
    this.startedAt,
    this.lastActivityAt,
    this.updatedAt,
    this.completedAt,
  });

  factory CourseProgress.fromJson(Map<String, dynamic> json, String docId) {
    // Parse moduleProgress map
    final Map<String, ModuleProgressSummary> modules = {};
    if (json['moduleProgress'] is Map) {
      final rawModules = json['moduleProgress'] as Map<String, dynamic>;
      for (final entry in rawModules.entries) {
        if (entry.value is Map) {
          modules[entry.key] = ModuleProgressSummary.fromJson(
            Map<String, dynamic>.from(entry.value as Map),
          );
        }
      }
    }

    return CourseProgress(
      userId: json['userId'] ?? '',
      courseId: json['courseId'] ?? docId,
      status: json['status'] ?? 'not_started',
      completionPercentage: (json['completionPercentage'] as num?)?.toDouble() ?? 0,
      weight: (json['weight'] as num?)?.toDouble() ?? 1,
      moduleProgress: modules,
      lastAccessedModuleId: json['lastAccessedModuleId'],
      lastAccessedContentId: json['lastAccessedContentId'],
      lastAccessedContentType: json['lastAccessedContentType'],
      startedAt: _parseTimestamp(json['startedAt']),
      lastActivityAt: _parseTimestamp(json['lastActivityAt']),
      updatedAt: _parseTimestamp(json['updatedAt']),
      completedAt: _parseTimestamp(json['completedAt']),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CourseProgress &&
          userId == other.userId &&
          courseId == other.courseId &&
          status == other.status &&
          completionPercentage == other.completionPercentage &&
          weight == other.weight &&
          lastAccessedModuleId == other.lastAccessedModuleId &&
          lastAccessedContentId == other.lastAccessedContentId &&
          mapEquals(moduleProgress, other.moduleProgress);

  @override
  int get hashCode => Object.hash(
        userId, courseId, status, completionPercentage,
        weight, lastAccessedModuleId, lastAccessedContentId,
        // Use entries for stable map hashing
        Object.hashAll(moduleProgress.entries.map((e) => Object.hash(e.key, e.value))),
      );
}

/// Per-content-item progress: `progress/{userId}/contentItems/{contentId}`.
class ContentItemProgress {
  final String userId;
  final String courseId;
  final String moduleId;
  final String contentId;
  final String contentType;
  final String status; // 'not_started' | 'in_progress' | 'completed'
  final DateTime? completedAt;
  final double percentage;
  final int viewCount;
  final double totalTimeSpent;
  final DateTime? firstAccessedAt;
  final DateTime? lastAccessedAt;

  // Video-specific
  final double? currentPosition;
  final double? totalDuration;
  final double? percentageWatched;
  final List<WatchedSegment>? watchedSegments;

  // PDF-specific
  final int? currentPage;
  final int? totalPages;
  final double? percentageRead;

  const ContentItemProgress({
    required this.userId,
    required this.courseId,
    required this.moduleId,
    required this.contentId,
    required this.contentType,
    required this.status,
    this.completedAt,
    this.percentage = 0,
    this.viewCount = 0,
    this.totalTimeSpent = 0,
    this.firstAccessedAt,
    this.lastAccessedAt,
    this.currentPosition,
    this.totalDuration,
    this.percentageWatched,
    this.watchedSegments,
    this.currentPage,
    this.totalPages,
    this.percentageRead,
  });

  factory ContentItemProgress.fromJson(Map<String, dynamic> json, String docId) {
    List<WatchedSegment>? segments;
    if (json['watchedSegments'] is List) {
      segments = (json['watchedSegments'] as List)
          .whereType<Map>()
          .map((s) => WatchedSegment.fromJson(Map<String, dynamic>.from(s)))
          .toList();
    }

    return ContentItemProgress(
      userId: json['userId'] ?? '',
      courseId: json['courseId'] ?? '',
      moduleId: json['moduleId'] ?? '',
      contentId: json['contentId'] ?? docId,
      contentType: json['contentType'] ?? '',
      status: json['status'] ?? 'not_started',
      completedAt: _parseTimestamp(json['completedAt']),
      percentage: (json['percentage'] as num?)?.toDouble() ?? 0,
      viewCount: json['viewCount'] ?? 0,
      totalTimeSpent: (json['totalTimeSpent'] as num?)?.toDouble() ?? 0,
      firstAccessedAt: _parseTimestamp(json['firstAccessedAt']),
      lastAccessedAt: _parseTimestamp(json['lastAccessedAt']),
      currentPosition: (json['currentPosition'] as num?)?.toDouble(),
      totalDuration: (json['totalDuration'] as num?)?.toDouble(),
      percentageWatched: (json['percentageWatched'] as num?)?.toDouble(),
      watchedSegments: segments,
      currentPage: json['currentPage'] as int?,
      totalPages: json['totalPages'] as int?,
      percentageRead: (json['percentageRead'] as num?)?.toDouble(),
    );
  }
}

/// Streak history entry.
class StreakDayEntry {
  final String date; // "YYYY-MM-DD"
  final int count;

  const StreakDayEntry({required this.date, required this.count});

  factory StreakDayEntry.fromJson(Map<String, dynamic> json) {
    return StreakDayEntry(
      date: json['date'] ?? '',
      count: json['count'] ?? 0,
    );
  }
}

/// Student streak: `streaks/{userId}`.
class StudentStreak {
  final String userId;
  final int currentStreak;
  final int longestStreak;
  final String? lastActivityDate; // "YYYY-MM-DD"
  final List<StreakDayEntry> streakHistory;
  final DateTime? updatedAt;

  const StudentStreak({
    required this.userId,
    this.currentStreak = 0,
    this.longestStreak = 0,
    this.lastActivityDate,
    this.streakHistory = const [],
    this.updatedAt,
  });

  factory StudentStreak.fromJson(Map<String, dynamic> json, String docId) {
    List<StreakDayEntry> history = [];
    if (json['streakHistory'] is List) {
      history = (json['streakHistory'] as List)
          .whereType<Map>()
          .map((e) => StreakDayEntry.fromJson(Map<String, dynamic>.from(e)))
          .toList();
    }

    return StudentStreak(
      userId: json['userId'] ?? docId,
      currentStreak: json['currentStreak'] ?? 0,
      longestStreak: json['longestStreak'] ?? 0,
      lastActivityDate: json['lastActivityDate'],
      streakHistory: history,
      updatedAt: _parseTimestamp(json['updatedAt']),
    );
  }
}

/// Resume position: `progress/{userId}/resume/{contentId}`.
/// Client-writable — used purely for "resume where you left off" UX.
class ResumePosition {
  final String contentId;
  final String courseId;
  final String moduleId;
  final String contentType;
  final double? currentPosition; // seconds (video/audio)
  final int? currentPage;        // page number (PDF)
  final DateTime? updatedAt;

  const ResumePosition({
    required this.contentId,
    required this.courseId,
    required this.moduleId,
    required this.contentType,
    this.currentPosition,
    this.currentPage,
    this.updatedAt,
  });

  factory ResumePosition.fromJson(Map<String, dynamic> json, String docId) {
    return ResumePosition(
      contentId: json['contentId'] ?? docId,
      courseId: json['courseId'] ?? '',
      moduleId: json['moduleId'] ?? '',
      contentType: json['contentType'] ?? '',
      currentPosition: (json['currentPosition'] as num?)?.toDouble(),
      currentPage: json['currentPage'] as int?,
      updatedAt: _parseTimestamp(json['updatedAt']),
    );
  }

  Map<String, dynamic> toJson() {
    final data = <String, dynamic>{
      'contentId': contentId,
      'courseId': courseId,
      'moduleId': moduleId,
      'contentType': contentType,
      'updatedAt': FieldValue.serverTimestamp(),
    };
    if (currentPosition != null) data['currentPosition'] = currentPosition;
    if (currentPage != null) data['currentPage'] = currentPage;
    return data;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

DateTime? _parseTimestamp(dynamic value) {
  if (value == null) return null;
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  if (value is int) return DateTime.fromMillisecondsSinceEpoch(value);
  return null;
}

```

---

## Flutter — Progress Service
`/Users/rojinroy/Projects/aptitude4us_app/lib/services/progress_service.dart`

```
import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../models/progress_models.dart';
import '../utils/logger.dart';

/// Service for reading progress data from Firestore and calling the
/// `recordProgress` Cloud Function.
///
/// All *writes* to progress collections go through the Cloud Function
/// (except `resume`, which is client-writable).
class ProgressService {
  static final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  static final FirebaseFunctions _functions = FirebaseFunctions.instanceFor(
    region: 'us-central1',
  );

  // ---------------------------------------------------------------------------
  // Cloud Function — recordProgress callable
  // ---------------------------------------------------------------------------

  /// FIFO serialization: chains calls so only one is in-flight at a time.
  /// Two overlapping calls from one client split the same wall-clock allowance,
  /// so we serialize them. Unlike a Completer, this never raises uncaught
  /// async errors when a call fails.
  static Future<void> _tail = Future.value();

  static Future<T> _serialize<T>(Future<T> Function() task) {
    final run = _tail.then((_) => task());
    _tail = run.then<void>((_) {}, onError: (_) {});
    return run;
  }

  /// Core entry point: calls the `recordProgress` Cloud Function.
  ///
  /// Valid actions: 'start', 'update_position', 'complete'.
  /// For videos, 'complete' is a hint — completion is derived server-side
  /// from segments vs duration. For PDFs/notes/etc, 'complete' grants completion.
  ///
  /// [progressData]: payload passed as the `data` field to the callable.
  ///   - Video: `{ watchedSegments: [{start, end}, ...], currentPosition: double }`
  ///   - PDF: `{ currentPage: int, totalPages: int }`
  ///
  /// Returns the function response data map.
  /// Throws [FirebaseFunctionsException] on server errors.
  ///
  /// Serialized: only one call in flight at a time. Retries on transient
  /// errors; never retries `invalid-argument`, `permission-denied`, `not-found`.
  static Future<Map<String, dynamic>> recordProgress({
    required String courseId,
    required String moduleId,
    required String contentId,
    required String contentType,
    required String action,
    Map<String, dynamic>? progressData,
  }) =>
      _serialize(() => _doRecordProgress(
            courseId: courseId,
            moduleId: moduleId,
            contentId: contentId,
            contentType: contentType,
            action: action,
            progressData: progressData,
          ));

  static Future<Map<String, dynamic>> _doRecordProgress({
    required String courseId,
    required String moduleId,
    required String contentId,
    required String contentType,
    required String action,
    Map<String, dynamic>? progressData,
    int attempt = 0,
  }) async {
    try {
      Logger.d(
        'ProgressService: recordProgress($action) for $contentType $contentId',
      );

      final callable = _functions.httpsCallable(
        'recordProgress',
        options: HttpsCallableOptions(timeout: const Duration(seconds: 30)),
      );

      final payload = <String, dynamic>{
        'courseId': courseId,
        'moduleId': moduleId,
        'contentId': contentId,
        'contentType': contentType,
        'action': action,
      };
      if (progressData != null) {
        payload['data'] = progressData;
      }

      final result = await callable.call<Map<String, dynamic>>(payload);
      final responseData = Map<String, dynamic>.from(result.data);

      Logger.d('ProgressService: recordProgress result: $responseData');
      return responseData;
    } on FirebaseFunctionsException catch (e) {
      Logger.e('ProgressService: recordProgress error: ${e.code} ${e.message}');

      // Never retry these — they indicate permanent failure
      if (e.code == 'invalid-argument' ||
          e.code == 'permission-denied' ||
          e.code == 'not-found' ||
          e.code == 'unauthenticated') {
        rethrow;
      }

      // Retry transient errors with backoff (max 2 retries)
      if (attempt < 2 &&
          (e.code == 'unavailable' ||
           e.code == 'deadline-exceeded' ||
           e.code == 'internal')) {
        final delay = Duration(milliseconds: 1000 * (attempt + 1));
        Logger.i('ProgressService: retrying in ${delay.inMilliseconds}ms (attempt ${attempt + 1})');
        await Future.delayed(delay);
        return _doRecordProgress(
          courseId: courseId,
          moduleId: moduleId,
          contentId: contentId,
          contentType: contentType,
          action: action,
          progressData: progressData,
          attempt: attempt + 1,
        );
      }

      rethrow;
    } catch (e) {
      Logger.e('ProgressService: recordProgress unexpected error: $e');
      rethrow;
    }
  }

  // ---------------------------------------------------------------------------
  // Resume subcollection — client-writable
  // ---------------------------------------------------------------------------

  /// Writes a resume position to `progress/{uid}/resume/{contentId}`.
  /// This is the only progress path the client writes directly to Firestore.
  ///
  /// Fields must exactly match the Firestore rules allow-list:
  /// userId, courseId, moduleId, contentId, contentType,
  /// currentPosition, currentPage, updatedAt.
  static Future<void> saveResumePosition({
    required String contentId,
    required String courseId,
    required String moduleId,
    required String contentType,
    double? currentPosition,
    int? currentPage,
  }) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;

    final data = <String, dynamic>{
      'userId': uid,
      'contentId': contentId,
      'courseId': courseId,
      'moduleId': moduleId,
      'contentType': contentType,
      'updatedAt': FieldValue.serverTimestamp(),
    };
    // Only include position fields if they're valid (non-negative numbers)
    if (currentPosition != null && currentPosition >= 0) {
      data['currentPosition'] = currentPosition;
    }
    if (currentPage != null && currentPage >= 0) {
      data['currentPage'] = currentPage;
    }

    try {
      await _firestore
          .collection('progress')
          .doc(uid)
          .collection('resume')
          .doc(contentId)
          .set(data);
    } catch (e) {
      // Resume writes are best-effort — never block the user.
      Logger.w('ProgressService: saveResumePosition failed: $e');
    }
  }

  /// Reads the resume position for a content item.
  static Future<ResumePosition?> getResumePosition(String contentId) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return null;

    try {
      final doc = await _firestore
          .collection('progress')
          .doc(uid)
          .collection('resume')
          .doc(contentId)
          .get();

      if (!doc.exists || doc.data() == null) return null;
      return ResumePosition.fromJson(doc.data()!, doc.id);
    } catch (e) {
      Logger.w('ProgressService: getResumePosition failed: $e');
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Course Progress reads (prefer streams for real-time UI)
  // ---------------------------------------------------------------------------

  /// Gets progress for a single course (one-shot).
  static Future<CourseProgress?> getCourseProgress(String courseId) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return null;

    try {
      final doc = await _firestore
          .collection('progress')
          .doc(uid)
          .collection('courseProgress')
          .doc(courseId)
          .get();

      if (!doc.exists || doc.data() == null) return null;
      return CourseProgress.fromJson(doc.data()!, doc.id);
    } catch (e) {
      Logger.w('ProgressService: getCourseProgress failed: $e');
      return null;
    }
  }

  /// Gets progress for all courses (one-shot).
  static Future<Map<String, CourseProgress>> getAllCourseProgress() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return {};

    try {
      final snapshot = await _firestore
          .collection('progress')
          .doc(uid)
          .collection('courseProgress')
          .get();

      final map = <String, CourseProgress>{};
      for (final doc in snapshot.docs) {
        if (doc.data().isNotEmpty) {
          map[doc.id] = CourseProgress.fromJson(doc.data(), doc.id);
        }
      }
      return map;
    } catch (e) {
      Logger.w('ProgressService: getAllCourseProgress failed: $e');
      return {};
    }
  }

  /// Streams progress for a single course (real-time updates).
  /// Prefer this over getCourseProgress for UI — the server recalculates
  /// asynchronously via triggers, so percentages may lag by a few seconds.
  static Stream<CourseProgress?> streamCourseProgress(String courseId) {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return Stream.value(null);

    return _firestore
        .collection('progress')
        .doc(uid)
        .collection('courseProgress')
        .doc(courseId)
        .snapshots()
        .map((doc) {
      if (!doc.exists || doc.data() == null) return null;
      return CourseProgress.fromJson(doc.data()!, doc.id);
    });
  }

  /// Streams all course progress docs (real-time).
  static Stream<Map<String, CourseProgress>> streamAllCourseProgress() {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return Stream.value({});

    return _firestore
        .collection('progress')
        .doc(uid)
        .collection('courseProgress')
        .snapshots()
        .map((snapshot) {
      final map = <String, CourseProgress>{};
      for (final doc in snapshot.docs) {
        if (doc.data().isNotEmpty) {
          map[doc.id] = CourseProgress.fromJson(doc.data(), doc.id);
        }
      }
      return map;
    });
  }

  // ---------------------------------------------------------------------------
  // Content Item Progress reads
  // ---------------------------------------------------------------------------

  /// Gets progress for a single content item.
  static Future<ContentItemProgress?> getContentItemProgress(
    String contentId,
  ) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return null;

    try {
      final doc = await _firestore
          .collection('progress')
          .doc(uid)
          .collection('contentItems')
          .doc(contentId)
          .get();

      if (!doc.exists || doc.data() == null) return null;
      return ContentItemProgress.fromJson(doc.data()!, doc.id);
    } catch (e) {
      Logger.w('ProgressService: getContentItemProgress failed: $e');
      return null;
    }
  }

  /// Gets progress for all content items in a module.
  static Future<List<ContentItemProgress>> getModuleContentProgress(
    String moduleId,
  ) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return [];

    try {
      final snapshot = await _firestore
          .collection('progress')
          .doc(uid)
          .collection('contentItems')
          .where('moduleId', isEqualTo: moduleId)
          .get();

      return snapshot.docs
          .where((doc) => doc.data().isNotEmpty)
          .map((doc) => ContentItemProgress.fromJson(doc.data(), doc.id))
          .toList();
    } catch (e) {
      Logger.w('ProgressService: getModuleContentProgress failed: $e');
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Streak reads
  // ---------------------------------------------------------------------------

  /// Streams the student's streak data (real-time).
  static Stream<StudentStreak?> streamStreak() {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return Stream.value(null);

    return _firestore
        .collection('streaks')
        .doc(uid)
        .snapshots()
        .map((doc) {
      if (!doc.exists || doc.data() == null) return null;
      return StudentStreak.fromJson(doc.data()!, doc.id);
    });
  }

  /// Gets the student's streak data (one-shot).
  static Future<StudentStreak?> getStreak() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return null;

    try {
      final doc = await _firestore.collection('streaks').doc(uid).get();
      if (!doc.exists || doc.data() == null) return null;
      return StudentStreak.fromJson(doc.data()!, doc.id);
    } catch (e) {
      Logger.w('ProgressService: getStreak failed: $e');
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // User-level progress fields
  // ---------------------------------------------------------------------------

  /// Streams progress-related fields from the user document.
  /// Includes `lastActivityDate` so the UI can derive whether the streak
  /// is stale (student hasn't been active today or yesterday).
  static Stream<Map<String, dynamic>> streamUserProgressFields() {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return Stream.value({});

    return _firestore
        .collection('users')
        .doc(uid)
        .snapshots()
        .map((doc) {
      if (!doc.exists || doc.data() == null) return <String, dynamic>{};
      final data = doc.data()!;
      return {
        'examReadiness': (data['examReadiness'] as num?)?.toDouble() ?? 0,
        'currentStreak': data['currentStreak'] ?? 0,
        'totalCoursesCompleted': data['totalCoursesCompleted'] ?? 0,
        'lastActivityDate': data['lastActivityDate'] as String?,
      };
    });
  }

  /// Returns the display streak: 0 if the student hasn't been active
  /// today or yesterday (the streak is effectively broken even though
  /// the server hasn't reset it yet).
  ///
  /// Uses day-difference in UTC to avoid DST off-by-one and timezone
  /// disagreement between server and device.
  static int displayStreak(int rawStreak, String? lastActivityDate, {DateTime? now}) {
    if (rawStreak <= 0) return 0;
    final last = lastActivityDate == null ? null : DateTime.tryParse(lastActivityDate);
    if (last == null) return 0;
    final n = now ?? DateTime.now();
    final today = DateTime.utc(n.year, n.month, n.day);
    final day = DateTime.utc(last.year, last.month, last.day);
    return today.difference(day).inDays.abs() <= 1 ? rawStreak : 0;
  }
}
```

---

## Flutter — Progress Trackers
`/Users/rojinroy/Projects/aptitude4us_app/lib/services/progress_tracker.dart`

```
import 'dart:async';
import 'dart:math';
import 'package:cloud_functions/cloud_functions.dart';
import '../services/progress_service.dart';
import '../utils/logger.dart';

// ---------------------------------------------------------------------------
// VideoSegmentTracker — pure Dart segment tracking from position events
// ---------------------------------------------------------------------------

/// Builds non-overlapping watched segments from video player position events.
///
/// Pure Dart — no player dependency. Testable.
///
/// Usage:
///   tracker.onPlaying(pos)   — when playback starts/resumes
///   tracker.onPosition(pos)  — on each position tick (~1/sec)
///   tracker.onPause()        — when playback pauses
///   tracker.onSeek(pos)      — when user seeks (close + reopen)
///   tracker.mergedSnapshot() — cumulative merged segments (for sending)
///   tracker.snapshot()       — raw segments including open one
class VideoSegmentTracker {
  final List<Map<String, double>> _closed = [];
  double? _start;
  double _last = 0;

  /// Current playback speed. Update via [setSpeed] so that the seek
  /// detection threshold scales with speed (avoids false seeks at 2x).
  double _speed = 1.0;

  /// Update the current playback speed. The seek detection threshold
  /// scales with this: `max(2.5, 2.5 * speed)`.
  void setSpeed(double speed) {
    _speed = speed;
  }

  /// Call when playback begins or resumes. Opens a segment if none is open.
  void onPlaying(double pos) {
    _start ??= pos;
    _last = pos;
  }

  /// Call on each position tick. Detects seeks by checking for jumps
  /// greater than a speed-scaled threshold.
  void onPosition(double pos) {
    if (_start == null) return;
    final threshold = max(2.5, 2.5 * _speed);
    if ((pos - _last).abs() > threshold) {
      // Seek or stall — close current, reopen at new position
      _close(_last);
      _start = pos;
    }
    _last = pos;
  }

  /// Call when playback pauses. Closes the current open segment.
  void onPause() => _close(_last);

  /// Call when user explicitly seeks. Closes open segment at old position,
  /// optionally opens new segment if still playing.
  void onSeek(double newPos, {bool isPlaying = false}) {
    _close(_last);
    if (isPlaying) {
      _start = newPos;
    }
    _last = newPos;
  }

  void _close(double end) {
    if (_start != null && end > _start!) {
      _closed.add({'start': _start!, 'end': end});
    }
    _start = null;
  }

  /// Raw snapshot: all segments (closed + currently open), unmerged.
  List<Map<String, double>> snapshot() => [
        ..._closed,
        if (_start != null && _last > _start!)
          {'start': _start!, 'end': _last},
      ];

  /// Cumulative merged snapshot — sorted, non-overlapping intervals
  /// including the currently open segment. This is what gets sent to
  /// the server. Idempotent: does not clear or mutate internal state.
  ///
  /// Merging keeps the segment list small (linear playback = 1 interval)
  /// and makes retries safe — the server dedupes by merging anyway.
  ///
  /// Returns copies of each map so callers can't mutate `_closed`.
  List<Map<String, double>> mergedSnapshot() {
    final raw = snapshot().map((s) => Map<String, double>.of(s)).toList();
    if (raw.isEmpty) return raw;

    // Sort by start
    raw.sort((a, b) => a['start']!.compareTo(b['start']!));

    final merged = <Map<String, double>>[raw.first];
    for (var i = 1; i < raw.length; i++) {
      final prev = merged.last;
      final cur = raw[i];
      if (cur['start']! <= prev['end']!) {
        // Overlapping or adjacent — extend
        prev['end'] = max(prev['end']!, cur['end']!);
      } else {
        merged.add(cur);
      }
    }
    return merged;
  }

  /// Total seconds of unique coverage in the merged snapshot.
  double get totalCoverage {
    final segs = mergedSnapshot();
    return segs.fold<double>(0, (s, e) => s + (e['end']! - e['start']!));
  }
}

// ---------------------------------------------------------------------------
// VideoProgressTracker — manages heartbeat timer and server communication
// ---------------------------------------------------------------------------

/// Manages video progress tracking lifecycle: segment collection, heartbeat
/// timer, resume writes, and Cloud Function calls.
///
/// Lifecycle:
///   1. Create when entering the video content viewer.
///   2. Call [start] once, await it before first heartbeat.
///   3. Forward player events to [onPlay], [onPause], [onSeek], [onPosition].
///   4. Call [onAppPaused] when app backgrounds (WidgetsBindingObserver).
///   5. Call [onRoutePopped] when navigating away.
///   6. Call [dispose] for cleanup only (cancel timers, no network calls).
///
/// Sends the cumulative merged segment list on every heartbeat. This makes
/// retries idempotent and ensures capped segments are re-sent on the next
/// call. The server merges and dedupes, so duplicates are harmless.
///
/// Does NOT send 'complete' for videos. Completion is derived server-side
/// from segments vs. duration. The 'complete' action is a no-op for videos
/// on the server.
///
/// For testing, inject [recordProgressFn] and [saveResumeFn] to avoid
/// real Cloud Function calls.
typedef RecordProgressFn = Future<Map<String, dynamic>> Function({
  required String courseId,
  required String moduleId,
  required String contentId,
  required String contentType,
  required String action,
  Map<String, dynamic>? progressData,
});

typedef SaveResumeFn = Future<void> Function({
  required String contentId,
  required String courseId,
  required String moduleId,
  required String contentType,
  double? currentPosition,
  int? currentPage,
});

class VideoProgressTracker {
  final String courseId;
  final String moduleId;
  final String contentId;
  final double? videoDuration; // from ContentModel.duration (seconds)

  /// How often to send heartbeats while playing.
  /// Must be ≤ 60s to stay within the server's wall-clock cap window.
  final Duration heartbeatInterval;

  /// How often to write resume position to Firestore (throttled).
  final Duration resumeWriteInterval;

  /// Injectable progress recording function. Defaults to [ProgressService.recordProgress].
  final RecordProgressFn _recordProgress;

  /// Injectable resume writing function. Defaults to [ProgressService.saveResumePosition].
  final SaveResumeFn _saveResume;

  VideoProgressTracker({
    required this.courseId,
    required this.moduleId,
    required this.contentId,
    this.videoDuration,
    this.heartbeatInterval = const Duration(seconds: 55),
    this.resumeWriteInterval = const Duration(seconds: 15),
    RecordProgressFn? recordProgressFn,
    SaveResumeFn? saveResumeFn,
  })  : _recordProgress = recordProgressFn ?? ProgressService.recordProgress,
        _saveResume = saveResumeFn ?? ProgressService.saveResumePosition;

  // --- Internal state ---
  final VideoSegmentTracker _segmentTracker = VideoSegmentTracker();
  double _currentPosition = 0;
  bool _isPlaying = false;
  bool _hasStarted = false;
  bool _startOk = false;
  bool _isDisposed = false;
  bool _inFlight = false;

  /// Permanently disables this tracker after an unrecoverable error
  /// (e.g. permission-denied, not-found). Prevents infinite retry loops
  /// against a server that will never accept the call.
  bool _disabled = false;

  /// Total seconds of unique coverage successfully acknowledged by the server.
  /// Used to skip heartbeats when nothing new has been watched.
  /// Starts at 0 so an empty pause doesn't send a no-segment call.
  double _sentSeconds = 0;

  Timer? _heartbeatTimer;
  DateTime? _lastResumeWriteTime;

  /// Initialize: sends `start` action and waits for it to complete.
  /// Must be called before the first heartbeat.
  Future<void> start({double initialPosition = 0}) async {
    if (_isDisposed || _disabled) return;
    _currentPosition = initialPosition;
    _hasStarted = true;

    // Send start and wait — the server needs this to initialize
    // lastServerCheckAt, which governs the wall-clock cap for the
    // first heartbeat (15s without a prior record).
    try {
      await _recordProgress(
        courseId: courseId,
        moduleId: moduleId,
        contentId: contentId,
        contentType: 'video',
        action: 'start',
        progressData: initialPosition > 0
            ? {'currentPosition': initialPosition}
            : null,
      );
      _startOk = true;
    } on FirebaseFunctionsException catch (e) {
      if (e.code == 'permission-denied' || e.code == 'not-found') {
        Logger.w('VideoProgressTracker: start permanently failed: ${e.code}');
        _disabled = true;
        return; // Don't start heartbeat timer
      }
      Logger.w('VideoProgressTracker: start failed: $e');
      _startOk = false;
    } catch (e) {
      // Non-fatal: offline start is acceptable; we'll retry before
      // the first heartbeat.
      Logger.w('VideoProgressTracker: start failed: $e');
      _startOk = false;
    }

    // Guard: dispose() may have run while we were awaiting
    if (_isDisposed) return;

    // Start heartbeat timer (only fires while playing, checked inside)
    _heartbeatTimer = Timer.periodic(heartbeatInterval, (_) {
      if (!_isDisposed && _isPlaying) {
        _sendHeartbeat(fromTimer: true);
      }
    });
  }

  /// Called on each position tick from the player (~1/sec).
  void onPosition(double positionSeconds) {
    if (_isDisposed || _disabled || !_hasStarted) return;
    _currentPosition = positionSeconds;
    _segmentTracker.onPosition(positionSeconds);
    _maybeWriteResume();
  }

  /// Called when playback starts / resumes.
  /// [positionSeconds] is the controller position at the time of the event.
  void onPlay(double positionSeconds) {
    if (_isDisposed || _disabled) return;
    _isPlaying = true;
    _currentPosition = positionSeconds;
    _segmentTracker.onPlaying(positionSeconds);
  }

  /// Called when playback pauses.
  void onPause() {
    if (_isDisposed || _disabled) return;
    _isPlaying = false;
    _segmentTracker.onPause();
    // Send a heartbeat immediately on pause (captures segments up to now).
    if (_hasStarted) _sendHeartbeat();
    _writeResume();
  }

  /// Called when the user seeks to a new position.
  void onSeek(double newPosition) {
    if (_isDisposed || _disabled) return;
    _segmentTracker.onSeek(newPosition, isPlaying: _isPlaying);
    _currentPosition = newPosition;
  }

  /// Called when playback speed changes. Scales the seek detection threshold.
  void onSpeedChanged(double speed) {
    _segmentTracker.setSpeed(speed);
  }

  /// Call when the app goes to background (paused/inactive lifecycle state).
  /// Closes the open segment and sends a final heartbeat.
  void onAppPaused() {
    if (_isDisposed || _disabled || !_hasStarted) return;
    _isPlaying = false;
    _segmentTracker.onPause();
    _sendHeartbeat();
    _writeResume();
  }

  /// Call when the app returns from background, if the player is still
  /// playing (e.g. audio-only). Re-opens a segment.
  void onAppResumed(double positionSeconds, {required bool isPlaying}) {
    if (_isDisposed || _disabled || !_hasStarted) return;
    _currentPosition = positionSeconds;
    if (isPlaying) {
      _isPlaying = true;
      _segmentTracker.onPlaying(positionSeconds);
    }
  }

  /// Call when the route is popped or content switches.
  /// Sends final heartbeat with all accumulated segments.
  Future<void> onRoutePopped() async {
    if (_isDisposed || _disabled || !_hasStarted) return;
    _isPlaying = false;
    _segmentTracker.onPause();
    await _sendHeartbeat();
    _writeResume();
  }

  /// Cleanup only — cancel timers. No network calls.
  /// Network calls go in [onRoutePopped] or [onAppPaused].
  void dispose() {
    if (_isDisposed) return;
    _isDisposed = true;
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
  }

  // --- Private helpers ---

  Future<void> _sendHeartbeat({bool fromTimer = false}) async {
    if (!_hasStarted || _disabled) return;
    if (fromTimer && _inFlight) return; // coalesce timer ticks

    // Cumulative merged segments — idempotent, safe to re-send
    final segments = _segmentTracker.mergedSnapshot();
    final total = _segmentTracker.totalCoverage;

    // Skip if nothing new to credit (avoids unnecessary callable cost)
    if (total <= _sentSeconds) return;

    _inFlight = true;
    try {
      // If start() failed, retry before the first real heartbeat.
      // The server needs the start record to initialize lastServerCheckAt.
      if (!_startOk) {
        try {
          await _recordProgress(
            courseId: courseId,
            moduleId: moduleId,
            contentId: contentId,
            contentType: 'video',
            action: 'start',
          );
          _startOk = true;
        } on FirebaseFunctionsException catch (e) {
          if (e.code == 'permission-denied' || e.code == 'not-found') {
            _disabled = true;
            _heartbeatTimer?.cancel();
            return;
          }
          Logger.w('VideoProgressTracker: start retry failed: $e');
          return; // Can't heartbeat without a start record
        } catch (e) {
          Logger.w('VideoProgressTracker: start retry failed: $e');
          return; // Can't heartbeat without a start record
        }
      }

      final result = await _recordProgress(
        courseId: courseId,
        moduleId: moduleId,
        contentId: contentId,
        contentType: 'video',
        action: 'update_position',
        progressData: {
          'watchedSegments': segments,
          if (_currentPosition > 0) 'currentPosition': _currentPosition,
        },
      );

      if (result['capped'] == true) {
        Logger.w(
          'VideoProgressTracker: heartbeat capped — remainder re-sent next time',
        );
        // Don't update _sentSeconds so we re-send the full list next time.
        // The trimmed segments will be credited when the wall-clock allowance
        // catches up.
      } else {
        _sentSeconds = total;
      }
    } on FirebaseFunctionsException catch (e) {
      if (e.code == 'permission-denied' || e.code == 'not-found') {
        Logger.w('VideoProgressTracker: permanently disabled: ${e.code}');
        _disabled = true;
        _heartbeatTimer?.cancel();
      } else {
        Logger.w('VideoProgressTracker: heartbeat failed: $e');
      }
    } catch (e) {
      // Progress tracking failures must never disrupt playback.
      // Segments are cumulative, so the next heartbeat re-sends them.
      Logger.w('VideoProgressTracker: heartbeat failed: $e');
    } finally {
      _inFlight = false;
    }
  }

  void _maybeWriteResume() {
    final now = DateTime.now();
    if (_lastResumeWriteTime != null &&
        now.difference(_lastResumeWriteTime!) < resumeWriteInterval) {
      return; // Throttled
    }
    _writeResume();
  }

  void _writeResume() {
    _lastResumeWriteTime = DateTime.now();
    _saveResume(
      contentId: contentId,
      courseId: courseId,
      moduleId: moduleId,
      contentType: 'video',
      currentPosition: _currentPosition,
    );
  }
}

// ---------------------------------------------------------------------------
// PdfProgressTracker — page-based tracking
// ---------------------------------------------------------------------------

/// Tracks PDF reading progress by page.
///
/// Tracks the *furthest* page reached, not just current page, because going
/// back should not lower progress (the server computes `currentPage / totalPages`).
///
/// Lifecycle:
///   1. Create when PDF opens.
///   2. Call [start] once.
///   3. Call [onTotalPagesKnown] once after render.
///   4. Call [onPageChanged] on each page change.
///   5. Call [onAppPaused] / [onRoutePopped] on lifecycle/navigation.
///   6. Call [dispose] for cleanup only.
class PdfProgressTracker {
  final String courseId;
  final String moduleId;
  final String contentId;

  PdfProgressTracker({
    required this.courseId,
    required this.moduleId,
    required this.contentId,
  });

  int _currentPage = 0;
  int _maxPageReached = 0;
  int _totalPages = 0;
  bool _hasStarted = false;
  bool _isDisposed = false;
  DateTime? _lastResumeWriteTime;
  DateTime? _lastHeartbeatTime;

  /// Initialize: sends `start` action.
  Future<void> start() async {
    if (_isDisposed) return;
    _hasStarted = true;
    try {
      await ProgressService.recordProgress(
        courseId: courseId,
        moduleId: moduleId,
        contentId: contentId,
        contentType: 'pdf',
        action: 'start',
      );
    } catch (e) {
      Logger.w('PdfProgressTracker: start failed: $e');
    }
  }

  /// Called when total pages are known (on PDF render).
  void onTotalPagesKnown(int totalPages) {
    _totalPages = totalPages;
  }

  /// Called when the user navigates to a new page (0-indexed).
  void onPageChanged(int page) {
    if (_isDisposed || !_hasStarted) return;
    _currentPage = page;
    _maxPageReached = max(_maxPageReached, page);

    // Throttled resume write (every 5 seconds at most)
    final now = DateTime.now();
    if (_lastResumeWriteTime == null ||
        now.difference(_lastResumeWriteTime!) > const Duration(seconds: 5)) {
      _lastResumeWriteTime = now;
      ProgressService.saveResumePosition(
        contentId: contentId,
        courseId: courseId,
        moduleId: moduleId,
        contentType: 'pdf',
        currentPage: _currentPage,
      );
    }

    // Throttled heartbeat (every 30 seconds at most)
    if (_lastHeartbeatTime == null ||
        now.difference(_lastHeartbeatTime!) > const Duration(seconds: 30)) {
      _lastHeartbeatTime = now;
      _sendProgressUpdate();
    }
  }

  /// Call when app goes to background.
  void onAppPaused() {
    if (_isDisposed || !_hasStarted) return;
    _sendProgressUpdate();
    ProgressService.saveResumePosition(
      contentId: contentId,
      courseId: courseId,
      moduleId: moduleId,
      contentType: 'pdf',
      currentPage: _currentPage,
    );
  }

  /// Call when navigating away. Sends final update.
  Future<void> onRoutePopped() async {
    if (_isDisposed || !_hasStarted || _totalPages == 0) return;

    // Send the furthest page reached. The server completes the PDF
    // when currentPage >= totalPages.
    // Page is 0-indexed from the viewer, but server expects 1-indexed
    // where currentPage == totalPages means last page reached.
    final pageToReport = _maxPageReached + 1; // Convert to 1-indexed
    final action = (pageToReport >= _totalPages) ? 'complete' : 'update_position';

    try {
      await ProgressService.recordProgress(
        courseId: courseId,
        moduleId: moduleId,
        contentId: contentId,
        contentType: 'pdf',
        action: action,
        progressData: {
          'currentPage': pageToReport,
          'totalPages': _totalPages,
        },
      );
    } catch (e) {
      Logger.w('PdfProgressTracker: onRoutePopped failed: $e');
    }

    // Final resume write
    ProgressService.saveResumePosition(
      contentId: contentId,
      courseId: courseId,
      moduleId: moduleId,
      contentType: 'pdf',
      currentPage: _currentPage,
    );
  }

  /// Cleanup only.
  void dispose() {
    _isDisposed = true;
  }

  void _sendProgressUpdate() {
    if (_totalPages == 0) return;
    final pageToReport = _maxPageReached + 1; // 1-indexed

    ProgressService.recordProgress(
      courseId: courseId,
      moduleId: moduleId,
      contentId: contentId,
      contentType: 'pdf',
      action: 'update_position',
      progressData: {
        'currentPage': pageToReport,
        'totalPages': _totalPages,
      },
    ).catchError((e) {
      Logger.w('PdfProgressTracker: update_position failed: $e');
      return <String, dynamic>{};
    });
  }
}

// ---------------------------------------------------------------------------
// SimpleProgressTracker — for notes, images, links, audio
// ---------------------------------------------------------------------------

/// Tracker for content types that complete on view.
/// Sends `start` + `complete` when the content is rendered.
///
/// For one-time-view content, use this tracker too — skip position/segment data.
class SimpleProgressTracker {
  final String courseId;
  final String moduleId;
  final String contentId;
  final String contentType; // 'note', 'image', 'link', 'audio'

  SimpleProgressTracker({
    required this.courseId,
    required this.moduleId,
    required this.contentId,
    required this.contentType,
  });

  bool _hasRecorded = false;
  bool _isDisposed = false;

  /// Sends `start` then `complete` in sequence.
  /// Idempotent — only fires once.
  Future<void> markViewed() async {
    if (_hasRecorded || _isDisposed) return;
    _hasRecorded = true;

    try {
      await ProgressService.recordProgress(
        courseId: courseId,
        moduleId: moduleId,
        contentId: contentId,
        contentType: contentType,
        action: 'start',
      );

      await ProgressService.recordProgress(
        courseId: courseId,
        moduleId: moduleId,
        contentId: contentId,
        contentType: contentType,
        action: 'complete',
      );

      Logger.i('SimpleProgressTracker: marked $contentType $contentId as viewed');
    } catch (e) {
      Logger.w('SimpleProgressTracker: markViewed failed: $e');
    }
  }

  void dispose() {
    _isDisposed = true;
  }
}
```

---

## Flutter — Progress Provider
`/Users/rojinroy/Projects/aptitude4us_app/lib/providers/progress_provider.dart`

```
import 'dart:async';
import 'dart:math';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/widgets.dart';
import '../models/progress_models.dart';
import '../services/progress_service.dart';
import '../utils/logger.dart';

/// Centralized provider for progress data.
///
/// Listens to [FirebaseAuth.authStateChanges] and re-subscribes all
/// progress streams when the signed-in user changes. This prevents stale
/// listeners from a previous user feeding data to screens after logout/login.
///
/// Exposes:
/// - [courseProgressMap] — all course progress keyed by courseId.
/// - [examReadiness], [currentStreak], [totalCoursesCompleted] — user-level stats.
///
/// Screens should read from this provider (via Provider/Consumer) instead of
/// subscribing to [ProgressService] streams directly.
///
/// The streak is computed live in the getter from stored raw values, so it
/// stays correct across midnight without a Firestore event.
class ProgressProvider extends ChangeNotifier with WidgetsBindingObserver {
  Map<String, CourseProgress> _courseProgressMap = {};
  double _examReadiness = 0;
  int _totalCoursesCompleted = 0;

  // Raw streak values — streak is derived in the getter
  int _rawStreak = 0;
  String? _lastActivityDate;

  StreamSubscription<User?>? _authSubscription;
  StreamSubscription<Map<String, CourseProgress>>? _courseProgressSub;
  StreamSubscription<Map<String, dynamic>>? _userProgressSub;

  String? _currentUid;
  bool _disposed = false;

  // Backoff attempt counters — instance fields so they reset on data events
  int _courseProgressAttempt = 0;
  int _userProgressAttempt = 0;

  ProgressProvider() {
    WidgetsBinding.instance.addObserver(this);
    _authSubscription = FirebaseAuth.instance.authStateChanges().listen(_onAuthChanged);
    // Kick-start with current user if already signed in
    _onAuthChanged(FirebaseAuth.instance.currentUser);
  }

  // ---------------------------------------------------------------------------
  // Public getters
  // ---------------------------------------------------------------------------

  Map<String, CourseProgress> get courseProgressMap => _courseProgressMap;
  double get examReadiness => _examReadiness;
  int get totalCoursesCompleted => _totalCoursesCompleted;

  /// Live streak: computed from raw values on every access so it stays
  /// correct across midnight without a Firestore event.
  int get currentStreak =>
      ProgressService.displayStreak(_rawStreak, _lastActivityDate);

  /// Convenience: get progress for a single course.
  CourseProgress? courseProgress(String courseId) => _courseProgressMap[courseId];

  // ---------------------------------------------------------------------------
  // App lifecycle — recompute streak on resume (crossing midnight)
  // ---------------------------------------------------------------------------

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_disposed) return;
    if (state == AppLifecycleState.resumed && _currentUid != null) {
      // The streak getter already recomputes, but we need to notify
      // listeners so widgets rebuild with the possibly-changed value.
      notifyListeners();
    }
  }

  // ---------------------------------------------------------------------------
  // Auth lifecycle
  // ---------------------------------------------------------------------------

  void _onAuthChanged(User? user) {
    if (_disposed) return;
    final newUid = user?.uid;

    // Same user — no action needed
    if (newUid == _currentUid) return;

    // Cancel old subscriptions
    _cancelDataSubscriptions();
    _currentUid = newUid;

    // Reset state immediately — prevents stale data from the previous user
    // showing while the new user's streams are loading.
    _courseProgressMap = {};
    _examReadiness = 0;
    _rawStreak = 0;
    _lastActivityDate = null;
    _totalCoursesCompleted = 0;
    _courseProgressAttempt = 0;
    _userProgressAttempt = 0;
    notifyListeners();

    if (newUid == null) return; // Signed out — already cleared

    // Signed in — subscribe to progress streams
    _listenCourseProgress(newUid);
    _listenUserProgress(newUid);
  }

  // ---------------------------------------------------------------------------
  // Stream listeners with error recovery
  // ---------------------------------------------------------------------------

  /// Subscribes to course progress. On stream error (e.g. permission-denied
  /// during token refresh), resubscribes with exponential backoff.
  /// The attempt counter resets to 0 on the first successful data event.
  void _listenCourseProgress(String uid) {
    if (_disposed) return;
    _courseProgressSub?.cancel();
    _courseProgressSub = ProgressService.streamAllCourseProgress().listen(
      (map) {
        if (_disposed) return;
        _courseProgressAttempt = 0; // Reset backoff on successful data
        _courseProgressMap = map;
        notifyListeners();
      },
      onError: (e) {
        Logger.w('ProgressProvider: courseProgress stream error: $e');
        if (_disposed) return;
        final delay = Duration(seconds: min(60, 2 << _courseProgressAttempt));
        _courseProgressAttempt++;
        Future.delayed(delay, () {
          if (!_disposed && _currentUid == uid) {
            _listenCourseProgress(uid);
          }
        });
      },
    );
  }

  /// Subscribes to user-level progress fields. On stream error,
  /// resubscribes with exponential backoff.
  /// The attempt counter resets to 0 on the first successful data event.
  void _listenUserProgress(String uid) {
    if (_disposed) return;
    _userProgressSub?.cancel();
    _userProgressSub = ProgressService.streamUserProgressFields().listen(
      (fields) {
        if (_disposed) return;
        _userProgressAttempt = 0; // Reset backoff on successful data
        _examReadiness = (fields['examReadiness'] as num?)?.toDouble() ?? 0;
        _rawStreak = (fields['currentStreak'] as num?)?.toInt() ?? 0;
        _lastActivityDate = fields['lastActivityDate'] as String?;
        _totalCoursesCompleted = (fields['totalCoursesCompleted'] as num?)?.toInt() ?? 0;
        notifyListeners();
      },
      onError: (e) {
        Logger.w('ProgressProvider: userProgress stream error: $e');
        if (_disposed) return;
        final delay = Duration(seconds: min(60, 2 << _userProgressAttempt));
        _userProgressAttempt++;
        Future.delayed(delay, () {
          if (!_disposed && _currentUid == uid) {
            _listenUserProgress(uid);
          }
        });
      },
    );
  }

  void _cancelDataSubscriptions() {
    _courseProgressSub?.cancel();
    _courseProgressSub = null;
    _userProgressSub?.cancel();
    _userProgressSub = null;
  }

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _authSubscription?.cancel();
    _cancelDataSubscriptions();
    super.dispose();
  }
}
```

---

## Flutter — Timezone Service
`/Users/rojinroy/Projects/aptitude4us_app/lib/services/timezone_service.dart`

```
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import '../utils/logger.dart';

/// Writes the student's IANA timezone to their user doc.
///
/// Called once at login (fire-and-forget). The Firestore security rules
/// allow students to update only `timezone` (among other safe fields)
/// on their own user doc.
///
/// The server uses this timezone for streak date boundaries:
/// a student in `America/New_York` should have their "day" start/end
/// at midnight Eastern, not midnight UTC or IST.
class TimezoneService {
  /// Writes the device's current IANA timezone (e.g. "Asia/Kolkata",
  /// "America/New_York") to `users/{uid}.timezone`.
  ///
  /// Fire-and-forget — errors are logged but never thrown. A missing
  /// timezone just means the server falls back to its default.
  static Future<void> writeTimezoneToUserDoc() async {
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return;

      final tz = await FlutterTimezone.getLocalTimezone();
      if (tz.isEmpty) return;

      await FirebaseFirestore.instance
          .collection('users')
          .doc(user.uid)
          .update({'timezone': tz});

      Logger.i('TimezoneService: wrote timezone "$tz" for ${user.uid}');
    } catch (e) {
      // Non-fatal — server falls back to default timezone.
      Logger.w('TimezoneService: failed to write timezone: $e');
    }
  }
}

```

---

## Flutter — Progress Tracker Tests
`/Users/rojinroy/Projects/aptitude4us_app/test/progress_tracker_test.dart`

```
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:xfini_academy/services/progress_tracker.dart';

// ---------------------------------------------------------------------------
// VideoSegmentTracker tests
// ---------------------------------------------------------------------------

void main() {
  group('VideoSegmentTracker', () {
    late VideoSegmentTracker tracker;

    setUp(() {
      tracker = VideoSegmentTracker();
    });

    test('linear playback produces one segment', () {
      tracker.onPlaying(0);
      tracker.onPosition(1);
      tracker.onPosition(2);
      tracker.onPosition(3);
      tracker.onPause();

      final segs = tracker.mergedSnapshot();
      expect(segs.length, 1);
      expect(segs[0]['start'], 0);
      expect(segs[0]['end'], 3);
    });

    test('seek splits into two segments', () {
      tracker.onPlaying(0);
      tracker.onPosition(1);
      tracker.onPosition(2);
      // Seek to 60 — jump > threshold (2.5)
      tracker.onSeek(60, isPlaying: true);
      tracker.onPosition(61);
      tracker.onPosition(62);
      tracker.onPause();

      final segs = tracker.mergedSnapshot();
      expect(segs.length, 2);
      expect(segs[0], {'start': 0.0, 'end': 2.0});
      expect(segs[1], {'start': 60.0, 'end': 62.0});
    });

    test('mergedSnapshot merges overlapping segments', () {
      // First viewing: 0-10, using position ticks
      tracker.onPlaying(0);
      for (var i = 1.0; i <= 10; i++) {
        tracker.onPosition(i);
      }
      tracker.onPause();

      // Rewind and re-watch 5-15 — use seek to jump back, then tick forward
      tracker.onSeek(5, isPlaying: true);
      for (var i = 6.0; i <= 15; i++) {
        tracker.onPosition(i);
      }
      tracker.onPause();

      final segs = tracker.mergedSnapshot();
      expect(segs.length, 1);
      expect(segs[0]['start'], 0.0);
      expect(segs[0]['end'], 15.0);
    });

    test('totalCoverage sums unique coverage', () {
      // Watch 0-10
      tracker.onPlaying(0);
      for (var i = 1.0; i <= 10; i++) {
        tracker.onPosition(i);
      }
      tracker.onPause();

      // Seek back and watch 5-15 (overlaps)
      tracker.onSeek(5, isPlaying: true);
      for (var i = 6.0; i <= 15; i++) {
        tracker.onPosition(i);
      }
      tracker.onPause();

      expect(tracker.totalCoverage, 15.0);
    });

    test('mergedSnapshot does not mutate internal state', () {
      tracker.onPlaying(0);
      tracker.onPosition(1);
      tracker.onPosition(2);
      tracker.onPosition(3);
      tracker.onPosition(4);
      tracker.onPosition(5);
      tracker.onPause();

      final snap1 = tracker.mergedSnapshot();
      expect(snap1.length, 1);
      // Mutate the returned map
      snap1[0]['end'] = 999;

      // Internal state should be unaffected
      final snap2 = tracker.mergedSnapshot();
      expect(snap2[0]['end'], 5.0);
    });

    test('mergedSnapshot includes open segment', () {
      tracker.onPlaying(0);
      tracker.onPosition(1);
      tracker.onPosition(2);
      tracker.onPosition(3);
      tracker.onPosition(4);
      tracker.onPosition(5);
      // No pause — segment is still open

      final segs = tracker.mergedSnapshot();
      expect(segs.length, 1);
      expect(segs[0], {'start': 0.0, 'end': 5.0});
    });

    test('empty tracker returns empty snapshot', () {
      expect(tracker.mergedSnapshot(), isEmpty);
      expect(tracker.totalCoverage, 0);
    });

    test('false-seek detection at 2x speed', () {
      tracker.setSpeed(2.0);
      // At 2x, threshold = max(2.5, 2.5 * 2.0) = 5.0
      tracker.onPlaying(0);
      tracker.onPosition(2.0); // 2s jump at 2x is normal
      tracker.onPosition(4.0);
      tracker.onPause();

      // Should be one continuous segment
      final segs = tracker.mergedSnapshot();
      expect(segs.length, 1);
      expect(segs[0], {'start': 0.0, 'end': 4.0});
    });

    test('real seek at 2x speed is detected', () {
      tracker.setSpeed(2.0);
      // At 2x, threshold = 5.0
      tracker.onPlaying(0);
      tracker.onPosition(2.0);
      tracker.onPosition(10.0); // 8s jump > 5.0 threshold — detected as seek
      tracker.onPosition(12.0);
      tracker.onPause();

      final segs = tracker.mergedSnapshot();
      expect(segs.length, 2);
    });

    test('seek while paused moves _last without opening segment', () {
      tracker.onPlaying(0);
      tracker.onPosition(1);
      tracker.onPosition(2);
      tracker.onPosition(3);
      tracker.onPosition(4);
      tracker.onPosition(5);
      tracker.onPause();

      // Seek while paused — no new segment opens
      tracker.onSeek(30);

      final segs = tracker.mergedSnapshot();
      expect(segs.length, 1);
      expect(segs[0], {'start': 0.0, 'end': 5.0});
    });

    test('onPosition before onPlaying is ignored', () {
      tracker.onPosition(5);
      tracker.onPosition(10);
      expect(tracker.mergedSnapshot(), isEmpty);
    });

    test('zero-length segment (pause immediately after play) is dropped', () {
      tracker.onPlaying(5);
      // Pause at same position (_last == _start)
      tracker.onPause();
      expect(tracker.mergedSnapshot(), isEmpty);
    });
  });

  // ---------------------------------------------------------------------------
  // VideoProgressTracker tests
  // ---------------------------------------------------------------------------

  group('VideoProgressTracker', () {
    late List<Map<String, dynamic>> recordedCalls;
    late List<Map<String, dynamic>> resumeCalls;

    Future<Map<String, dynamic>> mockRecordProgress({
      required String courseId,
      required String moduleId,
      required String contentId,
      required String contentType,
      required String action,
      Map<String, dynamic>? progressData,
    }) async {
      recordedCalls.add({
        'courseId': courseId,
        'moduleId': moduleId,
        'contentId': contentId,
        'contentType': contentType,
        'action': action,
        'progressData': progressData,
      });
      return {'success': true, 'status': 'updated'};
    }

    Future<void> mockSaveResume({
      required String contentId,
      required String courseId,
      required String moduleId,
      required String contentType,
      double? currentPosition,
      int? currentPage,
    }) async {
      resumeCalls.add({
        'contentId': contentId,
        'currentPosition': currentPosition,
      });
    }

    VideoProgressTracker createTracker() {
      return VideoProgressTracker(
        courseId: 'c1',
        moduleId: 'm1',
        contentId: 'v1',
        recordProgressFn: mockRecordProgress,
        saveResumeFn: mockSaveResume,
      );
    }

    setUp(() {
      recordedCalls = [];
      resumeCalls = [];
    });

    test('start() sends start action', () async {
      final tracker = createTracker();
      await tracker.start();
      tracker.dispose();

      expect(recordedCalls.length, 1);
      expect(recordedCalls[0]['action'], 'start');
    });

    test('pause sends heartbeat with cumulative segments', () async {
      final tracker = createTracker();
      await tracker.start();

      tracker.onPlay(0);
      for (var i = 1.0; i <= 10; i++) {
        tracker.onPosition(i);
      }
      tracker.onPause();
      // _sendHeartbeat is async — give it a microtask to finish
      await Future.delayed(Duration.zero);
      await Future.delayed(Duration.zero);

      final heartbeats = recordedCalls
          .where((c) => c['action'] == 'update_position')
          .toList();
      expect(heartbeats.length, 1);

      final segments = heartbeats[0]['progressData']!['watchedSegments'] as List;
      expect(segments.length, 1);

      tracker.dispose();
    });

    test('pause with no new segments makes no call', () async {
      final tracker = createTracker();
      await tracker.start();

      tracker.onPause();
      await Future.delayed(Duration.zero);

      // Only the start call, no heartbeat
      expect(recordedCalls.length, 1);
      expect(recordedCalls[0]['action'], 'start');

      tracker.dispose();
    });

    test('cumulative sending: failed heartbeat followed by successful one credits all', () async {
      var shouldFail = true;
      final allCalls = <Map<String, dynamic>>[];

      Future<Map<String, dynamic>> failOnceRecord({
        required String courseId,
        required String moduleId,
        required String contentId,
        required String contentType,
        required String action,
        Map<String, dynamic>? progressData,
      }) async {
        allCalls.add({'action': action, 'progressData': progressData});
        if (action == 'update_position' && shouldFail) {
          shouldFail = false;
          throw Exception('network error');
        }
        return {'success': true, 'status': 'updated'};
      }

      final tracker = VideoProgressTracker(
        courseId: 'c1',
        moduleId: 'm1',
        contentId: 'v1',
        recordProgressFn: failOnceRecord,
        saveResumeFn: mockSaveResume,
      );

      await tracker.start();

      // Play 0-10 (using ticks to stay within threshold)
      tracker.onPlay(0);
      for (var i = 1.0; i <= 10; i++) {
        tracker.onPosition(i);
      }
      tracker.onPause(); // heartbeat fails
      await Future.delayed(Duration.zero);
      await Future.delayed(Duration.zero);

      // Play more 10-20
      tracker.onPlay(10);
      for (var i = 11.0; i <= 20; i++) {
        tracker.onPosition(i);
      }
      tracker.onPause(); // heartbeat succeeds — should send cumulative 0-20
      await Future.delayed(Duration.zero);
      await Future.delayed(Duration.zero);

      final heartbeats = allCalls
          .where((c) => c['action'] == 'update_position')
          .toList();
      expect(heartbeats.length, greaterThanOrEqualTo(2));

      // The last successful heartbeat should have the full 0-20 range
      final lastSegments = heartbeats.last['progressData']!['watchedSegments'] as List;
      expect(lastSegments.length, 1);
      final seg = lastSegments[0] as Map<String, double>;
      expect(seg['start'], 0);
      expect(seg['end'], 20);

      tracker.dispose();
    });

    test('capped response re-sends full cumulative list next time', () async {
      var callCount = 0;
      final allCalls = <Map<String, dynamic>>[];

      Future<Map<String, dynamic>> cappedOnceRecord({
        required String courseId,
        required String moduleId,
        required String contentId,
        required String contentType,
        required String action,
        Map<String, dynamic>? progressData,
      }) async {
        allCalls.add({'action': action, 'progressData': progressData});
        callCount++;
        if (action == 'update_position' && callCount == 2) {
          return {'success': true, 'status': 'updated', 'capped': true};
        }
        return {'success': true, 'status': 'updated'};
      }

      final tracker = VideoProgressTracker(
        courseId: 'c1',
        moduleId: 'm1',
        contentId: 'v1',
        recordProgressFn: cappedOnceRecord,
        saveResumeFn: mockSaveResume,
      );

      await tracker.start();

      // Play 0-10
      tracker.onPlay(0);
      for (var i = 1.0; i <= 10; i++) {
        tracker.onPosition(i);
      }
      tracker.onPause(); // capped response
      await Future.delayed(Duration.zero);
      await Future.delayed(Duration.zero);

      // Play more 10-15
      tracker.onPlay(10);
      for (var i = 11.0; i <= 15; i++) {
        tracker.onPosition(i);
      }
      tracker.onPause(); // should re-send full 0-15 because capped didn't update _sentSeconds
      await Future.delayed(Duration.zero);
      await Future.delayed(Duration.zero);

      final heartbeats = allCalls
          .where((c) => c['action'] == 'update_position')
          .toList();
      expect(heartbeats.length, greaterThanOrEqualTo(2));

      // Second heartbeat should include the full 0-15 range
      final lastSegs = heartbeats.last['progressData']!['watchedSegments'] as List;
      final total = lastSegs.fold<double>(
        0,
        (s, seg) => s + ((seg as Map)['end']! as double) - (seg['start']! as double),
      );
      expect(total, 15);

      tracker.dispose();
    });

    test('dispose during start() leaves no active timer', () async {
      final completer = Completer<Map<String, dynamic>>();
      final allCalls = <String>[];

      Future<Map<String, dynamic>> slowRecord({
        required String courseId,
        required String moduleId,
        required String contentId,
        required String contentType,
        required String action,
        Map<String, dynamic>? progressData,
      }) async {
        allCalls.add(action);
        if (action == 'start') {
          return completer.future;
        }
        return {'success': true};
      }

      final tracker = VideoProgressTracker(
        courseId: 'c1',
        moduleId: 'm1',
        contentId: 'v1',
        recordProgressFn: slowRecord,
        saveResumeFn: mockSaveResume,
      );

      final startFuture = tracker.start();
      tracker.dispose(); // dispose before start completes

      completer.complete({'success': true});
      await startFuture;

      final callCountAfterStart = allCalls.length;

      // Try to use the tracker — should be no-ops
      tracker.onPlay(0);
      tracker.onPosition(10);
      tracker.onPause();
      await Future.delayed(Duration.zero);

      expect(allCalls.length, callCountAfterStart);
    });

    test('onRoutePopped sends final heartbeat', () async {
      final tracker = createTracker();
      await tracker.start();

      tracker.onPlay(0);
      for (var i = 1.0; i <= 30; i++) {
        tracker.onPosition(i);
      }

      await tracker.onRoutePopped();
      await Future.delayed(Duration.zero);

      final heartbeats = recordedCalls
          .where((c) => c['action'] == 'update_position')
          .toList();
      expect(heartbeats.length, 1);

      tracker.dispose();
    });

    test('speed change affects segment tracker threshold', () async {
      final tracker = createTracker();
      await tracker.start();

      tracker.onSpeedChanged(2.0);
      tracker.onPlay(0);
      // At 2x, threshold = max(2.5, 5.0) = 5.0
      // A jump of 4s should NOT be detected as a seek
      tracker.onPosition(4);
      tracker.onPause();
      await Future.delayed(Duration.zero);
      await Future.delayed(Duration.zero);

      final heartbeats = recordedCalls
          .where((c) => c['action'] == 'update_position')
          .toList();
      if (heartbeats.isNotEmpty) {
        final segs = heartbeats.last['progressData']!['watchedSegments'] as List;
        expect(segs.length, 1); // one continuous segment
      }

      tracker.dispose();
    });

    test('resume position is written on pause', () async {
      final tracker = createTracker();
      await tracker.start();

      tracker.onPlay(0);
      for (var i = 1.0; i <= 42; i++) {
        tracker.onPosition(i);
      }
      tracker.onPause();
      await Future.delayed(Duration.zero);

      expect(resumeCalls.isNotEmpty, true);
      expect(resumeCalls.last['currentPosition'], 42);

      tracker.dispose();
    });
  });
}
```

