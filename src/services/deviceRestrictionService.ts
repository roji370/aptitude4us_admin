import { doc, updateDoc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { generateDeviceFingerprint, validateDeviceFingerprint } from '../utils/deviceFingerprint';

export interface DeviceRestrictionUpdate {
  enabled: boolean;
  registeredDeviceId?: string;
  registeredAt?: Date;
}

/**
 * Toggle device restriction for a user
 */
export async function toggleDeviceRestriction(
  userId: string,
  enabled: boolean
): Promise<void> {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
      throw new Error('User not found');
    }

    const updateData: any = {
      'deviceRestriction.enabled': enabled,
      updatedAt: Timestamp.now()
    };

    // If disabling, clear the registered device
    if (!enabled) {
      updateData['deviceRestriction.registeredDeviceId'] = null;
      updateData['deviceRestriction.registeredAt'] = null;
    }

    await updateDoc(userRef, updateData);
  } catch (error) {
    console.error('Error toggling device restriction:', error);
    throw error;
  }
}

/**
 * Register current device for a user
 */
export async function registerUserDevice(userId: string): Promise<string> {
  try {
    const deviceId = generateDeviceFingerprint();
    const userRef = doc(db, 'users', userId);

    await updateDoc(userRef, {
      'deviceRestriction.registeredDeviceId': deviceId,
      'deviceRestriction.registeredAt': Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    return deviceId;
  } catch (error) {
    console.error('Error registering device:', error);
    throw error;
  }
}

/**
 * Validate if current device is allowed for user
 */
export async function validateUserDevice(userId: string): Promise<{
  isValid: boolean;
  requiresRegistration: boolean;
  restrictionEnabled: boolean;
}> {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const deviceRestriction = userData.deviceRestriction;

    // If device restriction is not enabled, allow access
    if (!deviceRestriction?.enabled) {
      return {
        isValid: true,
        requiresRegistration: false,
        restrictionEnabled: false
      };
    }

    // If no device is registered yet, require registration
    if (!deviceRestriction.registeredDeviceId) {
      return {
        isValid: false,
        requiresRegistration: true,
        restrictionEnabled: true
      };
    }

    // Validate current device against registered device
    const isCurrentDeviceValid = validateDeviceFingerprint(deviceRestriction.registeredDeviceId);

    return {
      isValid: isCurrentDeviceValid,
      requiresRegistration: false,
      restrictionEnabled: true
    };
  } catch (error) {
    console.error('Error validating device:', error);
    throw error;
  }
}

/**
 * Reset registered device for a user (admin function)
 */
export async function resetUserDevice(userId: string): Promise<void> {
  try {
    const userRef = doc(db, 'users', userId);

    await updateDoc(userRef, {
      'deviceRestriction.registeredDeviceId': null,
      'deviceRestriction.registeredAt': null,
      updatedAt: Timestamp.now()
    });
  } catch (error) {
    console.error('Error resetting device:', error);
    throw error;
  }
}

/**
 * Get device restriction status for a user
 */
export async function getDeviceRestrictionStatus(userId: string): Promise<{
  enabled: boolean;
  hasRegisteredDevice: boolean;
  registeredAt?: Date;
  deviceInfo?: string;
}> {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const deviceRestriction = userData.deviceRestriction;

    return {
      enabled: deviceRestriction?.enabled || false,
      hasRegisteredDevice: !!deviceRestriction?.registeredDeviceId,
      registeredAt: deviceRestriction?.registeredAt instanceof Timestamp ?
        deviceRestriction.registeredAt.toDate() :
        deviceRestriction?.registeredAt ? new Date(deviceRestriction.registeredAt) : undefined,
      deviceInfo: userData.deviceInfo
    };
  } catch (error) {
    console.error('Error getting device restriction status:', error);
    throw error;
  }
}

/**
 * Toggle device restriction for multiple users (bulk operation)
 */
export async function bulkToggleDeviceRestriction(
  userIds: string[],
  enabled: boolean
): Promise<{
  success: number;
  failed: number;
  errors: Array<{ userId: string; error: string }>;
}> {
  let success = 0;
  let failed = 0;
  const errors: Array<{ userId: string; error: string }> = [];

  // Process users in parallel with error handling for each
  await Promise.all(
    userIds.map(async (userId) => {
      try {
        await toggleDeviceRestriction(userId, enabled);
        success++;
      } catch (error) {
        failed++;
        errors.push({
          userId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        console.error(`Error toggling device restriction for user ${userId}:`, error);
      }
    })
  );

  return { success, failed, errors };
}