import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  Timestamp,
  limit as firestoreLimit,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase/config';
import { Subscription, SubscriptionPlan } from '../types/subscription';
import { updateUserAssignedCourses } from './authService';

// ---------------------------------------------------------------------------
// Effective-end-date helpers
//
// `effectiveEndDate` is the authoritative end of access. It equals `examDate`
// (normalized to end-of-day so a same-day exam date does not silently shorten
// access by hours) when an exam date is set and falls before the regular
// `endDate`; otherwise it equals `endDate`.
//
// All access checks (admin and student) and the Cloud Functions cron use this
// field. Whenever `endDate` or `examDate` changes, this denormalized field
// MUST be recomputed and written in the same update.
// ---------------------------------------------------------------------------

/** Return a new Date set to 23:59:59.999 of the given date in local time. */
const endOfDay = (d: Date): Date => {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
};

/**
 * Compute the effective end date given a regular endDate and optional examDate.
 * If examDate (end-of-day) is strictly before endDate, that wins; otherwise endDate.
 */
export const computeEffectiveEndDate = (
  endDate: Date,
  examDate: Date | null | undefined
): Date => {
  if (!examDate) return endDate;
  const examEod = endOfDay(examDate);
  return examEod < endDate ? examEod : endDate;
};

/**
 * Pull the effective end date out of a Subscription. Prefers the denormalized
 * `effectiveEndDate` field; falls back to recomputing from endDate/examDate
 * for legacy documents that have not been backfilled yet.
 */
export const getEffectiveEndDate = (sub: Subscription): Date => {
  const toDate = (v: any): Date =>
    v instanceof Date ? v : (v?.toDate?.() ?? new Date());
  if (sub.effectiveEndDate) return toDate(sub.effectiveEndDate);
  const endDate = toDate(sub.endDate);
  const examDate = sub.examDate ? toDate(sub.examDate) : null;
  return computeEffectiveEndDate(endDate, examDate);
};

// Get all subscriptions
export const getAllSubscriptions = async (): Promise<Subscription[]> => {
  try {
    const q = query(
      collection(db, 'subscriptions'),
      orderBy('endDate', 'asc')
    );

    const querySnapshot = await getDocs(q);
    const subscriptions: Subscription[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      subscriptions.push({
        id: doc.id,
        ...data,
        startDate: data.startDate?.toDate() || new Date(),
        endDate: data.endDate?.toDate() || new Date(),
        examDate: data.examDate?.toDate() || null,
        effectiveEndDate: data.effectiveEndDate?.toDate() || undefined,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date()
      } as Subscription);
    });

    return subscriptions;
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    throw error;
  }
};

// Get active subscriptions
export const getActiveSubscriptions = async (): Promise<Subscription[]> => {
  try {
    const q = query(
      collection(db, 'subscriptions'),
      where('status', '==', 'active'),
      orderBy('endDate', 'asc')
    );

    const querySnapshot = await getDocs(q);
    const subscriptions: Subscription[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      subscriptions.push({
        id: doc.id,
        ...data,
        startDate: data.startDate?.toDate() || new Date(),
        endDate: data.endDate?.toDate() || new Date(),
        examDate: data.examDate?.toDate() || null,
        effectiveEndDate: data.effectiveEndDate?.toDate() || undefined,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date()
      } as Subscription);
    });

    return subscriptions;
  } catch (error) {
    console.error('Error fetching active subscriptions:', error);
    throw error;
  }
};

// Get expiring subscriptions (within the next X days)
export const getExpiringSubscriptions = async (daysThreshold = 7): Promise<Subscription[]> => {
  try {
    const now = new Date();
    const thresholdDate = new Date();
    thresholdDate.setDate(now.getDate() + daysThreshold);
    
    // Query against the denormalized effectiveEndDate so that exam-date-shortened
    // subscriptions are included. Documents that pre-date the backfill (no
    // effectiveEndDate field) will be skipped here; run the backfill script.
    const q = query(
      collection(db, 'subscriptions'),
      where('status', '==', 'active'),
      where('effectiveEndDate', '<=', Timestamp.fromDate(thresholdDate)),
      where('effectiveEndDate', '>=', Timestamp.fromDate(now)),
      orderBy('effectiveEndDate', 'asc')
    );

    const querySnapshot = await getDocs(q);
    const subscriptions: Subscription[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      subscriptions.push({
        id: doc.id,
        ...data,
        startDate: data.startDate?.toDate() || new Date(),
        endDate: data.endDate?.toDate() || new Date(),
        examDate: data.examDate?.toDate() || null,
        effectiveEndDate: data.effectiveEndDate?.toDate() || undefined,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date()
      } as Subscription);
    });

    return subscriptions;
  } catch (error) {
    console.error('Error fetching expiring subscriptions:', error);
    throw error;
  }
};

// Get user subscriptions
export const getUserSubscriptions = async (userId: string): Promise<Subscription[]> => {
  try {
    const q = query(
      collection(db, 'subscriptions'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );

    const querySnapshot = await getDocs(q);
    const subscriptions: Subscription[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      subscriptions.push({
        id: doc.id,
        ...data,
        startDate: data.startDate?.toDate() || new Date(),
        endDate: data.endDate?.toDate() || new Date(),
        examDate: data.examDate?.toDate() || null,
        effectiveEndDate: data.effectiveEndDate?.toDate() || undefined,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date()
      } as Subscription);
    });

    return subscriptions;
  } catch (error) {
    console.error('Error fetching user subscriptions:', error);
    throw error;
  }
};

// Create a subscription
export const createSubscription = async (
  userId: string,
  planId: string,
  planName: string,
  duration: number,
  price: number,
  isDurationInDays: boolean = false,
  examDate?: Date | null
): Promise<Subscription> => {
  try {
    const startDate = new Date();
    const endDate = new Date();
    
    if (isDurationInDays) {
      endDate.setDate(endDate.getDate() + duration);
    } else {
      endDate.setMonth(endDate.getMonth() + duration);
    }

    const effectiveEndDate = computeEffectiveEndDate(endDate, examDate ?? null);

    const subscriptionData: any = {
      userId: userId || '',
      planId: planId || '',
      planName: planName || 'Basic Subscription',
      startDate: Timestamp.fromDate(startDate),
      endDate: Timestamp.fromDate(endDate),
      effectiveEndDate: Timestamp.fromDate(effectiveEndDate),
      status: 'active',
      notificationsSent: {
        studentPreExpiry: false,
        adminPreExpiry: false
      },
      price: price || 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    // Add exam date if provided
    if (examDate) {
      subscriptionData.examDate = Timestamp.fromDate(examDate);
    }

    // Create a subscriptions collection if it doesn't exist
    const subscriptionsRef = collection(db, 'subscriptions');
    const docRef = await addDoc(subscriptionsRef, subscriptionData);

    // Cancel any pending data deletion for this user (they re-subscribed)
    try {
      const pendingRef = doc(db, 'pendingDeletions', userId);
      const pendingSnap = await getDoc(pendingRef);
      if (pendingSnap.exists()) {
        await deleteDoc(pendingRef);
        console.log(`Cancelled pending data deletion for re-subscribing user ${userId}`);
      }
      // Clear cancellation timestamp so future lapses can be tracked fresh
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        lastDeletionCancelledAt: null,
        deletionCancelledBy: null,
      });
    } catch (pendingError) {
      console.warn(`Failed to check/cancel pending deletion for ${userId} (non-fatal):`, pendingError);
    }
    
    return {
      id: docRef.id,
      ...subscriptionData,
      startDate,
      endDate,
      examDate: examDate || null,
      effectiveEndDate,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'active' as const
    };
  } catch (error) {
    console.error('Error creating subscription:', error);
    // Return a placeholder subscription with error flag instead of throwing
    return {
      id: 'error',
      userId: userId,
      planId: planId,
      planName: planName,
      startDate: new Date(),
      endDate: new Date(),
      examDate: null,
      status: 'error' as any,
      notificationsSent: {
        studentPreExpiry: false,
        adminPreExpiry: false
      },
      price: price,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
};

// Get subscription by ID
export const getSubscriptionById = async (id: string): Promise<Subscription | null> => {
  try {
    const docRef = doc(db, 'subscriptions', id);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        startDate: data.startDate?.toDate() || new Date(),
        endDate: data.endDate?.toDate() || new Date(),
        examDate: data.examDate?.toDate() || null,
        effectiveEndDate: data.effectiveEndDate?.toDate() || undefined,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date()
      } as Subscription;
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching subscription:', error);
    throw error;
  }
};

// Renew a subscription
export const renewSubscription = async (
  id: string, 
  duration: number, 
  isInDays: boolean = false
): Promise<void> => {
  try {
    const subscription = await getSubscriptionById(id);
    if (!subscription) {
      throw new Error('Subscription not found');
    }
    
    // Calculate new end date based on the old one or current date if expired
    const now = new Date();
    const baseDate = subscription.status === 'expired' || 
                    (subscription.endDate as Date) < now 
                    ? now 
                    : subscription.endDate as Date;
    
    const newEndDate = new Date(baseDate);
    
    if (isInDays) {
      // Add days to the date
      newEndDate.setDate(newEndDate.getDate() + duration);
    } else {
      // Add months to the date (original behavior)
      newEndDate.setMonth(newEndDate.getMonth() + duration);
    }

    await updateDoc(doc(db, 'subscriptions', id), {
      endDate: Timestamp.fromDate(newEndDate),
      // Exam date is cleared on renewal, so effectiveEndDate == newEndDate.
      effectiveEndDate: Timestamp.fromDate(newEndDate),
      status: 'active',
      examDate: null, // Clear exam date on renewal since it's a new period
      cancelledAt: null, // Clear cancellation timestamp on renewal
      'notificationsSent.studentPreExpiry': false,
      'notificationsSent.adminPreExpiry': false,
      updatedAt: serverTimestamp()
    });

    // Cancel any pending data deletion for this user (they re-subscribed)
    if (subscription?.userId) {
      try {
        const pendingRef = doc(db, 'pendingDeletions', subscription.userId);
        const pendingSnap = await getDoc(pendingRef);
        if (pendingSnap.exists()) {
          await deleteDoc(pendingRef);
          console.log(`Cancelled pending data deletion for re-subscribing user ${subscription.userId}`);
        }
        // Clear cancellation timestamp so future lapses can be tracked fresh
        const userRef = doc(db, 'users', subscription.userId);
        await updateDoc(userRef, {
          lastDeletionCancelledAt: null,
          deletionCancelledBy: null,
        });
      } catch (pendingError) {
        console.warn(`Failed to cancel pending deletion on renewal (non-fatal):`, pendingError);
      }
    }
  } catch (error) {
    console.error('Error renewing subscription:', error);
    throw error;
  }
};

// Update exam date on a subscription (set or remove)
export const updateSubscriptionExamDate = async (
  id: string,
  examDate: Date | null
): Promise<void> => {
  try {
    // We must recompute effectiveEndDate from the persisted endDate so that
    // access checks and the cron stay correct.
    const subscription = await getSubscriptionById(id);
    if (!subscription) {
      throw new Error('Subscription not found');
    }
    const endDate = subscription.endDate instanceof Date
      ? subscription.endDate
      : (subscription.endDate as Timestamp).toDate();
    const effectiveEndDate = computeEffectiveEndDate(endDate, examDate);

    const updateData: any = {
      updatedAt: serverTimestamp(),
      effectiveEndDate: Timestamp.fromDate(effectiveEndDate),
      // If shortening (or extending back to endDate), reset pre-expiry flags
      // so notifications can fire against the new effective date.
      'notificationsSent.studentPreExpiry': false,
      'notificationsSent.adminPreExpiry': false
    };

    if (examDate) {
      updateData.examDate = Timestamp.fromDate(examDate);
    } else {
      // Remove exam date by setting to null
      updateData.examDate = null;
    }

    await updateDoc(doc(db, 'subscriptions', id), updateData);
    console.log(`Subscription ${id} exam date updated to: ${examDate ? examDate.toISOString() : 'removed'} (effective end: ${effectiveEndDate.toISOString()})`);
  } catch (error) {
    console.error('Error updating subscription exam date:', error);
    throw error;
  }
};

// Cancel a subscription
export const cancelSubscription = async (id: string): Promise<void> => {
  try {
    // Fetch the subscription to get the userId for course revocation
    const subscription = await getSubscriptionById(id);

    const now = new Date();
    await updateDoc(doc(db, 'subscriptions', id), {
      status: 'cancelled',
      // Shorten effectiveEndDate to now so the student app's local-validity
      // fast path immediately invalidates on next app resume.
      effectiveEndDate: Timestamp.fromDate(now),
      // Record exact cancellation time for the 30-day purge countdown
      cancelledAt: Timestamp.fromDate(now),
      updatedAt: serverTimestamp()
    });

    // Revoke course access (consistent with bulkCancelSubscriptions)
    if (subscription?.userId) {
      try {
        await updateUserAssignedCourses(subscription.userId, []);
        console.log(`Revoked course access for user ${subscription.userId} due to cancelled subscription ${id}`);
      } catch (revokeError) {
        console.warn(`Failed to revoke course access for user ${subscription.userId}:`, revokeError);
      }
    }
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    throw error;
  }
};

// Bulk cancel subscriptions - OPTIMIZED VERSION
export const bulkCancelSubscriptions = async (
  subscriptionIds: string[]
): Promise<{
  successCount: number;
  failCount: number;
  failedSubscriptions: Array<{ subscriptionId: string; reason: string }>;
}> => {
  try {
    let successCount = 0;
    let failCount = 0;
    const failedSubscriptions: Array<{ subscriptionId: string; reason: string }> = [];

    console.log(`Starting optimized bulk cancellation of ${subscriptionIds.length} subscriptions`);

    // Step 1: Batch fetch all subscription documents
    console.log('Fetching subscription documents...');
    const subscriptionDocs = new Map();
    const subFetchPromises = subscriptionIds.map(async (subscriptionId) => {
      try {
        const subDoc = await getDoc(doc(db, 'subscriptions', subscriptionId));
        if (subDoc.exists()) {
          subscriptionDocs.set(subscriptionId, subDoc.data());
        }
      } catch (error) {
        console.warn(`Failed to fetch subscription ${subscriptionId}:`, error);
      }
    });
    
    await Promise.all(subFetchPromises);
    console.log(`Fetched ${subscriptionDocs.size} subscription documents out of ${subscriptionIds.length}`);

    // Step 2: Prepare batch updates
    const batch = writeBatch(db);
    const validCancellations: Array<{ subscriptionId: string; userId: string }> = [];

    for (const subscriptionId of subscriptionIds) {
      try {
        // Check if subscription exists
        if (!subscriptionDocs.has(subscriptionId)) {
          failCount++;
          failedSubscriptions.push({
            subscriptionId,
            reason: 'Subscription not found'
          });
          continue;
        }

        const subscriptionData = subscriptionDocs.get(subscriptionId);
        
        // Check if already cancelled
        if (subscriptionData.status === 'cancelled') {
          successCount++; // Count as success since desired state is achieved
          console.log(`Subscription ${subscriptionId} already cancelled`);
          continue;
        }

        // Check if subscription is active or expired (we can cancel both)
        if (!['active', 'expired'].includes(subscriptionData.status)) {
          failCount++;
          failedSubscriptions.push({
            subscriptionId,
            reason: `Cannot cancel subscription with status: ${subscriptionData.status}`
          });
          continue;
        }

        // Prepare batch update
        const subscriptionRef = doc(db, 'subscriptions', subscriptionId);
        batch.update(subscriptionRef, {
          status: 'cancelled',
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        validCancellations.push({
          subscriptionId,
          userId: subscriptionData.userId
        });

      } catch (error) {
        failCount++;
        failedSubscriptions.push({
          subscriptionId,
          reason: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Step 3: Execute batch update
    if (validCancellations.length > 0) {
      console.log(`Executing batch cancellation for ${validCancellations.length} subscriptions...`);
      await batch.commit();
      successCount += validCancellations.length;
      console.log(`Batch cancellation completed for ${validCancellations.length} subscriptions`);

      // Step 4: Revoke course access for cancelled subscriptions (in parallel)
      console.log('Revoking course access for cancelled subscriptions...');
      const courseRevocationPromises = validCancellations.map(async ({ subscriptionId, userId }) => {
        try {
          // Remove all course assignments when subscription is cancelled
          await updateUserAssignedCourses(userId, []);
          console.log(`Revoked course access for user ${userId} due to cancelled subscription ${subscriptionId}`);
        } catch (error) {
          console.warn(`Failed to revoke course access for user ${userId}:`, error);
        }
      });
      
      // Don't wait for course revocations - they can complete in background
      Promise.all(courseRevocationPromises).then(() => {
        console.log('Course access revocations completed');
      }).catch((error) => {
        console.warn('Some course access revocations failed:', error);
      });
    }

    console.log(`Optimized bulk cancellation completed: ${successCount} successful, ${failCount} failed`);
    
    return {
      successCount,
      failCount,
      failedSubscriptions
    };
    
  } catch (error) {
    console.error('Error in optimized bulk subscription cancellation:', error);
    throw error;
  }
};

// Get all subscription plans
export const getSubscriptionPlans = async (): Promise<SubscriptionPlan[]> => {
  try {
    // Remove the filter for active plans to get all plans
    const q = query(
      collection(db, 'subscriptionPlans'),
      orderBy('price', 'asc')
    );

    const querySnapshot = await getDocs(q);
    const plans: SubscriptionPlan[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      plans.push({
        id: doc.id,
        name: data.name || 'Unnamed Plan',
        description: data.description || 'No description',
        durationInDays: data.durationInDays !== undefined ? data.durationInDays : null,
        durationMonths: data.durationMonths !== undefined ? data.durationMonths : 1,
        price: data.price || 0,
        isActive: data.isActive !== undefined ? data.isActive : true,
        features: Array.isArray(data.features) ? data.features : []
      } as SubscriptionPlan);
    });

    return plans;
  } catch (error) {
    console.error('Error fetching subscription plans:', error);
    return []; // Return empty array instead of throwing error
  }
};

// Create a subscription plan
export const createSubscriptionPlan = async (
  name: string,
  description: string,
  duration: number,
  price: number,
  features: string[],
  isDurationInDays: boolean = false
): Promise<SubscriptionPlan> => {
  try {
    const planData: any = {
      name,
      description,
      price,
      isActive: true,
      features
    };
    
    if (isDurationInDays) {
      planData.durationInDays = duration;
      planData.durationMonths = null;
    } else {
      planData.durationMonths = duration;
      planData.durationInDays = null;
    }

    const docRef = await addDoc(collection(db, 'subscriptionPlans'), planData);
    
    return {
      id: docRef.id,
      ...planData
    };
  } catch (error) {
    console.error('Error creating subscription plan:', error);
    throw error;
  }
};

// Update a subscription plan
export const updateSubscriptionPlan = async (
  id: string,
  name: string,
  description: string,
  duration: number,
  price: number,
  features: string[],
  isActive: boolean,
  isDurationInDays: boolean = false
): Promise<void> => {
  try {
    const planRef = doc(db, 'subscriptionPlans', id);
    
    const updateData: any = {
      name,
      description,
      price,
      isActive,
      features
    };
    
    if (isDurationInDays) {
      updateData.durationInDays = duration;
      updateData.durationMonths = null;
    } else {
      updateData.durationMonths = duration;
      updateData.durationInDays = null;
    }
    
    await updateDoc(planRef, updateData);
  } catch (error) {
    console.error('Error updating subscription plan:', error);
    throw error;
  }
};

// Delete a subscription plan
export const deleteSubscriptionPlan = async (id: string): Promise<void> => {
  try {
    const planRef = doc(db, 'subscriptionPlans', id);
    await deleteDoc(planRef);
  } catch (error) {
    console.error('Error deleting subscription plan:', error);
    throw error;
  }
};

// Extend a subscription by days
export const extendSubscription = async (
  id: string, 
  days: number
): Promise<void> => {
  try {
    const subscription = await getSubscriptionById(id);
    if (!subscription) {
      throw new Error('Subscription not found');
    }
    
    // Get the current end date
    const currentEndDate = subscription.endDate instanceof Date 
      ? new Date(subscription.endDate) 
      : subscription.endDate.toDate();
    
    // Calculate new end date by adding days
    const newEndDate = new Date(currentEndDate);
    newEndDate.setDate(newEndDate.getDate() + days);
    
    // If subscription was expired, set it back to active
    const status = subscription.status === 'expired' ? 'active' : subscription.status;

    // Recompute effective end against any existing exam date
    const examDate = subscription.examDate
      ? (subscription.examDate instanceof Date
          ? subscription.examDate
          : (subscription.examDate as Timestamp)?.toDate?.() ?? null)
      : null;
    const effectiveEndDate = computeEffectiveEndDate(newEndDate, examDate);

    // Update the subscription in Firestore
    await updateDoc(doc(db, 'subscriptions', id), {
      endDate: Timestamp.fromDate(newEndDate),
      effectiveEndDate: Timestamp.fromDate(effectiveEndDate),
      status: status,
      updatedAt: serverTimestamp()
    });
    
    console.log(`Subscription ${id} extended by ${days} days. New end date: ${newEndDate.toISOString()}`);
  } catch (error) {
    console.error('Error extending subscription:', error);
    throw error;
  }
}; 