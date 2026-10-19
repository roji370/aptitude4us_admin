import { 
  doc, 
  setDoc, 
  serverTimestamp, 
  query, 
  collection, 
  where, 
  getDocs,
  writeBatch,
  getDoc
} from "firebase/firestore";
import { db } from "../firebase/config";
import { getMessaging, getToken, onMessage } from "firebase/messaging";
import app from "../firebase/config";

// Types
export interface FCMToken {
  token: string;
  userId: string;
  deviceInfo?: {
    platform?: string;
    model?: string;
    appVersion?: string;
  };
  lastUpdated: Date;
}

// Initialize Firebase Cloud Messaging
const messaging = getMessaging(app);

/**
 * Request permission for notifications and get the FCM token
 * @returns {Promise<string|null>} The FCM token or null if permission denied
 */
export const requestNotificationPermission = async (): Promise<string | null> => {
  try {
    // Request permission
    const permission = await Notification.requestPermission();
    
    if (permission !== 'granted') {
      console.log('Notification permission denied');
      return null;
    }
    
    // Get the token
    // Replace with your actual VAPID key from Firebase Console
    const token = await getToken(messaging, {
      vapidKey: "BHblemqxT0lmvPXUWAv4C0inJhQopT-T5ftbG5W1Hrde01P5g6SfCrBpnm2N6q6oUODFWDazXcqvtWkgpK4azu4"
    });
    
    if (token) {
      console.log("FCM Token:", token);
      return token;
    } else {
      console.log("No registration token available");
      return null;
    }
  } catch (error) {
    console.error("Error requesting notification permission:", error);
    return null;
  }
};

/**
 * Save the FCM token to Firestore for the current user
 * @param {string} token - The FCM token
 * @param {string} userId - The user ID
 */
export const saveTokenToFirestore = async (token: string, userId: string): Promise<void> => {
  try {
    const deviceInfo = {
      platform: 'web',
      model: navigator.userAgent,
      appVersion: '1.0.0', // You can update this with your actual app version
    };

    // Clean up old tokens before saving the new one
    await _cleanupOldTokens(userId);

    await setDoc(doc(db, "user_tokens", token), {
      token,
      userId,
      timestamp: serverTimestamp(),
      platform: 'web',
      deviceInfo,
      lastUpdated: serverTimestamp(),
      isActive: true,
      appType: 'admin' // Mark this as the admin app
    });
    console.log("FCM token saved to Firestore");
  } catch (error) {
    console.error("Error saving FCM token to Firestore:", error);
  }
};

/**
 * Clean up old tokens for a user when registering a new one
 * This helps prevent the accumulation of stale tokens
 * @param {string} userId - The user ID
 * @private
 */
const _cleanupOldTokens = async (userId: string): Promise<void> => {
  try {
    // Get all tokens for this user
    const q = query(
      collection(db, 'user_tokens'),
      where('userId', '==', userId),
      where('appType', '==', 'admin') // Only clean up admin app tokens
    );

    const querySnapshot = await getDocs(q);
    
    // If there are more than 2 tokens, delete all but the 2 most recent
    if (querySnapshot.size > 2) {
      console.log(`Found ${querySnapshot.size} tokens for user ${userId}, cleaning up old ones`);
      
      // Sort tokens by timestamp (newest first)
      const tokens = querySnapshot.docs.map(doc => ({
        id: doc.id,
        data: doc.data(),
        timestamp: doc.data().timestamp?.toDate() || new Date(0)
      }));
      
      tokens.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      
      // Keep the 2 most recent tokens, delete the rest
      const tokensToDelete = tokens.slice(2);
      
      const batch = writeBatch(db);
      tokensToDelete.forEach(token => {
        const tokenRef = doc(db, 'user_tokens', token.id);
        batch.update(tokenRef, { isActive: false });
      });
      
      await batch.commit();
      console.log(`Marked ${tokensToDelete.length} old tokens as inactive`);
    }
  } catch (error) {
    console.error('Error cleaning up old tokens:', error);
    // Don't throw the error as this is a background operation
  }
};

/**
 * Clean up all tokens for a user except the current one
 * This is more aggressive than _cleanupOldTokens and should be used
 * when you want to ensure only the current device receives notifications
 * @param {string} currentToken - The current token to keep
 * @param {string} userId - The user ID
 */
export const cleanupAllTokensExceptCurrent = async (currentToken: string, userId: string): Promise<void> => {
  try {
    console.log(`Cleaning up all tokens except current for user ${userId}`);
    
    // Get all tokens for this user except the current one
    const q = query(
      collection(db, 'user_tokens'),
      where('userId', '==', userId),
      where('token', '!=', currentToken)
    );

    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.size > 0) {
      console.log(`Found ${querySnapshot.size} other tokens for user ${userId}, marking as inactive`);
      
      const batch = writeBatch(db);
      querySnapshot.forEach(document => {
        const tokenRef = doc(db, 'user_tokens', document.id);
        batch.update(tokenRef, { 
          isActive: false,
          deletedAt: serverTimestamp()
        });
      });
      
      await batch.commit();
      console.log(`Marked ${querySnapshot.size} tokens as inactive`);
    }
  } catch (error) {
    console.error('Error cleaning up all tokens except current:', error);
    // Don't throw the error as this is a background operation
  }
};

/**
 * Set up a listener for foreground messages
 * @returns {Promise<any>} Promise that resolves with the message payload
 */
export const onForegroundMessage = () =>
  new Promise<import('firebase/messaging').MessagePayload | null>((resolve) => {
    try {
      // First check if notifications are permitted
      if (Notification.permission !== 'granted') {
        console.log('Cannot listen for foreground messages: notifications not permitted');
        resolve(null);
        return;
      }

      onMessage(messaging, (payload) => {
        console.log('Foreground message received:', payload);
        
        // Log the payload structure to debug
        console.log('Payload structure:', JSON.stringify(payload, null, 2));
        
        // Handle payload from student app which uses chatId instead of messageId
        if (payload.data?.type === 'chat') {
          // Make sure we're setting "chatId" correctly from the payload
          console.log('Chat ID:', payload.data?.chatId);
          
          // Play sound for chat messages
          try {
            const audio = new Audio('/notification-sound.mp3');
            audio.play();
          } catch (error) {
            console.error('Error playing notification sound:', error);
          }
        }
        
        resolve(payload);
      });
    } catch (error) {
      console.error('Error setting up foreground message listener:', error);
      resolve(null);
    }
  });

/**
 * Initialize Firebase Cloud Messaging
 * @param {string} userId - The user ID
 * @returns {Promise<string|null>} The FCM token or null if initialization failed
 */
export const initializeMessaging = async (userId: string): Promise<string | null> => {
  try {
    // Check if messaging is supported
    if (!messaging) {
      console.log('Firebase messaging not available');
      return null;
    }

    // Check if notification permission is already granted
    if (Notification.permission === 'granted') {
      try {
        // Get the token directly
        const token = await getToken(messaging, {
          vapidKey: "BHblemqxT0lmvPXUWAv4C0inJhQopT-T5ftbG5W1Hrde01P5g6SfCrBpnm2N6q6oUODFWDazXcqvtWkgpK4azu4"
        });
        
        if (token) {
          try {
            await saveTokenToFirestore(token, userId);
          } catch (saveError) {
            console.warn('Failed to save FCM token to Firestore (non-fatal):', saveError);
          }
          
          try {
            // Get user role to determine which topics to subscribe to
            const userDoc = await getDoc(doc(db, 'users', userId));
            const role = userDoc.data()?.role || 'student';
            
            // Subscribe to appropriate topics based on user role
            if (role === 'admin') {
              await subscribeTopic(token, 'admin_chat');
            } else {
              await subscribeTopic(token, 'student_chat');
            }
            
            // Everyone subscribes to community chat, past questions, and general notifications
            await subscribeTopic(token, 'community_chat');
            await subscribeTopic(token, 'past_questions');
            await subscribeTopic(token, 'notifications');
          } catch (subscriptionError) {
            console.warn('Failed to subscribe to topics (non-fatal):', subscriptionError);
          }
          
          return token;
        }
      } catch (tokenError) {
        console.error('Failed to get FCM token:', tokenError);
        return null;
      }
    } else if (Notification.permission === 'denied') {
      console.log('Notifications are blocked. Please enable them in your browser settings.');
      return null;
    } else {
      // Request permission if not granted
      try {
        const token = await requestNotificationPermission();
        
        if (token) {
          try {
            await saveTokenToFirestore(token, userId);
          } catch (saveError) {
            console.warn('Failed to save FCM token to Firestore (non-fatal):', saveError);
          }
          
          try {
            // Get user role to determine which topics to subscribe to
            const userDoc = await getDoc(doc(db, 'users', userId));
            const role = userDoc.data()?.role || 'student';
            
            // Subscribe to appropriate topics based on user role
            if (role === 'admin') {
              await subscribeTopic(token, 'admin_chat');
            } else {
              await subscribeTopic(token, 'student_chat');
            }
            
            // Everyone subscribes to community chat, past questions, and general notifications
            await subscribeTopic(token, 'community_chat');
            await subscribeTopic(token, 'past_questions');
            await subscribeTopic(token, 'notifications');
          } catch (subscriptionError) {
            console.warn('Failed to subscribe to topics (non-fatal):', subscriptionError);
          }
          
          return token;
        }
      } catch (permissionError) {
        console.error('Failed to request notification permission:', permissionError);
        return null;
      }
    }
    
    return null;
  } catch (error) {
    console.error("Error initializing FCM (non-fatal):", error);
    return null;
  }
};

/**
 * Delete the FCM token from Firestore
 * @param {string} token - The FCM token to delete
 */
export const deleteToken = async (token: string): Promise<void> => {
  try {
    // Check if token exists first to avoid permission errors
    const tokenDoc = await getDoc(doc(db, "user_tokens", token));
    
    if (tokenDoc.exists()) {
      // Use set with merge which is more permissive than update
    await setDoc(doc(db, "user_tokens", token), {
      isActive: false,
        deletedAt: serverTimestamp(),
        logoutMethod: 'normal'
    }, { merge: true });
      console.log(`FCM token ${token.substring(0, 10)}... marked as inactive`);
    } else {
      console.log(`FCM token ${token.substring(0, 10)}... does not exist, no action needed`);
    }
  } catch (error) {
    console.error("Error marking FCM token as inactive:", error);
    // Don't rethrow - we don't want token errors to block logout
  }
};

/**
 * Emergency function to mark tokens as inactive without blocking
 * This function will not throw errors and can be used during logout
 * @param {string} userId - The user ID to mark tokens for
 */
export const emergencyMarkTokensInactive = (userId: string): void => {
  // Run this in the background, don't await it
  (async () => {
    try {
      console.log(`Emergency marking tokens as inactive for user ${userId}`);
      
      // Get all tokens for this user
      const q = query(
        collection(db, 'user_tokens'),
        where('userId', '==', userId),
        where('isActive', '==', true)
      );

      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.size > 0) {
        console.log(`Found ${querySnapshot.size} tokens to mark inactive`);
        
        // Use set with merge instead of update to avoid permission issues
        // Process one at a time instead of batch to avoid total failure if one fails
        for (const document of querySnapshot.docs) {
          try {
            await setDoc(doc(db, 'user_tokens', document.id), { 
              isActive: false,
              deletedAt: serverTimestamp(),
              logoutMethod: 'emergency'
            }, { merge: true });
            
            console.log(`Marked token ${document.id.substring(0, 10)}... as inactive`);
          } catch (tokenError) {
            console.error(`Error marking token ${document.id.substring(0, 10)}... as inactive:`, tokenError);
            // Continue with other tokens even if one fails
          }
        }
        
        console.log(`Emergency token cleanup completed`);
      }
    } catch (error) {
      console.error('Error in emergency token cleanup:', error);
      // Intentionally swallow errors to prevent blocking logout
    }
  })();
};

// Get all FCM tokens for a specific user
export const getUserFCMTokens = async (userId: string): Promise<FCMToken[]> => {
  try {
    const q = query(
      collection(db, 'user_tokens'),
      where('userId', '==', userId),
      where('isActive', '==', true) // Only get active tokens
    );

    const querySnapshot = await getDocs(q);
    const tokens: FCMToken[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      tokens.push({
        ...data,
        lastUpdated: data.lastUpdated?.toDate() || new Date()
      } as FCMToken);
    });

    return tokens;
  } catch (error) {
    console.error('Error getting user FCM tokens:', error);
    throw error;
  }
};

// Get all FCM tokens for all users
export const getAllFCMTokens = async (): Promise<FCMToken[]> => {
  try {
    const q = query(
      collection(db, 'user_tokens'),
      where('isActive', '==', true) // Only get active tokens
    );
    
    const querySnapshot = await getDocs(q);
    const tokens: FCMToken[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      tokens.push({
        ...data,
        lastUpdated: data.lastUpdated?.toDate() || new Date()
      } as FCMToken);
    });

    return tokens;
  } catch (error) {
    console.error('Error getting all FCM tokens:', error);
    throw error;
  }
};

// Get all FCM tokens for specific users
export const getMultipleUsersFCMTokens = async (userIds: string[]): Promise<FCMToken[]> => {
  try {
    if (userIds.length === 0) {
      return [];
    }
    
    const q = query(
      collection(db, 'user_tokens'),
      where('userId', 'in', userIds),
      where('isActive', '==', true) // Only get active tokens
    );

    const querySnapshot = await getDocs(q);
    const tokens: FCMToken[] = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      tokens.push({
        ...data,
        lastUpdated: data.lastUpdated?.toDate() || new Date()
      } as FCMToken);
    });

    return tokens;
  } catch (error) {
    console.error('Error getting multiple users FCM tokens:', error);
    throw error;
  }
};

/**
 * Subscribe a FCM token to a topic
 * @param {string} token - The FCM token
 * @param {string} topic - The topic to subscribe to
 * @returns {Promise<void>}
 */
export const subscribeTopic = async (token: string, topic: string): Promise<void> => {
  try {
    // Use the deployed function URL directly
    const functionBaseUrl = 'https://us-central1-course-c18bb.cloudfunctions.net';
    
    console.log(`Subscribing to topic ${topic} with URL: ${functionBaseUrl}/subscribeToTopic`);
    
    const response = await fetch(`${functionBaseUrl}/subscribeToTopic`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      mode: 'cors',
      body: JSON.stringify({ token, topic }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to subscribe to topic: ${response.statusText} - ${errorText}`);
    }
    
    console.log(`Successfully subscribed to topic: ${topic}`);
  } catch (error) {
    console.error(`Error subscribing to topic ${topic}:`, error);
    // Don't throw the error to avoid breaking the flow
  }
};

/**
 * Unsubscribe a FCM token from a topic
 * @param {string} token - The FCM token
 * @param {string} topic - The topic to unsubscribe from
 * @returns {Promise<void>}
 */
export const unsubscribeTopic = async (token: string, topic: string): Promise<void> => {
  try {
    // Use the deployed function URL directly
    const functionBaseUrl = 'https://us-central1-course-c18bb.cloudfunctions.net';
    
    console.log(`Unsubscribing from topic ${topic} with URL: ${functionBaseUrl}/unsubscribeFromTopic`);
    
    const response = await fetch(`${functionBaseUrl}/unsubscribeFromTopic`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      mode: 'cors',
      body: JSON.stringify({ token, topic }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to unsubscribe from topic: ${response.statusText} - ${errorText}`);
    }
    
    console.log(`Successfully unsubscribed from topic: ${topic}`);
  } catch (error) {
    console.error(`Error unsubscribing from topic ${topic}:`, error);
    // Don't throw the error to avoid breaking the flow
  }
}; 