const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { onSchedule } = require("firebase-functions/v2/scheduler");

// Import data purge functions for 30-day auto-deletion
const dataPurge = require('./dataPurge');

// Check for subscriptions that are expiring soon and send notifications
exports.checkExpiringSubscriptions = async () => {
  try {
    // Get subscriptions expiring in the next 7 days
    const now = new Date();
    const sevenDaysLater = new Date(now);
    sevenDaysLater.setDate(now.getDate() + 7);
    
    console.log(`Checking for subscriptions expiring between ${now.toISOString()} and ${sevenDaysLater.toISOString()}`);
    
    // Query against the denormalized `effectiveEndDate` so that exam-date-
    // shortened subscriptions are picked up. The admin app's
    // subscriptionService writes this field on every create/update/renew/extend
    // and a backfill script seeds it for legacy documents.
    const subscriptionsSnapshot = await admin.firestore()
      .collection('subscriptions')
      .where('status', '==', 'active')
      .where('effectiveEndDate', '<=', sevenDaysLater)
      .where('effectiveEndDate', '>=', now)
      .orderBy('effectiveEndDate', 'asc')
      .get();
    
    if (subscriptionsSnapshot.empty) {
      console.log('No subscriptions expiring in the next 7 days');
      return;
    }
    
    console.log(`Found ${subscriptionsSnapshot.size} subscriptions expiring soon`);
    
    // Process each subscription
    for (const doc of subscriptionsSnapshot.docs) {
      const subscription = doc.data();
      subscription.id = doc.id;
      
      // Calculate days until expiry from effective end date
      const effectiveEnd = subscription.effectiveEndDate.toDate();
      const daysUntilExpiry = Math.ceil(
        (effectiveEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      console.log(`Subscription ${subscription.id} expires in ${daysUntilExpiry} days (effective end ${effectiveEnd.toISOString()})`);
      
      // Get user information for notification
      const userDoc = await admin.firestore()
        .collection('users')
        .doc(subscription.userId)
        .get();
      
      if (!userDoc.exists) {
        console.log(`User ${subscription.userId} not found, skipping notification`);
        continue;
      }
      
      const user = userDoc.data();
      const userName = user.displayName || user.email || 'User';
      
      // For student notifications (1 day before expiry)
      if (daysUntilExpiry === 1 && !subscription.notificationsSent?.studentPreExpiry) {
        // Create notification document
        await admin.firestore().collection('notifications').add({
          title: 'Your Subscription is Expiring Soon',
          body: `Your subscription will expire tomorrow (${effectiveEnd.toLocaleDateString()}). Please renew to maintain access.`,
          type: 'subscription_expiry',
          sender: 'system',
          recipients: [subscription.userId],
          subscriptionId: subscription.id,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          targetApp: 'student'
        });
        
        // Update the notification status
        await admin.firestore()
          .collection('subscriptions')
          .doc(subscription.id)
          .update({
            'notificationsSent.studentPreExpiry': true
          });
        
        console.log(`Student notification sent for subscription ${subscription.id} (${userName})`);
      }
    }
    
    console.log('Completed checking expiring subscriptions');
  } catch (error) {
    console.error('Error checking expiring subscriptions:', error);
    throw error;
  }
};

// Mark expired subscriptions and revoke course access
exports.markExpiredSubscriptions = async () => {
  try {
    const now = new Date();
    
    // Find subscriptions that have expired
    // Use effectiveEndDate so subscriptions whose exam date has passed are
    // also auto-expired even if their endDate is still in the future.
    const expiredSnapshot = await admin.firestore()
      .collection('subscriptions')
      .where('status', '==', 'active')
      .where('effectiveEndDate', '<', now)
      .get();
    
    if (expiredSnapshot.empty) {
      console.log('No expired subscriptions found');
      return;
    }
    
    console.log(`Found ${expiredSnapshot.size} expired subscriptions to update`);
    
    // Update in batches for better performance
    const batchSize = 500;  // Firestore limit
    let batch = admin.firestore().batch();
    let operationCount = 0;
    
    // Collect user IDs that need course access revoked
    const usersToRevokeAccess = [];
    
    for (const doc of expiredSnapshot.docs) {
      const subscription = doc.data();
      
      // Add user to list for course access revocation
      usersToRevokeAccess.push(subscription.userId);
      
      batch.update(doc.ref, { 
        status: 'expired',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      operationCount++;
      
      if (operationCount >= batchSize) {
        await batch.commit();
        batch = admin.firestore().batch();
        operationCount = 0;
      }
    }
    
    if (operationCount > 0) {
      await batch.commit();
    }
    
    // CRITICAL: Revoke course access for all users with expired subscriptions
    console.log(`Revoking course access for ${usersToRevokeAccess.length} users`);
    for (const userId of usersToRevokeAccess) {
      try {
        await admin.firestore()
          .collection('users')
          .doc(userId)
          .update({
            assignedCourseIds: [],
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        
        // Also update custom claims
        try {
          await admin.auth().setCustomUserClaims(userId, { assignedCourseIds: [] });
          console.log(`Revoked course access for user ${userId} due to expired subscription`);
        } catch (claimsError) {
          console.error(`Failed to update custom claims for user ${userId}:`, claimsError);
        }
      } catch (error) {
        console.error(`Failed to revoke course access for user ${userId}:`, error);
        // Continue processing other users even if one fails
      }
    }
    
    console.log(`Successfully marked ${expiredSnapshot.size} subscriptions as expired and revoked course access`);
  } catch (error) {
    console.error('Error marking expired subscriptions:', error);
    throw error;
  }
};

// Scheduled function to check for expiring subscriptions daily
exports.scheduledSubscriptionCheck = onSchedule({
  schedule: 'every 24 hours',
  timeZone: 'UTC',
  timeoutSeconds: 540, // 9 minutes (max for scheduled functions)
  memory: '512MiB',
  retryConfig: {
    maxRetryAttempts: 1,
    minBackoffSeconds: 120
  }
}, async (event) => {
  try {
    console.log('Running scheduled subscription check');
    
    // Check for expiring subscriptions and send notifications
    await exports.checkExpiringSubscriptions();
    
    // Mark expired subscriptions
    await exports.markExpiredSubscriptions();
    
    console.log('Scheduled subscription check completed successfully');

    // --- 30-Day Data Purge Lifecycle ---
    // Phase 1: Scan for users eligible for data deletion
    try {
      console.log('Running data purge check (30-day auto-deletion)...');
      const purgeCheckResult = await dataPurge.scheduledDataPurgeCheck();
      console.log('Data purge check completed:', purgeCheckResult);
    } catch (purgeCheckError) {
      // Isolate purge errors — don't let them block core subscription logic
      console.error('Error in data purge check (non-fatal):', purgeCheckError);
    }

    // Phase 2: Execute any pending deletions
    try {
      console.log('Running pending deletions execution...');
      const purgeExecResult = await dataPurge.executePendingDeletions();
      console.log('Pending deletions execution completed:', purgeExecResult);
    } catch (purgeExecError) {
      console.error('Error in pending deletions execution (non-fatal):', purgeExecError);
    }

    return null;
  } catch (error) {
    console.error('Error in scheduled subscription check:', error);
    return null;
  }
}); 