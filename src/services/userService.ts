import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  query, 
  where,
  orderBy,
  Timestamp,
  DocumentSnapshot,
  setDoc,
  addDoc,
  limit
} from 'firebase/firestore';
import type { SnapshotOptions } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { User } from '../services/authService';

// Extended user interface for admin views
export interface UserDetails extends User {
  lastLogin?: Date;
  lastLoginIp?: string;
  deviceInfo?: string;
  createdAt: Date;
  updatedAt: Date;
  phoneNumber?: string;
  bio?: string;
}

// Progress interface to track student module completion
export interface Progress {
  id: string;
  userId: string;
  moduleId: string;
  courseId: string;
  completed: boolean;
  completedAt?: Date;
  lastAccessedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Login log interface for tracking user activity
export interface LoginLog {
  id: string;
  userId: string;
  ipAddress: string;
  timestamp: Date;
  deviceInfo: string;
}

// Firestore converter for UserDetails
const userConverter = {
  toFirestore: (user: Omit<UserDetails, 'uid'>) => {
    const result: Record<string, unknown> = {
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      assignedModules: user.assignedModules || [],
      assignedCourseIds: user.assignedCourseIds || [],
      updatedAt: Timestamp.fromDate(user.updatedAt)
    };

    if (user.lastLogin) {
      console.log(`Converting lastLogin date to Firestore timestamp: ${user.lastLogin}`);
      result.lastLogin = Timestamp.fromDate(user.lastLogin);
    }

    if (user.createdAt) {
      result.createdAt = Timestamp.fromDate(user.createdAt);
    }

    if (user.lastLoginIp) {
      result.lastLoginIp = user.lastLoginIp;
    }

    if (user.deviceInfo) {
      result.deviceInfo = user.deviceInfo;
    }

    if (user.deviceRestriction) {
      result.deviceRestriction = {
        enabled: user.deviceRestriction.enabled,
        registeredDeviceId: user.deviceRestriction.registeredDeviceId,
        registeredAt: user.deviceRestriction.registeredAt ? Timestamp.fromDate(user.deviceRestriction.registeredAt) : undefined
      };
    }

    return result;
  },
  fromFirestore: (snapshot: DocumentSnapshot, options: SnapshotOptions) => {
    const data = snapshot.data(options);
    if (!data) return {} as UserDetails;
    
    const result: UserDetails = {
      uid: snapshot.id,
      email: data.email,
      displayName: data.displayName,
      role: data.role as 'admin' | 'student',
      assignedModules: data.assignedModules || [],
      assignedCourseIds: data.assignedCourseIds || [],
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(),
      updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date()
    };

    if (data.lastLogin) {
      console.log(`Converting Firestore timestamp to lastLogin date: ${data.lastLogin}`);
      result.lastLogin = data.lastLogin instanceof Timestamp ? data.lastLogin.toDate() : new Date(data.lastLogin);
    }

    if (data.lastLoginIp) {
      result.lastLoginIp = data.lastLoginIp;
    }

    if (data.deviceInfo) {
      result.deviceInfo = data.deviceInfo;
    }

    if (data.deviceRestriction) {
      result.deviceRestriction = {
        enabled: data.deviceRestriction.enabled || false,
        registeredDeviceId: data.deviceRestriction.registeredDeviceId,
        registeredAt: data.deviceRestriction.registeredAt instanceof Timestamp ? 
          data.deviceRestriction.registeredAt.toDate() : 
          data.deviceRestriction.registeredAt ? new Date(data.deviceRestriction.registeredAt) : undefined
      };
    }

    if (data.phoneNumber) {
      result.phoneNumber = data.phoneNumber;
    }

    if (data.bio) {
      result.bio = data.bio;
    }

    return result;
  }
};

// Firestore converter for Progress
const progressConverter = {
  toFirestore: (progress: Omit<Progress, 'id'>) => {
    const result: Record<string, unknown> = {
      userId: progress.userId,
      moduleId: progress.moduleId,
      courseId: progress.courseId,
      completed: progress.completed,
      lastAccessedAt: Timestamp.fromDate(progress.lastAccessedAt),
      createdAt: Timestamp.fromDate(progress.createdAt),
      updatedAt: Timestamp.fromDate(progress.updatedAt)
    };

    if (progress.completedAt) {
      result.completedAt = Timestamp.fromDate(progress.completedAt);
    }

    return result;
  },
  fromFirestore: (snapshot: DocumentSnapshot, options: SnapshotOptions) => {
    const data = snapshot.data(options);
    if (!data) return {} as Progress;
    
    const result: Progress = {
      id: snapshot.id,
      userId: data.userId,
      moduleId: data.moduleId,
      courseId: data.courseId,
      completed: data.completed,
      lastAccessedAt: data.lastAccessedAt.toDate(),
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate()
    };

    if (data.completedAt) {
      result.completedAt = data.completedAt.toDate();
    }

    return result;
  }
};

// Get all users
export const getUsers = async (): Promise<UserDetails[]> => {
  try {
    const usersRef = collection(db, 'users').withConverter(userConverter);
    const q = query(usersRef, orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    
    return querySnapshot.docs.map((doc) => doc.data() as UserDetails);
  } catch (error) {
    console.error('Error getting users:', error);
    throw error;
  }
};

// Get users by role
export const getUsersByRole = async (role: 'admin' | 'student'): Promise<UserDetails[]> => {
  try {
    const usersRef = collection(db, 'users').withConverter(userConverter);
    const q = query(usersRef, where('role', '==', role), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    
    return querySnapshot.docs.map((doc) => doc.data() as UserDetails);
  } catch (error) {
    console.error(`Error getting ${role}s:`, error);
    throw error;
  }
};

// Get user by ID
export const getUserById = async (userId: string): Promise<UserDetails | null> => {
  try {
    const userRef = doc(db, 'users', userId).withConverter(userConverter);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      return userSnap.data() as UserDetails;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting user by ID:', error);
    throw error;
  }
};

// Update user details
export const updateUser = async (userId: string, userData: Partial<Omit<UserDetails, 'uid' | 'createdAt' | 'updatedAt'>>): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userId);
    
    await updateDoc(userRef, {
      ...userData,
      updatedAt: new Date()
    });
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
};

// Assign modules to user
export const assignModulesToUser = async (userId: string, moduleIds: string[]): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userId);
    
    await updateDoc(userRef, {
      assignedModules: moduleIds,
      updatedAt: new Date()
    });
  } catch (error) {
    console.error('Error assigning modules to user:', error);
    throw error;
  }
};

// Get user progress
export const getUserProgress = async (userId: string): Promise<Progress[]> => {
  try {
    const progressRef = collection(db, `users/${userId}/progress`).withConverter(progressConverter);
    const q = query(progressRef, orderBy('updatedAt', 'desc'));
    const querySnapshot = await getDocs(q);
    
    return querySnapshot.docs.map((doc) => doc.data() as Progress);
  } catch (error) {
    console.error('Error getting user progress:', error);
    throw error;
  }
};

// Get user progress for a specific module
export const getUserModuleProgress = async (userId: string, moduleId: string): Promise<Progress | null> => {
  try {
    const progressRef = doc(db, `users/${userId}/progress`, moduleId).withConverter(progressConverter);
    const progressSnap = await getDoc(progressRef);
    
    if (progressSnap.exists()) {
      return progressSnap.data() as Progress;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting user module progress:', error);
    throw error;
  }
};

// Update user progress
export const updateUserProgress = async (userId: string, moduleId: string, courseId: string, completed: boolean): Promise<void> => {
  try {
    const progressRef = doc(db, `users/${userId}/progress`, moduleId);
    
    const now = new Date();
    const progressData: Omit<Progress, 'id'> = {
      userId,
      moduleId,
      courseId,
      completed,
      lastAccessedAt: now,
      createdAt: now,
      updatedAt: now
    };
    
    if (completed) {
      progressData.completedAt = now;
    }
    
    const progressSnap = await getDoc(progressRef);
    
    if (progressSnap.exists()) {
      // Update existing progress
      await updateDoc(progressRef, {
        completed,
        lastAccessedAt: now,
        updatedAt: now,
        ...(completed ? { completedAt: now } : {})
      });
    } else {
      // Create new progress
      await setDoc(progressRef, progressData);
    }
  } catch (error) {
    console.error('Error updating user progress:', error);
    throw error;
  }
};

// Log user login
export const logUserLogin = async (userId: string, ipAddress: string, deviceInfo: string): Promise<void> => {
  try {
    console.log(`Logging user login: userId=${userId}, ipAddress=${ipAddress}`);
    const logRef = collection(db, 'login_logs');
    
    const now = new Date();
    const timestamp = Timestamp.fromDate(now);
    
    await addDoc(logRef, {
      userId,
      ipAddress,
      deviceInfo,
      timestamp
    });
    
    // Update user's last login info
    const userRef = doc(db, 'users', userId);
    
    console.log(`Updating user lastLogin to: ${now.toString()}`);
    await updateDoc(userRef, {
      lastLogin: timestamp,
      lastLoginIp: ipAddress,
      deviceInfo,
      updatedAt: timestamp
    });
    console.log('User lastLogin successfully updated');
  } catch (error) {
    console.error('Error logging user login:', error);
    // Add more detailed error logging
    if (error instanceof Error) {
      console.error(`Error details: ${error.message}`);
      console.error(`Error stack: ${error.stack}`);
    }
    throw error;
  }
};

// Get login logs for a user
export const getUserLoginLogs = async (userId: string): Promise<LoginLog[]> => {
  try {
    const logsRef = collection(db, 'login_logs');
    const q = query(logsRef, where('userId', '==', userId), orderBy('timestamp', 'desc'));
    const querySnapshot = await getDocs(q);
    
    return querySnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId,
        ipAddress: data.ipAddress,
        deviceInfo: data.deviceInfo,
        timestamp: data.timestamp.toDate()
      };
    });
  } catch (error) {
    console.error('Error getting user login logs:', error);
    throw error;
  }
};

// Get all login logs
export const getAllLoginLogs = async (limitCount = 100): Promise<LoginLog[]> => {
  try {
    const logsRef = collection(db, 'login_logs');
    const q = query(logsRef, orderBy('timestamp', 'desc'), limit(limitCount));
    const querySnapshot = await getDocs(q);
    
    return querySnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId,
        ipAddress: data.ipAddress,
        deviceInfo: data.deviceInfo,
        timestamp: data.timestamp.toDate()
      };
    });
  } catch (error) {
    console.error('Error getting all login logs:', error);
    throw error;
  }
}; 