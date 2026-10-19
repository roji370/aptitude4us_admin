const admin = require('firebase-admin');
const { onCall } = require('firebase-functions/v2/https');

/**
 * Check if a user's violations have been reset
 * Called by student app to see if admin has restored access
 */
exports.checkViolationResetStatus = onCall({
  cpu: 0.5,  // Reduce CPU allocation
  memory: "256MiB"
}, async (request) => {
  const { data, auth } = request;
  // Verify authentication
  if (!auth) {
    throw new Error('User must be authenticated');
  }

  const userId = auth.uid;

  try {
    // Query the violations collection for this user
    const violationsSnapshot = await admin.firestore()
      .collection('screenshotViolations')
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (violationsSnapshot.empty) {
      return {
        hasBeenReset: false,
        resetAt: null,
        message: 'No violation record found'
      };
    }

    const violationDoc = violationsSnapshot.docs[0];
    const violationData = violationDoc.data();

    // Check if violations have been reset (count is 0 and there's a lastReset date)
    const hasBeenReset = violationData.violations.count === 0 &&
      violationData.violations.lastReset != null;

    console.log('🔍 Reset status check:', {
      userId,
      count: violationData.violations.count,
      hasLastReset: !!violationData.violations.lastReset,
      hasBeenReset,
      resetAcknowledged: violationData.violations.resetAcknowledged
    });

    return {
      hasBeenReset,
      resetAt: hasBeenReset ? violationData.violations.lastReset.toDate().toISOString() : null,
      currentViolations: violationData.violations.count,
      isBlocked: violationData.violations.isBlocked
    };

  } catch (error) {
    console.error('Error checking violation reset status:', error);
    throw new Error('Failed to check reset status');
  }
});

/**
 * Record a screenshot violation
 * Called by student app when a screenshot is detected
 */
exports.recordScreenshotViolation = onCall({
  cpu: 0.5,  // Reduce CPU allocation
  memory: "256MiB"
}, async (request) => {
  const { data, auth } = request;
  // Verify authentication
  if (!auth) {
    throw new Error('User must be authenticated');
  }

  const userId = auth.uid;

  try {
    // Get user information
    const userDoc = await admin.firestore()
      .collection('users')
      .doc(userId)
      .get();

    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();

    // Check if violation record already exists
    const violationsSnapshot = await admin.firestore()
      .collection('screenshotViolations')
      .where('userId', '==', userId)
      .limit(1)
      .get();

    const now = new Date();

    if (!violationsSnapshot.empty) {
      // Update existing violation record
      const violationDoc = violationsSnapshot.docs[0];
      const currentData = violationDoc.data();
      const newCount = currentData.violations.count + 1;

      // Handle case where user was reset (firstWarning was deleted)
      const needsFirstWarning = !currentData.violations.firstWarning;

      const updateData = {
        'violations.count': newCount,
        'violations.isBlocked': newCount >= 2,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      // Set firstWarning if it doesn't exist (user was reset)
      if (needsFirstWarning) {
        updateData['violations.firstWarning'] = admin.firestore.Timestamp.fromDate(now);
      }

      // Only set blockedAt if user is getting blocked AND doesn't already have a blockedAt timestamp
      if (newCount >= 2 && !currentData.violations.blockedAt) {
        updateData['violations.blockedAt'] = admin.firestore.Timestamp.fromDate(now);
      }

      console.log('📱 Recording violation:', {
        userId,
        oldCount: currentData.violations.count,
        newCount,
        needsFirstWarning,
        hasLastReset: !!currentData.violations.lastReset
      });

      await violationDoc.ref.update(updateData);

      console.log('✅ Violation recorded successfully:', {
        userId,
        violationCount: newCount,
        isBlocked: newCount >= 2
      });

      return {
        success: true,
        violationCount: newCount,
        isBlocked: newCount >= 2,
        message: newCount >= 2 ? 'Access blocked due to multiple violations' : 'Warning issued'
      };
    } else {
      // Create new violation record
      const violationData = {
        userId,
        userEmail: userData.email || 'Unknown',
        ...(userData.displayName && { userName: userData.displayName }),
        violations: {
          count: 1,
          isBlocked: false,
          firstWarning: admin.firestore.Timestamp.fromDate(now),
          resetHistory: []
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await admin.firestore()
        .collection('screenshotViolations')
        .add(violationData);

      return {
        success: true,
        violationCount: 1,
        isBlocked: false,
        message: 'First warning issued'
      };
    }

  } catch (error) {
    console.error('Error recording violation:', error);
    throw new Error('Failed to record violation');
  }
});

/**
 * Acknowledge that user has seen the reset
 * Called by student app after user sees that access is restored
 */
exports.acknowledgeViolationReset = onCall({
  cpu: 0.5,
  memory: "256MiB"
}, async (request) => {
  const { data, auth } = request;
  // Verify authentication
  if (!auth) {
    throw new Error('User must be authenticated');
  }

  const userId = auth.uid;

  try {
    // Update the violation record to mark that reset has been acknowledged
    const violationsSnapshot = await admin.firestore()
      .collection('screenshotViolations')
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (!violationsSnapshot.empty) {
      const violationDoc = violationsSnapshot.docs[0];
      await violationDoc.ref.update({
        'violations.resetAcknowledged': true,
        'violations.resetAcknowledgedAt': admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return { success: true };

  } catch (error) {
    console.error('Error acknowledging reset:', error);
    throw new Error('Failed to acknowledge reset');
  }
});

/**
 * Admin function to manually record a violation for any user (for testing/debugging)
 * Called by admin app for testing purposes
 */
exports.adminRecordViolation = onCall({
  cpu: 0.5,
  memory: "256MiB"
}, async (request) => {
  const { data, auth } = request;

  // Verify authentication
  if (!auth) {
    throw new Error('User must be authenticated');
  }

  // Get the target user ID from the request data
  const { targetUserId } = data;

  if (!targetUserId) {
    throw new Error('Target user ID is required');
  }

  try {
    // Get admin user info to verify admin privileges
    const adminUserDoc = await admin.firestore()
      .collection('users')
      .doc(auth.uid)
      .get();

    if (!adminUserDoc.exists) {
      throw new Error('Admin user not found');
    }

    const adminUserData = adminUserDoc.data();

    // Verify admin role
    if (adminUserData.role !== 'admin') {
      throw new Error('Only admins can manually record violations');
    }

    // Get target user information
    const targetUserDoc = await admin.firestore()
      .collection('users')
      .doc(targetUserId)
      .get();

    if (!targetUserDoc.exists) {
      throw new Error('Target user not found');
    }

    const targetUserData = targetUserDoc.data();

    // Check if violation record already exists for target user
    const violationsSnapshot = await admin.firestore()
      .collection('screenshotViolations')
      .where('userId', '==', targetUserId)
      .limit(1)
      .get();

    const now = new Date();

    if (!violationsSnapshot.empty) {
      // Update existing violation record
      const violationDoc = violationsSnapshot.docs[0];
      const currentData = violationDoc.data();
      const newCount = currentData.violations.count + 1;

      // Handle case where user was reset (firstWarning was deleted)
      const needsFirstWarning = !currentData.violations.firstWarning;

      const updateData = {
        'violations.count': newCount,
        'violations.isBlocked': newCount >= 2,
        'violations.blockedAt': newCount >= 2 && !currentData.violations.blockedAt
          ? admin.firestore.Timestamp.fromDate(now)
          : currentData.violations.blockedAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      // Set firstWarning if it doesn't exist (user was reset)
      if (needsFirstWarning) {
        updateData['violations.firstWarning'] = admin.firestore.Timestamp.fromDate(now);
      }

      console.log('Admin recording violation:', {
        adminId: auth.uid,
        targetUserId,
        newCount,
        needsFirstWarning
      });

      await violationDoc.ref.update(updateData);

      return {
        success: true,
        violationCount: newCount,
        isBlocked: newCount >= 2,
        message: newCount >= 2 ? 'Access blocked due to multiple violations' : 'Warning issued'
      };
    } else {
      // Create new violation record
      const violationData = {
        userId: targetUserId,
        userEmail: targetUserData.email || 'Unknown',
        ...(targetUserData.displayName && { userName: targetUserData.displayName }),
        violations: {
          count: 1,
          isBlocked: false,
          firstWarning: admin.firestore.Timestamp.fromDate(now),
          resetHistory: []
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await admin.firestore()
        .collection('screenshotViolations')
        .add(violationData);

      return {
        success: true,
        violationCount: 1,
        isBlocked: false,
        message: 'First warning issued'
      };
    }

  } catch (error) {
    console.error('Error in admin recording violation:', error);
    throw new Error('Failed to record violation: ' + error.message);
  }
});
