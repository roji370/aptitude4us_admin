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
    startedAt: null,
    lastActivityAt: null,
    completedAt: null,
    updatedAt: null,
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
