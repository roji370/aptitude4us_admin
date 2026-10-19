import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';
import { doc, collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { 
  parseNotificationError, 
  getUserFriendlyErrorMessage, 
  logNotificationError, 
  validateNotificationInput,
  validateConsolidatedNotificationInput,
  shouldRetry,
  getRetryDelay,
  NotificationError
} from './notificationErrorHandler';

// Types for notification tracking
export interface NotificationResult {
  userId: string;
  notificationId: string;
  status: 'success' | 'partial_success' | 'failed';
  directPushSent: boolean;
  tokenCount: number;
  successfulSends: number;
  error?: string;
}

export interface NotificationSummary {
  totalUsers: number;
  successful: number;
  failed: number;
}

export interface CourseAssignmentNotificationResponse {
  success: boolean;
  message: string;
  results: NotificationResult[];
  errors: Array<{ userId: string; error: string }>;
  summary: NotificationSummary;
}

export interface NotificationTrackingRecord {
  id: string;
  type: 'course_assignment';
  courseId: string;
  assignedBy: string;
  assignedUsers: string[];
  timestamp: Date;
  results: NotificationResult[];
  summary: NotificationSummary;
  errors: Array<{ userId: string; error: string }>;
}

// Send course assignment notifications with retry logic and comprehensive error handling
export const sendCourseAssignmentNotifications = async (
  courseId: string,
  userIds: string[],
  newAssignments?: string[]
): Promise<CourseAssignmentNotificationResponse> => {
  // Validate input
  try {
    validateNotificationInput(courseId, userIds);
  } catch (validationError) {
    const parsedError = parseNotificationError(validationError);
    logNotificationError(parsedError, { courseId, userIds, newAssignments });
    throw new Error(getUserFriendlyErrorMessage(parsedError));
  }

  let lastError: NotificationError | null = null;
  let attemptCount = 0;
  const maxRetries = 3;

  while (attemptCount <= maxRetries) {
    try {
      const triggerNotification = httpsCallable(functions, 'triggerCourseAssignmentNotification');
      
      const result = await triggerNotification({
        courseId,
        userIds,
        newAssignments: newAssignments || userIds
      });

      // Success - log and return
      console.log('Course assignment notifications sent successfully:', {
        courseId,
        userCount: userIds.length,
        attemptCount: attemptCount + 1
      });

      return result.data as CourseAssignmentNotificationResponse;
    } catch (error) {
      attemptCount++;
      lastError = parseNotificationError(error);
      
      logNotificationError(lastError, { 
        courseId, 
        userIds, 
        newAssignments,
        attemptCount,
        maxRetries
      });

      // Check if we should retry
      if (shouldRetry(lastError, attemptCount, maxRetries)) {
        const delay = getRetryDelay(attemptCount - 1);
        console.log(`Retrying notification send in ${delay}ms (attempt ${attemptCount}/${maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      } else {
        // No more retries or non-retryable error
        break;
      }
    }
  }

  // If we get here, all retries failed
  const friendlyMessage = getUserFriendlyErrorMessage(lastError!);
  throw new Error(friendlyMessage);
};

// Get notification tracking records
export const getNotificationTrackingRecords = async (
  courseId?: string,
  limitCount = 50
): Promise<NotificationTrackingRecord[]> => {
  try {
    let q;
    
    if (courseId) {
      q = query(
        collection(db, 'notification_tracking'),
        where('courseId', '==', courseId),
        where('type', '==', 'course_assignment'),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
    } else {
      q = query(
        collection(db, 'notification_tracking'),
        where('type', '==', 'course_assignment'),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
    }

    const querySnapshot = await getDocs(q);
    const records: NotificationTrackingRecord[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      records.push({
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate() || new Date(),
      } as NotificationTrackingRecord);
    });

    return records;
  } catch (error) {
    const parsedError = parseNotificationError(error);
    logNotificationError(parsedError, { courseId, limitCount });
    throw new Error(getUserFriendlyErrorMessage(parsedError));
  }
};

// Get notification statistics for a course
export const getCourseNotificationStats = async (courseId: string) => {
  try {
    const records = await getNotificationTrackingRecords(courseId);
    
    if (records.length === 0) {
      return {
        totalNotificationsSent: 0,
        totalUsersNotified: 0,
        successRate: 0,
        lastNotificationDate: null
      };
    }

    const totalNotificationsSent = records.length;
    const totalUsersNotified = records.reduce((sum, record) => sum + record.summary.totalUsers, 0);
    const totalSuccessful = records.reduce((sum, record) => sum + record.summary.successful, 0);
    const successRate = totalUsersNotified > 0 ? (totalSuccessful / totalUsersNotified) * 100 : 0;
    const lastNotificationDate = records[0].timestamp; // First record is the most recent

    return {
      totalNotificationsSent,
      totalUsersNotified,
      successRate,
      lastNotificationDate
    };
  } catch (error) {
    console.error('Error getting course notification stats:', error);
    throw error;
  }
};

// Check if a user received a notification for a specific course assignment
export const checkUserNotificationStatus = async (
  userId: string,
  courseId: string
): Promise<{
  hasReceived: boolean;
  notificationId?: string;
  timestamp?: Date;
  status?: string;
}> => {
  try {
    const records = await getNotificationTrackingRecords(courseId);
    
    for (const record of records) {
      const userResult = record.results.find(result => result.userId === userId);
      if (userResult) {
        return {
          hasReceived: true,
          notificationId: userResult.notificationId,
          timestamp: record.timestamp,
          status: userResult.status
        };
      }
    }

    return { hasReceived: false };
  } catch (error) {
    console.error('Error checking user notification status:', error);
    throw error;
  }
};

// Utility function to determine newly assigned users
export const getNewlyAssignedUsers = (
  previousAssignments: string[],
  currentAssignments: string[]
): string[] => {
  return currentAssignments.filter(userId => !previousAssignments.includes(userId));
};

/**
 * Send consolidated notification for multiple course assignments to users
 * This sends ONE notification per user for all newly assigned courses
 */
export const sendConsolidatedCourseAssignmentNotifications = async (
  courseIds: string[],
  userIds: string[],
  adminId: string
): Promise<CourseAssignmentNotificationResponse> => {
  const maxRetries = 3;
  let attemptCount = 0;
  let lastError: any = null;

  // Validate input
  try {
    validateConsolidatedNotificationInput(courseIds, userIds, adminId);
  } catch (validationError) {
    const parsedError = parseNotificationError(validationError);
    logNotificationError(parsedError, { courseIds, userIds, adminId });
    throw new Error(getUserFriendlyErrorMessage(parsedError));
  }

  console.log(`Sending consolidated notifications for ${courseIds.length} courses to ${userIds.length} users`);

  while (attemptCount < maxRetries) {
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../firebase/config');
      
      const triggerConsolidatedNotification = httpsCallable(functions, 'triggerConsolidatedCourseAssignmentNotification');
      
      const result = await triggerConsolidatedNotification({
        courseIds,
        userIds,
        adminId
      });

      // Success - log and return
      console.log('Consolidated course assignment notifications sent successfully:', {
        courseCount: courseIds.length,
        userCount: userIds.length,
        attemptCount: attemptCount + 1
      });

      return result.data as CourseAssignmentNotificationResponse;
    } catch (error) {
      attemptCount++;
      lastError = parseNotificationError(error);
      
      logNotificationError(lastError, { 
        courseIds, 
        userIds, 
        adminId,
        attemptCount,
        maxRetries
      });

      // Check if we should retry
      if (attemptCount >= maxRetries || !shouldRetry(lastError, attemptCount, maxRetries)) {
        break;
      }

      // Wait before retrying
      const delay = getRetryDelay(attemptCount);
      console.log(`Retrying consolidated notification in ${delay}ms... (attempt ${attemptCount + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All retries failed
  const errorMessage = `Failed to send consolidated course assignment notifications after ${maxRetries} attempts. ${getUserFriendlyErrorMessage(lastError)}`;
  throw new Error(errorMessage);
};
