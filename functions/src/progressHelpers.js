/**
 * Pure helper functions for progress computation.
 * No Firestore, no admin SDK — safe to import in unit tests.
 */

const CONTENT_TYPES = ["videos", "pdfs", "notes", "audios", "images", "links"];

const TYPE_BY_KEY = {
  videos: "video",
  pdfs: "pdf",
  notes: "note",
  audios: "audio",
  images: "image",
  links: "link",
};

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
 * Find a content item by ID and also return the canonical content type.
 * Returns { item, type } or null. The `type` is the singular form
 * (e.g. "video", "pdf") matching what the client sends as `contentType`.
 */
function findContentItemWithType(content, contentId) {
  if (!content) return null;
  for (const key of CONTENT_TYPES) {
    const arr = content[key] || [];
    const item = arr.find((i) => i.id === contentId);
    if (item) return { item, type: TYPE_BY_KEY[key] };
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
      !Number.isFinite(seg.start) ||
      !Number.isFinite(seg.end) ||
      seg.start < 0 ||
      seg.end < seg.start
    ) {
      throw new Error("Invalid segment data.");
    }
  }

  // Cap segment count to prevent abuse
  if (newSegments.length > 500) {
    throw new Error("Too many segments.");
  }

  // Validate server duration if provided
  const hasServerDuration =
    Number.isFinite(serverDuration) && serverDuration > 0;
  const totalDuration = hasServerDuration ? serverDuration : 0;

  // Clamp segment ends to duration instead of throwing on > 110%.
  // A wrong stored duration shouldn't stall a video permanently.
  let clampedSegments = [...prevSegments, ...newSegments];
  if (totalDuration > 0) {
    clampedSegments = clampedSegments.map((seg) => ({
      start: Math.min(seg.start, totalDuration),
      end: Math.min(seg.end, totalDuration),
    }));
  }

  const merged = mergeSegments(clampedSegments);
  let watchedSeconds = merged.reduce(
    (s, seg) => s + (seg.end - seg.start),
    0
  );

  // Wall-clock cap: credit up to maxAdded of new watched seconds.
  const prevSeconds = sumSegments(prevSegments);
  const added = watchedSeconds - prevSeconds;

  const lastCheckMs =
    existing?.videoProgress?.lastServerCheckAt?.toMillis?.() ??
    existing?.videoProgress?.lastServerCheckAt ??
    null;
  const rawElapsed = lastCheckMs ? (nowMs - lastCheckMs) / 1000 : 0;
  const elapsed = Math.min(rawElapsed, 300); // cap at 5 minutes
  // Tighter slack: elapsed * 2, plus 5s only if elapsed >= 10s.
  // First call (no lastCheckMs): 15s budget.
  const maxAdded = lastCheckMs ? elapsed * 2 + (elapsed >= 10 ? 5 : 0) : 15;

  let capped = false;
  let finalSegments = merged;
  if (added > maxAdded) {
    const trimResult = trimSegmentsWithBudget(merged, mergeSegments(prevSegments.map((s) => ({ ...s }))), maxAdded);
    finalSegments = trimResult.segments;
    watchedSeconds = sumSegments(finalSegments);
    capped = true;
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
  findContentItemWithType,
  evaluateVideoProgress,
  trimSegmentsToTotal,
  trimSegmentsWithBudget,
  subtractCoverage,
  takeEarliest,
  CONTENT_TYPES,
  TYPE_BY_KEY,
};

