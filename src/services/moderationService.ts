import { 
  doc, 
  deleteDoc, 
  collection, 
  query, 
  where, 
  getDocs,
  updateDoc
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { deleteObject, ref } from 'firebase/storage';
import { storage } from '../firebase/config';

// Delete a message from any collection (community, past questions, etc.)
export const deleteMessage = async (
  messageId: string, 
  collectionName: 'communityChat' | 'pastQuestions' | 'messages'
): Promise<{ success: boolean; error?: string }> => {
  try {
    // Delete the message document
    await deleteDoc(doc(db, collectionName, messageId));
    
    return { success: true };
  } catch (error) {
    console.error(`Error deleting message from ${collectionName}:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

// Delete message attachments from storage
export const deleteMessageAttachments = async (
  attachments: Array<{ url: string; name: string }>
): Promise<{ success: boolean; error?: string }> => {
  try {
    for (const attachment of attachments) {
      try {
        // Extract the storage path from the download URL
        const storageRef = ref(storage, attachment.url);
        await deleteObject(storageRef);
      } catch (error) {
        console.error(`Error deleting attachment ${attachment.name}:`, error);
        // Continue with other attachments even if one fails
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting message attachments:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

// Get user's message activity for moderation review
export const getUserMessageActivity = async (
  userId: string,
  collectionName: 'communityChat' | 'pastQuestions' = 'pastQuestions'
): Promise<{
  success: boolean;
  messages?: any[];
  totalCount?: number;
  error?: string;
}> => {
  try {
    const q = query(
      collection(db, collectionName),
      where('senderId', '==', userId)
    );
    
    const snapshot = await getDocs(q);
    const messages: any[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      messages.push({
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp)
      });
    });
    
    // Sort by timestamp (newest first)
    messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    return {
      success: true,
      messages,
      totalCount: messages.length
    };
  } catch (error) {
    console.error(`Error fetching user message activity from ${collectionName}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

// Block user from posting messages (mark user as blocked)
export const blockUserFromMessaging = async (
  userId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      isBlockedFromMessaging: true,
      blockedAt: new Date(),
      blockedReason: 'Inappropriate content violation'
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error blocking user from messaging:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

// Unblock user from posting messages
export const unblockUserFromMessaging = async (
  userId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      isBlockedFromMessaging: false,
      unblockedAt: new Date()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error unblocking user from messaging:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};

// Search messages by content for moderation
export const searchMessagesForModeration = async (
  searchTerm: string,
  collectionName: 'communityChat' | 'pastQuestions' = 'pastQuestions',
  limit: number = 50
): Promise<{
  success: boolean;
  messages?: any[];
  error?: string;
}> => {
  try {
    // Note: Firestore doesn't support full-text search natively
    // This is a basic implementation that can be enhanced with Algolia or similar
    const q = query(
      collection(db, collectionName),
      where('text', '>=', searchTerm),
      where('text', '<=', searchTerm + '\uf8ff')
    );
    
    const snapshot = await getDocs(q);
    const messages: any[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      messages.push({
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp)
      });
    });
    
    // Sort by timestamp (newest first)
    messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    return {
      success: true,
      messages: messages.slice(0, limit)
    };
  } catch (error) {
    console.error(`Error searching messages in ${collectionName}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

// Get message statistics for admin dashboard
export const getMessageStatistics = async (): Promise<{
  success: boolean;
  stats?: {
    pastQuestions: { total: number; today: number; thisWeek: number };
    communityChat: { total: number; today: number; thisWeek: number };
  };
  error?: string;
}> => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Get past questions stats
    const pastQuestionsSnapshot = await getDocs(collection(db, 'pastQuestions'));
    const pastQuestionsToday = await getDocs(
      query(collection(db, 'pastQuestions'), where('timestamp', '>=', today))
    );
    const pastQuestionsThisWeek = await getDocs(
      query(collection(db, 'pastQuestions'), where('timestamp', '>=', thisWeek))
    );
    
    // Get community chat stats
    const communityChatSnapshot = await getDocs(collection(db, 'communityChat'));
    const communityChatToday = await getDocs(
      query(collection(db, 'communityChat'), where('timestamp', '>=', today))
    );
    const communityChatThisWeek = await getDocs(
      query(collection(db, 'communityChat'), where('timestamp', '>=', thisWeek))
    );
    
    return {
      success: true,
      stats: {
        pastQuestions: {
          total: pastQuestionsSnapshot.size,
          today: pastQuestionsToday.size,
          thisWeek: pastQuestionsThisWeek.size
        },
        communityChat: {
          total: communityChatSnapshot.size,
          today: communityChatToday.size,
          thisWeek: communityChatThisWeek.size
        }
      }
    };
  } catch (error) {
    console.error('Error getting message statistics:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};
