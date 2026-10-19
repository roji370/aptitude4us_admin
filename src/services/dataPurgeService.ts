import {
  collection,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  limit as firestoreLimit,
  Timestamp,
  where
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase/config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingDeletion {
  userId: string;
  email: string;
  displayName: string;
  reason: string;
  latestLapseDate: Date;
  queuedAt: Date;
  scheduledDeletionDate: Date;
  status: 'pending' | 'in_progress' | 'failed' | 'permanently_failed';
  error?: string;
  failedAt?: Date;
}

export interface DeletionAuditLogEntry {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  reason: string;
  latestLapseDate: Date;
  queuedAt: Date;
  deletedAt: Date;
  deletionCounts: {
    userDoc: number;
    progress: number;
    tokens: number;
    fcmTokens: number;
    subscriptions: number;
    loginLogs: number;
    loginEvents: number;
    notifications: number;
    userTokens: number;
    userContentViews: number;
    contentViews: number;
    messages: number;
    chats: number;
    communityChat: number;
    pastQuestions: number;
    contentUpdates: number;
    typingStatus: number;
    notificationTracking: number;
    userProgress: number;
    authRecord: number;
    storageFiles: number;
  };
}

// ---------------------------------------------------------------------------
// Pending Deletions
// ---------------------------------------------------------------------------

/**
 * Get all users pending data deletion.
 */
export const getPendingDeletions = async (): Promise<PendingDeletion[]> => {
  try {
    const q = query(
      collection(db, 'pendingDeletions'),
      orderBy('queuedAt', 'desc')
    );
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        userId: doc.id,
        email: data.email || 'unknown',
        displayName: data.displayName || 'unknown',
        reason: data.reason || 'subscription_lapsed_30_days',
        latestLapseDate: data.latestLapseDate?.toDate() || new Date(),
        queuedAt: data.queuedAt?.toDate() || new Date(),
        scheduledDeletionDate: data.scheduledDeletionDate?.toDate() || new Date(),
        status: data.status || 'pending',
        error: data.error,
        failedAt: data.failedAt?.toDate(),
      } as PendingDeletion;
    });
  } catch (error) {
    console.error('Error fetching pending deletions:', error);
    throw error;
  }
};

/**
 * Get a specific user's pending deletion status.
 * Returns null if the user is not pending deletion.
 */
export const getUserPendingDeletion = async (userId: string): Promise<PendingDeletion | null> => {
  try {
    const docRef = doc(db, 'pendingDeletions', userId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) return null;
    
    const data = docSnap.data();
    return {
      userId: docSnap.id,
      email: data.email || 'unknown',
      displayName: data.displayName || 'unknown',
      reason: data.reason || 'subscription_lapsed_30_days',
      latestLapseDate: data.latestLapseDate?.toDate() || new Date(),
      queuedAt: data.queuedAt?.toDate() || new Date(),
      scheduledDeletionDate: data.scheduledDeletionDate?.toDate() || new Date(),
      status: data.status || 'pending',
      error: data.error,
      failedAt: data.failedAt?.toDate(),
    };
  } catch (error) {
    console.error('Error fetching user pending deletion:', error);
    return null;
  }
};

/**
 * Get the count of pending deletions (for dashboard widget).
 */
export const getPendingDeletionCount = async (): Promise<number> => {
  try {
    const q = query(
      collection(db, 'pendingDeletions'),
      where('status', '==', 'pending')
    );
    const snapshot = await getDocs(q);
    return snapshot.size;
  } catch (error) {
    console.error('Error fetching pending deletion count:', error);
    return 0;
  }
};

// ---------------------------------------------------------------------------
// Admin Actions
// ---------------------------------------------------------------------------

/**
 * Cancel a pending data deletion for a user.
 * Calls the Cloud Function which verifies admin permissions.
 */
export const cancelPendingDeletion = async (userId: string): Promise<{ success: boolean; message: string }> => {
  try {
    const cancelFn = httpsCallable(functions, 'cancelPendingDeletion');
    const result = await cancelFn({ userId });
    const data = result.data as { success: boolean; message: string };
    
    console.log(`Cancel pending deletion result for ${userId}:`, data);
    return data;
  } catch (error) {
    console.error('Error cancelling pending deletion:', error);
    throw error;
  }
};

/**
 * Exempt a user from auto-deletion (or remove exemption).
 * Calls the Cloud Function which verifies admin permissions.
 */
export const exemptUserFromDeletion = async (
  userId: string,
  exempt: boolean = true
): Promise<{ success: boolean; message: string }> => {
  try {
    const exemptFn = httpsCallable(functions, 'exemptUserFromDeletion');
    const result = await exemptFn({ userId, exempt });
    const data = result.data as { success: boolean; message: string };
    
    console.log(`Exempt user from deletion result for ${userId}:`, data);
    return data;
  } catch (error) {
    console.error('Error exempting user from deletion:', error);
    throw error;
  }
};

/**
 * Check if a user is exempt from auto-deletion.
 */
export const isUserExemptFromDeletion = async (userId: string): Promise<boolean> => {
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) return false;
    return userSnap.data().exemptFromDeletion === true;
  } catch (error) {
    console.error('Error checking user exemption:', error);
    return false;
  }
};

// ---------------------------------------------------------------------------
// Deletion Audit Log
// ---------------------------------------------------------------------------

/**
 * Get the deletion audit log (most recent entries first).
 */
export const getDeletionAuditLog = async (
  limitCount: number = 50
): Promise<DeletionAuditLogEntry[]> => {
  try {
    const q = query(
      collection(db, 'deletionAuditLog'),
      orderBy('deletedAt', 'desc'),
      firestoreLimit(limitCount)
    );
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId || 'unknown',
        email: data.email || 'unknown',
        displayName: data.displayName || 'unknown',
        reason: data.reason || 'unknown',
        latestLapseDate: data.latestLapseDate?.toDate() || new Date(),
        queuedAt: data.queuedAt?.toDate() || new Date(),
        deletedAt: data.deletedAt?.toDate() || new Date(),
        deletionCounts: data.deletionCounts || {},
      } as DeletionAuditLogEntry;
    });
  } catch (error) {
    console.error('Error fetching deletion audit log:', error);
    throw error;
  }
};

/**
 * Calculate how many days until a pending deletion is executed.
 * Returns 0 if already past the scheduled date.
 */
export const getDaysUntilDeletion = (pendingDeletion: PendingDeletion): number => {
  const now = new Date();
  const scheduledDate = pendingDeletion.scheduledDeletionDate;
  const diffMs = scheduledDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
};

/**
 * Calculate how many days since the subscription lapsed.
 */
export const getDaysSinceLapse = (pendingDeletion: PendingDeletion): number => {
  const now = new Date();
  const lapseDate = pendingDeletion.latestLapseDate;
  const diffMs = now.getTime() - lapseDate.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
};
