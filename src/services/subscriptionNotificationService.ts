import { getExpiringSubscriptions } from './subscriptionService';
import { getUserById } from './userService';
import { createSubscriptionExpiryNotification } from './notificationService';
import { updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { updateUserAssignedCourses } from './authService';

// Check for subscriptions that are expiring soon and send notifications
export const checkExpiringSubscriptions = async (): Promise<void> => {
  try {
    // Get subscriptions expiring in the next 7 days
    const expiringSubscriptions = await getExpiringSubscriptions(7);
    
    // For each subscription, check if notifications need to be sent
    for (const subscription of expiringSubscriptions) {
      const endDate = subscription.endDate instanceof Date
        ? subscription.endDate
        : subscription.endDate.toDate();
      
      const now = new Date();
      const daysUntilExpiry = Math.ceil(
        (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      // Get user information for notification
      const user = await getUserById(subscription.userId);
      const userName = user?.displayName || user?.email || 'User';
      
      // For admin notifications (3 days before expiry)
      if (daysUntilExpiry === 3 && !subscription.notificationsSent.adminPreExpiry) {
        await createSubscriptionExpiryNotification(
          subscription.id,
          subscription.userId,
          userName,
          daysUntilExpiry,
          endDate,
          'admin' // Send only to admin app
        );
        
        // Update the notification status
        await updateDoc(doc(db, 'subscriptions', subscription.id), {
          'notificationsSent.adminPreExpiry': true
        });
        
        console.log(`Admin notification sent for subscription ${subscription.id} (${userName})`);
      }
      
      // For student notifications (1 day before expiry)
      if (daysUntilExpiry === 1 && !subscription.notificationsSent.studentPreExpiry) {
        await createSubscriptionExpiryNotification(
          subscription.id,
          subscription.userId,
          userName,
          daysUntilExpiry,
          endDate,
          'student' // Send only to student app
        );
        
        // Update the notification status
        await updateDoc(doc(db, 'subscriptions', subscription.id), {
          'notificationsSent.studentPreExpiry': true
        });
        
        console.log(`Student notification sent for subscription ${subscription.id} (${userName})`);
      }
    }
    
    console.log('Completed checking expiring subscriptions');
  } catch (error) {
    console.error('Error checking expiring subscriptions:', error);
  }
};

// Mark expired subscriptions and revoke course access
export const markExpiredSubscriptions = async (): Promise<void> => {
  try {
    // Get subscriptions that have expired today (0 days remaining)
    const expiringSubscriptions = await getExpiringSubscriptions(0);
    
    const now = new Date();
    
    // Filter to get truly expired subscriptions
    const expiredSubscriptions = expiringSubscriptions.filter(sub => {
      const endDate = sub.endDate instanceof Date
        ? sub.endDate
        : sub.endDate.toDate();
      return endDate < now && sub.status === 'active';
    });
    
    // Mark each as expired and revoke course access
    for (const subscription of expiredSubscriptions) {
      // Mark subscription as expired
      await updateDoc(doc(db, 'subscriptions', subscription.id), {
        status: 'expired'
      });
      
      // CRITICAL: Remove all course assignments for this user
      // This ensures they lose access to all course content immediately
      try {
        await updateUserAssignedCourses(subscription.userId, []);
        console.log(`Revoked course access for user ${subscription.userId} due to expired subscription`);
      } catch (error) {
        console.error(`Failed to revoke course access for user ${subscription.userId}:`, error);
        // Continue processing other subscriptions even if one fails
      }
      
      console.log(`Marked subscription ${subscription.id} as expired`);
    }
    
    console.log(`Completed marking ${expiredSubscriptions.length} expired subscriptions and revoked course access`);
  } catch (error) {
    console.error('Error marking expired subscriptions:', error);
  }
};

// Manual trigger for subscription expiry notifications
export const manualTriggerSubscriptionNotifications = async (): Promise<{success: boolean; message: string; stats: any}> => {
  try {
    // Get subscriptions expiring in the next 7 days
    const expiringSubscriptions = await getExpiringSubscriptions(7);
    
    // Stats to return
    const stats = {
      processed: 0,
      notificationsSent: 0,
      studentsNotified: 0,
      adminsNotified: 0,
      expiringToday: 0,
      expiringTomorrow: 0,
      expiringIn3Days: 0
    };
    
    // For each subscription, check if notifications need to be sent
    for (const subscription of expiringSubscriptions) {
      stats.processed++;
      
      const endDate = subscription.endDate instanceof Date
        ? subscription.endDate
        : subscription.endDate.toDate();
      
      const now = new Date();
      const daysUntilExpiry = Math.ceil(
        (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      // Get user information for notification
      const user = await getUserById(subscription.userId);
      const userName = user?.displayName || user?.email || 'User';
      
      // Count subscriptions by days remaining
      if (daysUntilExpiry === 3) {
        stats.expiringIn3Days++;
      } else if (daysUntilExpiry === 1) {
        stats.expiringTomorrow++;
      } else if (daysUntilExpiry === 0) {
        stats.expiringToday++;
      }
      
      // Send admin notification 3 days before expiry (only if not already sent)
      if (daysUntilExpiry === 3 && !subscription.notificationsSent.adminPreExpiry) {
        await createSubscriptionExpiryNotification(
          subscription.id,
          subscription.userId,
          userName,
          daysUntilExpiry,
          endDate,
          'admin' // Send only to admin app
        );
        
        // Update the notification status
        await updateDoc(doc(db, 'subscriptions', subscription.id), {
          'notificationsSent.adminPreExpiry': true
        });
        
        stats.notificationsSent++;
        stats.adminsNotified++;
        console.log(`Admin notification sent for subscription ${subscription.id} (${userName}) - expires in 3 days`);
      }
      
      // Send notification to student 1 day before expiry (only if not already sent)
      if (daysUntilExpiry === 1 && !subscription.notificationsSent.studentPreExpiry) {
        await createSubscriptionExpiryNotification(
          subscription.id,
          subscription.userId,
          userName,
          daysUntilExpiry,
          endDate,
          'student' // Send only to student app to prevent duplicates
        );
        
        // Update the notification status
        await updateDoc(doc(db, 'subscriptions', subscription.id), {
          'notificationsSent.studentPreExpiry': true
        });
        
        stats.notificationsSent++;
        stats.studentsNotified++;
        console.log(`Student notification sent for subscription ${subscription.id} (${userName})`);
      }
    }
    
    // Also mark expired subscriptions
    const expiredCount = await markExpiredSubscriptionsAndReturnCount();
    
    return {
      success: true,
      message: `Successfully processed ${stats.processed} subscriptions and sent ${stats.notificationsSent} notifications.`,
      stats: {
        ...stats,
        expiredCount
      }
    };
  } catch (error) {
    console.error('Error in manual trigger:', error);
    return {
      success: false,
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      stats: {}
    };
  }
};

// Mark expired subscriptions, revoke course access, and return count
export const markExpiredSubscriptionsAndReturnCount = async (): Promise<number> => {
  try {
    // Get subscriptions that have expired today (0 days remaining)
    const expiringSubscriptions = await getExpiringSubscriptions(0);
    
    const now = new Date();
    
    // Filter to get truly expired subscriptions
    const expiredSubscriptions = expiringSubscriptions.filter(sub => {
      const endDate = sub.endDate instanceof Date
        ? sub.endDate
        : sub.endDate.toDate();
      return endDate < now && sub.status === 'active';
    });
    
    // Mark each as expired and revoke course access
    for (const subscription of expiredSubscriptions) {
      // Mark subscription as expired
      await updateDoc(doc(db, 'subscriptions', subscription.id), {
        status: 'expired'
      });
      
      // CRITICAL: Remove all course assignments for this user
      // This ensures they lose access to all course content immediately
      try {
        await updateUserAssignedCourses(subscription.userId, []);
        console.log(`Revoked course access for user ${subscription.userId} due to expired subscription`);
      } catch (error) {
        console.error(`Failed to revoke course access for user ${subscription.userId}:`, error);
        // Continue processing other subscriptions even if one fails
      }
      
      console.log(`Marked subscription ${subscription.id} as expired`);
    }
    
    console.log(`Completed marking ${expiredSubscriptions.length} expired subscriptions and revoked course access`);
    return expiredSubscriptions.length;
  } catch (error) {
    console.error('Error marking expired subscriptions:', error);
    return 0;
  }
}; 