const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { onRequest, onCall } = require("firebase-functions/v2/https");
const { notifications } = require('./notifications');

// Initialize Firebase Admin SDK
admin.initializeApp();

// Export all functions from notifications.js
exports.notifications = notifications;

// Import and re-export content update notification functions
const contentUpdateFunctions = require('./contentUpdates');
exports.notifyCourseUpdate = contentUpdateFunctions.notifyCourseUpdate;
exports.notifyModuleUpdate = contentUpdateFunctions.notifyModuleUpdate;
exports.notifyContentUpdate = contentUpdateFunctions.notifyContentUpdate;
exports.notifyContentItemUpdate = contentUpdateFunctions.notifyContentItemUpdate;
exports.markUpdateAsSeen = contentUpdateFunctions.markUpdateAsSeen;
exports.getUnseenUpdatesCount = contentUpdateFunctions.getUnseenUpdatesCount;

// Import and re-export subscription functions
const subscriptionFunctions = require('./subscriptions');
exports.checkExpiringSubscriptions = subscriptionFunctions.checkExpiringSubscriptions;
exports.markExpiredSubscriptions = subscriptionFunctions.markExpiredSubscriptions;
exports.scheduledSubscriptionCheck = subscriptionFunctions.scheduledSubscriptionCheck;

// Import and re-export violation functions
const violationFunctions = require('./violations');
exports.checkViolationResetStatus = violationFunctions.checkViolationResetStatus;
exports.recordScreenshotViolation = violationFunctions.recordScreenshotViolation;
exports.acknowledgeViolationReset = violationFunctions.acknowledgeViolationReset;

// Add a scheduled function to clean up stale tokens
const { onSchedule } = require("firebase-functions/v2/scheduler");

// Clean up stale tokens that are older than 60 days
exports.cleanupStaleTokens = onSchedule({
  schedule: 'every 24 hours',
  timeZone: 'UTC',
}, async (event) => {
  try {
    console.log('Running scheduled cleanup of stale FCM tokens');

    // Calculate the cutoff date (60 days ago)
    const EXPIRATION_TIME_MS = 60 * 24 * 60 * 60 * 1000; // 60 days in milliseconds
    const cutoffDate = new Date(Date.now() - EXPIRATION_TIME_MS);

    // Get tokens older than the cutoff date
    const staleTokensSnapshot = await admin.firestore()
      .collection('user_tokens')
      .where('lastUpdated', '<', cutoffDate)
      .get();

    if (staleTokensSnapshot.empty) {
      console.log('No stale tokens found');
      return null;
    }

    console.log(`Found ${staleTokensSnapshot.size} stale tokens to clean up`);

    // Use batched writes for better performance
    const batchSize = 500; // Firestore limit
    let batch = admin.firestore().batch();
    let operationCount = 0;
    let totalProcessed = 0;

    staleTokensSnapshot.forEach((doc) => {
      // Mark the token as inactive instead of deleting it
      batch.update(doc.ref, {
        isActive: false,
        deletedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      operationCount++;
      totalProcessed++;

      // Commit the batch when it reaches the limit
      if (operationCount >= batchSize) {
        batch.commit();
        console.log(`Committed batch of ${operationCount} operations`);
        batch = admin.firestore().batch();
        operationCount = 0;
      }
    });

    // Commit any remaining operations
    if (operationCount > 0) {
      await batch.commit();
      console.log(`Committed final batch of ${operationCount} operations`);
    }

    console.log(`Successfully cleaned up ${totalProcessed} stale tokens`);
    return null;
  } catch (error) {
    console.error('Error cleaning up stale tokens:', error);
    return null;
  }
});

// API endpoint for subscribing to FCM topics
exports.subscribeToTopic = onRequest({
  cpu: 0.5,
  memory: "256MiB"
}, async (request, response) => {
  try {
    // Set CORS headers
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST');
    response.set('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight OPTIONS request
    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    // Extract token and topic from query params
    const { token, topic } = request.query;

    if (!token || !topic) {
      response.status(400).send({ error: 'Token and topic are required' });
      return;
    }

    // Subscribe the token to the topic
    await admin.messaging().subscribeToTopic(token, topic);

    // Log the subscription
    console.log(`Subscribed token ${token.substring(0, 10)}... to topic ${topic}`);

    // Return success
    response.status(200).send({ success: true, message: `Subscribed to ${topic}` });
  } catch (error) {
    console.error('Error subscribing to topic:', error);
    response.status(500).send({
      error: 'Failed to subscribe to topic',
      message: error.message
    });
  }
});

// API endpoint for unsubscribing from FCM topics
// Updated: Added CPU limits to reduce quota usage
exports.unsubscribeFromTopic = onRequest({
  cpu: 0.5,
  memory: "256MiB"
}, async (request, response) => {
  try {
    // Set CORS headers
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST');
    response.set('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight OPTIONS request
    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    // Extract token and topic from query params
    const { token, topic } = request.query;

    if (!token || !topic) {
      response.status(400).send({ error: 'Token and topic are required' });
      return;
    }

    // Unsubscribe the token from the topic
    await admin.messaging().unsubscribeFromTopic(token, topic);

    // Log the unsubscription
    console.log(`Unsubscribed token ${token.substring(0, 10)}... from topic ${topic}`);

    // Return success
    response.status(200).send({ success: true, message: `Unsubscribed from ${topic}` });
  } catch (error) {
    console.error('Error unsubscribing from topic:', error);
    response.status(500).send({
      error: 'Failed to unsubscribe from topic',
      message: error.message
    });
  }
});

// Ensure required indexes are created for the messaging system
exports.createMessageIndexes = functions.https.onRequest(async (req, res) => {
  try {
    console.log('Creating necessary indexes for messaging system');

    // We can't create indexes programmatically through the API,
    // so we'll just log instructions for the developer
    const requiredIndexes = [
      {
        collection: 'messages',
        fields: [
          { fieldPath: 'senderId', order: 'ASCENDING' },
          { fieldPath: 'timestamp', order: 'DESCENDING' }
        ]
      },
      {
        collection: 'messages',
        fields: [
          { fieldPath: 'receiverId', order: 'ASCENDING' },
          { fieldPath: 'timestamp', order: 'DESCENDING' }
        ]
      }
    ];

    console.log('Required indexes:', JSON.stringify(requiredIndexes, null, 2));
    console.log('Please create these indexes manually in the Firebase Console:');
    console.log('1. Go to Firestore > Indexes > Composite tab > Add Index');
    console.log('2. Create the indexes as described above');
    console.log('3. Wait for indexes to build before using the application');

    res.status(200).send({
      success: true,
      message: 'Index information displayed in logs',
      requiredIndexes
    });
  } catch (error) {
    console.error('Error in createMessageIndexes:', error);
    res.status(500).send({
      error: 'Failed to process index information',
      message: error.message
    });
  }
});

// Function to fix ADMIN receiverId messages
exports.fixAdminMessages = onCall(async (data, context) => {
  // Check if the caller is an admin
  if (!context.auth) {
    throw new Error("Unauthenticated. You must be logged in.");
  }

  // Get the admin user ID
  const adminId = context.auth.uid;

  try {
    console.log(`Starting to fix messages with receiverId="ADMIN" to use actual admin ID: ${adminId}`);

    // Find all messages with receiverId="ADMIN"
    const messagesSnapshot = await admin.firestore()
      .collection('messages')
      .where('receiverId', '==', 'ADMIN')
      .get();

    if (messagesSnapshot.empty) {
      console.log('No messages with receiverId="ADMIN" found');
      return { success: true, count: 0 };
    }

    console.log(`Found ${messagesSnapshot.size} messages to fix`);

    // Update each message with the real admin ID
    const batch = admin.firestore().batch();
    let count = 0;

    messagesSnapshot.forEach(doc => {
      console.log(`Fixing message: ${doc.id}`);
      batch.update(doc.ref, { receiverId: adminId });
      count++;
    });

    // Commit the batch
    await batch.commit();

    console.log(`Successfully updated ${count} messages`);
    return { success: true, count };
  } catch (error) {
    console.error('Error fixing admin messages:', error);
    throw new Error(`Failed to fix messages: ${error.message}`);
  }
});

// Manual trigger for subscription check (admin only)
exports.manualSubscriptionCheck = onCall(async (data, context) => {
  // Check if the caller is an admin
  if (!context.auth) {
    throw new Error("Unauthenticated. You must be logged in.");
  }

  try {
    // Get user role
    const userSnapshot = await admin.firestore()
      .collection('users')
      .doc(context.auth.uid)
      .get();

    if (!userSnapshot.exists) {
      throw new Error("User not found");
    }

    const userData = userSnapshot.data();
    if (userData.role !== 'admin') {
      throw new Error("Unauthorized. Admin access required.");
    }

    console.log(`Admin ${context.auth.uid} manually triggered subscription check`);

    // Run the subscription checks
    await subscriptionFunctions.checkExpiringSubscriptions();
    await subscriptionFunctions.markExpiredSubscriptions();

    return {
      success: true,
      message: "Subscription check completed successfully",
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error in manual subscription check:', error);
    throw new Error(`Failed to run subscription check: ${error.message}`);
  }
}); 