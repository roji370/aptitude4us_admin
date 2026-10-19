import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  limit as firestoreLimit
} from 'firebase/firestore';
import { db } from '../firebase/config';

// Types
export interface Notification {
  id?: string;
  title: string;
  body: string;
  type: 'chat' | 'system' | 'announcement' | 'course' | 'course_assignment' | 'subscription_expiry' | 'payment_reminder';
  sender: string; // admin UID
  recipients: string[]; // empty array means broadcast to all
  timestamp: Date;
  read?: boolean;
  readTimestamp?: Date;
  courseId?: string; // optional, for course-related notifications
  subscriptionId?: string; // optional, for subscription-related notifications
  link?: string; // optional, for deep linking
  targetApp?: 'admin' | 'student' | 'both'; // which app should display this notification
}

// Send a new notification
export const sendNotification = async (
  title: string,
  body: string,
  type: 'chat' | 'system' | 'announcement' | 'course' | 'course_assignment' | 'subscription_expiry' | 'payment_reminder',
  sender: string,
  recipients: string[] = [], // Empty array for broadcast
  courseId?: string,
  subscriptionId?: string,
  link?: string,
  targetApp: 'admin' | 'student' | 'both' = 'both'
): Promise<string> => {
  try {
    const notification: Omit<Notification, 'id'> = {
      title,
      body,
      type,
      sender,
      recipients,
      timestamp: new Date(),
      targetApp
    };

    if (courseId) {
      notification.courseId = courseId;
    }

    if (subscriptionId) {
      notification.subscriptionId = subscriptionId;
    }

    if (link) {
      notification.link = link;
    }

    const docRef = await addDoc(collection(db, 'notifications'), {
      ...notification,
      timestamp: serverTimestamp()
    });

    return docRef.id;
  } catch (error) {
    console.error('Error sending notification:', error);
    throw error;
  }
};

// Get recent notifications
export const getRecentNotifications = async (
  targetApp: 'admin' | 'student' | 'both' = 'both',
  limitCount = 50
): Promise<Notification[]> => {
  try {
    const q = query(
      collection(db, 'notifications'),
      where('targetApp', 'in', [targetApp, 'both']),
      orderBy('timestamp', 'desc'),
      firestoreLimit(limitCount)
    );

    const querySnapshot = await getDocs(q);
    const notifications: Notification[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      notifications.push({
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate() || new Date(),
        readTimestamp: data.readTimestamp?.toDate()
      } as Notification);
    });

    return notifications;
  } catch (error) {
    console.error('Error getting recent notifications:', error);
    throw error;
  }
};

// Get notifications for a specific user
export const getUserNotifications = async (
  userId: string, 
  targetApp: 'admin' | 'student' | 'both' = 'both',
  limitCount = 50
): Promise<Notification[]> => {
  try {
    const q = query(
      collection(db, 'notifications'),
      where('recipients', 'array-contains', userId),
      where('targetApp', 'in', [targetApp, 'both']),
      orderBy('timestamp', 'desc'),
      firestoreLimit(limitCount)
    );

    const querySnapshot = await getDocs(q);
    const notifications: Notification[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      notifications.push({
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate() || new Date(),
        readTimestamp: data.readTimestamp?.toDate()
      } as Notification);
    });

    return notifications;
  } catch (error) {
    console.error('Error getting user notifications:', error);
    throw error;
  }
};

// Get notifications by type
export const getNotificationsByType = async (
  type: 'chat' | 'system' | 'announcement' | 'course' | 'course_assignment' | 'subscription_expiry' | 'payment_reminder',
  targetApp: 'admin' | 'student' | 'both' = 'both',
  limitCount = 50
): Promise<Notification[]> => {
  try {
    const q = query(
      collection(db, 'notifications'),
      where('type', '==', type),
      where('targetApp', 'in', [targetApp, 'both']),
      orderBy('timestamp', 'desc'),
      firestoreLimit(limitCount)
    );

    const querySnapshot = await getDocs(q);
    const notifications: Notification[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      notifications.push({
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate() || new Date(),
        readTimestamp: data.readTimestamp?.toDate()
      } as Notification);
    });

    return notifications;
  } catch (error) {
    console.error(`Error getting ${type} notifications:`, error);
    throw error;
  }
};

// Get subscription notifications
export const getSubscriptionNotifications = async (
  targetApp: 'admin' | 'student' | 'both' = 'both',
  limitCount = 50
): Promise<Notification[]> => {
  try {
    // Add a stricter filter to ensure we only get notifications specifically for the target app, 
    // not including 'both' if a specific app is requested
    let appFilter;
    if (targetApp === 'both') {
      appFilter = ['admin', 'student', 'both'];
    } else {
      appFilter = [targetApp, 'both'];
    }
    
    const q = query(
      collection(db, 'notifications'),
      where('type', 'in', ['subscription_expiry', 'payment_reminder']),
      where('targetApp', 'in', appFilter),
      orderBy('timestamp', 'desc'),
      firestoreLimit(limitCount)
    );

    const querySnapshot = await getDocs(q);
    const notifications: Notification[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      
      // Extra filter for admin role - only include notifications meant for admin
      if (targetApp === 'admin' && data.recipients && data.recipients.length > 0) {
        // Skip notifications that are for specific students but not for admin role
        if (data.targetApp === 'student' || !data.recipients.includes('admin')) {
          return; // Skip this notification
        }
      }
      
      notifications.push({
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate() || new Date(),
        readTimestamp: data.readTimestamp?.toDate()
      } as Notification);
    });

    return notifications;
  } catch (error) {
    console.error('Error getting subscription notifications:', error);
    throw error;
  }
};

// Create subscription expiry notification
export const createSubscriptionExpiryNotification = async (
  subscriptionId: string,
  userId: string,
  userName: string,
  daysLeft: number,
  expiryDate: Date,
  targetApp: 'admin' | 'student' | 'both'
): Promise<string> => {
  // Only send notifications when there are 3 days or less remaining
  if (daysLeft > 3) {
    throw new Error('Notifications should only be sent when there are 3 days or less remaining');
  }

  let title, body, link, recipients;
  
  // When explicitly sending to student only, use this simpler format
  if (targetApp === 'student') {
    title = 'Subscription Notice';
    body = `Your subscription will expire soon. Please renew to maintain access.`;
    link = '/subscription'; // Simple path for student app
    recipients = [userId]; // Only send to this specific student
    
    // Send notification directly to student only
    return sendNotification(
      title,
      body,
      'subscription_expiry',
      'system', // Use system as sender
      recipients,
      undefined, // No courseId
      subscriptionId,
      link,
      'student' // Explicitly only target student app
    );
  } 
  // When explicitly sending to admin only
  else if (targetApp === 'admin') {
    title = `Subscription Expiring Soon`;
    body = `${userName}'s subscription will expire in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} (${expiryDate.toLocaleDateString()})`;
    link = `/subscriptions/${subscriptionId}`;
    
    // Send notification to admin only
    return sendNotification(
      title,
      body,
      'subscription_expiry',
      'system',
      ['admin'], // Send to admin role instead of the user
      undefined,
      subscriptionId,
      link,
      'admin' // Explicitly only target admin app
    );
  } 
  // For both (general case - used by automatic notifications)
  else {
    const adminTitle = `Subscription Expiring Soon`;
    const adminBody = `${userName}'s subscription will expire in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} (${expiryDate.toLocaleDateString()})`;
    const adminLink = `/subscriptions/${subscriptionId}`;
    
    const studentTitle = 'Subscription Notice';
    const studentBody = `Your subscription will expire soon. Please renew to maintain access.`;
    const studentLink = '/subscription';
    
    // Send separate notifications for admin and student
    // First to admin
    await sendNotification(
      adminTitle,
      adminBody,
      'subscription_expiry',
      'system',
      ['admin'], // Send to admin role
      undefined,
      subscriptionId,
      adminLink,
      'admin' // Explicitly only target admin app
    );
    
    // Then to student
    return sendNotification(
      studentTitle,
      studentBody,
      'subscription_expiry',
      'system',
      [userId], // Send to the specific student
      undefined,
      subscriptionId,
      studentLink,
      'student' // Explicitly only target student app
    );
  }
};

// Mark notification as read
export const markNotificationAsRead = async (notificationId: string): Promise<void> => {
  try {
    const notificationRef = doc(db, 'notifications', notificationId);
    await updateDoc(notificationRef, {
      read: true,
      readTimestamp: serverTimestamp()
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
};

// Mark all notifications as read
export const markAllNotificationsAsRead = async (userId: string, targetApp: 'admin' | 'student' | 'both'): Promise<void> => {
  try {
    const q = query(
      collection(db, 'notifications'),
      where('recipients', 'array-contains', userId),
      where('targetApp', 'in', [targetApp, 'both']),
      where('read', '==', false)
    );

    const querySnapshot = await getDocs(q);
    
    for (const docSnapshot of querySnapshot.docs) {
      await updateDoc(doc(db, 'notifications', docSnapshot.id), {
        read: true,
        readTimestamp: serverTimestamp()
      });
    }
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
};

// Delete a notification
export const deleteNotification = async (notificationId: string): Promise<void> => {
  try {
    await deleteDoc(doc(db, 'notifications', notificationId));
  } catch (error) {
    console.error('Error deleting notification:', error);
    throw error;
  }
}; 