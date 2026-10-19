/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const cors = require('cors')({ origin: true });

// Import notification functions from consolidated module
const notifications = require("./src/notifications");

// Import subscription functions
const subscriptions = require("./src/subscriptions");

// Initialize the Firebase Admin SDK
admin.initializeApp();

// Export subscription functions
exports.checkExpiringSubscriptions = subscriptions.checkExpiringSubscriptions;
exports.markExpiredSubscriptions = subscriptions.markExpiredSubscriptions;
exports.scheduledSubscriptionCheck = subscriptions.scheduledSubscriptionCheck;

// Import and export data purge functions (30-day auto-deletion)
const dataPurge = require("./src/dataPurge");
exports.cancelPendingDeletion = dataPurge.cancelPendingDeletion;
exports.exemptUserFromDeletion = dataPurge.exemptUserFromDeletion;

// Import and export screenshot violation functions
const violations = require("./src/violations");
exports.checkViolationResetStatus = violations.checkViolationResetStatus;
exports.recordScreenshotViolation = violations.recordScreenshotViolation;
exports.acknowledgeViolationReset = violations.acknowledgeViolationReset;
exports.adminRecordViolation = violations.adminRecordViolation;

// Import and export device restriction functions
const deviceRestriction = require("./src/deviceRestriction");
exports.toggleDeviceRestriction = deviceRestriction.toggleDeviceRestriction;
exports.registerUserDevice = deviceRestriction.registerUserDevice;
exports.resetUserDevice = deviceRestriction.resetUserDevice;
exports.validateUserDevice = deviceRestriction.validateUserDevice;
exports.getDeviceRestrictionStatus = deviceRestriction.getDeviceRestrictionStatus;
exports.listUsersWithDeviceRestrictions = deviceRestriction.listUsersWithDeviceRestrictions;

// Import and export content update functions
const contentUpdates = require("./src/contentUpdates");
exports.notifyCourseUpdate = contentUpdates.notifyCourseUpdate;
exports.notifyModuleUpdate = contentUpdates.notifyModuleUpdate;
exports.notifyContentUpdate = contentUpdates.notifyContentUpdate;
exports.notifyContentItemUpdate = contentUpdates.notifyContentItemUpdate;
exports.markUpdateAsSeen = contentUpdates.markUpdateAsSeen;
exports.getUnseenUpdatesCount = contentUpdates.getUnseenUpdatesCount;

// Export notification functions
exports.sendChatNotification = notifications.sendChatNotification;
exports.sendCommunityNotification = notifications.sendCommunityNotification;
exports.sendPastQuestionsNotification = notifications.sendPastQuestionsNotification;
exports.sendPushNotification = notifications.sendPushNotification;
exports.markNotificationRead = notifications.markNotificationRead;
exports.sendCourseAssignmentNotification = notifications.sendCourseAssignmentNotification;
exports.cleanupInvalidTokens = notifications.cleanupInvalidTokens;

// Add CORS-enabled topic subscription endpoints
exports.subscribeToTopic = onRequest({
  cors: true,
  maxInstances: 10,
  cpu: 0.5,
  memory: "256MiB"
}, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const { token, topic } = req.body;

    if (!token || !topic) {
      return res.status(400).send('Token and topic are required');
    }

    await admin.messaging().subscribeToTopic(token, topic);
    logger.info(`Successfully subscribed token to topic ${topic}`);

    return res.status(200).send({ success: true });
  } catch (error) {
    logger.error('Error subscribing to topic:', error);
    return res.status(500).send({
      error: error.message,
      success: false
    });
  }
});

exports.unsubscribeFromTopic = onRequest({
  cors: true,
  maxInstances: 10,
  cpu: 0.5,
  memory: "256MiB"
}, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const { token, topic } = req.body;

    if (!token || !topic) {
      return res.status(400).send('Token and topic are required');
    }

    await admin.messaging().unsubscribeFromTopic(token, topic);
    logger.info(`Successfully unsubscribed token from topic ${topic}`);

    return res.status(200).send({ success: true });
  } catch (error) {
    logger.error('Error unsubscribing from topic:', error);
    return res.status(500).send({
      error: error.message,
      success: false
    });
  }
});

// Track function invocations to prevent rate limiting
const functionInvocations = {
  setCustomClaims: new Map(),
};

// Clear old invocations periodically
setInterval(() => {
  const now = Date.now();
  for (const [functionName, invocationMap] of Object.entries(functionInvocations)) {
    for (const [key, timestamp] of invocationMap.entries()) {
      // Remove entries older than 1 minute
      if (now - timestamp > 60000) {
        invocationMap.delete(key);
      }
    }
  }
}, 60000);

/**
 * Cloud Function to set custom claims for a user
 * This function can only be called by authenticated admin users
 */
exports.setCustomClaims = onCall({
  enforceAppCheck: false, // Set to true in production
  maxInstances: 10,
  timeoutSeconds: 60,
  minInstances: 0,
  cpu: 0.5,
  memory: "256MiB"
}, async (request) => {
  const { data, auth } = request;

  // Authentication check
  if (!auth) {
    logger.error('Unauthorized attempt to set custom claims - no auth');
    throw new Error("Unauthorized. User must be authenticated.");
  }

  // Check if caller is an admin
  const callerUid = auth.uid;

  try {
    // Get request parameters
    const { userId, claims } = data;
    if (!userId) {
      logger.error('Missing userId in request data');
      throw new Error("User ID is required.");
    }

    if (!claims || typeof claims !== 'object') {
      logger.error(`Invalid claims format: ${JSON.stringify(claims)}`);
      throw new Error("Claims object is required.");
    }

    // Rate limiting protection
    const invocationKey = `${callerUid}-${userId}`;
    const lastInvocation = functionInvocations.setCustomClaims.get(invocationKey);
    const now = Date.now();

    if (lastInvocation && (now - lastInvocation) < 5000) {
      logger.warn(`Rate limiting custom claims request for user ${userId}`);
      return {
        success: true,
        message: `Custom claims request rate limited, please try again in a few seconds.`,
        rateLimited: true
      };
    }
    functionInvocations.setCustomClaims.set(invocationKey, now);

    // Check caller permissions - admin check
    const callerData = await admin.firestore().collection('users').doc(callerUid).get();

    if (!callerData.exists || callerData.data().role !== 'admin') {
      logger.error(`Permission denied - user ${callerUid} is not an admin`);
      throw new Error("Permission denied. Only administrators can set custom claims.");
    }

    // Log the claims we're about to set
    logger.info(`Setting custom claims for user ${userId}:`, claims);

    // Validate claims size - Firebase has a 1000 byte limit for custom claims
    const claimsSize = JSON.stringify(claims).length;
    if (claimsSize > 950) { // Leave some margin
      logger.error(`Custom claims too large: ${claimsSize} bytes`);
      throw new Error("Custom claims object is too large. Maximum size is 1000 bytes.");
    }

    // Set custom claims for the user with more detailed error handling
    try {
      // Check if user exists before setting claims
      let user;
      try {
        user = await admin.auth().getUser(userId);
        logger.info(`User found: ${userId}, email: ${user.email}`);
      } catch (userError) {
        logger.error(`User not found: ${userId}`, userError);
        throw new Error(`User not found: ${userError.message}`);
      }

      // Add a small delay before setting claims to prevent race conditions
      await new Promise(resolve => setTimeout(resolve, 500));

      // Set custom claims with retry logic
      let retries = 3;
      let success = false;

      while (retries > 0 && !success) {
        try {
          // Set custom claims
          await admin.auth().setCustomUserClaims(userId, claims);
          success = true;
          logger.info(`Custom claims set for user ${userId}`);
        } catch (claimsError) {
          if (retries > 1) {
            logger.warn(`Failed to set custom claims, retrying (${retries - 1} attempts left): ${claimsError.message}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            retries--;
          } else {
            throw claimsError;
          }
        }
      }

      // Update a timestamp in the user's document to trigger a token refresh
      try {
        await admin.firestore().collection('users').doc(userId).update({
          customClaimsUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (updateError) {
        logger.warn(`Failed to update customClaimsUpdated timestamp (non-fatal): ${updateError.message}`);
        // Don't fail the whole operation because of this
      }

      return {
        success: true,
        message: `Custom claims updated for user ${userId}`,
        email: user.email
      };
    } catch (error) {
      logger.error(`Error setting custom claims for ${userId}:`, error);

      // Handle INTERNAL errors specially
      if (error.code === 'internal' || error.message.includes('INTERNAL')) {
        logger.warn(`Got INTERNAL error, returning partial success`);
        return {
          success: true,
          partial: true,
          message: `Custom claims partially updated for user ${userId} (Firebase internal error)`,
          error: error.message
        };
      }

      throw new Error(`Failed to set custom claims: ${error.message}`);
    }
  } catch (error) {
    logger.error('Error in setCustomClaims function:', error);
    return {
      success: false,
      message: `Error: ${error.message}`,
      error: error.message
    };
  }
});

/**
 * Cloud Function to create a new user (admin only)
 * This allows admins to create users without affecting their own authentication state
 * Updated: Added CPU limits to reduce quota usage
 */
exports.createUser = onCall({
  enforceAppCheck: false,
  maxInstances: 10,
  minInstances: 0,
  cpu: 0.5,
  memory: "256MiB"
}, async (request) => {
  const { data, auth } = request;

  // Authentication check
  if (!auth) {
    logger.error('Unauthorized attempt to create user - no auth');
    throw new Error("Unauthorized. User must be authenticated.");
  }

  // Check if caller is an admin
  const callerUid = auth.uid;

  try {
    // Get request parameters
    const { email, password, role, displayName } = data;

    if (!email || !password || !role || !displayName) {
      logger.error('Missing required fields in create user request');
      throw new Error("All fields are required: email, password, role, displayName.");
    }

    if (!['admin', 'student'].includes(role)) {
      logger.error(`Invalid role: ${role}`);
      throw new Error("Role must be either 'admin' or 'student'.");
    }

    // Check caller permissions - admin check
    const callerData = await admin.firestore().collection('users').doc(callerUid).get();

    if (!callerData.exists || callerData.data().role !== 'admin') {
      logger.error(`Permission denied - user ${callerUid} is not an admin`);
      throw new Error("Permission denied. Only administrators can create users.");
    }

    // Log the user creation attempt
    logger.info(`Admin ${callerUid} creating user with email: ${email}, role: ${role}`);

    // Create user in Firebase Auth using Admin SDK
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: displayName,
      emailVerified: false
    });

    logger.info(`User created in Firebase Auth: ${userRecord.uid}`);

    // Add user data to Firestore
    await admin.firestore().collection('users').doc(userRecord.uid).set({
      email,
      displayName,
      role,
      assignedModules: [],
      assignedCourseIds: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    logger.info(`User data added to Firestore for: ${userRecord.uid}`);

    // Set custom claims for the new user
    try {
      await admin.auth().setCustomUserClaims(userRecord.uid, {
        role,
        assignedModules: [],
        assignedCourseIds: []
      });
      logger.info(`Custom claims set for user: ${userRecord.uid}`);
    } catch (claimsError) {
      logger.warn(`Failed to set custom claims for user ${userRecord.uid} (non-fatal):`, claimsError);
    }

    return {
      success: true,
      message: 'User created successfully',
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        role: role
      }
    };

  } catch (error) {
    logger.error('Error creating user:', error);
    logger.error('Firebase error code:', error.code);

    // Map Firebase Auth error codes to proper HttpsError codes
    // so the client sees a real error instead of a generic INTERNAL
    if (error.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'A user with this email address already exists.');
    } else if (error.code === 'auth/invalid-email') {
      throw new HttpsError('invalid-argument', 'The email address is not valid.');
    } else if (error.code === 'auth/invalid-password') {
      throw new HttpsError('invalid-argument', 'The password must be at least 6 characters.');
    } else if (error.code === 'auth/weak-password') {
      throw new HttpsError('invalid-argument', 'The password is too weak. Use at least 6 characters.');
    } else if (error.code === 'auth/uid-already-exists') {
      throw new HttpsError('already-exists', 'A user with this UID already exists.');
    } else {
      throw new HttpsError('internal', `Failed to create user: ${error.message}`);
    }
  }
});

/**
 * Cloud Function to trigger course assignment notifications
 */
exports.triggerCourseAssignmentNotification = onCall({
  enforceAppCheck: false,
  maxInstances: 10,
  cpu: 0.5,
  memory: "256MiB"
}, async (request) => {
  const { data, auth } = request;

  // Authentication check
  if (!auth) {
    throw new Error("Unauthorized. User must be authenticated.");
  }

  // Check if user is an admin
  const callerUid = auth.uid;
  const callerData = await admin.firestore().collection('users').doc(callerUid).get();

  if (!callerData.exists || callerData.data().role !== 'admin') {
    throw new Error("Permission denied. Only administrators can trigger course assignment notifications.");
  }

  const { courseId, userIds, newAssignments } = data;

  if (!courseId || !Array.isArray(userIds) || userIds.length === 0) {
    throw new Error("Course ID and user IDs array are required.");
  }

  try {
    // Get course data
    const courseDoc = await admin.firestore().collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      throw new Error("Course not found.");
    }

    const courseData = {
      id: courseDoc.id,
      ...courseDoc.data()
    };

    // Only send notifications for newly assigned users (not existing assignments)
    const usersToNotify = newAssignments || userIds;

    if (usersToNotify.length === 0) {
      return {
        success: true,
        message: "No new assignments to notify about.",
        results: [],
        summary: { totalUsers: 0, successful: 0, failed: 0 }
      };
    }

    // Call the notification function
    const result = await notifications.sendCourseAssignmentNotification(
      courseData,
      usersToNotify,
      callerUid
    );

    // Store notification tracking record
    await admin.firestore().collection('notification_tracking').add({
      type: 'course_assignment',
      courseId: courseId,
      assignedBy: callerUid,
      assignedUsers: usersToNotify,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      results: result.results,
      summary: result.summary,
      errors: result.errors
    });

    return {
      success: true,
      message: `Course assignment notifications sent to ${result.summary.successful} users.`,
      ...result
    };

  } catch (error) {
    logger.error('Error triggering course assignment notification:', error);
    throw new Error(`Failed to send notifications: ${error.message}`);
  }
});

/**
 * Cloud Function to delete a user from Firebase Authentication and clean up related data
 * This function can only be called by authenticated admin users
 */
exports.deleteUser = onCall({
  enforceAppCheck: false, // Set to true in production
  cpu: 0.5,  // Reduce CPU allocation
  memory: "256MiB"
}, async (request) => {
  const { data, auth } = request;

  // Authentication check
  if (!auth) {
    throw new Error("Unauthorized. User must be authenticated.");
  }

  // Check if user is an admin
  const callerUid = auth.uid;
  const callerData = await admin.firestore().collection('users').doc(callerUid).get();

  if (!callerData.exists || callerData.data().role !== 'admin') {
    throw new Error("Permission denied. Only administrators can delete users.");
  }

  // Get the user ID to delete
  const userIdToDelete = data.userId;
  if (!userIdToDelete) {
    throw new Error("User ID is required.");
  }

  // Get Firebase service references
  const db = admin.firestore();
  const authAdmin = admin.auth();

  try {
    // Log start of deletion process
    logger.info(`Starting deletion process for user ${userIdToDelete}`, {
      userId: userIdToDelete,
      deletedBy: callerUid,
    });

    // Step 1: Delete user progress data
    const progressRef = db.collection(`users/${userIdToDelete}/progress`);
    const progressSnapshot = await progressRef.get();
    const progressDeletions = [];

    progressSnapshot.forEach(doc => {
      progressDeletions.push(doc.ref.delete());
    });

    await Promise.all(progressDeletions);
    logger.info(`Deleted ${progressDeletions.length} progress records for user ${userIdToDelete}`);

    // Step 2: Delete user login logs
    const logsQuery = db.collection('loginLogs').where('userId', '==', userIdToDelete);
    const logsSnapshot = await logsQuery.get();
    const logDeletions = [];

    logsSnapshot.forEach(doc => {
      logDeletions.push(doc.ref.delete());
    });

    await Promise.all(logDeletions);
    logger.info(`Deleted ${logDeletions.length} login logs for user ${userIdToDelete}`);

    // Step 3: Delete user document
    await db.collection('users').doc(userIdToDelete).delete();
    logger.info(`Deleted user document for ${userIdToDelete}`);

    // Step 4: Delete user from Firebase Auth
    await authAdmin.deleteUser(userIdToDelete);
    logger.info(`Deleted user auth record for ${userIdToDelete}`);

    return {
      success: true,
      message: `User ${userIdToDelete} successfully deleted`,
      deletedItems: {
        progress: progressDeletions.length,
        logs: logDeletions.length,
        userDoc: 1,
        authRecord: 1
      }
    };
  } catch (error) {
    logger.error('Error deleting user:', error);
    throw new Error(`Error deleting user: ${error.message}`);
  }
});

/**
 * Trigger consolidated course assignment notification for multiple courses
 * This sends ONE notification per user for all newly assigned courses
 */
exports.triggerConsolidatedCourseAssignmentNotification = onCall(
  {
    cors: ["http://localhost:5173", "http://localhost:5174"], // TODO: Add new client's production URL
    enforceAppCheck: false, // Set to true in production
    cpu: 0.5,
    memory: "256MiB"
  },
  async (request) => {
    const { courseIds, userIds, adminId } = request.data;

    // Check authentication
    if (!request.auth) {
      throw new Error("Authentication required.");
    }

    // Check if user is admin
    const callerUid = request.auth.uid;
    const callerData = await admin.firestore().collection('users').doc(callerUid).get();

    if (!callerData.exists || callerData.data().role !== 'admin') {
      throw new Error("Admin privileges required.");
    }

    try {
      // Validate input
      if (!Array.isArray(courseIds) || courseIds.length === 0) {
        throw new Error("courseIds must be a non-empty array.");
      }

      if (!Array.isArray(userIds) || userIds.length === 0) {
        throw new Error("userIds must be a non-empty array.");
      }

      if (!adminId || typeof adminId !== 'string') {
        throw new Error("adminId must be a valid string.");
      }

      logger.info(`Consolidated notification requested for ${courseIds.length} courses to ${userIds.length} users`);

      // Get course data for all courses
      const coursePromises = courseIds.map(courseId =>
        admin.firestore().collection('courses').doc(courseId).get()
      );
      const courseDocs = await Promise.all(coursePromises);

      // Validate all courses exist
      const courseData = [];
      for (let i = 0; i < courseDocs.length; i++) {
        const courseDoc = courseDocs[i];
        if (!courseDoc.exists) {
          throw new Error(`Course not found: ${courseIds[i]}`);
        }
        courseData.push({
          id: courseIds[i],
          ...courseDoc.data()
        });
      }

      // Send consolidated notification
      const notificationResult = await notifications.sendConsolidatedCourseAssignmentNotification(
        courseData,
        userIds,
        adminId
      );

      // Store notification tracking record
      const trackingRecord = {
        type: 'consolidated_course_assignment',
        courseIds: courseIds,
        userIds: userIds,
        adminId: adminId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        notificationResult: notificationResult,
        status: notificationResult.summary.totalSuccess > 0 ? 'partial_success' : 'failed'
      };

      await admin.firestore().collection('notification_tracking').add(trackingRecord);

      logger.info(`Consolidated notification completed for ${courseIds.length} courses`);

      return {
        success: true,
        message: `Consolidated course assignment notifications sent to ${userIds.length} users for ${courseIds.length} courses.`,
        results: notificationResult.results,
        errors: notificationResult.errors,
        summary: notificationResult.summary
      };

    } catch (error) {
      logger.error('Error in triggerConsolidatedCourseAssignmentNotification:', error);
      throw new Error(error.message || 'An unexpected error occurred while sending consolidated notifications.');
    }
  }
);
