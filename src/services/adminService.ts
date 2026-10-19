import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';
import { setUserCustomClaims } from './authService';
import type { User } from './authService';

// Batch size for Firestore operations
const BATCH_SIZE = 100;

/**
 * Updates custom claims for all users in the system
 * This is an admin-only function used to ensure all existing users have their claims updated
 */
export const updateAllUserClaims = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const usersRef = collection(db, 'users');
    const usersSnapshot = await getDocs(usersRef);
    
    if (usersSnapshot.empty) {
      return { success: true, message: 'No users found to update' };
    }
    
    let processedCount = 0;
    let errorCount = 0;
    const users: User[] = [];
    
    // Convert all user documents to our User model
    usersSnapshot.forEach((userDoc) => {
      const userData = userDoc.data();
      users.push({
        uid: userDoc.id,
        email: userData.email || null,
        displayName: userData.displayName || null,
        role: userData.role,
        assignedModules: userData.assignedModules || [],
        assignedCourseIds: userData.assignedCourseIds || []
      });
    });
    
    // Process users in batches to avoid rate limiting
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const userBatch = users.slice(i, i + BATCH_SIZE);
      const batchPromises = userBatch.map(async (user) => {
        try {
          // Set custom claims based on user data
          await setUserCustomClaims(user.uid, {
            role: user.role,
            assignedModules: user.assignedModules || [],
            assignedCourseIds: user.assignedCourseIds || []
          });
          processedCount++;
        } catch (error) {
          console.error(`Error updating claims for user ${user.uid}:`, error);
          errorCount++;
        }
      });
      
      // Wait for all operations in this batch to complete
      await Promise.all(batchPromises);
      
      // Add a short delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < users.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return { 
      success: true, 
      message: `Updated claims for ${processedCount} users. Errors: ${errorCount}` 
    };
  } catch (error) {
    console.error('Failed to update all user claims:', error);
    return { 
      success: false, 
      message: `Error updating user claims: ${error instanceof Error ? error.message : String(error)}` 
    };
  }
};

/**
 * Updates the custom claims timestamp for all users to force token refresh
 * This is useful when you need all users to get a fresh token
 */
export const forceTokenRefreshForAllUsers = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const usersRef = collection(db, 'users');
    const usersSnapshot = await getDocs(usersRef);
    
    if (usersSnapshot.empty) {
      return { success: true, message: 'No users found to update' };
    }
    
    // Use batched writes for better performance
    let currentBatch = writeBatch(db);
    let operationCount = 0;
    let batchCount = 0;
    
    usersSnapshot.forEach((userDoc) => {
      const userRef = doc(db, 'users', userDoc.id);
      currentBatch.update(userRef, {
        customClaimsUpdated: new Date()
      });
      
      operationCount++;
      
      // Firestore batches are limited to 500 operations
      if (operationCount === 499) {
        // Commit the current batch
        currentBatch.commit();
        // Start a new batch
        currentBatch = writeBatch(db);
        operationCount = 0;
        batchCount++;
      }
    });
    
    // Commit any remaining operations
    if (operationCount > 0) {
      await currentBatch.commit();
      batchCount++;
    }
    
    return { 
      success: true, 
      message: `Updated timestamp for ${usersSnapshot.size} users in ${batchCount + 1} batches` 
    };
  } catch (error) {
    console.error('Failed to update token refresh timestamps:', error);
    return { 
      success: false, 
      message: `Error updating timestamps: ${error instanceof Error ? error.message : String(error)}` 
    };
  }
}; 