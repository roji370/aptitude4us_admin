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
  startedAt: Timestamp | null;
  lastActivityAt: Timestamp | null;
  completedAt: Timestamp | null;
  updatedAt: Timestamp | null;
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
