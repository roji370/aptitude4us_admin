import { 
  collection, 
  addDoc, 
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  query, 
  where, 
  orderBy, 
  limit as firestoreLimit,
  serverTimestamp,
  onSnapshot,
  Timestamp,
  DocumentData,
  QuerySnapshot,
  startAfter,
  DocumentSnapshot
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytes, 
  getDownloadURL,
  deleteObject 
} from 'firebase/storage';
import { db, storage } from '../firebase/config';

// Attachment interface
export interface MessageAttachment {
  id: string;
  name: string;
  type: 'image' | 'video' | 'document' | 'audio';
  url: string;
  size: number;
  mimeType: string;
  thumbnailUrl?: string; // For videos and images
}

// Reply interface for message threading
export interface MessageReply {
  messageId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: Date | Timestamp;
  type: 'text' | 'attachment' | 'mixed' | 'voice';
  attachments?: MessageAttachment[];
}

// Voice message interface
export interface VoiceMessage {
  id: string;
  url: string;
  duration: number; // in seconds
  mimeType: string;
  size: number; // in bytes
}

// Message Schema
export interface Message {
  id?: string;
  senderId: string;
  senderName: string;
  receiverId: string; // Student UID or "ALL" or "COMMUNITY"
  text: string;
  timestamp: Date | Timestamp;
  status: 'sent' | 'delivered' | 'read' | 'error' | 'sending';
  type: 'text' | 'attachment' | 'mixed' | 'voice'; // Added 'voice' type
  attachments?: MessageAttachment[];
  voiceMessage?: VoiceMessage; // Voice message data
  isCommunity?: boolean; // Flag for community messages
  replyTo?: MessageReply; // Reference to the message being replied to
}

export interface MessageResult {
  success: boolean;
  id?: string;
  error?: string;
}

export interface PaginationResult {
  messages: Message[];
  lastVisible: DocumentSnapshot | null;
  hasMore: boolean;
}

// Re-export Firestore types needed by components
export type { DocumentSnapshot }; 

// Helper for timestamp conversion
const getTimestampMs = (timestamp: Date | Timestamp): number => {
  if (timestamp instanceof Date) return timestamp.getTime();
  if (timestamp?.toDate) return timestamp.toDate().getTime();
  if (timestamp?.seconds) return timestamp.seconds * 1000 + (timestamp?.nanoseconds ? timestamp.nanoseconds / 1000000 : 0);
  return 0;
};

// Default page size for queries
const DEFAULT_PAGE_SIZE = 500;

// Upload voice message to Firebase Storage
export const uploadVoiceMessage = async (
  audioBlob: Blob,
  senderId: string,
  messageId: string
): Promise<{ url: string; size: number }> => {
  try {
    const fileName = `voice_messages/${senderId}/${messageId}_${Date.now()}.webm`;
    const storageRef = ref(storage, fileName);
    
    const uploadResult = await uploadBytes(storageRef, audioBlob);
    const downloadURL = await getDownloadURL(uploadResult.ref);
    
    return {
      url: downloadURL,
      size: audioBlob.size
    };
  } catch (error) {
    console.error('Error uploading voice message:', error);
    throw new Error('Failed to upload voice message');
  }
};

// Check database connectivity
export const checkDatabaseConnectivity = async (): Promise<{ connected: boolean; error?: string }> => {
  try {
    const testQuery = query(collection(db, 'users'), firestoreLimit(1));
    const testSnapshot = await getDocs(testQuery);
    const isConnected = !testSnapshot.empty;
    return { connected: isConnected };
  } catch (error) {
    console.error('Database connectivity check failed:', error);
    return { 
      connected: false, 
      error: error instanceof Error ? error.message : 'Unknown error connecting to Firestore' 
    };
  }
};

// Send a direct message
export const sendDirectMessage = async (
  text: string,
  senderId: string,
  senderName: string,
  receiverId: string,
  attachments?: MessageAttachment[],
  replyTo?: MessageReply,
  voiceMessage?: VoiceMessage
): Promise<MessageResult> => {
  try {
    // Determine message type
    let messageType: 'text' | 'attachment' | 'mixed' | 'voice' = 'text';
    if (voiceMessage) {
      messageType = 'voice';
    } else if (attachments && attachments.length > 0) {
      messageType = text.trim() ? 'mixed' : 'attachment';
    }

    const messageData: any = {
      text,
      senderId,
      senderName,
      receiverId,
      timestamp: serverTimestamp(),
      status: 'sent',
      type: messageType
    };

    // Add attachments if provided
    if (attachments && attachments.length > 0) {
      messageData.attachments = attachments;
    }

    // Add reply reference if provided
    if (replyTo) {
      messageData.replyTo = replyTo;
    }

    // Add voice message if provided
    if (voiceMessage) {
      messageData.voiceMessage = voiceMessage;
    }

    const docRef = await addDoc(collection(db, 'messages'), messageData);

    return { id: docRef.id, success: true };
  } catch (error) {
    console.error('Error sending direct message:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

// Send a broadcast message
export const sendBroadcastMessage = async (
  text: string,
  senderId: string,
  senderName: string,
  attachments?: MessageAttachment[],
  replyTo?: MessageReply,
  voiceMessage?: VoiceMessage
): Promise<MessageResult> => {
  try {
    // Determine message type
    let messageType: 'text' | 'attachment' | 'mixed' | 'voice' = 'text';
    if (voiceMessage) {
      messageType = 'voice';
    } else if (attachments && attachments.length > 0) {
      messageType = text.trim() ? 'mixed' : 'attachment';
    }

    const messageData: any = {
      text,
      senderId,
      senderName,
      receiverId: 'ALL',
      timestamp: serverTimestamp(),
      status: 'sent',
      type: messageType,
      isBroadcast: true // Add flag to clearly identify broadcast messages
    };

    // Add attachments if provided
    if (attachments && attachments.length > 0) {
      messageData.attachments = attachments;
    }

    // Add reply reference if provided
    if (replyTo) {
      messageData.replyTo = replyTo;
    }

    // Add voice message if provided
    if (voiceMessage) {
      messageData.voiceMessage = voiceMessage;
    }

    // Save the broadcast message to the messages collection
    const docRef = await addDoc(collection(db, 'messages'), messageData);

    // We no longer need to create a separate notification document
    // The Cloud Function 'sendChatNotification' will handle notifications
    // when it triggers on the message document creation
    
    return { id: docRef.id, success: true };
  } catch (error) {
    console.error('Error sending broadcast message:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

// Send a community message
export const sendCommunityMessage = async (
  text: string,
  senderId: string,
  senderName: string,
  attachments?: MessageAttachment[],
  replyTo?: MessageReply,
  voiceMessage?: VoiceMessage
): Promise<MessageResult> => {
  try {
    // Determine message type
    let messageType: 'text' | 'attachment' | 'mixed' | 'voice' = 'text';
    if (voiceMessage) {
      messageType = 'voice';
    } else if (attachments && attachments.length > 0) {
      messageType = text.trim() ? 'mixed' : 'attachment';
    }

    const messageData: any = {
      text,
      senderId,
      senderName,
      receiverId: 'COMMUNITY', // All community messages use this receiverId
      timestamp: serverTimestamp(),
      status: 'sent',
      type: messageType,
      isCommunity: true // Flag to identify community messages
    };

    // Add attachments if provided
    if (attachments && attachments.length > 0) {
      messageData.attachments = attachments;
    }

    // Add reply reference if provided
    if (replyTo) {
      messageData.replyTo = replyTo;
    }

    // Add voice message if provided
    if (voiceMessage) {
      messageData.voiceMessage = voiceMessage;
    }

    // Save the community message to the communityChat collection
    const docRef = await addDoc(collection(db, 'communityChat'), messageData);

    return { id: docRef.id, success: true };
  } catch (error) {
    console.error('Error sending community message:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

// Send a past questions message (admin only - for testing purposes)
export const sendPastQuestionsMessage = async (
  text: string,
  senderId: string,
  senderName: string,
  attachments?: MessageAttachment[],
  replyTo?: MessageReply,
  voiceMessage?: VoiceMessage
): Promise<MessageResult> => {
  try {
    // Determine message type
    let messageType: 'text' | 'attachment' | 'mixed' | 'voice' = 'text';
    if (voiceMessage) {
      messageType = 'voice';
    } else if (attachments && attachments.length > 0) {
      messageType = text.trim() ? 'mixed' : 'attachment';
    }

    const messageData: any = {
      text,
      senderId,
      senderName,
      receiverId: 'PAST_QUESTIONS',
      timestamp: serverTimestamp(),
      status: 'sent',
      type: messageType,
      isPastQuestions: true // Flag to identify past questions messages
    };

    // Add attachments if provided
    if (attachments && attachments.length > 0) {
      messageData.attachments = attachments;
    }

    // Add reply reference if provided
    if (replyTo) {
      messageData.replyTo = replyTo;
    }

    // Add voice message if provided
    if (voiceMessage) {
      messageData.voiceMessage = voiceMessage;
    }

    // Save the past questions message to the pastQuestions collection
    const docRef = await addDoc(collection(db, 'pastQuestions'), messageData);

    return { id: docRef.id, success: true };
  } catch (error) {
    console.error('Error sending past questions message:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

// Fetch sent messages with pagination support
export const fetchSentMessages = async (
  adminId: string,
  lastVisible: DocumentSnapshot | null = null,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<PaginationResult> => {
  try {
    let q = query(
      collection(db, 'messages'),
      where('senderId', '==', adminId),
      orderBy('timestamp', 'desc'),
      firestoreLimit(pageSize)
    );
    
    // If we have a last visible document, start after it
    if (lastVisible) {
      q = query(
        collection(db, 'messages'),
        where('senderId', '==', adminId),
        orderBy('timestamp', 'desc'),
        startAfter(lastVisible),
        firestoreLimit(pageSize)
      );
    }
    
    const snapshot = await getDocs(q);
    const messages: Message[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      // Convert timestamp to Date regardless of future dates
      let messageTimestamp;
      if (data.timestamp) {
        messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
      } else {
        messageTimestamp = new Date();
      }
      
      messages.push({
        id: doc.id,
        ...data,
        timestamp: messageTimestamp
      } as Message);
    });
    
    // Sort by timestamp (newest first - since we're loading older messages)
    messages.sort((a, b) => getTimestampMs(b.timestamp) - getTimestampMs(a.timestamp));
    
    // Get the last document for pagination
    const lastVisibleDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
    const hasMore = snapshot.docs.length >= pageSize;
    
    return {
      messages,
      lastVisible: lastVisibleDoc,
      hasMore
    };
  } catch (error) {
    console.error('Error fetching sent messages:', error);
    return {
      messages: [],
      lastVisible: null,
      hasMore: false
    };
  }
};

// Fetch received messages with pagination support
export const fetchReceivedMessages = async (
  lastVisible: DocumentSnapshot | null = null,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<PaginationResult> => {
  try {
    let q = query(
      collection(db, 'messages'),
      where('receiverId', 'in', ['ADMIN', 'ALL']),
      orderBy('timestamp', 'desc'),
      firestoreLimit(pageSize)
    );
    
    // If we have a last visible document, start after it
    if (lastVisible) {
      q = query(
        collection(db, 'messages'),
        where('receiverId', 'in', ['ADMIN', 'ALL']),
        orderBy('timestamp', 'desc'),
        startAfter(lastVisible),
        firestoreLimit(pageSize)
      );
    }
    
    const snapshot = await getDocs(q);
    const messages: Message[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      // Convert timestamp to Date regardless of future dates
      let messageTimestamp;
      if (data.timestamp) {
        messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
      } else {
        messageTimestamp = new Date();
      }
      
      messages.push({
        id: doc.id,
        ...data,
        timestamp: messageTimestamp
      } as Message);
    });
    
    // Sort by timestamp (newest first - since we're loading older messages)
    messages.sort((a, b) => getTimestampMs(b.timestamp) - getTimestampMs(a.timestamp));
    
    // Get the last document for pagination
    const lastVisibleDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
    const hasMore = snapshot.docs.length >= pageSize;
    
    return {
      messages,
      lastVisible: lastVisibleDoc,
      hasMore
    };
  } catch (error) {
    console.error('Error fetching received messages:', error);
    return {
      messages: [],
      lastVisible: null,
      hasMore: false
    };
  }
};

// Fetch community messages with pagination support
export const fetchCommunityMessages = async (
  lastVisible: DocumentSnapshot | null = null,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<PaginationResult> => {
  try {
    let q = query(
      collection(db, 'communityChat'),
      orderBy('timestamp', 'desc'),
      firestoreLimit(pageSize)
    );
    
    // If we have a last visible document, start after it
    if (lastVisible) {
      q = query(
        collection(db, 'communityChat'),
        orderBy('timestamp', 'desc'),
        startAfter(lastVisible),
        firestoreLimit(pageSize)
      );
    }
    
    const snapshot = await getDocs(q);
    const messages: Message[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      // Convert timestamp to Date regardless of future dates
      let messageTimestamp;
      if (data.timestamp) {
        messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
      } else {
        messageTimestamp = new Date();
      }
      
      messages.push({
        id: doc.id,
        ...data,
        timestamp: messageTimestamp
      } as Message);
    });
    
    // Sort by timestamp (newest first - since we're loading older messages)
    messages.sort((a, b) => getTimestampMs(b.timestamp) - getTimestampMs(a.timestamp));
    
    // Get the last document for pagination
    const lastVisibleDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
    const hasMore = snapshot.docs.length >= pageSize;
    
    return {
      messages,
      lastVisible: lastVisibleDoc,
      hasMore
    };
  } catch (error) {
    console.error('Error fetching community messages:', error);
    return {
      messages: [],
      lastVisible: null,
      hasMore: false
    };
  }
};

// Fetch past questions messages with pagination support
export const fetchPastQuestionsMessages = async (
  lastVisible: DocumentSnapshot | null = null,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<PaginationResult> => {
  try {
    let q = query(
      collection(db, 'pastQuestions'),
      orderBy('timestamp', 'desc'),
      firestoreLimit(pageSize)
    );
    
    // If we have a last visible document, start after it
    if (lastVisible) {
      q = query(
        collection(db, 'pastQuestions'),
        orderBy('timestamp', 'desc'),
        startAfter(lastVisible),
        firestoreLimit(pageSize)
      );
    }
    
    const snapshot = await getDocs(q);
    const messages: Message[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      // Convert timestamp to Date regardless of future dates
      let messageTimestamp;
      if (data.timestamp) {
        messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
      } else {
        messageTimestamp = new Date();
      }
      
      messages.push({
        id: doc.id,
        ...data,
        timestamp: messageTimestamp
      } as Message);
    });
    
    // Sort by timestamp (newest first - since we're loading older messages)
    messages.sort((a, b) => getTimestampMs(b.timestamp) - getTimestampMs(a.timestamp));
    
    // Get the last document for pagination
    const lastVisibleDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
    const hasMore = snapshot.docs.length >= pageSize;
    
    return {
      messages,
      lastVisible: lastVisibleDoc,
      hasMore
    };
  } catch (error) {
    console.error('Error fetching past questions messages:', error);
    return {
      messages: [],
      lastVisible: null,
      hasMore: false
    };
  }
};

// Listen for messages sent by the admin
export const listenToSentMessages = (
  adminId: string,
  onMessages: (messages: Message[]) => void,
  onError: (error: Error) => void
): () => void => {
  try {
    // Query for most recent messages first (desc order)
    const q = query(
      collection(db, 'messages'),
      where('senderId', '==', adminId),
      orderBy('timestamp', 'desc'),
      firestoreLimit(DEFAULT_PAGE_SIZE)
    );
    
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const messages: Message[] = [];
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Convert timestamp to Date regardless of future dates
          let messageTimestamp;
          if (data.timestamp) {
            messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
          } else {
            messageTimestamp = new Date();
          }
          
          messages.push({
            id: doc.id,
            ...data,
            timestamp: messageTimestamp
          } as Message);
        });
        
        // Note: we don't sort here - the messages are already in desc order
        // from Firestore. The component will handle proper display ordering.
        onMessages(messages);
      },
      onError
    );
    
    return unsubscribe;
  } catch (error) {
    console.error('Error setting up sent messages listener:', error);
    return () => {}; // Return empty function if setup fails
  }
};

// Listen for messages received by the admin
export const listenToReceivedMessages = (
  onMessages: (messages: Message[]) => void,
  onError: (error: Error) => void
): () => void => {
  try {
    const processMessages = (snapshot: QuerySnapshot<DocumentData>) => {
      const messages: Message[] = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.senderId && data.receiverId) {
          // Convert timestamp to Date regardless of future dates
          let messageTimestamp;
          if (data.timestamp) {
            messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
          } else {
            messageTimestamp = new Date();
          }
          
          messages.push({
            id: doc.id,
            ...data,
            timestamp: messageTimestamp
          } as Message);
        }
      });
      
      // Note: we don't sort here - the messages are already in desc order
      // from Firestore. The component will handle proper display ordering.
      onMessages(messages);
    };
    
    // Query for both direct messages to ADMIN and broadcast messages (ALL)
    // in desc order (newest first)
    const q = query(
      collection(db, 'messages'),
      where('receiverId', 'in', ['ADMIN', 'ALL']),
      orderBy('timestamp', 'desc'),
      firestoreLimit(DEFAULT_PAGE_SIZE)
    );
    
    const unsubscribe = onSnapshot(q, processMessages, onError);
    return unsubscribe;
  } catch (error) {
    console.error('Error setting up received messages listener:', error);
    return () => {};
  }
};

// Listen to community messages in real-time
export const listenToCommunityMessages = (
  onMessages: (messages: Message[]) => void,
  onError: (error: Error) => void
): () => void => {
  try {
    const q = query(
      collection(db, 'communityChat'),
      orderBy('timestamp', 'desc'),
      firestoreLimit(30)
    );
    
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const messages: Message[] = [];
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Convert timestamp to Date regardless of future dates
          let messageTimestamp;
          if (data.timestamp) {
            messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
          } else {
            messageTimestamp = new Date();
          }
          
          messages.push({
            id: doc.id,
            ...data,
            timestamp: messageTimestamp
          } as Message);
        });
        
        // Sort by timestamp (newest first)
        messages.sort((a, b) => getTimestampMs(b.timestamp) - getTimestampMs(a.timestamp));
        
        onMessages(messages);
      },
      (error) => {
        console.error('Error listening to community messages:', error);
        onError(error);
      }
    );
    
    return unsubscribe;
  } catch (error) {
    console.error('Error setting up community messages listener:', error);
    onError(error instanceof Error ? error : new Error('Unknown error'));
    return () => {}; // Return empty function as fallback
  }
};

// Listen to past questions messages in real-time
export const listenToPastQuestionsMessages = (
  onMessages: (messages: Message[]) => void,
  onError: (error: Error) => void
): () => void => {
  try {
    const q = query(
      collection(db, 'pastQuestions'),
      orderBy('timestamp', 'desc'),
      firestoreLimit(50) // Load more for monitoring purposes
    );
    
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const messages: Message[] = [];
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Convert timestamp to Date regardless of future dates
          let messageTimestamp;
          if (data.timestamp) {
            messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
          } else {
            messageTimestamp = new Date();
          }
          
          messages.push({
            id: doc.id,
            ...data,
            timestamp: messageTimestamp
          } as Message);
        });
        
        // Sort by timestamp (newest first)
        messages.sort((a, b) => getTimestampMs(b.timestamp) - getTimestampMs(a.timestamp));
        
        onMessages(messages);
      },
      (error) => {
        console.error('Error listening to past questions messages:', error);
        onError(error);
      }
    );
    
    return unsubscribe;
  } catch (error) {
    console.error('Error setting up past questions messages listener:', error);
    onError(error instanceof Error ? error : new Error('Unknown error'));
    return () => {}; // Return empty function as fallback
  }
};

// Update message status
export const updateMessageStatus = async (
  messageId: string,
  status: 'sent' | 'delivered' | 'read'
): Promise<void> => {
  try {
    const messageRef = doc(db, 'messages', messageId);
    await updateDoc(messageRef, {
      status,
      statusTimestamp: serverTimestamp()
    });
  } catch (error) {
    console.error('Error updating message status:', error);
    throw error;
  }
};

// Delete a message from the database
export const deleteMessage = async (messageId: string): Promise<{ success: boolean; error?: string }> => {
  try {
    console.log('🗑️ Deleting message:', messageId);
    
    if (!messageId) {
      throw new Error('Message ID is required');
    }

    const messageRef = doc(db, 'messages', messageId);
    await deleteDoc(messageRef);
    
    console.log('✅ Message deleted successfully:', messageId);
    return { success: true };
  } catch (error) {
    console.error('❌ Error deleting message:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to delete message' 
    };
  }
}; 