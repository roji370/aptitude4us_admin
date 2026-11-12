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

  test("two calls at same nowMs: second gets zero allowance", () => {
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
    // elapsed = 0, so maxAdded = 0*2 + 0 = 0. No new seconds credited.
    expect(sumSegments(second.watchedSegments)).toBe(10);
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

  test("segments beyond duration are clamped, not rejected", () => {
    const checkTime = Date.now() - 60000;

    // Segments extending past duration get clamped to duration.
    // [300, 340] → [300, 300] → empty, so total stays at 300.
    const result = evaluateVideoProgress({
      existing: mkExisting([{ start: 0, end: 300 }], checkTime),
      incomingSegments: [{ start: 300, end: 340 }],
      serverDuration: VIDEO_DURATION,
      nowMs: Date.now(),
      threshold: THRESHOLD,
      action: "update_position",
    });

    expect(result.watchedSegments).toEqual([{ start: 0, end: 300 }]);
    expect(result.percentageWatched).toBe(100);
    expect(result.completedAt).toBe(true);
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
    const checkTime = nowMs - 5000; // 5s ago → maxAdded = 5*2 + 0 = 10

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
    // New coverage: only 10s of [0,100] → [0,10]
    expect(result.watchedSegments).toEqual([
      { start: 0, end: 10 },
      { start: 200, end: 260 },
    ]);
  });
});
