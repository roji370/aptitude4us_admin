import { 
  signInWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword as firebaseUpdatePassword
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, updateDoc, collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../firebase/config';
import { validateUserDevice, registerUserDevice } from './deviceRestrictionService';
import { getDeviceDisplayInfo } from '../utils/deviceFingerprint';

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: 'admin' | 'student';
  assignedModules?: string[];
  assignedCourseIds?: string[];
  deviceRestriction?: {
    enabled: boolean;
    registeredDeviceId?: string;
    registeredAt?: Date;
  };
}

// Convert Firebase User to our User model
const mapFirebaseUser = async (firebaseUser: FirebaseUser): Promise<User | null> => {
  if (!firebaseUser) return null;
  
  // Get user data from Firestore
  const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
  
  if (userDoc.exists()) {
    const userData = userDoc.data();
    return {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      role: userData.role,
      assignedModules: userData.assignedModules || [],
      assignedCourseIds: userData.assignedCourseIds || [],
      deviceRestriction: userData.deviceRestriction || {
        enabled: false,
        registeredDeviceId: undefined,
        registeredAt: undefined
      }
    };
  }
  
  return null;
};

// Sign in with email and password
export const signInWithEmail = async (email: string, password: string): Promise<User | null> => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = await mapFirebaseUser(userCredential.user);
    
    if (user) {
      // Check device restrictions
      const deviceValidation = await validateUserDevice(user.uid);
      
      if (deviceValidation.restrictionEnabled && !deviceValidation.isValid) {
        if (deviceValidation.requiresRegistration) {
          // Register current device
          const deviceId = await registerUserDevice(user.uid);
          console.log('Device registered for user:', user.uid, 'Device ID:', deviceId);
        } else {
          // Device restriction enabled but current device not registered
          await signOut(auth);
          throw new Error('DEVICE_RESTRICTED: This account is restricted to a specific device. Please contact your administrator.');
        }
      }

      // Update last login info with device information
      await updateLastLogin(user.uid);
    }
    
    return user;
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
};

// Enhanced sign in with device validation for admin use
export const signInWithDeviceValidation = async (email: string, password: string): Promise<{
  user: User | null;
  deviceStatus: {
    restrictionEnabled: boolean;
    deviceRegistered: boolean;
    requiresRegistration: boolean;
  };
}> => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = await mapFirebaseUser(userCredential.user);
    
    if (!user) {
      return {
        user: null,
        deviceStatus: {
          restrictionEnabled: false,
          deviceRegistered: false,
          requiresRegistration: false
        }
      };
    }

    const deviceValidation = await validateUserDevice(user.uid);
    
    if (deviceValidation.restrictionEnabled) {
      if (deviceValidation.requiresRegistration) {
        // Register current device
        const deviceId = await registerUserDevice(user.uid);
        console.log('Device registered for user:', user.uid, 'Device ID:', deviceId);
      } else if (!deviceValidation.isValid) {
        // Device restriction enabled but current device not authorized
        await signOut(auth);
        throw new Error('DEVICE_RESTRICTED: This account is restricted to a specific device.');
      }
    }

    // Update last login info
    await updateLastLogin(user.uid);
    
    return {
      user,
      deviceStatus: {
        restrictionEnabled: deviceValidation.restrictionEnabled,
        deviceRegistered: !deviceValidation.requiresRegistration,
        requiresRegistration: deviceValidation.requiresRegistration
      }
    };
  } catch (error) {
    console.error('Enhanced login error:', error);
    throw error;
  }
};

// Update last login with device info
const updateLastLogin = async (userId: string): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userId);
    const deviceInfo = getDeviceDisplayInfo();
    
    await updateDoc(userRef, {
      lastLogin: Timestamp.now(),
      deviceInfo: deviceInfo,
      updatedAt: Timestamp.now()
    });
  } catch (error) {
    console.error('Error updating last login:', error);
    // Don't throw here as login should still succeed
  }
};

// Sign out
export const logOut = async (): Promise<void> => {
  try {
    // First sign out from Firebase Auth (this is the most important part)
    await signOut(auth);
    
    // Token cleanup will happen asynchronously in the background
    // This ensures the user isn't blocked if token cleanup takes time
    console.log('User signed out successfully');
  } catch (error) {
    console.error('Logout error:', error);
    throw error;
  }
};

// Emergency sign out - to be used when normal logout fails or times out
// This bypasses all token cleanup and just focuses on signing out
export const emergencyLogOut = async (): Promise<void> => {
  try {
    console.log('EMERGENCY LOGOUT: Bypassing token cleanup');
    // Just sign out from Firebase Auth, skip all other cleanup
    await signOut(auth);
    console.log('EMERGENCY LOGOUT: Completed successfully');
  } catch (error) {
    console.error('EMERGENCY LOGOUT error:', error);
    // Try one more time with a clean try/catch
    try {
      await signOut(auth);
    } catch (finalError) {
      console.error('FINAL EMERGENCY LOGOUT ATTEMPT FAILED:', finalError);
      // At this point we've done our best - the app should redirect to login
    }
  }
};

// Send password reset email
export const resetPassword = async (email: string): Promise<void> => {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    console.error('Password reset error:', error);
    throw error;
  }
};

// Update password directly
export const updatePassword = async (newPassword: string): Promise<void> => {
  try {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('No user is currently signed in');
    }
    
    await firebaseUpdatePassword(user, newPassword);
  } catch (error) {
    console.error('Update password error:', error);
    throw error;
  }
};

// Reauthenticate user with email and password
export const reauthenticateUser = async (password: string): Promise<void> => {
  try {
    const user = auth.currentUser;
    if (!user || !user.email) {
      throw new Error('No user is currently signed in or email is missing');
    }
    
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
  } catch (error) {
    console.error('Reauthentication error:', error);
    throw error;
  }
};

// Create a new user (admin only function) using Cloud Function
export const createUser = async (
  email: string, 
  password: string, 
  role: 'admin' | 'student',
  displayName: string
): Promise<User | null> => {
  try {
    console.log(`Creating user via Cloud Function: ${email}, role: ${role}`);
    
    // Call the Cloud Function to create the user
    const createUserFunction = httpsCallable(functions, 'createUser');
    const result = await createUserFunction({
      email,
      password,
      role,
      displayName
    });
    
    // Parse the response
    const data = result.data as {
      success: boolean;
      message: string;
      user?: {
        uid: string;
        email: string;
        displayName: string;
        role: string;
      };
      error?: string;
    };
    
    console.log('Cloud Function response:', data);
    
    if (!data.success) {
      throw new Error(data.error || data.message || 'Failed to create user');
    }
    
    if (!data.user) {
      throw new Error('User data not returned from Cloud Function');
    }
    
    // Return the user data in the expected format
    return {
      uid: data.user.uid,
      email: data.user.email,
      displayName: data.user.displayName,
      role: data.user.role as 'admin' | 'student',
      assignedModules: [],
      assignedCourseIds: []
    };
  } catch (error) {
    console.error('Create user error:', error);
    // Extract the real error message from Firebase HttpsError
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      const fbError = error as { code: string; message: string };
      console.error('Firebase error code:', fbError.code, '| message:', fbError.message);
      throw new Error(fbError.message);
    }
    throw error;
  }
};

// Update user role (admin only function)
export const updateUserRole = async (userId: string, role: 'admin' | 'student'): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      role,
      updatedAt: new Date()
    });
    
    // Also update the custom claims
    const claimsResult = await setUserCustomClaims(userId, { role });
    
    if (!claimsResult.success) {
      console.warn(`Custom claims not updated for role change: ${claimsResult.message}`);
    }
  } catch (error) {
    console.error('Update user role error:', error);
    throw error;
  }
};

// Set custom claims for a user (admin only function)
export const setUserCustomClaims = async (userId: string, claims: Record<string, unknown>): Promise<{success: boolean; message: string}> => {
  try {
    // Log request information
    console.log(`Setting custom claims for user ${userId}`, claims);
    
    // Call the Cloud Function
    const setCustomClaimsFunction = httpsCallable(functions, 'setCustomClaims');
    const result = await setCustomClaimsFunction({ userId, claims });
    
    // Parse the response
    const data = result.data as {
      success: boolean;
      message: string;
      partial?: boolean;
      error?: string;
      email?: string;
      rateLimited?: boolean;
    };
    
    console.log('Custom claims result:', data);
    
    // If the operation was rate-limited, log this but don't consider it an error
    if (data.rateLimited) {
      console.warn('Custom claims request was rate limited');
      return { 
        success: true,
        message: 'Custom claims will be updated shortly (rate limited)'
      };
    }
    
    // If there was a partial success (INTERNAL error but we handled it)
    if (data.partial) {
      console.warn(`Partial success setting custom claims: ${data.message}`);
      return {
        success: true,
        message: 'Custom claims partially updated'
      };
    }
    
    // Check if the operation was successful
    if (!data.success) {
      throw new Error(data.error || data.message || 'Unknown error setting custom claims');
    }
    
    return {
      success: true,
      message: data.message || 'Custom claims updated successfully'
    };
  } catch (error) {
    console.error('Set custom claims error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error setting custom claims'
    };
  }
};

// Update user assigned modules (admin only function)
export const updateUserAssignedModules = async (userId: string, moduleIds: string[]): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      assignedModules: moduleIds,
      updatedAt: new Date()
    });
    
    // Update custom claims with module access
    const claimsResult = await setUserCustomClaims(userId, { assignedModules: moduleIds });
    
    if (!claimsResult.success) {
      console.warn(`Custom claims not updated for modules: ${claimsResult.message}`);
    }
  } catch (error) {
    console.error('Update assigned modules error:', error);
    throw error;
  }
};

// Check if user is an admin
export const isAdmin = async (userId: string): Promise<boolean> => {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (userDoc.exists()) {
      return userDoc.data().role === 'admin';
    }
    return false;
  } catch (error) {
    console.error('Check admin error:', error);
    return false;
  }
};

// Add a new function to update assigned courses
export const updateUserAssignedCourses = async (
  userId: string, 
  courseIds: string[],
  options: {
    sendNotifications?: boolean;
    adminId?: string;
  } = {}
): Promise<{
  success: boolean;
  newlyAssigned: string[];
  notificationResult?: any;
}> => {
  try {
    // Get the user's current assignments
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    const currentAssignments = userDoc.exists() ? (userDoc.data().assignedCourseIds || []) : [];
    
    // First verify that all provided course IDs actually exist
    const validatedCourseIds = await validateCourseIds(courseIds);
    
    if (validatedCourseIds.length !== courseIds.length) {
      console.warn(`Some course IDs don't exist or are inactive and will be removed:`, 
        courseIds.filter(id => !validatedCourseIds.includes(id)));
    }
    
    // Determine newly assigned courses
    const newlyAssigned = validatedCourseIds.filter(courseId => !currentAssignments.includes(courseId));
    
    await updateDoc(userRef, {
      assignedCourseIds: validatedCourseIds,
      updatedAt: new Date()
    });
    
    console.log(`Updated user ${userId} with validated course IDs:`, validatedCourseIds);
    console.log(`Newly assigned courses:`, newlyAssigned);
    
    // Update custom claims with course access
    const claimsResult = await setUserCustomClaims(userId, { assignedCourseIds: validatedCourseIds });
    
    if (!claimsResult.success) {
      console.warn(`Custom claims not updated for courses: ${claimsResult.message}`);
    }

    let notificationResult = null;

    // Send notifications for newly assigned courses if requested
    if (options.sendNotifications && newlyAssigned.length > 0 && options.adminId) {
      try {
        // Import the notification service dynamically to avoid circular dependencies
        const { sendCourseAssignmentNotifications } = await import('./courseAssignmentNotificationService');
        
        // Send individual notifications for each newly assigned course (same as bulk assign)
        const notificationResults: Record<string, { success: boolean; error?: string }> = {};
        
        for (const courseId of newlyAssigned) {
          try {
            const result = await sendCourseAssignmentNotifications(
              courseId,
              [userId], // Only this user
              [userId]  // All are newly assigned
            );
            notificationResults[courseId] = result;
            console.log(`Notification sent for course ${courseId}:`, result);
          } catch (courseNotificationError) {
            console.error(`Failed to send notification for course ${courseId}:`, courseNotificationError);
            notificationResults[courseId] = {
              success: false,
              error: courseNotificationError instanceof Error ? courseNotificationError.message : 'Unknown error'
            };
          }
        }
        
        // Aggregate results
        const successfulCourses = Object.keys(notificationResults).filter(
          courseId => notificationResults[courseId].success
        );
        const failedCourses = Object.keys(notificationResults).filter(
          courseId => !notificationResults[courseId].success
        );
        
        notificationResult = {
          success: successfulCourses.length > 0,
          courses: notificationResults,
          summary: {
            totalCourses: newlyAssigned.length,
            successful: successfulCourses.length,
            failed: failedCourses.length
          },
          errors: failedCourses.map(courseId => ({
            courseId,
            error: notificationResults[courseId].error
          }))
        };
        
      } catch (importError) {
        console.error('Failed to import notification service:', importError);
        notificationResult = {
          success: false,
          error: 'Failed to load notification service'
        };
      }
    }

    return {
      success: true,
      newlyAssigned,
      notificationResult
    };
  } catch (error) {
    console.error('Update assigned courses error:', error);
    throw error;
  }
};

// Helper function to validate course IDs
async function validateCourseIds(courseIds: string[]): Promise<string[]> {
  if (courseIds.length === 0) return [];
  
  try {
    // Create an array to hold promises for batched validation
    const validCourseIds: string[] = [];
    
    // Query all courses at once for better performance
    const coursesRef = collection(db, 'courses');
    const q = query(coursesRef, where('isActive', '==', true));
    const snapshot = await getDocs(q);
    
    // Create a map of valid course IDs for O(1) lookup
    const validCourseMap = new Map();
    snapshot.forEach(doc => {
      validCourseMap.set(doc.id, true);
    });
    
    // Check each course ID against our map
    for (const courseId of courseIds) {
      if (validCourseMap.has(courseId)) {
        validCourseIds.push(courseId);
      } else {
        console.warn(`Course ID ${courseId} does not exist or is not active`);
      }
    }
    
    return validCourseIds;
  } catch (error) {
    console.error('Error validating course IDs:', error);
    // In case of error, return the original list as a fallback
    return courseIds;
  }
}

// Delete a user and all their related data (admin only function)
export const deleteUser = async (userId: string): Promise<void> => {
  try {
    // Use the deployed Cloud Function for complete user deletion
    const deleteUserFunction = httpsCallable(functions, 'deleteUser');
    const result = await deleteUserFunction({ userId });
    
    console.log('User deletion result:', result.data);
  } catch (error) {
    console.error('Delete user error:', error);
    throw error;
  }
};

// Update user profile information
export interface UserProfileUpdate {
  displayName?: string;
  phoneNumber?: string;
  bio?: string;
  photoURL?: string;
}

export const updateUserProfile = async (userId: string, profileData: UserProfileUpdate): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userId);
    
    await updateDoc(userRef, {
      ...profileData,
      updatedAt: new Date()
    });
    
    // If displayName is being updated, update it in Firebase Auth as well
    if (profileData.displayName && auth.currentUser) {
      await updateDoc(userRef, {
        displayName: profileData.displayName
      });
    }
  } catch (error) {
    console.error('Update profile error:', error);
    throw error;
  }
}; 