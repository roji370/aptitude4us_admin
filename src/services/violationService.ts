import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
  serverTimestamp,
  writeBatch,
  deleteField,
  onSnapshot,
  QuerySnapshot,
  DocumentData
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { 
  ScreenshotViolation, 
  ViolationReset, 
  ViolationResetRequest, 
  ViolationSummary,
  ViolationStatus
} from '../types/violations';
import { getUserById } from './userService';

// Collection reference
const VIOLATIONS_COLLECTION = 'screenshotViolations';

/**
 * Get all screenshot violations for admin dashboard
 */
export const getAllViolations = async (): Promise<ViolationSummary[]> => {
  try {
    const q = query(
      collection(db, VIOLATIONS_COLLECTION),
      orderBy('updatedAt', 'desc')
    );

    const querySnapshot = await getDocs(q);
    const violations: ViolationSummary[] = [];

    for (const docSnapshot of querySnapshot.docs) {
      const data = docSnapshot.data() as ScreenshotViolation;
      
      // Get user info if not cached
      if (!data.userEmail) {
        try {
          const userInfo = await getUserById(data.userId);
          data.userEmail = userInfo?.email || 'Unknown';
          if (userInfo?.displayName) {
            data.userName = userInfo.displayName;
          }
        } catch (error) {
          console.error(`Error fetching user ${data.userId}:`, error);
          data.userEmail = 'Unknown';
        }
      }

      const status: ViolationStatus = data.violations.isBlocked 
        ? 'BLOCKED' 
        : data.violations.count > 0 
          ? 'WARNING' 
          : 'NONE';

      const violationSummary = {
        userId: data.userId,
        userEmail: data.userEmail || 'Unknown',
        userName: data.userName,
        count: data.violations.count,
        status,
        firstWarning: data.violations.firstWarning instanceof Date 
          ? data.violations.firstWarning 
          : data.violations.firstWarning?.toDate(),
        blockedAt: data.violations.blockedAt instanceof Date 
          ? data.violations.blockedAt 
          : data.violations.blockedAt?.toDate(),
        lastReset: data.violations.lastReset instanceof Date 
          ? data.violations.lastReset 
          : data.violations.lastReset?.toDate(),
      };
      
      violations.push(violationSummary);
    }

    return violations;
  } catch (error) {
    console.error('Error fetching violations:', error);
    throw error;
  }
};

/**
 * Get screenshot violations for a specific user
 */
export const getUserViolations = async (userId: string): Promise<ScreenshotViolation | null> => {
  try {
    const q = query(
      collection(db, VIOLATIONS_COLLECTION),
      where('userId', '==', userId)
    );

    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      return null;
    }

    const docSnapshot = querySnapshot.docs[0];
    const data = docSnapshot.data() as ScreenshotViolation;
    
    return {
      id: docSnapshot.id,
      ...data,
      violations: {
        ...data.violations,
        firstWarning: data.violations.firstWarning instanceof Date 
          ? data.violations.firstWarning 
          : data.violations.firstWarning?.toDate(),
        blockedAt: data.violations.blockedAt instanceof Date 
          ? data.violations.blockedAt 
          : data.violations.blockedAt?.toDate(),
        lastReset: data.violations.lastReset instanceof Date 
          ? data.violations.lastReset 
          : data.violations.lastReset?.toDate(),
        resetHistory: data.violations.resetHistory.map(reset => ({
          ...reset,
          resetAt: reset.resetAt instanceof Date 
            ? reset.resetAt 
            : reset.resetAt.toDate()
        }))
      }
    };
  } catch (error) {
    console.error('Error fetching user violations:', error);
    throw error;
  }
};

/**
 * Create or update a screenshot violation
 */
export const recordViolation = async (userId: string, isSecondViolation: boolean = false): Promise<void> => {
  try {
    const existingViolation = await getUserViolations(userId);
    const now = new Date();

    if (existingViolation && existingViolation.id) {
      // Update existing violation
      const newCount = existingViolation.violations.count + 1;
      
      // Handle case where user was reset (firstWarning was deleted)
      const needsFirstWarning = !existingViolation.violations.firstWarning;
      
      // serverTimestamp() returns a FieldValue sentinel, which Firestore replaces server-side.
      // Cast through `any` to satisfy the strict Date | Timestamp typing on ScreenshotViolation.
      const updateData: Partial<ScreenshotViolation> = {
        violations: {
          ...existingViolation.violations,
          count: newCount,
          isBlocked: newCount >= 2,
          // Set firstWarning if it doesn't exist (user was reset)
          firstWarning: needsFirstWarning ? Timestamp.fromDate(now) : existingViolation.violations.firstWarning,
          blockedAt: newCount >= 2 && !existingViolation.violations.blockedAt 
            ? Timestamp.fromDate(now) 
            : existingViolation.violations.blockedAt
        },
        updatedAt: serverTimestamp() as any
      };

      console.log('🔄 Updating violation record:', { newCount, needsFirstWarning, userId });
      await updateDoc(doc(db, VIOLATIONS_COLLECTION, existingViolation.id), updateData);
    } else {
      // Create new violation record
      const userInfo = await getUserById(userId);
      
      const violationData: Omit<ScreenshotViolation, 'id'> = {
        userId,
        userEmail: userInfo?.email || 'Unknown',
        ...(userInfo?.displayName && { userName: userInfo.displayName }),
        violations: {
          count: 1,
          isBlocked: isSecondViolation,
          firstWarning: Timestamp.fromDate(now),
          ...(isSecondViolation && { blockedAt: Timestamp.fromDate(now) }),
          resetHistory: []
        },
        createdAt: serverTimestamp() as any,
        updatedAt: serverTimestamp() as any
      };

      await addDoc(collection(db, VIOLATIONS_COLLECTION), violationData);
    }
  } catch (error) {
    console.error('Error recording violation:', error);
    throw error;
  }
};

/**
 * Reset screenshot violations for a user
 */
export const resetUserViolations = async (
  userId: string, 
  resetRequest: ViolationResetRequest,
  adminUserId: string
): Promise<void> => {
  try {
    const violation = await getUserViolations(userId);
    
    if (!violation || !violation.id) {
      throw new Error('No violations found for this user');
    }

    // Get admin info
    const adminInfo = await getUserById(adminUserId);
    
    const resetEntry: ViolationReset = {
      resetAt: Timestamp.fromDate(new Date()),
      resetBy: adminUserId,
      resetByEmail: adminInfo?.email || 'Unknown Admin',
      reason: resetRequest.reason || 'support_request', // Default reason
      ...(resetRequest.notes && { notes: resetRequest.notes }) // Only include notes if defined
    };

    const updateData: any = {
      'violations.count': 0,
      'violations.isBlocked': false,
      'violations.lastReset': resetEntry.resetAt,
      'violations.resetHistory': [...violation.violations.resetHistory, resetEntry],
      'violations.resetAcknowledged': deleteField(), // Clear any previous acknowledgment
      updatedAt: serverTimestamp()
    };

    // Only delete fields if they exist
    if (violation.violations.firstWarning) {
      updateData['violations.firstWarning'] = deleteField();
    }
    if (violation.violations.blockedAt) {
      updateData['violations.blockedAt'] = deleteField();
    }

    console.log('🔄 Resetting violations for user:', { 
      userId, 
      adminId: adminUserId,
      currentCount: violation.violations.count,
      hasFirstWarning: !!violation.violations.firstWarning,
      hasBlockedAt: !!violation.violations.blockedAt
    });

    await updateDoc(doc(db, VIOLATIONS_COLLECTION, violation.id), updateData);
  } catch (error) {
    console.error('Error resetting violations:', error);
    throw error;
  }
};

/**
 * Check if user has been reset recently (for student app)
 */
export const checkResetStatus = async (userId: string): Promise<{ hasBeenReset: boolean; resetAt?: Date }> => {
  try {
    const violation = await getUserViolations(userId);
    
    if (!violation) {
      return { hasBeenReset: false };
    }

    const lastReset = violation.violations.lastReset;
    // Normalize Firestore Timestamp -> Date for the public API.
    const resetAt = lastReset
      ? (lastReset instanceof Timestamp ? lastReset.toDate() : lastReset)
      : undefined;

    return {
      hasBeenReset: !!lastReset && violation.violations.count === 0,
      resetAt
    };
  } catch (error) {
    console.error('Error checking reset status:', error);
    return { hasBeenReset: false };
  }
};

/**
 * Get violation statistics
 */
export const getViolationStats = async () => {
  try {
    const violations = await getAllViolations();
    
    const stats = {
      total: violations.length,
      warnings: violations.filter(v => v.status === 'WARNING').length,
      blocked: violations.filter(v => v.status === 'BLOCKED').length,
      recentResets: violations.filter(v => {
        if (!v.lastReset) return false;
        const daysSinceReset = (Date.now() - v.lastReset.getTime()) / (1000 * 60 * 60 * 24);
        return daysSinceReset <= 7;
      }).length
    };

    return stats;
  } catch (error) {
    console.error('Error getting violation stats:', error);
    throw error;
  }
};

/**
 * Bulk reset violations for multiple users
 */
export const bulkResetViolations = async (
  userIds: string[],
  resetRequest: ViolationResetRequest,
  adminUserId: string
): Promise<{ successful: number; failed: number }> => {
  let successful = 0;
  let failed = 0;

  for (const userId of userIds) {
    try {
      await resetUserViolations(userId, resetRequest, adminUserId);
      successful++;
    } catch (error) {
      console.error(`Failed to reset violations for user ${userId}:`, error);
      failed++;
    }
  }

  return { successful, failed };
};

/**
 * Delete violation record (admin only, for cleanup)
 */
export const deleteViolationRecord = async (violationId: string): Promise<void> => {
  try {
    await deleteDoc(doc(db, VIOLATIONS_COLLECTION, violationId));
  } catch (error) {
    console.error('Error deleting violation record:', error);
    throw error;
  }
};

/**
 * Listen to violations in real-time for admin dashboard
 */
export const listenToViolations = (
  onViolations: (violations: ViolationSummary[]) => void,
  onError: (error: Error) => void
): (() => void) => {
  try {
    const q = query(
      collection(db, VIOLATIONS_COLLECTION),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      async (snapshot: QuerySnapshot<DocumentData>) => {
        console.log('🔄 Real-time violations update received:', snapshot.size, 'documents');
        
        const violations: ViolationSummary[] = [];

        for (const docSnapshot of snapshot.docs) {
          const data = docSnapshot.data() as ScreenshotViolation;
          
          // Get user info if not cached
          if (!data.userEmail) {
            try {
              const userInfo = await getUserById(data.userId);
              data.userEmail = userInfo?.email || 'Unknown';
              if (userInfo?.displayName) {
                data.userName = userInfo.displayName;
              }
            } catch (error) {
              console.error(`Error fetching user ${data.userId}:`, error);
              data.userEmail = 'Unknown';
            }
          }

          const status: ViolationStatus = data.violations.isBlocked 
            ? 'BLOCKED' 
            : data.violations.count > 0 
              ? 'WARNING' 
              : 'NONE';

          const violationSummary = {
            userId: data.userId,
            userEmail: data.userEmail || 'Unknown',
            userName: data.userName,
            count: data.violations.count,
            status,
            firstWarning: data.violations.firstWarning instanceof Date 
              ? data.violations.firstWarning 
              : data.violations.firstWarning?.toDate(),
            blockedAt: data.violations.blockedAt instanceof Date 
              ? data.violations.blockedAt 
              : data.violations.blockedAt?.toDate(),
            lastReset: data.violations.lastReset instanceof Date 
              ? data.violations.lastReset 
              : data.violations.lastReset?.toDate(),
          };
          
          violations.push(violationSummary);
        }

        console.log('📊 Processed violations for dashboard:', violations.length);
        onViolations(violations);
      },
      (error) => {
        console.error('❌ Real-time violations listener error:', error);
        onError(error);
      }
    );

    return unsubscribe;
  } catch (error) {
    console.error('Error setting up violations listener:', error);
    onError(error as Error);
    return () => {}; // Return empty cleanup function
  }
};
