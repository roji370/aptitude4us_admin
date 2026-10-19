const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

/**
 * Toggle device restriction for a user
 * Only admins can call this function
 */
exports.toggleDeviceRestriction = onCall({
  cors: true,
  maxInstances: 10,
  cpu: 0.5,
  memory: "256MiB"
}, async (request) => {
  try {
    // Check if user is authenticated
    if (!request.auth) {
      throw new Error('Authentication required');
    }

    // Check if user is admin
    const callerDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
    const callerData = callerDoc.data();

    if (!callerData || callerData.role !== 'admin') {
      throw new Error('Admin privileges required');
    }

    const { userId, enabled } = request.data;

    if (!userId || typeof enabled !== 'boolean') {
      throw new Error('Invalid parameters: userId and enabled (boolean) are required');
    }

    const userRef = admin.firestore().collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const updateData = {
      'deviceRestriction.enabled': enabled,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // If disabling, clear the registered device
    if (!enabled) {
      updateData['deviceRestriction.registeredDeviceId'] = null;
      updateData['deviceRestriction.registeredAt'] = null;
    }

    await userRef.update(updateData);

    logger.info(`Device restriction ${enabled ? 'enabled' : 'disabled'} for user ${userId} by admin ${request.auth.uid}`);

    return {
      success: true,
      message: `Device restriction ${enabled ? 'enabled' : 'disabled'} successfully`
    };
  } catch (error) {
    logger.error('Error toggling device restriction:', error);
    throw new Error(error.message || 'Failed to toggle device restriction');
  }
});

/**
 * Register device for a user
 * Can be called by the user themselves or by an admin
 */
exports.registerUserDevice = onCall({
  cors: true,
  maxInstances: 10,
  cpu: 0.5,
  memory: "256MiB"
}, async (request) => {
  try {
    // Check if user is authenticated
    if (!request.auth) {
      throw new Error('Authentication required');
    }

    const { userId, deviceId, deviceInfo } = request.data;
    const targetUserId = userId || request.auth.uid;

    if (!deviceId) {
      throw new Error('Device ID is required');
    }

    // Check permissions - user can register their own device, or admin can register any device
    if (targetUserId !== request.auth.uid) {
      const callerDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
      const callerData = callerDoc.data();

      if (!callerData || callerData.role !== 'admin') {
        throw new Error('Admin privileges required to register device for another user');
      }
    }

    const userRef = admin.firestore().collection('users').doc(targetUserId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const updateData = {
      'deviceRestriction.registeredDeviceId': deviceId,
      'deviceRestriction.registeredAt': admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (deviceInfo) {
      updateData.deviceInfo = deviceInfo;
    }

    await userRef.update(updateData);

    logger.info(`Device registered for user ${targetUserId}: ${deviceId}`);

    return {
      success: true,
      deviceId: deviceId,
      message: 'Device registered successfully'
    };
  } catch (error) {
    logger.error('Error registering device:', error);
    throw new Error(error.message || 'Failed to register device');
  }
});

/**
 * Reset device registration for a user
 * Only admins can call this function
 */
exports.resetUserDevice = onCall({
  cors: true,
  maxInstances: 10,
  cpu: 0.5,
  memory: "256MiB"
}, async (request) => {
  try {
    // Check if user is authenticated
    if (!request.auth) {
      throw new Error('Authentication required');
    }

    // Check if user is admin
    const callerDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
    const callerData = callerDoc.data();

    if (!callerData || callerData.role !== 'admin') {
      throw new Error('Admin privileges required');
    }

    const { userId } = request.data;

    if (!userId) {
      throw new Error('User ID is required');
    }

    const userRef = admin.firestore().collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    await userRef.update({
      'deviceRestriction.registeredDeviceId': null,
      'deviceRestriction.registeredAt': null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    logger.info(`Device registration reset for user ${userId} by admin ${request.auth.uid}`);

    return {
      success: true,
      message: 'Device registration reset successfully'
    };
  } catch (error) {
    logger.error('Error resetting device registration:', error);
    throw new Error(error.message || 'Failed to reset device registration');
  }
});

/**
 * Validate device for a user
 * Can be called by the user themselves
 */
exports.validateUserDevice = onCall({
  cors: true,
  maxInstances: 10,
  cpu: 0.5,
  memory: "256MiB"
}, async (request) => {
  try {
    // Check if user is authenticated
    if (!request.auth) {
      throw new Error('Authentication required');
    }

    const { userId, currentDeviceId } = request.data;
    const targetUserId = userId || request.auth.uid;

    if (!currentDeviceId) {
      throw new Error('Current device ID is required');
    }

    // Users can only validate their own device unless they're admin
    if (targetUserId !== request.auth.uid) {
      const callerDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
      const callerData = callerDoc.data();

      if (!callerData || callerData.role !== 'admin') {
        throw new Error('Can only validate your own device');
      }
    }

    const userRef = admin.firestore().collection('users').doc(targetUserId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const deviceRestriction = userData.deviceRestriction || {};

    // If device restriction is not enabled, allow access
    if (!deviceRestriction.enabled) {
      return {
        isValid: true,
        requiresRegistration: false,
        restrictionEnabled: false,
        message: 'Device restriction not enabled'
      };
    }

    // If no device is registered yet, require registration
    if (!deviceRestriction.registeredDeviceId) {
      return {
        isValid: false,
        requiresRegistration: true,
        restrictionEnabled: true,
        message: 'Device registration required'
      };
    }

    // Validate current device against registered device
    // Extract the hash part (after the timestamp prefix) for comparison
    const registeredHash = deviceRestriction.registeredDeviceId.split('-').slice(1).join('-');
    const currentHash = currentDeviceId.split('-').slice(1).join('-');

    const isCurrentDeviceValid = registeredHash === currentHash;

    return {
      isValid: isCurrentDeviceValid,
      requiresRegistration: false,
      restrictionEnabled: true,
      message: isCurrentDeviceValid ? 'Device validated successfully' : 'Device not authorized'
    };
  } catch (error) {
    logger.error('Error validating device:', error);
    throw new Error(error.message || 'Failed to validate device');
  }
});

/**
 * Get device restriction status for a user
 * Admins can check any user, users can check their own status
 */
exports.getDeviceRestrictionStatus = onCall({
  cors: true,
  maxInstances: 10,
  cpu: 0.5,
  memory: "256MiB"
}, async (request) => {
  try {
    // Check if user is authenticated
    if (!request.auth) {
      throw new Error('Authentication required');
    }

    const { userId } = request.data;
    const targetUserId = userId || request.auth.uid;

    // Users can only check their own status unless they're admin
    if (targetUserId !== request.auth.uid) {
      const callerDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
      const callerData = callerDoc.data();

      if (!callerData || callerData.role !== 'admin') {
        throw new Error('Can only check your own device restriction status');
      }
    }

    const userRef = admin.firestore().collection('users').doc(targetUserId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const deviceRestriction = userData.deviceRestriction || {};

    return {
      enabled: deviceRestriction.enabled || false,
      hasRegisteredDevice: !!deviceRestriction.registeredDeviceId,
      registeredAt: deviceRestriction.registeredAt || null,
      deviceInfo: userData.deviceInfo || null,
      lastLogin: userData.lastLogin || null
    };
  } catch (error) {
    logger.error('Error getting device restriction status:', error);
    throw new Error(error.message || 'Failed to get device restriction status');
  }
});

/**
 * List all users with device restrictions (Admin only)
 */
exports.listUsersWithDeviceRestrictions = onCall({
  cors: true,
  maxInstances: 10,
  cpu: 0.5,  // Reduce CPU allocation
  memory: "256MiB"
}, async (request) => {
  try {
    // Check if user is authenticated and is admin
    if (!request.auth) {
      throw new Error('Authentication required');
    }

    const callerDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
    const callerData = callerDoc.data();

    if (!callerData || callerData.role !== 'admin') {
      throw new Error('Admin privileges required');
    }

    const usersSnapshot = await admin.firestore()
      .collection('users')
      .where('deviceRestriction.enabled', '==', true)
      .get();

    const users = [];
    usersSnapshot.forEach(doc => {
      const userData = doc.data();
      users.push({
        uid: doc.id,
        email: userData.email,
        displayName: userData.displayName,
        deviceRestriction: userData.deviceRestriction,
        deviceInfo: userData.deviceInfo,
        lastLogin: userData.lastLogin
      });
    });

    return {
      users: users,
      count: users.length
    };
  } catch (error) {
    logger.error('Error listing users with device restrictions:', error);
    throw new Error(error.message || 'Failed to list users with device restrictions');
  }
});
