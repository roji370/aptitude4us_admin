import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Divider,
  IconButton,
  CircularProgress,
  Alert,
  Avatar,
  Select,
  MenuItem,
  FormControl,
  SelectChangeEvent,
  Checkbox,
  Popover,
  Snackbar,
  Zoom,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions
} from '@mui/material';
import {
  Send as SendIcon,
  Forum as ForumIcon,
  EmojiEmotions as EmojiIcon,
  Info as InfoIcon,
  History as HistoryIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  People as PeopleIcon,
  QuestionAnswer as QuestionAnswerIcon,
  Delete as DeleteIcon,
  Reply as ReplyIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import './Chat.css';
import {
  Message,
  MessageAttachment,
  MessageReply,
  VoiceMessage,
  sendDirectMessage,
  sendBroadcastMessage,
  sendCommunityMessage,
  sendPastQuestionsMessage,
  fetchPastQuestionsMessages,
  checkDatabaseConnectivity,
  deleteMessage,
  uploadVoiceMessage,
} from '../services/messageService';
import AttachmentPicker from '../components/AttachmentPicker';
import MessageAttachmentDisplay from '../components/MessageAttachmentDisplay';
import VoiceRecorder from '../components/VoiceRecorder';
import VoiceMessageDisplay from '../components/VoiceMessageDisplay';
import { getUsers } from '../services/userService';
import EmojiPicker, { EmojiClickData } from 'emoji-picker-react';
import { auth } from '../firebase/config';
import { Virtuoso } from 'react-virtuoso';
import { DocumentSnapshot, Timestamp } from 'firebase/firestore';
import { collection, query, where, orderBy, limit, onSnapshot, startAfter, getDocs, addDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

// Extend window interface for URL testing cache
declare global {
  interface Window {
    testedUrls?: Set<string>;
  }
}

// User interface for recipient selection
interface UserOption {
  id: string;
  displayName: string;
  email: string;
  photoURL?: string | null;
  role?: string;
}

// Extended Message interface to include additional properties (used for type-checking message display)
interface ExtendedMessage extends Message {
  isBroadcast?: boolean;
  receiverName?: string;
  read?: boolean;
}

// Student app AttachmentData structure
interface StudentAttachmentData {
  id: string;
  fileName: string;     // Student app uses 'fileName' not 'name'
  fileUrl: string;      // Student app uses 'fileUrl' not 'url'
  thumbnailUrl?: string;
  type: string;
  fileSize: number;     // Student app uses 'fileSize' not 'size'
  mimeType: string;
  metadata?: Record<string, unknown>;
}

// Student app compatibility - handles AttachmentData structure
interface StudentMessage extends Message {
  attachment?: StudentAttachmentData | MessageAttachment | MessageAttachment[];
}

// Chat mode type
type ChatMode = 'broadcast' | 'direct' | 'community' | 'pastQuestions';

// Function to get date key for a message
const getDateKey = (msg: Message): string => {
  if (!msg.timestamp) return '';
  const date = msg.timestamp instanceof Date 
    ? msg.timestamp 
    : msg.timestamp.toDate();
  return date.toDateString();
};

// Admin Chat Component based on student app team schema
const AdminChat: React.FC = () => {
  // Auth state
  const { currentUser, isAdmin } = useAuth();
  
  // Add error boundary logging
  console.log('🚀 AdminChat component mounting...');
  console.log('Current user:', currentUser);
  
  // Chat mode state
  const [chatMode, setChatMode] = useState<ChatMode>('broadcast');
  
  // Message state
  const [message, setMessage] = useState<string>('');
  const [isBroadcast, setIsBroadcast] = useState<boolean>(true);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<MessageAttachment[]>([]);
  
  // Reply state
  const [replyingTo, setReplyingTo] = useState<MessageReply | null>(null);
  
  // Unified message state
  const [messageMap, setMessageMap] = useState<Map<string, Message>>(new Map());
  
  // Community chat state
  const [communityMessageMap, setCommunityMessageMap] = useState<Map<string, Message>>(new Map());
  const [communityLastVisible, setCommunityLastVisible] = useState<DocumentSnapshot | null>(null);
  const [communityHasMoreMessages, setCommunityHasMoreMessages] = useState<boolean>(true);
  const [communityIsLoadingMore, setCommunityIsLoadingMore] = useState<boolean>(false);
  
  // Past Questions chat state
  const [pastQuestionsMessageMap, setPastQuestionsMessageMap] = useState<Map<string, Message>>(new Map());
  const [pastQuestionsLastVisible, setPastQuestionsLastVisible] = useState<DocumentSnapshot | null>(null);
  const [pastQuestionsHasMoreMessages, setPastQuestionsHasMoreMessages] = useState<boolean>(true);
  const [pastQuestionsIsLoadingMore, setPastQuestionsIsLoadingMore] = useState<boolean>(false);
  
  // UI state
  const [loading, setLoading] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [dbConnected, setDbConnected] = useState<boolean>(false);

  // Delete message state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState<boolean>(false);
  const [messageToDelete, setMessageToDelete] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  // Pagination state
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [hasMoreMessages, setHasMoreMessages] = useState<boolean>(true);
  const [lastVisible, setLastVisible] = useState<DocumentSnapshot | null>(null);
  const [initialLoadComplete, setInitialLoadComplete] = useState<boolean>(false);

  // Refs
  const textFieldRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const virtuosoRef = useRef<import('react-virtuoso').VirtuosoHandle>(null);
  
  // Add a search field to filter recipients
  const [recipientSearch, setRecipientSearch] = useState<string>('');

  // Emoji picker state
  const [emojiAnchorEl, setEmojiAnchorEl] = useState<HTMLButtonElement | null>(null);
  const emojiPickerOpen = Boolean(emojiAnchorEl);

  // Filter users based on search term (only students for dropdown)
  const filteredUserOptions = useMemo(() => {
    const students = userOptions.filter(user => user.role === 'student');
    if (!recipientSearch.trim()) return students;
    
    const searchTerm = recipientSearch.toLowerCase();
    return students.filter(user => 
      user.displayName.toLowerCase().includes(searchTerm) || 
      user.email.toLowerCase().includes(searchTerm)
    );
  }, [userOptions, recipientSearch]);

  // State for error snackbar
  const [errorSnackbarOpen, setErrorSnackbarOpen] = useState<boolean>(false);

  // User selection state
  const [selectedUser] = useState<UserOption | null>({
    id: 'ALL',
    displayName: 'All Students',
    email: '',
    photoURL: null
  });

  // Track if user is at the bottom
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Fetch messages as a fallback
  const fetchAllMessages = useCallback(async () => {
    try {
      console.log("Fetching messages directly...");
      setLoading(true);
      
      // Get most recent messages with pagination
      const recentMessagesQuery = query(
        collection(db, 'messages'),
        orderBy('timestamp', 'desc'),
        limit(30)
      );
      
      const snapshot = await getDocs(recentMessagesQuery);
      console.log(`Fetched ${snapshot.size} recent messages`);
      
      const newMessages = new Map<string, Message>();
      
      // Process all messages
      snapshot.forEach(doc => {
        const data = doc.data();
        
        // Only include messages relevant to this admin
        if (
          currentUser && (
            data.senderId === currentUser.uid || 
            data.receiverId === 'ADMIN' || 
            data.receiverId === 'ALL' ||
            data.receiverId === 'admin' ||
            data.receiverId === 'all' ||
            data.receiverId === 'Admin' ||
            data.receiverId === 'All'
          )
        ) {
          // Convert timestamp to Date regardless of future dates
          let messageTimestamp;
          if (data.timestamp) {
            messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
          } else {
            messageTimestamp = new Date();
          }
          
          newMessages.set(doc.id, {
            id: doc.id,
            ...data,
            timestamp: messageTimestamp
          } as Message);
        }
      });
      
      console.log(`Found ${newMessages.size} relevant messages`);
      
      // Update message map atomically
      setMessageMap(prevMessages => {
        const updatedMessages = new Map(prevMessages);
        newMessages.forEach((msg, id) => {
          updatedMessages.set(id, msg);
        });
        console.log(`Total messages in map after update: ${updatedMessages.size}`);
        return updatedMessages;
      });
      
      // Set hasMoreMessages to true since we're only loading a limited number
      setHasMoreMessages(true);
      
      // If we have any messages, set the lastVisible document for pagination
      if (snapshot.docs.length > 0) {
        setLastVisible(snapshot.docs[snapshot.docs.length - 1]);
      }
      
      setLoading(false);
      setInitialLoadComplete(true);
    } catch (error) {
      console.error("Error fetching messages:", error);
      setLoading(false);
      setInitialLoadComplete(true);
    }
  }, [currentUser]);

  // Fetch community messages
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchCommunityMessages = useCallback(async () => {
    try {
      console.log("Fetching community messages directly...");
      setLoading(true);
      
      // Get most recent messages with pagination
      const recentMessagesQuery = query(
        collection(db, 'communityChat'),
        orderBy('timestamp', 'desc'),
        limit(30)
      );
      
      const snapshot = await getDocs(recentMessagesQuery);
      console.log(`Fetched ${snapshot.size} community messages`);
      
      const newMessages = new Map<string, Message>();
      
      // Process all messages
      snapshot.forEach(doc => {
        const data = doc.data();
        
        // Convert timestamp to Date regardless of future dates
        let messageTimestamp;
        if (data.timestamp) {
          messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
        } else {
          messageTimestamp = new Date();
        }
        
        newMessages.set(doc.id, {
          id: doc.id,
          ...data,
          timestamp: messageTimestamp
        } as Message);
      });
      
      console.log(`Found ${newMessages.size} community messages`);
      
      // Update community message map atomically
      setCommunityMessageMap(prevMessages => {
        const updatedMessages = new Map(prevMessages);
        newMessages.forEach((msg, id) => {
          updatedMessages.set(id, msg);
        });
        console.log(`Total community messages in map after update: ${updatedMessages.size}`);
        return updatedMessages;
      });
      
      // Set hasMoreMessages to true since we're only loading a limited number
      setCommunityHasMoreMessages(true);
      
      // If we have any messages, set the lastVisible document for pagination
      if (snapshot.docs.length > 0) {
        setCommunityLastVisible(snapshot.docs[snapshot.docs.length - 1]);
      }
      
      setLoading(false);
      setInitialLoadComplete(true);
    } catch (error) {
      console.error("Error fetching community messages:", error);
      setLoading(false);
      setInitialLoadComplete(true);
    }
  }, []);

  // Fetch past questions messages for admin monitoring
  const fetchPastQuestionsMessagesForAdmin = useCallback(async () => {
    try {
      console.log("🔄 Fetching past questions messages for admin monitoring...");
      // Prevent multiple simultaneous calls
      if (pastQuestionsIsLoadingMore) {
        console.log("⚠️ Already fetching past questions, skipping");
        return;
      }
      setLoading(true);
      
      const result = await fetchPastQuestionsMessages(null, 50);
      
      const newMessages = new Map<string, Message>();
      result.messages.forEach((msg) => {
        if (msg.id) {
          newMessages.set(msg.id, msg);
        }
      });
      
      console.log(`Found ${newMessages.size} past questions messages`);
      
      setPastQuestionsMessageMap(newMessages);
      setPastQuestionsHasMoreMessages(result.hasMore);
      
      if (result.lastVisible) {
        setPastQuestionsLastVisible(result.lastVisible);
      }
      
      setLoading(false);
      setInitialLoadComplete(true);
    } catch (error) {
      console.error("Error fetching past questions messages:", error);
      setLoading(false);
      setInitialLoadComplete(true);
    }
  }, [pastQuestionsIsLoadingMore]);

  // Load more community messages
  const loadMoreCommunityMessages = async () => {
    try {
      if (communityIsLoadingMore || !communityHasMoreMessages || !communityLastVisible) {
        console.log("📄 Cannot load more community messages:", { 
          communityIsLoadingMore, 
          communityHasMoreMessages, 
          communityLastVisible: !!communityLastVisible 
        });
        return;
      }
      
      console.log("📄 Loading more community messages...");
      setCommunityIsLoadingMore(true);
      
      // Query for older messages using the lastVisible document
      const olderMessagesQuery = query(
        collection(db, 'communityChat'),
        orderBy('timestamp', 'desc'),
        startAfter(communityLastVisible),
        limit(20)
      );
      
      const snapshot = await getDocs(olderMessagesQuery);
      console.log(`Fetched ${snapshot.size} older community messages`);
      
      if (snapshot.empty) {
        setCommunityHasMoreMessages(false);
        setCommunityIsLoadingMore(false);
        return;
      }
      
      const newMessages = new Map<string, Message>();
      
      snapshot.forEach(doc => {
        const data = doc.data();
        let messageTimestamp;
        if (data.timestamp) {
          messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
        } else {
          messageTimestamp = new Date();
        }
        newMessages.set(doc.id, {
          id: doc.id,
          ...data,
          timestamp: messageTimestamp
        } as Message);
      });
      
      setCommunityMessageMap(prevMessages => {
        const updatedMessages = new Map(prevMessages);
        newMessages.forEach((msg, id) => {
          updatedMessages.set(id, msg);
        });
        return updatedMessages;
      });
      
      if (snapshot.docs.length > 0) {
        setCommunityLastVisible(snapshot.docs[snapshot.docs.length - 1]);
      }
      setCommunityHasMoreMessages(snapshot.size >= 20);
      setCommunityIsLoadingMore(false);

      // After loading, scroll to the first message of the previous batch (now at index snapshot.size)
      setTimeout(() => {
        if (virtuosoRef.current) {
          virtuosoRef.current.scrollToIndex({
            index: snapshot.size,
            behavior: 'auto'
          });
        }
      }, 100);
    } catch (error) {
      console.error("Failed to load more community messages:", error);
      setError("Failed to load more community messages");
      setCommunityIsLoadingMore(false);
    }
  };

  // Load more past questions messages
  const loadMorePastQuestionsMessages = async () => {
    try {
      if (pastQuestionsIsLoadingMore || !pastQuestionsHasMoreMessages || !pastQuestionsLastVisible) {
        console.log("❓ Cannot load more past questions messages:", { 
          pastQuestionsIsLoadingMore, 
          pastQuestionsHasMoreMessages, 
          pastQuestionsLastVisible: !!pastQuestionsLastVisible 
        });
        return;
      }
      
      console.log("❓ Loading more past questions messages...");
      setPastQuestionsIsLoadingMore(true);
      
      const result = await fetchPastQuestionsMessages(pastQuestionsLastVisible, 20);
      
      if (result.messages.length === 0) {
        setPastQuestionsHasMoreMessages(false);
        setPastQuestionsIsLoadingMore(false);
        return;
      }
      
      const newMessages = new Map<string, Message>();
      result.messages.forEach((msg) => {
        if (msg.id) {
          newMessages.set(msg.id, msg);
        }
      });
      
      setPastQuestionsMessageMap(prevMessages => {
        const updatedMessages = new Map(prevMessages);
        newMessages.forEach((msg, id) => {
          updatedMessages.set(id, msg);
        });
        return updatedMessages;
      });
      
      if (result.lastVisible) {
        setPastQuestionsLastVisible(result.lastVisible);
      }
      setPastQuestionsHasMoreMessages(result.hasMore);
      setPastQuestionsIsLoadingMore(false);

      // In pastQuestions, do not force scroll after loading older messages
      if (chatMode !== 'pastQuestions') {
        setTimeout(() => {
          if (virtuosoRef.current) {
            virtuosoRef.current.scrollToIndex({
              index: result.messages.length,
              behavior: 'auto'
            });
          }
        }, 100);
      }
    } catch (error) {
      console.error("Failed to load more past questions messages:", error);
      setError("Failed to load more past questions messages");
      setPastQuestionsIsLoadingMore(false);
    }
  };

  // Process messages for display
  const sortedMessages = useMemo(() => {
    console.log(`Processing ${messageMap.size} messages for display`);
    const allMessages: Message[] = [];
    messageMap.forEach(msg => { allMessages.push(msg); });
    // Sort messages by timestamp (oldest to newest for proper rendering)
    const sorted = allMessages.sort((a, b) => {
      const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : (a.timestamp as Timestamp).toDate().getTime();
      const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : (b.timestamp as Timestamp).toDate().getTime();
      return timeA - timeB;
    });
    console.log(`Sorted ${sorted.length} messages for display`);
    if (sorted.length > 0) {
      console.log("First message (oldest):", sorted[0]);
      if (sorted.length > 1) { console.log("Second message:", sorted[1]); }
      console.log("Last message (newest):", sorted[sorted.length - 1]);
    }
    return sorted;
  }, [messageMap]);

  // Process community messages for display
  const sortedCommunityMessages = useMemo(() => {
    console.log(`Processing ${communityMessageMap.size} community messages for display`);
    const allMessages: Message[] = [];
    communityMessageMap.forEach(msg => { allMessages.push(msg); });
    // Sort messages by timestamp (oldest to newest for proper rendering)
    const sorted = allMessages.sort((a, b) => {
      const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : (a.timestamp as Timestamp).toDate().getTime();
      const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : (b.timestamp as Timestamp).toDate().getTime();
      return timeA - timeB;
    });
    console.log(`Sorted ${sorted.length} community messages for display`);
    if (sorted.length > 0) {
      console.log("First community message (oldest):", sorted[0]);
      if (sorted.length > 1) { console.log("Second community message:", sorted[1]); }
      console.log("Last community message (newest):", sorted[sorted.length - 1]);
    }
    return sorted;
  }, [communityMessageMap]);

  // Process past questions messages for display
  const sortedPastQuestionsMessages = useMemo(() => {
    console.log(`Processing ${pastQuestionsMessageMap.size} past questions messages for display`);
    const allMessages: Message[] = [];
    pastQuestionsMessageMap.forEach(msg => { allMessages.push(msg); });
    
    const sorted = allMessages.sort((a, b) => {
      const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : a.timestamp?.toDate?.()?.getTime?.() || 0;
      const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : b.timestamp?.toDate?.()?.getTime?.() || 0;
      return timeA - timeB;
    });
    console.log(`Sorted ${sorted.length} past questions messages for display`);
    return sorted;
  }, [pastQuestionsMessageMap]);

  // Get the active messages based on the chat mode
  const activeMessages = useMemo(() => {
    if (chatMode === 'community') return sortedCommunityMessages;
    if (chatMode === 'pastQuestions') return sortedPastQuestionsMessages;
    return sortedMessages;
  }, [chatMode, sortedMessages, sortedCommunityMessages, sortedPastQuestionsMessages]);

  // Get the active message flags for the virtuoso component
  const messagesWithDateFlags = useMemo(() => {
    return activeMessages.map((msg, idx) => {
      const dateKey = getDateKey(msg);
      let showDateSeparator = false;
      
      // Show separator if this is the first message or first with this date
      if (idx === 0 || dateKey !== getDateKey(activeMessages[idx - 1])) {
        showDateSeparator = true;
      }
      
      return {
        message: msg,
        showDateSeparator
      };
    });
  }, [activeMessages]);

  // Track the index and id of the topmost visible message
  const topIndexRef = useRef(0);
  const topMessageIdRef = useRef<string | null>(null);

  // Helper function to format message date for display
  const formatMessageDate = (timestamp: Date | Timestamp | undefined) => {
    if (!timestamp) return '';
    
    const date = timestamp instanceof Date ? timestamp : timestamp.toDate();
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
  };

  // Debounce function for smoother scrolling
  const debounce = <F extends (...args: unknown[]) => unknown>(
    func: F,
    waitFor: number
  ): ((...args: Parameters<F>) => void) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    
    return (...args: Parameters<F>): void => {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => func(...args), waitFor);
    };
  };

  // Virtuoso rangeChanged handler to track top visible message
  const handleRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    topIndexRef.current = range.startIndex;
    const msg = activeMessages[range.startIndex];
    topMessageIdRef.current = msg && msg.id ? msg.id : null;
  }, [activeMessages]);

  // Handle error snackbar close
  const handleErrorSnackbarClose = () => {
    setErrorSnackbarOpen(false);
    setError(null);
  };

  // Lock body scroll only while chat page is mounted
  useEffect(() => {
    document.body.classList.add('chat-page-active');
    return () => {
      document.body.classList.remove('chat-page-active');
    };
  }, []);

  // Effect to show error snackbar when error is set
  useEffect(() => {
    if (error) {
      setErrorSnackbarOpen(true);
    }
  }, [error]);

  // Check database connectivity on component mount
  useEffect(() => {
    if (!currentUser) return;
    
    console.log("🔄 Main useEffect triggered for user:", currentUser.uid);

    // Check database connectivity on component mount
    const checkConnectivity = async () => {
      try {
        const result = await checkDatabaseConnectivity();
        setDbConnected(result.connected);
        
        if (!result.connected) {
          setError(`Database connectivity issue: ${result.error}`);
        }
      } catch (err) {
        console.error('Error checking database connectivity:', err);
        setDbConnected(false);
        setError('Failed to connect to database');
      }
    };

    // Check if communityChat collection exists
    const checkCommunityChatCollection = async () => {
      try {
        console.log("Checking if communityChat collection exists...");
        
        // Try to get a single document from the collection
        const q = query(
          collection(db, 'communityChat'),
          where('text', '==', 'Welcome to Community Chat! This is where admins and students can interact together.'),
          limit(1)
        );
        const snapshot = await getDocs(q);
        
        // If no welcome message exists, create an initial message
        if (snapshot.empty) {
          console.log("No welcome message found, creating initial message");
          await createTestCommunityMessage();
        } else {
          console.log("Welcome message already exists, skipping creation");
        }
      } catch (error) {
        console.error("Error checking communityChat collection:", error);
      }
    };

    // Use the existing fetchCommunityMessages callback - no need for duplicate function

  // Fetch users for recipient selection
    const fetchUsers = async () => {
      try {
        const users = await getUsers();
        // Get all users for name lookup, but only show students in dropdown
        const allUsers = users.map(user => ({
            id: user.uid,
            displayName: user.displayName || 'Unknown User',
          email: user.email || '',
          role: user.role
        }));
        
        // Store all users for name lookup (dropdown filtering happens in filteredUserOptions)
        setUserOptions(allUsers.sort((a, b) => a.displayName.localeCompare(b.displayName)));
      } catch (err) {
        console.error('Error fetching users:', err);
        setError('Failed to load user list');
      }
    };
    
    // Check connectivity and fetch users
    checkConnectivity();
    fetchUsers();
    checkCommunityChatCollection();

    // Set up a single unified listener for all messages
    console.log(`📡 Setting up unified message listener for admin ${currentUser.uid}`);
    console.log(`📊 Current loading states - loading: ${loading}, initialLoadComplete: ${initialLoadComplete}`);
    setLoading(true);
    
    // Add a delayed fetchAllMessages call as a fallback if listeners don't return anything
    const fallbackTimer = setTimeout(() => {
      setMessageMap(currentMap => {
        if (currentMap.size === 0 && initialLoadComplete) {
          console.log("No messages from listeners, using fallback");
          fetchAllMessages();
        }
        return currentMap;
      });
      
      setCommunityMessageMap(currentMap => {
        if (currentMap.size === 0) {
          console.log("No community messages from listeners, skipping fallback to prevent loops");
          // Don't call fetchCommunityMessages here to prevent infinite loops
        }
        return currentMap;
      });
    }, 3000);
    
    // Use a query that gets only the most recent messages
    const messagesQuery = query(
      collection(db, 'messages'),
      orderBy('timestamp', 'desc'),
      limit(30) // Only load the most recent 30 messages initially
    );
    
    // Listen for all messages
    const messagesUnsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        console.log(`Messages snapshot received: ${snapshot.docs.length} documents`);
        const newMessages = new Map<string, Message>();
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          
          // Only include messages relevant to this admin
          if (
            currentUser && (
              data.senderId === currentUser.uid || 
              data.receiverId === 'ADMIN' || 
              data.receiverId === 'ALL' ||
              data.receiverId === 'admin' ||
              data.receiverId === 'all' ||
              data.receiverId === 'Admin' ||
              data.receiverId === 'All'
            )
          ) {
            // Convert timestamp to Date regardless of future dates
            let messageTimestamp;
            if (data.timestamp) {
              messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
            } else {
              messageTimestamp = new Date();
            }
            
            newMessages.set(doc.id, {
              id: doc.id,
              ...data,
              timestamp: messageTimestamp
            } as Message);
          }
        });
        
        console.log(`Found ${newMessages.size} relevant messages`);
        
        // Update message map atomically
        setMessageMap(prevMessages => {
          const updatedMessages = new Map(prevMessages);
          newMessages.forEach((msg, id) => {
            updatedMessages.set(id, msg);
          });
          console.log(`Total messages in map after update: ${updatedMessages.size}`);
          return updatedMessages;
        });
        
        // Set hasMoreMessages to true since we're only loading a limited number initially
        setHasMoreMessages(true);
        
        // If we have any messages, set the lastVisible document for pagination
        if (snapshot.docs.length > 0) {
          setLastVisible(snapshot.docs[snapshot.docs.length - 1]);
        }
        
        setLoading(false);
        setInitialLoadComplete(true);
      },
      (error) => {
        console.error('Messages listener error:', error);
        setError('Error loading messages');
        setLoading(false);
      }
    );

    

    // Set up community messages listener (only if not in pastQuestions mode)
    const communityMessagesQuery = query(
      collection(db, 'communityChat'),
      orderBy('timestamp', 'desc'),
      limit(30) // Only load the most recent 30 messages initially
    );
    
    // Listen for community messages (only when not viewing Past Questions)
    let communityMessagesUnsubscribe = () => {};
    if (chatMode !== 'pastQuestions') {
      try {
        communityMessagesUnsubscribe = onSnapshot(
          communityMessagesQuery,
        (snapshot) => {
          console.log(`📄 Community messages snapshot received: ${snapshot.docs.length} documents`);
          const newMessages = new Map<string, Message>();
          
          snapshot.forEach((doc) => {
            const data = doc.data();
            
            // Convert timestamp to Date regardless of future dates
            let messageTimestamp;
            if (data.timestamp) {
              messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
          } else {
              messageTimestamp = new Date();
            }
            
            newMessages.set(doc.id, {
              id: doc.id,
              ...data,
              timestamp: messageTimestamp
            } as Message);
          });
          
          console.log(`Found ${newMessages.size} community messages`);
          
          // Update community message map atomically
          setCommunityMessageMap(prevMessages => {
            const updatedMessages = new Map(prevMessages);
            newMessages.forEach((msg, id) => {
              updatedMessages.set(id, msg);
            });
            console.log(`Total community messages in map after update: ${updatedMessages.size}`);
            return updatedMessages;
          });
          
          // Set hasMoreMessages to true since we're only loading a limited number initially
          setCommunityHasMoreMessages(true);
          
          // If we have any messages, set the lastVisible document for pagination
          if (snapshot.docs.length > 0) {
            setCommunityLastVisible(snapshot.docs[snapshot.docs.length - 1]);
          }
          
          // Hide loading indicator once we have messages
          setLoading(false);
          setInitialLoadComplete(true);
      },
      (error) => {
          console.error('Error listening to community messages:', error);
          setError(`Error loading community messages: ${error.message}`);
        setLoading(false);
      }
    );
      } catch (error) {
        console.error('Error setting up community messages listener:', error);
        setError(`Error setting up community chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
        setLoading(false);
      }
    }

    // Set up past questions messages listener
    const pastQuestionsMessagesQuery = query(
      collection(db, 'pastQuestions'),
      orderBy('timestamp', 'desc'),
      limit(50) // Load more for monitoring purposes
    );
    
    // Listen for past questions messages (only when viewing Past Questions)
    let pastQuestionsMessagesUnsubscribe = () => {};
    if (chatMode === 'pastQuestions') {
      try {
        pastQuestionsMessagesUnsubscribe = onSnapshot(
          pastQuestionsMessagesQuery,
        (snapshot) => {
          console.log(`❓ Past questions messages snapshot received: ${snapshot.docs.length} documents`);
          const newMessages = new Map<string, Message>();
          
          snapshot.forEach((doc) => {
            const data = doc.data();
            
            // Convert timestamp to Date regardless of future dates
            let messageTimestamp;
            if (data.timestamp) {
              messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
            } else {
              messageTimestamp = new Date();
            }
            
            newMessages.set(doc.id, {
              id: doc.id,
              ...data,
              timestamp: messageTimestamp
            } as Message);
          });
          
          // Update past questions message map atomically
          setPastQuestionsMessageMap(prevMessages => {
            const updatedMessages = new Map(prevMessages);
            newMessages.forEach((msg, id) => {
              updatedMessages.set(id, msg);
            });
            console.log(`Total past questions messages in map after update: ${updatedMessages.size}`);
            return updatedMessages;
          });
          
          // Set hasMoreMessages to true since we're only loading a limited number initially
          setPastQuestionsHasMoreMessages(true);
          
          // If we have any messages, set the lastVisible document for pagination
          if (snapshot.docs.length > 0) {
            setPastQuestionsLastVisible(snapshot.docs[snapshot.docs.length - 1]);
          }
        },
        (error) => {
          console.error('Error listening to past questions messages:', error);
          setError(`Failed to listen to past questions: ${error.message}`);
        }
      );
      } catch (error) {
        console.error('Error setting up past questions messages listener:', error);
        setError(`Failed to set up past questions listener: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Cleanup function to unsubscribe from listeners
    return () => {
      console.log('Cleaning up message listeners');
      clearTimeout(fallbackTimer);
      messagesUnsubscribe();
      communityMessagesUnsubscribe();
      pastQuestionsMessagesUnsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, initialLoadComplete]); // Removed function dependencies to prevent infinite loops

  // Check if we have any messages to display
  const hasMessages = useMemo(() => {
    const hasAny = activeMessages.length > 0;
    console.log(`Has messages check: ${hasAny} (${activeMessages.length} messages)`);
    return hasAny;
  }, [activeMessages.length]);

  // Update the debounced scroll to bottom function
  const debouncedScrollToBottom = useMemo(() => 
    debounce(() => {
      if (chatMode === 'pastQuestions') return;
      if (virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({
          index: messagesWithDateFlags.length - 1,
          behavior: 'smooth'
        });
        
        // Set a small timeout to ensure isAtBottom is set to true after scrolling
        setTimeout(() => {
          setIsAtBottom(true);
        }, 300);
      }
    }, 150), 
  [chatMode, messagesWithDateFlags.length]);

  // Replace the existing scrollToBottom function with the debounced version
  const scrollToBottom = useCallback(() => {
    // Force isAtBottom to true first to prevent FAB from appearing during scroll
    setIsAtBottom(true);
    // Scroll immediately rather than using the debounced version for button clicks
    if (virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({
        index: messagesWithDateFlags.length - 1,
        behavior: 'smooth'
      });
    }
  }, [messagesWithDateFlags.length]);

  // Scroll to bottom when new messages arrive and user is at bottom
  useEffect(() => {
    if (
      chatMode !== 'pastQuestions' &&
      isAtBottom &&
      messagesWithDateFlags.length > 0 &&
      !loading &&
      !isLoadingMore &&
      !communityIsLoadingMore &&
      !pastQuestionsIsLoadingMore
    ) {
      // Use a small timeout to ensure the UI has updated before scrolling
      const timer = setTimeout(() => {
        // Double-check conditions before scrolling
        if (
          (chatMode as ChatMode) !== 'pastQuestions' &&
          isAtBottom &&
          !loading &&
          !isLoadingMore &&
          !communityIsLoadingMore &&
          !pastQuestionsIsLoadingMore
        ) {
          debouncedScrollToBottom();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps  
  }, [chatMode, messagesWithDateFlags.length, loading, isLoadingMore, communityIsLoadingMore, pastQuestionsIsLoadingMore, isAtBottom]); // Removed debouncedScrollToBottom to prevent loops

  // Format timestamp for display - WhatsApp style
  const formatTime = useCallback((date: Date | undefined) => {
    if (!date) return '';
    
    // WhatsApp only shows time in bubbles
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, []);

  // Add a CSS class for message bubbles to make them more compact
  const MessageBubble = ({ isCurrentUser, children }: { isCurrentUser: boolean, children: React.ReactNode }) => (
    <Paper 
      elevation={1}
      className={isCurrentUser ? 'message-bubble-outgoing' : 'message-bubble-incoming'}
      sx={{ 
        p: 0.8, // tighter padding
        mt: 0,
        display: 'inline-block',
        minWidth: 'auto',
        maxWidth: '100%',
        wordBreak: 'break-word',
        borderRadius: isCurrentUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        boxShadow: isCurrentUser ? '0 1px 3px rgba(7, 26, 82, 0.12)' : '0 1px 3px rgba(7, 26, 82, 0.04)',
        border: isCurrentUser ? 'none' : '1px solid #E2E8F0',
        lineHeight: 1.4,
        backgroundColor: isCurrentUser ? '#071A52' : '#ffffff',
        color: isCurrentUser ? '#ffffff' : 'inherit',
        '& .message-timestamp': {
          color: isCurrentUser ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)'
        }
      }}
    >
      {children}
    </Paper>
  );

  // Message item component
  const MessageItem = ({ 
    msg, 
    isCurrentUser, 
    formatTime,
    isPending = false,
    onDeleteRequest,
    canDeleteMessage = false,
    onReplyRequest
  }: { 
    msg: Message, 
    isCurrentUser: boolean, 
    formatTime: (date?: Date) => string,
    isPending?: boolean,
    onDeleteRequest?: (message: Message) => void,
    canDeleteMessage?: boolean,
    onReplyRequest?: (message: Message) => void
  }) => {
    console.log("Rendering MessageItem:", msg);
    
    // Debug attachment structure
    const studentMsg = msg as StudentMessage;
    if (msg.attachments || studentMsg.attachment) {
      console.log("🔍 ATTACHMENT DEBUG:", {
        messageId: msg.id,
        attachments: msg.attachments,
        attachment: studentMsg.attachment,
        type: msg.type,
        text: msg.text,
        senderName: msg.senderName,
        fullMessage: msg
      });
      
      // Debug attachment structure (simplified logging)
      const rawAttachment = msg.attachments?.[0] || studentMsg.attachment;
      if (rawAttachment && process.env.NODE_ENV === 'development') {
        // Handle array case and extract single attachment
        const testAttachment = Array.isArray(rawAttachment) ? rawAttachment[0] : rawAttachment;
        if (testAttachment && !Array.isArray(testAttachment)) {
          // Only log once per unique URL to avoid spam
          const studentUrl = (testAttachment as StudentAttachmentData)?.fileUrl;
          const adminUrl = (testAttachment as MessageAttachment)?.url;
          const testUrl = studentUrl || adminUrl;
          
          if (testUrl && !window.testedUrls) {
            window.testedUrls = new Set();
          }
          
          if (testUrl && !window.testedUrls?.has(testUrl)) {
            window.testedUrls?.add(testUrl);
            console.log("🔗 Testing attachment URL:", {
              type: testAttachment.type || 'unknown',
              isFirebaseStorage: testUrl.includes('firebasestorage.googleapis.com'),
              urlStart: testUrl.substring(0, 50) + '...'
            });
          }
        }
      }
    }
    
    // Safely handle timestamp conversion
    let timestamp: Date;
    try {
      if (msg.timestamp instanceof Date) {
        timestamp = msg.timestamp;
      } else if (msg.timestamp?.toDate && typeof msg.timestamp.toDate === 'function') {
        timestamp = msg.timestamp.toDate();
      } else {
        timestamp = new Date();
      }
    } catch (error) {
      console.error('Error processing timestamp', error);
      timestamp = new Date();
    }
    
    // Get proper sender name - try message senderName first, then lookup by senderId
    const getSenderDisplayName = (message: Message) => {
      // If senderName exists and is not "Unknown", use it
      if (message.senderName && message.senderName !== 'Unknown') {
        return message.senderName;
      }
      
      // Try to find user in userOptions by senderId
      const user = userOptions.find(u => u.id === message.senderId);
      if (user && user.displayName && user.displayName !== 'Unknown User') {
        return user.displayName;
      }
      
      // If it's the current user, use their displayName
      if (isCurrentUser && currentUser?.displayName) {
        return currentUser.displayName;
      }
      
      // Fall back to truncated senderId or Unknown
      return message.senderId ? `User ${message.senderId.slice(-8)}` : 'Unknown';
    };
    
    const getRecipientName = (recipientId: string) => {
      if (recipientId === 'ALL' || recipientId === 'all') return 'All';
      const user = userOptions.find(u => u.id === recipientId);
      return user ? user.displayName : recipientId;
    };
    
    const displayName = getSenderDisplayName(msg);
    
    // Normalize attachment data from different sources (handles student app AttachmentData structure)
    const normalizeAttachment = (att: StudentAttachmentData | MessageAttachment | Partial<MessageAttachment>): MessageAttachment => {
      // Handle student app's AttachmentData structure
      const studentAppFields = {
        id: att.id,
        name: (att as StudentAttachmentData).fileName, // Student app uses 'fileName' 
        url: (att as StudentAttachmentData).fileUrl,   // Student app uses 'fileUrl'
        type: att.type,
        size: (att as StudentAttachmentData).fileSize, // Student app uses 'fileSize'
        mimeType: att.mimeType,
        thumbnailUrl: att.thumbnailUrl
      };
      
      return {
        id: studentAppFields.id || (att as MessageAttachment).url || (att as StudentAttachmentData).fileUrl || `att_${Date.now()}`,
        name: studentAppFields.name || (att as MessageAttachment).name || (att as StudentAttachmentData).fileName || 'Unknown File',
        type: studentAppFields.type || att.type || 
              (studentAppFields.url || (att as MessageAttachment).url || (att as StudentAttachmentData).fileUrl || '').includes('image') ? 'image' : 
              (studentAppFields.url || (att as MessageAttachment).url || (att as StudentAttachmentData).fileUrl || '').includes('video') ? 'video' : 
              (studentAppFields.url || (att as MessageAttachment).url || (att as StudentAttachmentData).fileUrl || '').includes('audio') ? 'audio' : 'document',
        url: studentAppFields.url || (att as MessageAttachment).url || (att as StudentAttachmentData).fileUrl || '',
        size: typeof studentAppFields.size === 'number' ? studentAppFields.size : 
              typeof (att as MessageAttachment).size === 'number' ? (att as MessageAttachment).size : 
              typeof (att as StudentAttachmentData).fileSize === 'number' ? (att as StudentAttachmentData).fileSize : 0,
        mimeType: studentAppFields.mimeType || att.mimeType || 'application/octet-stream',
        thumbnailUrl: studentAppFields.thumbnailUrl || att.thumbnailUrl
      };
    };
    
    return (
      <Box sx={{ 
        width: '100%', 
        p: 1, 
        borderRadius: 1, 
        mb: 1, 
        backgroundColor: '#f8f9fa',
        border: '1px solid #e0e0e0'
      }}>
        {/* Sender name for messages from others */}
        {!isCurrentUser && (
          <Typography 
            variant="caption" 
            color="text.secondary" 
            sx={{ 
              fontSize: '0.75rem',
              fontWeight: 500, 
              display: 'block',
              mb: 0.1
            }}
          >
            {displayName}
          </Typography>
        )}
        <Box 
          sx={{ 
            display: 'flex', 
            flexDirection: isCurrentUser ? 'row-reverse' : 'row',
            alignItems: 'flex-end',
            width: '100%',
            gap: 0.3
          }}
        >
          {/* Avatar for messages from others */}
          {!isCurrentUser && (
            <Avatar 
              sx={{ 
                bgcolor: '#1573fd',
                width: 26,
                height: 26,
                fontSize: '0.7rem',
                mr: 0.3
              }}
            >
              {(displayName?.charAt(0) || '?').toUpperCase()}
            </Avatar>
          )}
          <Box sx={{ maxWidth: '70%', alignSelf: isCurrentUser ? 'flex-end' : 'flex-start' }}>
            <MessageBubble isCurrentUser={isCurrentUser}>
              {/* Reply preview - show if this message is a reply */}
              {msg.replyTo && (
                <Box sx={{
                  borderLeft: '3px solid',
                  borderColor: isCurrentUser ? 'rgba(255, 255, 255, 0.3)' : '#071A52',
                  pl: 1,
                  pr: 1,
                  py: 0.5,
                  mb: 1,
                  backgroundColor: isCurrentUser ? 'rgba(255, 255, 255, 0.1)' : 'rgba(7, 26, 82, 0.06)',
                  borderRadius: '4px',
                  maxWidth: '100%'
                }}>
                  <Typography variant="caption" sx={{
                    color: isCurrentUser ? 'rgba(255, 255, 255, 0.8)' : '#071A52',
                    fontWeight: 600,
                    fontSize: '0.7rem',
                    display: 'block',
                    mb: 0.2
                  }}>
                    {msg.replyTo.senderName}
                  </Typography>
                  <Typography variant="caption" sx={{
                    color: isCurrentUser ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)',
                    fontSize: '0.7rem',
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '200px'
                  }}>
                    {msg.replyTo.text || '📎 Attachment'}
                  </Typography>
                </Box>
              )}
              <Box sx={{ 
                display: 'flex', 
                flexDirection: (!msg.text || !msg.text.trim()) && msg.attachments && msg.attachments.length > 0 ? 'column' : 'row',
                justifyContent: 'space-between', 
                alignItems: (!msg.text || !msg.text.trim()) && msg.attachments && msg.attachments.length > 0 ? 'flex-start' : 'flex-end', 
                gap: 1.5 
              }}>
                {/* Only show text if it exists and is not empty */}
                {msg.text && msg.text.trim() && (
                <Typography 
                  variant="body2" 
                  className="message-content"
                  sx={{ 
                      mb: msg.attachments && msg.attachments.length > 0 ? 0.5 : 0,
                    minWidth: '2rem',
                      display: 'block',
                    fontSize: '0.875rem',
                    color: isCurrentUser ? '#ffffff' : 'inherit'
                  }}
                >
                    {msg.text}
                </Typography>
                )}
                
                {/* Show placeholder for attachment-only messages */}
                {(!msg.text || !msg.text.trim()) && 
                 ((msg.attachments && msg.attachments.length > 0) || (msg as StudentMessage).attachment) && (
                  <Typography 
                    variant="body2" 
                    className="message-content attachment-only"
                    sx={{ 
                      mb: 0.5,
                      minWidth: '2rem',
                      display: 'block',
                      fontSize: '0.75rem',
                      color: isCurrentUser ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)',
                      fontStyle: 'italic'
                    }}
                  >
                    {(() => {
                      const studentMsg = msg as StudentMessage;
                      const attachments = msg.attachments || 
                        (studentMsg.attachment ? 
                         (Array.isArray(studentMsg.attachment) ? studentMsg.attachment : [studentMsg.attachment]) : 
                         []);
                      
                      if (!attachments || attachments.length === 0) return '📎 Attachment';
                      
                      if (attachments.length === 1 && attachments[0]) {
                        const firstAttachment = attachments[0];
                        const type = firstAttachment?.type || 'file';
                        return `📎 ${type === 'image' ? 'Image' : 
                                    type === 'video' ? 'Video' : 
                                    type === 'audio' ? 'Audio' : 'File'}`;
                      }
                      
                      return `📎 ${attachments.length} attachments`;
                    })()}
                  </Typography>
                )}
                <Box className="message-time-container" sx={{ display: 'flex', flexShrink: 0, alignSelf: 'flex-end', ml: 0.8, mb: '1px', alignItems: 'center', gap: 0.5 }}>
                  {/* Reply button - show for all messages */}
                  {onReplyRequest && msg.id && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReplyRequest(msg);
                      }}
                      sx={{
                        opacity: 0.7,
                        padding: '2px',
                        minWidth: 'auto',
                        width: '16px',
                        height: '16px',
                        color: isCurrentUser ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.6)',
                        '&:hover': {
                          opacity: 1,
                          backgroundColor: 'rgba(7, 26, 82, 0.08)',
                          color: '#071A52'
                        }
                      }}
                    >
                      <ReplyIcon sx={{ fontSize: '12px' }} />
                    </IconButton>
                  )}
                  {/* Delete button - show for current user or admin with delete handler provided */}
                  {canDeleteMessage && onDeleteRequest && msg.id && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteRequest(msg);
                      }}
                      sx={{
                        opacity: 0.7,
                        padding: '2px',
                        minWidth: 'auto',
                        width: '16px',
                        height: '16px',
                        color: isCurrentUser ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.6)',
                        '&:hover': {
                          opacity: 1,
                          backgroundColor: 'rgba(255, 0, 0, 0.1)',
                          color: '#f44336'
                        }
                      }}
                    >
                      <DeleteIcon sx={{ fontSize: '12px' }} />
                    </IconButton>
                  )}
                  <Typography variant="caption" className="message-timestamp">
                    {formatTime(timestamp)}
                  </Typography>
                  {isCurrentUser && (
                    <Typography 
                      variant="caption" 
                      className="message-status" 
                      sx={{ 
                        color: isPending ? '#8696a0' : (isCurrentUser ? 'rgba(255, 255, 255, 0.7)' : '#53bdeb'), 
                        ml: 0.2 
                      }}
                    >
                      {isPending ? '⌛' : '✓✓'}
                    </Typography>
                  )}
                </Box>
              </Box>
              
              {/* Display attachments if present */}
              {msg.attachments && msg.attachments.length > 0 && (
                <MessageAttachmentDisplay 
                  attachments={msg.attachments.map(att => normalizeAttachment(att))} 
                  compact={true} 
                />
              )}
              
              {/* Fallback for different attachment field names (student app compatibility) */}
              {!msg.attachments && (msg as StudentMessage).attachment && (
                <MessageAttachmentDisplay 
                  attachments={Array.isArray((msg as StudentMessage).attachment) ? 
                    ((msg as StudentMessage).attachment as MessageAttachment[]).map(att => normalizeAttachment(att)) : 
                    [normalizeAttachment((msg as StudentMessage).attachment as MessageAttachment)]} 
                  compact={true} 
                />
              )}

              {/* Display voice message if present */}
              {msg.type === 'voice' && msg.voiceMessage && (
                <VoiceMessageDisplay
                  audioUrl={msg.voiceMessage.url}
                  duration={msg.voiceMessage.duration}
                  isCurrentUser={isCurrentUser}
                  timestamp={timestamp}
                  compact={true}
                />
              )}
            </MessageBubble>
            {isCurrentUser && msg.receiverId !== 'ALL' && msg.receiverId !== 'all' && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.1, fontSize: '0.6rem', textAlign: 'right', display: 'block' }}>
                To: {getRecipientName(msg.receiverId)}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>
    );
  };

  // Handle recipient selection change with proper type handling
  const handleRecipientChange = (event: SelectChangeEvent<typeof selectedRecipients>) => {
    const { target: { value } } = event;
    
    // When we get a string value, it's because the input was cleared
    if (typeof value === 'string') {
      setSelectedRecipients([]);
      return;
    }
    
    // Otherwise, use the array value directly
    console.log('New recipients selection:', value);
    setSelectedRecipients(value);
  };

  // Handle checkbox click in the MenuItem to manually control selection
  const handleRecipientToggle = (recipientId: string) => {
    console.log('Toggling recipient:', recipientId);
    
    setSelectedRecipients(current => {
      // If already selected, remove it
      if (current.includes(recipientId)) {
        return current.filter(id => id !== recipientId);
      }
      // Otherwise add it
      return [...current, recipientId];
    });
  };

  // Handle delete message request
  const handleDeleteMessageRequest = (message: Message) => {
    console.log('🗑️ Delete requested for message:', message.id);
    setMessageToDelete(message);
    setDeleteDialogOpen(true);
  };

  // Handle reply request
  const handleReplyRequest = (message: Message) => {
    console.log('💬 Reply requested for message:', message.id);
    
    // Create a MessageReply object from the message
    const replyData: MessageReply = {
      messageId: message.id || '',
      senderId: message.senderId,
      senderName: message.senderName,
      text: message.text,
      timestamp: message.timestamp,
      type: message.type,
      attachments: message.attachments
    };
    
    setReplyingTo(replyData);
  };

  // Handle cancel reply
  const handleCancelReply = useCallback(() => {
    console.log('=== CANCEL REPLY FUNCTION CALLED ===');
    setReplyingTo(null);
  }, []);

  // Handle delete reply with confirmation
  const handleDeleteReply = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    console.log('=== DELETE REPLY FUNCTION CALLED ===');
    console.log('Current replyingTo state:', replyingTo);
    
    if (replyingTo) {
      console.log('Deleting reply context...');
      setReplyingTo(null);
      console.log('Reply context deleted successfully');
    } else {
      console.log('No reply context to delete');
    }
  }, [replyingTo]);

  // Handle keyboard events for reply cancellation
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape' && replyingTo) {
      event.preventDefault();
      handleCancelReply();
    }
  }, [replyingTo, handleCancelReply]);

  // Add keyboard event listener
  useEffect(() => {
    if (replyingTo) {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [replyingTo, handleKeyDown]);

  // Handle voice message
  const handleVoiceMessage = useCallback(async (audioBlob: Blob, duration: number) => {
    if (!currentUser) {
      setError('You must be logged in to send voice messages');
      return;
    }

    // Check if recipients are selected for direct messages
    if (chatMode === 'direct' && selectedRecipients.length === 0) {
      setError('Please select at least one recipient');
      return;
    }

    // Check database connectivity before sending
    if (dbConnected === false) {
      setError('Cannot send voice message: Database connection issue');
      return;
    }

    try {
      setSending(true);
      
      // Try to verify database connection again
      if (!dbConnected) {
        const connectResult = await checkDatabaseConnectivity();
        setDbConnected(connectResult.connected);
        
        if (!connectResult.connected) {
          throw new Error(`Database connection failed: ${connectResult.error}`);
        }
      }

      // Generate a temporary message ID for upload
      const tempMessageId = `temp_${Date.now()}_${Math.random()}`;
      
      // Upload voice message to Firebase Storage
      const uploadResult = await uploadVoiceMessage(audioBlob, currentUser.uid, tempMessageId);
      
      // Create voice message object
      const voiceMessage: VoiceMessage = {
        id: tempMessageId,
        url: uploadResult.url,
        duration: duration,
        mimeType: 'audio/webm',
        size: uploadResult.size
      };

      // Send message based on chat mode
      if (chatMode === 'broadcast') {
        await sendBroadcastMessage(
          '', // Empty text for voice messages
          currentUser.uid,
          currentUser.displayName || 'Admin',
          undefined, // No attachments
          replyingTo || undefined,
          voiceMessage
        );
      } else if (chatMode === 'direct') {
        // Send to each selected recipient
        await Promise.all(
          selectedRecipients.map(async (recipientId) => {
            await sendDirectMessage(
              '', // Empty text for voice messages
              currentUser.uid,
              currentUser.displayName || 'Admin',
              recipientId,
              undefined, // No attachments
              replyingTo || undefined,
              voiceMessage
            );
          })
        );
      } else if (chatMode === 'community') {
        await sendCommunityMessage(
          '', // Empty text for voice messages
          currentUser.uid,
          currentUser.displayName || 'Admin',
          undefined, // No attachments
          replyingTo || undefined,
          voiceMessage
        );
      } else if (chatMode === 'pastQuestions') {
        await sendPastQuestionsMessage(
          '', // Empty text for voice messages
          currentUser.uid,
          currentUser.displayName || 'Admin',
          undefined, // No attachments
          replyingTo || undefined,
          voiceMessage
        );
      }

      // Clear reply state
      setReplyingTo(null);
      
    } catch (err) {
      console.error('Error sending voice message:', err);
      setError(`Failed to send voice message: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSending(false);
    }
  }, [currentUser, chatMode, selectedRecipients, dbConnected, replyingTo]);

  // Handle delete message confirmation
  const handleDeleteMessageConfirm = async () => {
    if (!messageToDelete?.id) {
      console.error('❌ No message to delete');
      return;
    }

    setDeleting(true);
    try {
      console.log('🗑️ Deleting message:', messageToDelete.id);
      const result = await deleteMessage(messageToDelete.id);
      
      if (result.success) {
        console.log('✅ Message deleted successfully');
        
        // Remove from all message maps immediately for instant UI feedback
        setMessageMap(prev => {
          const newMap = new Map(prev);
          newMap.delete(messageToDelete.id!);
          return newMap;
        });
        
        setCommunityMessageMap(prev => {
          const newMap = new Map(prev);
          newMap.delete(messageToDelete.id!);
          return newMap;
        });
        
        setPastQuestionsMessageMap(prev => {
          const newMap = new Map(prev);
          newMap.delete(messageToDelete.id!);
          return newMap;
        });
        
      } else {
        console.error('❌ Failed to delete message:', result.error);
        setError(result.error || 'Failed to delete message');
      }
    } catch (error) {
      console.error('❌ Error deleting message:', error);
      setError('Failed to delete message');
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setMessageToDelete(null);
    }
  };

  // Handle delete message cancellation
  const handleDeleteMessageCancel = () => {
    setDeleteDialogOpen(false);
    setMessageToDelete(null);
  };

  // Handle message type change
  const handleMessageTypeChange = (mode: ChatMode) => {
    console.log(`🔄 Switching chat mode from ${chatMode} to ${mode}`);
    setChatMode(mode);
    setIsBroadcast(mode === 'broadcast');
    
    // Reset recipients when switching to broadcast mode
    if (mode === 'broadcast') {
      setSelectedRecipients([]);
    }
    
    // If switching to community mode and no community messages exist, check for welcome message
    if (mode === 'community' && communityMessageMap.size === 0) {
      console.log("📄 Community mode: No messages, creating welcome message");
      // Use the existing createTestCommunityMessage function which now checks for duplicates
      createTestCommunityMessage();
    } else if (mode === 'community') {
      console.log(`📄 Community mode: ${communityMessageMap.size} messages already loaded`);
    }
    
    // If switching to past questions mode, fetch past questions messages
    if (mode === 'pastQuestions' && pastQuestionsMessageMap.size === 0) {
      console.log("❓ Past Questions mode: No messages, fetching from server");
      fetchPastQuestionsMessagesForAdmin();
    } else if (mode === 'pastQuestions') {
      console.log(`❓ Past Questions mode: ${pastQuestionsMessageMap.size} messages already loaded`);
    }
    
    // Reset scroll position
    setIsAtBottom(true);
    
    // Scroll to bottom after a short delay to ensure UI has updated
    setTimeout(() => {
      if (virtuosoRef.current) {
        const targetLength = mode === 'community' ? 
          sortedCommunityMessages.length : 
          mode === 'pastQuestions' ?
            sortedPastQuestionsMessages.length :
            sortedMessages.length;
        
        if (targetLength > 0) {
          virtuosoRef.current.scrollToIndex({
            index: targetLength - 1,
            behavior: 'smooth',
            align: 'end'
          });
        }
      }
    }, 100);
    
    // No need to simulate loading when switching modes - let natural data loading handle it
  };

  // Function to create a test community message
  const createTestCommunityMessage = async () => {
    if (!currentUser) return;
    
    try {
      console.log("Creating test community message...");
      
      // First check if a welcome message already exists
      const welcomeMessageQuery = query(
        collection(db, 'communityChat'),
        where('text', '==', 'Welcome to the Community Chat! This is where admins and students can interact together.'),
        limit(1)
      );
      
      const existingWelcomeSnapshot = await getDocs(welcomeMessageQuery);
      
      // If welcome message already exists, don't create another one
      if (!existingWelcomeSnapshot.empty) {
        console.log("Welcome message already exists, skipping creation");
        return;
      }
      
      // Check if the communityChat collection exists
      const communityChatRef = collection(db, 'communityChat');
      
      // Create a test message in the communityChat collection
      const docRef = await addDoc(communityChatRef, {
        senderId: currentUser.uid,
        senderName: currentUser.displayName || 'Admin',
        receiverId: 'COMMUNITY',
        text: 'Welcome to Community Chat! This is where admins and students can interact together.',
        timestamp: new Date(), // Use a JavaScript Date instead of serverTimestamp() for immediate visibility
        status: 'sent',
        type: 'text',
        isCommunity: true
      });
      
      // No need to add to local state as the listener will pick it up
      console.log("Test community message created successfully with ID:", docRef.id);
    } catch (error) {
      console.error("Error creating test community message:", error);
      setError("Failed to initialize community chat. Please try again.");
    }
  };

  // Handle attachment selection
  const handleAttachmentsSelected = useCallback((attachments: MessageAttachment[]) => {
    setSelectedAttachments(prev => [...prev, ...attachments]);
  }, []);

  // Handle removing an attachment
  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    setSelectedAttachments(prev => prev.filter(att => att.id !== attachmentId));
  }, []);

  // Handle sending a message
  const handleSendMessage = useCallback(async () => {
    if (!message.trim() && selectedAttachments.length === 0) return;
    if (!currentUser) {
      setError('You must be logged in to send messages');
      return;
    }

    // Check if recipients are selected for direct messages
    if (chatMode === 'direct' && selectedRecipients.length === 0) {
      setError('Please select at least one recipient');
      return;
    }

    // Check database connectivity before sending
    if (dbConnected === false) {
      setError('Cannot send message: Database connection issue');
      return;
    }
    
    try {
      setSending(true);
      
      // Try to verify database connection again
      if (!dbConnected) {
        const connectResult = await checkDatabaseConnectivity();
        setDbConnected(connectResult.connected);
        
        if (!connectResult.connected) {
          throw new Error(`Database connection failed: ${connectResult.error}`);
        }
      }
      
      // Send message based on chat mode
      if (chatMode === 'broadcast') {
        // Send the actual message first, then let the Firestore listener update the UI
        // No optimistic updates - the onSnapshot listener will pick up the new message
        await sendBroadcastMessage(
          message,
          currentUser.uid,
          currentUser.displayName || 'Admin',
          selectedAttachments.length > 0 ? selectedAttachments : undefined,
          replyingTo || undefined
        );
      } else if (chatMode === 'direct') {
        // Send to each selected recipient - no optimistic updates
        // The onSnapshot listener will pick up the new messages
        await Promise.all(
          selectedRecipients.map(async (recipientId) => {
            await sendDirectMessage(
              message,
              currentUser.uid,
              currentUser.displayName || 'Admin',
              recipientId,
              selectedAttachments.length > 0 ? selectedAttachments : undefined,
              replyingTo || undefined
            );
          })
        );
      } else if (chatMode === 'community') {
        // Just send the message and let the listener handle the UI update
        await sendCommunityMessage(
          message,
          currentUser.uid,
          currentUser.displayName || 'Admin',
          selectedAttachments.length > 0 ? selectedAttachments : undefined,
          replyingTo || undefined
        );
      } else if (chatMode === 'pastQuestions') {
        // For past questions, admins can send test messages (not typical use case)
        await sendPastQuestionsMessage(
          message,
          currentUser.uid,
          currentUser.displayName || 'Admin',
          selectedAttachments.length > 0 ? selectedAttachments : undefined,
          replyingTo || undefined
        );
      }
      
        // Clear input, attachments, and reply state
        setMessage('');
        setSelectedAttachments([]);
        setReplyingTo(null);
    } catch (err) {
      console.error('Error sending message:', err);
      setError(`Failed to send message: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSending(false);
      
      // Focus back on text field
      setTimeout(() => {
        textFieldRef.current?.focus();
      }, 100);
    }
  }, [message, chatMode, selectedRecipients, currentUser, dbConnected, selectedAttachments, replyingTo]);

  // Handle key press for sending
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Handle emoji click
  const handleEmojiClick = (emojiData: EmojiClickData) => {
    setMessage(prev => prev + emojiData.emoji);
    // Focus back on text field after emoji selection
    setTimeout(() => {
      textFieldRef.current?.focus();
    }, 100);
  };

  // Open emoji picker
  const handleEmojiButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setEmojiAnchorEl(event.currentTarget);
  };

  // Close emoji picker
  const handleEmojiPickerClose = () => {
    setEmojiAnchorEl(null);
  };

  // Update loadMoreMessages to scroll to the first message of the previous batch after loading
  const loadMoreMessages = async () => {
    try {
      if (isLoadingMore || !hasMoreMessages || !lastVisible) {
        console.log("Cannot load more messages:", { isLoadingMore, hasMoreMessages, lastVisible: !!lastVisible });
        return;
      }
      
      setIsLoadingMore(true);
      
      // Query for older messages using the lastVisible document
      const olderMessagesQuery = query(
        collection(db, 'messages'),
        orderBy('timestamp', 'desc'),
        startAfter(lastVisible),
        limit(20)
      );
      
      const snapshot = await getDocs(olderMessagesQuery);
      console.log(`Fetched ${snapshot.size} older messages`);
      
      if (snapshot.empty) {
        setHasMoreMessages(false);
        setIsLoadingMore(false);
        return;
      }
      
      const newMessages = new Map<string, Message>();
      
      snapshot.forEach(doc => {
        const data = doc.data();
        if (
          currentUser && (
            data.senderId === currentUser.uid || 
            data.receiverId === 'ADMIN' || 
            data.receiverId === 'ALL' ||
            data.receiverId === 'admin' ||
            data.receiverId === 'all' ||
            data.receiverId === 'Admin' ||
            data.receiverId === 'All'
          )
        ) {
          let messageTimestamp;
          if (data.timestamp) {
            messageTimestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
      } else {
            messageTimestamp = new Date();
          }
          newMessages.set(doc.id, {
            id: doc.id,
            ...data,
            timestamp: messageTimestamp
          } as Message);
        }
      });
      
      setMessageMap(prevMessages => {
        const updatedMessages = new Map(prevMessages);
        newMessages.forEach((msg, id) => {
          updatedMessages.set(id, msg);
        });
        return updatedMessages;
      });
      
      if (snapshot.docs.length > 0) {
        setLastVisible(snapshot.docs[snapshot.docs.length - 1]);
      }
      setHasMoreMessages(snapshot.size >= 20);
      setIsLoadingMore(false);

      // After loading, scroll to the first message of the previous batch (now at index snapshot.size)
      setTimeout(() => {
        if (virtuosoRef.current) {
          virtuosoRef.current.scrollToIndex({
            index: snapshot.size,
            behavior: 'auto'
          });
        }
      }, 100);
    } catch (error) {
      console.error("Failed to load more messages:", error);
      setError("Failed to load more messages");
      setIsLoadingMore(false);
    }
  };

  // Debug function to inspect message structure
  useEffect(() => {
    // Debug function to inspect message structure
    const inspectMessageStructure = async () => {
      try {
        console.log("Inspecting message structure in Firestore...");
        
        // Get a sample of messages to inspect their structure
        const sampleQuery = query(
          collection(db, 'messages'),
          limit(10)
        );
        
        const snapshot = await getDocs(sampleQuery);
        
        if (snapshot.empty) {
          console.log("No messages found in the database");
          return;
        }
        
        console.log(`Found ${snapshot.size} messages for inspection`);
        
        // Check message structure
        snapshot.forEach(doc => {
          const data = doc.data();
          console.log("Message structure:", {
            id: doc.id,
            senderId: data.senderId,
            receiverId: data.receiverId,
            timestamp: data.timestamp,
            hasTimestamp: !!data.timestamp,
            timestampType: data.timestamp ? typeof data.timestamp : 'undefined'
          });
        });
        
        // Check if we have the correct receiverId values
        const adminMessages = query(
          collection(db, 'messages'),
          where('receiverId', '==', 'ADMIN'),
          limit(5)
        );
        
        const adminSnapshot = await getDocs(adminMessages);
        console.log(`Found ${adminSnapshot.size} messages with receiverId='ADMIN'`);
        
        // Try a direct query for ALL messages
        const allRecipientsQuery = query(
          collection(db, 'messages'),
          where('receiverId', '==', 'ALL'),
          limit(50)
        );
        
        const allRecipientsSnapshot = await getDocs(allRecipientsQuery);
        console.log(`Found ${allRecipientsSnapshot.size} messages with receiverId=ALL`);
        
        // Try with lowercase variants
        const adminLowerQuery = query(
          collection(db, 'messages'),
          where('receiverId', '==', 'admin'),
          limit(50)
        );
        
        const adminLowerSnapshot = await getDocs(adminLowerQuery);
        console.log(`Found ${adminLowerSnapshot.size} messages with receiverId=admin (lowercase)`);
        
        const allLowerQuery = query(
          collection(db, 'messages'),
          where('receiverId', '==', 'all'),
          limit(50)
        );
        
        const allLowerSnapshot = await getDocs(allLowerQuery);
        console.log(`Found ${allLowerSnapshot.size} messages with receiverId=all (lowercase)`);
        
        // Check if there are other receiverId values we should be checking
        const allMessagesQuery = query(
          collection(db, 'messages'),
          limit(50)
        );
        
        const allMessagesSnapshot = await getDocs(allMessagesQuery);
        const receiverIds = new Set<string>();
        
        allMessagesSnapshot.forEach(doc => {
          const data = doc.data();
          if (data.receiverId) {
            receiverIds.add(data.receiverId);
          }
        });
        
        console.log("All receiverId values found:", Array.from(receiverIds));
        
      } catch (error) {
        console.error("Error inspecting message structure:", error);
      }
    };
    
    // Run the inspection
    if (currentUser) {
      inspectMessageStructure();
    }
  }, [currentUser]);

  // Ensure broadcast mode is set by default
  useEffect(() => {
    setIsBroadcast(true);
  }, []);

  // Debug function to inspect UI state
  useEffect(() => {
    console.log("UI State Debug:");
    console.log("- Has messages:", hasMessages);
    console.log("- Loading:", loading);
    console.log("- Initial load complete:", initialLoadComplete);
    console.log("- Message map size:", messageMap.size);
    console.log("- Sorted messages length:", activeMessages.length);
    console.log("- Is broadcast mode:", isBroadcast);
    console.log("- Selected user:", selectedUser);
  }, [hasMessages, loading, initialLoadComplete, messageMap.size, activeMessages.length, isBroadcast, selectedUser]);

  // Add a scroll-to-bottom button component
  const ScrollToBottomButton = ({ onClick, visible }: { onClick: () => void, visible: boolean }) => (
    <Zoom in={visible}>
      <Box
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        sx={{
          position: 'relative', // Changed from absolute to relative
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: '50%',
          backgroundColor: 'primary.main',
          color: 'white',
          boxShadow: '0 3px 5px rgba(0,0,0,0.2)',
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            backgroundColor: 'primary.dark',
            transform: 'scale(1.05)',
            boxShadow: '0 4px 8px rgba(0,0,0,0.3)'
          },
          pointerEvents: 'auto'
        }}
      >
        <KeyboardArrowDownIcon />
      </Box>
    </Zoom>
  );

  // Add error handling for debugging
  try {
    // Render loading state
    if (!currentUser) {
      console.log('❌ No current user for chat');
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
          <Alert severity="error">You must be logged in to access chat</Alert>
        </Box>
      );
    }
    
    console.log('✅ Chat rendering with user:', currentUser.email);
  } catch (error) {
    console.error('❌ Error in AdminChat render:', error);
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <Alert severity="error">Error loading chat: {error instanceof Error ? error.message : 'Unknown error'}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ height: { xs: 'calc(100vh - 88px)', sm: 'calc(100vh - 96px)', md: 'calc(100vh - 100px)' }, overflow: 'hidden', display: 'flex', flexDirection: 'column', p: 0, m: 0, position: 'relative' }}>
      {/* Message type selector */}
      <Box sx={{ 
        mt: 0,
        mb: 0, 
        display: 'flex', 
        gap: 1, 
        alignItems: 'center', 
        flexWrap: 'wrap',
        bgcolor: '#f0f2f5', 
        borderRadius: 1, 
        p: 0.5, 
        pt: 0.3,
        pb: 0.3,
        justifyContent: 'space-between' 
      }}>
        <Box sx={{ display: 'flex', gap: { xs: 0.5, sm: 1 }, flexWrap: 'wrap' }}>
        <Button
            variant={chatMode === 'broadcast' ? "contained" : "outlined"}
          color="primary"
            onClick={() => handleMessageTypeChange('broadcast')}
          size="small"
            sx={{ 
              py: 0.3,
              px: { xs: 1, sm: 1.5 },
              textTransform: 'none', 
              borderRadius: '16px',
              boxShadow: chatMode === 'broadcast' ? 1 : 0,
              minHeight: '30px',
              fontSize: { xs: '0.75rem', sm: '0.85rem' }
            }}
        >
          Broadcast
        </Button>
        <Button
            variant={chatMode === 'direct' ? "contained" : "outlined"}
          color="primary"
            onClick={() => handleMessageTypeChange('direct')}
          size="small"
            sx={{ 
              py: 0.3,
              px: { xs: 1, sm: 1.5 },
              textTransform: 'none', 
              borderRadius: '16px',
              boxShadow: chatMode === 'direct' ? 1 : 0,
              minHeight: '30px',
              fontSize: { xs: '0.75rem', sm: '0.85rem' }
            }}
        >
          Direct Message
        </Button>
          <Button
            variant={chatMode === 'community' ? "contained" : "outlined"}
            color="primary"
            onClick={() => handleMessageTypeChange('community')}
            size="small"
            sx={{ 
              py: 0.3,
              px: { xs: 1, sm: 1.5 },
              textTransform: 'none', 
              borderRadius: '16px',
              boxShadow: chatMode === 'community' ? 1 : 0,
              minHeight: '30px',
              fontSize: { xs: '0.75rem', sm: '0.85rem' },
              backgroundColor: chatMode === 'community' ? '#071A52' : 'transparent',
              color: chatMode === 'community' ? 'white' : '#071A52',
              borderColor: '#071A52',
              '&:hover': {
                backgroundColor: chatMode === 'community' ? '#051442' : 'rgba(7, 26, 82, 0.06)',
                borderColor: '#051442',
              }
            }}
            startIcon={<PeopleIcon fontSize="small" />}
          >
            Community Chat
        </Button>
        {/* Past Questions tab - commented out
        <Button
          variant={chatMode === 'pastQuestions' ? "contained" : "outlined"}
          color="primary"
          onClick={() => handleMessageTypeChange('pastQuestions')}
          size="small"
          sx={{ 
            py: 0.3,
            px: { xs: 1, sm: 1.5 },
            textTransform: 'none', 
            borderRadius: '16px',
            boxShadow: chatMode === 'pastQuestions' ? 1 : 0,
            minHeight: '30px',
            fontSize: { xs: '0.75rem', sm: '0.85rem' },
            backgroundColor: chatMode === 'pastQuestions' ? '#071A52' : 'transparent',
            color: chatMode === 'pastQuestions' ? 'white' : '#071A52',
            borderColor: '#071A52',
            '&:hover': {
              backgroundColor: chatMode === 'pastQuestions' ? '#051442' : 'rgba(7, 26, 82, 0.06)',
              borderColor: '#051442',
            }
          }}
          startIcon={<QuestionAnswerIcon fontSize="small" />}
        >
          Past Questions
        </Button>
        */}
      </Box>
      
        {/* Only show recipient dropdown when Direct Message is selected */}
        {chatMode === 'direct' && (
        <FormControl 
          size="small"
            sx={{ 
              minWidth: { xs: 140, sm: 180 }, 
              bgcolor: 'transparent',
              '& .MuiInputBase-root': {
                height: '30px',
                fontSize: '0.85rem'
              }
            }}
        >
          <Select
              displayEmpty
            value={selectedRecipients}
              multiple
            onChange={handleRecipientChange}
              renderValue={(selected) => {
                if (selected.length === 0) {
                  return <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>Select recipients...</Typography>;
                }
                return `${selected.length} recipient${selected.length > 1 ? 's' : ''} selected`;
              }}
              sx={{ 
                borderRadius: '16px',
                bgcolor: '#fff',
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'primary.main',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'primary.dark',
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'primary.main',
                },
                height: '30px',
                py: 0.5,
                textTransform: 'none',
              }}
            MenuProps={{
              slotProps: { paper: {
                style: {
                    maxHeight: 300,
                  width: 250,
                    borderRadius: 8
                },
                sx: {
                  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.15)',
                  '& .MuiMenuItem-root': {
                    py: 0.5,
                    px: 1.5
                  },
                  '& .MuiCheckbox-root': {
                    p: 0.5
                  }
                }
              } },
              anchorOrigin: {
                vertical: 'bottom',
                horizontal: 'left',
              },
              transformOrigin: {
                vertical: 'top',
                horizontal: 'left',
              }
            }}
          >
            {/* Search field at the top of dropdown */}
            <Box sx={{ position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1, p: 1, pb: 0.5 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Search recipients..."
                value={recipientSearch}
                onChange={(e) => setRecipientSearch(e.target.value)}
                variant="outlined"
                slotProps={{ input: {
                    sx: { 
                      fontSize: '0.875rem', 
                      borderRadius: '14px',
                      height: '36px',
                      '& .MuiOutlinedInput-input': {
                        padding: '6px 10px'
                      }
                    }
                } }}
                onClick={(e) => e.stopPropagation()} // Prevent dropdown from closing when clicking the search field
              />
            </Box>
            <Divider sx={{ my: 0.5 }} />
            
            {filteredUserOptions.length === 0 ? (
              <MenuItem disabled sx={{ fontSize: '0.875rem', fontStyle: 'italic', py: 0.5 }}>
                No matching recipients
              </MenuItem>
            ) : (
              filteredUserOptions.map((user) => {
                const isSelected = selectedRecipients.includes(user.id);
                
                return (
                  <MenuItem 
                    key={user.id}
                    value={user.id}
                    sx={{ 
                      fontSize: '0.875rem',
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                      py: 0.5,
                      px: 1.5,
                      '&:hover': {
                        bgcolor: 'rgba(25, 118, 210, 0.08)'
                      }
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleRecipientToggle(user.id);
                    }}
                  >
                    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: isSelected ? 500 : 400 }}>{user.displayName}</Typography>
                      <Typography variant="caption" color="text.secondary">{user.email}</Typography>
                    </Box>
                    <Checkbox 
                      checked={isSelected}
                      size="small"
                      sx={{ p: 0.5 }}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        event.stopPropagation();
                        handleRecipientToggle(user.id);
                      }}
                    />
                  </MenuItem>
                );
              })
            )}
          </Select>
        </FormControl>
      )}
      </Box>

      {/* Error Snackbar */}
      <Snackbar
        open={errorSnackbarOpen}
        autoHideDuration={6000}
        onClose={handleErrorSnackbarClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert 
          onClose={handleErrorSnackbarClose} 
          severity="error" 
          variant="filled"
          sx={{ 
            py: 0.5, 
            borderRadius: 1,
            width: '100%',
            fontSize: '0.85rem'
          }}
        >
          {error}
        </Alert>
      </Snackbar>
      
      {/* Recipient selection reminder */}
      <Snackbar
        open={chatMode === 'direct' && selectedRecipients.length === 0}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{ 
          position: 'fixed',
          top: 'auto',
          bottom: 'auto',
          left: '50%',
          transform: 'translateX(-50%)',
          marginTop: '85px', // Increased to 85px for more space
          zIndex: 1000,
          width: 'auto',
          '& .MuiPaper-root': {
            backgroundColor: '#FFFFFF', 
            borderLeft: '4px solid #071A52',
            border: '1px solid #E2E8F0',
            borderLeftWidth: '4px',
            boxShadow: '0 4px 12px rgba(7, 26, 82, 0.08)',
            borderRadius: '8px'
          }
        }}
      >
        <Alert 
          severity="info" 
          icon={<Box sx={{ display: 'flex', alignItems: 'center' }}><InfoIcon fontSize="small" /></Box>}
          sx={{ 
            py: 0.7, 
            borderRadius: 1,
            width: '100%',
            fontSize: '0.9rem',
            fontWeight: 500
          }}
        >
          Please select at least one recipient to send a direct message
        </Alert>
      </Snackbar>
      
      {/* Main chat interface - WhatsApp style */}
      <Paper 
        elevation={2} 
        sx={{ 
          flexGrow: 1, 
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: '4px',
          bgcolor: '#f0f2f5',
          border: '1px solid #d1d7db',
          height: '100%',
          minHeight: 'unset',
          maxHeight: 'unset',
          m: 0, 
          mt: 0.5,
          p: 0,
          position: 'relative' // Add position relative for absolute positioning of button
        }}
      >
        {/* Chat header - WhatsApp style */}
        <Box 
          className="chat-header"
          sx={{
            display: 'flex',
            alignItems: 'center',
            padding: '10px 16px',
            backgroundColor: '#f0f2f5',
            borderBottom: '1px solid #e0e0e0',
            minHeight: '60px'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Typography variant="subtitle1" sx={{ mr: 1, fontWeight: "500" }}>
                {chatMode === 'broadcast' ? 'Broadcast' : 
                 chatMode === 'direct' ? 'Direct Messages' : 
                 chatMode === 'community' ? 'Community Chat' : 'Past Questions Monitor'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {chatMode === 'broadcast' ? 'Message to all students' : 
                 chatMode === 'direct' ? 
                  (selectedRecipients.length > 0 
                    ? `${selectedRecipients.length} recipients selected` 
                    : 'No recipients selected') :
                  'Chat with all users'}
              </Typography>
            </Box>
          </Box>
        </Box>
        
        {/* Messages list */}
        <Box 
          ref={messageListRef}
          sx={{ 
            flex: 1, 
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0 /* Important for flex children to prevent overflow */
          }}
          >
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <CircularProgress size={24} />
              </Box>
          ) : activeMessages.length === 0 ? (
              <Box sx={{ 
                display: 'flex', 
                flexDirection: 'column',
                justifyContent: 'center', 
                alignItems: 'center',
                height: '100%'
              }}>
                <ForumIcon sx={{ fontSize: 48, color: '#8696a0', mb: 1 }} />
                <Typography variant="body1" color="text.secondary">No messages yet</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                  {chatMode === 'broadcast' ? 'Send a broadcast message to all students' : 
                   chatMode === 'direct' ? 'Select recipients and start a conversation' :
                   'Start a conversation in the community chat'}
                </Typography>
              </Box>
            ) : (
            <div style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
              <Virtuoso
                ref={virtuosoRef}
                style={{ height: '100%', width: '100%' }}
                data={messagesWithDateFlags}
                overscan={800}
                increaseViewportBy={{ top: 800, bottom: 800 }}
                firstItemIndex={Math.max(0, messagesWithDateFlags.length - 30)}
                initialTopMostItemIndex={messagesWithDateFlags.length - 1}
                defaultItemHeight={96}
                followOutput={
                  chatMode === 'pastQuestions'
                    ? false
                    : (isAtBottom && !loading && !isLoadingMore && !communityIsLoadingMore && !pastQuestionsIsLoadingMore ? 'smooth' : false)
                }
                computeItemKey={(index, item) => item.message.id || index}
                atBottomStateChange={(bottom) => {
                  if (chatMode === 'pastQuestions') {
                    // In pastQuestions, only update isAtBottom for button visibility
                    // but don't trigger any scroll behaviors
                    setIsAtBottom(bottom);
                    return;
                  }
                  // Only update if the state is changing to avoid unnecessary re-renders
                  if (isAtBottom !== bottom) {
                    if (bottom) {
                      // When reaching bottom, update immediately if not loading
                      const isAnyLoading = loading || isLoadingMore || communityIsLoadingMore || pastQuestionsIsLoadingMore;
                      if (!isAnyLoading) {
                        setIsAtBottom(true);
                      }
                    } else {
                      // When scrolling away from bottom, add a small delay
                      // This prevents the FAB from appearing during small scroll adjustments
                      const timer = setTimeout(() => {
                        // Only update if we're still not at bottom and not loading
                        const isAnyLoading = loading || isLoadingMore || communityIsLoadingMore || pastQuestionsIsLoadingMore;
                        if (!isAnyLoading) {
                          setIsAtBottom(bottom);
                        }
                      }, 200);
                      return () => clearTimeout(timer);
                    }
                  }
                }}
                alignToBottom={chatMode !== 'pastQuestions'}
                rangeChanged={handleRangeChanged}
                itemContent={(index, item) => {
                  const message = item.message;
                  const showDateSeparator = item.showDateSeparator;
                  const isCurrentUser = Boolean(auth.currentUser && message.senderId === auth.currentUser.uid);
                  const canDeleteMessage = isCurrentUser || isAdmin;
                  
                  const isNextMessageFromSameSender = index < messagesWithDateFlags.length - 1 && 
                    messagesWithDateFlags[index + 1].message.senderId === message.senderId && 
                    getDateKey(messagesWithDateFlags[index + 1].message) === getDateKey(message);
                  
                  return (
                    <React.Fragment key={message.id || index}>
                      {showDateSeparator && (
                        <Box sx={{ 
                          display: 'flex', 
                          justifyContent: 'center', 
                          py: 1,
                          position: 'relative',
                          mb: 0.5
                        }}>
                          <Box sx={{
                            bgcolor: '#dbebfd',
                            px: 2,
                            py: 0.3,
                            borderRadius: 4,
                            zIndex: 1,
                            boxShadow: '0 1px 0.5px rgba(0, 0, 0, 0.13)',
                            fontSize: '0.75rem',
                            color: '#54656f'
                          }}>
                            {formatMessageDate(message.timestamp)}
                          </Box>
                        </Box>
                      )}
                      <Box 
                        sx={{ 
                          mb: isNextMessageFromSameSender ? 0.1 : 0.6,
                          px: 0.5
                        }}
                      >
                        <MessageItem 
                          msg={message} 
                          isCurrentUser={isCurrentUser} 
                          formatTime={formatTime} 
                          isPending={false}
                          onDeleteRequest={handleDeleteMessageRequest}
                          canDeleteMessage={canDeleteMessage}
                          onReplyRequest={handleReplyRequest}
                        />
          </Box>
                    </React.Fragment>
                  );
                }}
                components={{
                  Header: () => (
                    <div style={{ padding: '12px', textAlign: 'center' }}>
                      {chatMode !== 'community' && chatMode !== 'pastQuestions' && hasMoreMessages && !isLoadingMore && (
                        <Button 
                          onClick={loadMoreMessages} 
                          variant="contained" 
                          size="small"
                          color="primary"
                          startIcon={<HistoryIcon />}
                          sx={{
                            borderRadius: '18px',
                            textTransform: 'none',
                            boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
                            px: 2,
                            py: 0.5,
                            fontSize: '0.85rem',
                            fontWeight: 500,
                            '&:hover': {
                              backgroundColor: '#1565c0',
                              boxShadow: '0 3px 6px rgba(0,0,0,0.15)',
                            }
                          }}
                        >
                          Load Previous Messages
                        </Button>
                      )}
                      {chatMode === 'community' && communityHasMoreMessages && !communityIsLoadingMore && (
                        <Button 
                          onClick={loadMoreCommunityMessages} 
                          variant="contained" 
                          size="small"
                          color="primary"
                          startIcon={<HistoryIcon />}
                          sx={{
                            borderRadius: '18px',
                            textTransform: 'none',
                            boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
                            px: 2,
                            py: 0.5,
                            fontSize: '0.85rem',
                            fontWeight: 500,
                            '&:hover': {
                              backgroundColor: '#051442',
                              boxShadow: '0 3px 6px rgba(0,0,0,0.15)',
                            }
                          }}
                        >
                          Load Previous Student Messages
                        </Button>
                      )}
                      {chatMode === 'pastQuestions' && pastQuestionsHasMoreMessages && !pastQuestionsIsLoadingMore && (
                        <Button 
                          onClick={loadMorePastQuestionsMessages} 
                          variant="contained" 
                          size="small"
                          color="primary"
                          sx={{
                            backgroundColor: '#071A52',
                            color: 'white',
                            textTransform: 'none',
                            borderRadius: '16px',
                            px: 2,
                            py: 0.5,
                            fontSize: '0.8rem',
                            fontWeight: 500,
                            '&:hover': {
                              backgroundColor: '#051442',
                              boxShadow: '0 3px 6px rgba(0,0,0,0.15)',
                            }
                          }}
                        >
                          Load Previous Past Questions
                        </Button>
                      )}
                      {((chatMode !== 'community' && chatMode !== 'pastQuestions' && isLoadingMore) || 
                        (chatMode === 'community' && communityIsLoadingMore) ||
                        (chatMode === 'pastQuestions' && pastQuestionsIsLoadingMore)) && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1 }}>
                          <CircularProgress size={20} />
                          <Typography variant="body2" color="text.secondary">
                            Loading messages...
                          </Typography>
                        </Box>
                      )}
                      {((chatMode !== 'community' && chatMode !== 'pastQuestions' && !hasMoreMessages) || 
                        (chatMode === 'community' && !communityHasMoreMessages) ||
                        (chatMode === 'pastQuestions' && !pastQuestionsHasMoreMessages)) && (
                        <Typography 
                          variant="body2" 
                          color="text.secondary"
                          sx={{
                            backgroundColor: 'rgba(0,0,0,0.04)',
                            py: 0.8,
                            px: 2,
                            borderRadius: '16px',
                            display: 'inline-block'
                          }}
                        >
                          No more messages
                        </Typography>
                      )}
                    </div>
                  )
                }}
              />
            </div>
          )}
        </Box>

        {/* Quoted message display for replies */}
        {replyingTo && (
          <Box 
            sx={{
              backgroundColor: '#f8fafc',
              borderTop: '1px solid #e2e8f0',
              borderBottom: '1px solid #e2e8f0',
              p: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              position: 'relative',
              zIndex: 10
            }}
            onClick={(e) => {
              console.log('Reply container clicked');
              // Don't prevent default here, let the button handle it
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
              <ReplyIcon sx={{ color: '#071A52', fontSize: '16px', flexShrink: 0 }} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="caption" sx={{
                  color: '#071A52',
                  fontWeight: 600,
                  fontSize: '0.7rem',
                  display: 'block'
                }}>
                  Replying to {replyingTo.senderName}
                </Typography>
                <Typography variant="caption" sx={{
                  color: 'rgba(0, 0, 0, 0.6)',
                  fontSize: '0.7rem',
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {replyingTo.text || '📎 Attachment'}
                </Typography>
              </Box>
            </Box>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {/* Delete/Cancel button with label */}
              <Button
                variant="text"
                size="small"
                onClick={handleDeleteReply}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                title="Cancel reply (or press Escape)"
                sx={{
                  minWidth: 'auto',
                  width: '32px',
                  height: '32px',
                  padding: '6px',
                  color: '#f44336',
                  backgroundColor: 'transparent',
                  border: '1px solid rgba(244, 67, 54, 0.3)',
                  borderRadius: '50%',
                  '&:hover': {
                    backgroundColor: 'rgba(244, 67, 54, 0.1)',
                    color: '#d32f2f',
                    borderColor: 'rgba(244, 67, 54, 0.5)',
                    transform: 'scale(1.05)'
                  },
                  '&:active': {
                    backgroundColor: 'rgba(244, 67, 54, 0.2)',
                    transform: 'scale(0.95)'
                  },
                  transition: 'all 0.2s ease',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
                }}
              >
                <DeleteIcon sx={{ fontSize: '16px' }} />
              </Button>
              
              {/* Delete label */}
              <Typography
                variant="caption"
                sx={{
                  color: '#f44336',
                  fontSize: '0.7rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  '&:hover': {
                    color: '#d32f2f'
                  }
                }}
                onClick={handleDeleteReply}
              >
                Delete
              </Typography>
            </div>
          </Box>
        )}

        {/* Message input - WhatsApp style */}
        <Box 
          sx={{ 
            p: 0.6,
            display: 'flex', 
            alignItems: 'center',
            gap: 0.5,
            backgroundColor: '#f0f2f5',
            borderTop: replyingTo ? 'none' : '1px solid #e0e0e0',
            position: 'relative',
            zIndex: 10,
            mt: 'auto'
          }}
          className="message-input-container"
        >
          <AttachmentPicker
            onAttachmentsSelected={handleAttachmentsSelected}
            senderId={currentUser?.uid || ''}
            disabled={loading || sending || (chatMode === 'direct' && selectedRecipients.length === 0)}
          />
          
          <IconButton
            onClick={handleEmojiButtonClick}
            disabled={loading || sending || (chatMode === 'direct' && selectedRecipients.length === 0)}
            size="medium"
            className={`emoji-button ${emojiPickerOpen ? 'active' : ''}`}
            sx={{ mx: 0.3 }}
          >
            <EmojiIcon fontSize="small" />
          </IconButton>
          
          <Popover
            open={emojiPickerOpen}
            anchorEl={emojiAnchorEl}
            onClose={handleEmojiPickerClose}
            anchorOrigin={{
              vertical: 'top',
              horizontal: 'left',
            }}
            transformOrigin={{
              vertical: 'bottom',
              horizontal: 'left',
            }}
          >
            <EmojiPicker onEmojiClick={handleEmojiClick} />
          </Popover>
          
          <TextField
            fullWidth
            placeholder={
              chatMode === 'broadcast' ? "Type broadcast message..." : 
              chatMode === 'direct' ? "Type direct message..." :
              chatMode === 'community' ? "Type message to students..." :
              "Monitor past questions from students..."
            }
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            inputRef={textFieldRef}
            variant="outlined"
            disabled={loading || sending || (chatMode === 'direct' && selectedRecipients.length === 0)}
            size="small"
            className="message-input-field"
            slotProps={{ input: {
              className: "message-input",
              sx: {
                borderRadius: '24px',
                py: 0.3,
                px: 1
              }
            } }}
          />
          
          <VoiceRecorder
            onVoiceMessage={handleVoiceMessage}
            disabled={loading || sending || (chatMode === 'direct' && selectedRecipients.length === 0)}
          />
          
          <IconButton
            color="primary"
            className="send-button"
            onClick={handleSendMessage}
            disabled={
              (!message.trim() && selectedAttachments.length === 0) || 
              loading || 
              sending || 
              (chatMode === 'direct' && selectedRecipients.length === 0)
            }
            sx={{ ml: 0.3 }}
          >
            {sending ? (
              <CircularProgress size={18} color="inherit" />
            ) : (
              <SendIcon fontSize="small" />
            )}
          </IconButton>
        </Box>
        
        {/* Selected Attachments Preview */}
        {selectedAttachments.length > 0 && (
          <Box sx={{ p: 1, borderTop: '1px solid #e0e0e0', backgroundColor: '#f9f9f9' }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              Selected Attachments ({selectedAttachments.length}):
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', maxHeight: 120, overflow: 'auto' }}>
              {selectedAttachments.map((attachment) => (
                <Box
                  key={attachment.id}
                  sx={{
                    position: 'relative',
                    border: '1px solid #e0e0e0',
                    borderRadius: 1,
                    p: 0.5,
                    backgroundColor: 'white',
                    minWidth: 100,
                    maxWidth: 150
                  }}
                >
                  <Typography variant="caption" noWrap>
                    {attachment.name}
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => handleRemoveAttachment(attachment.id)}
                    sx={{
                      position: 'absolute',
                      top: -8,
                      right: -8,
                      backgroundColor: 'error.main',
                      color: 'white',
                      width: 20,
                      height: 20,
                      '&:hover': { backgroundColor: 'error.dark' }
                    }}
                  >
                    ×
                  </IconButton>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Paper>
      
      {/* Update the scroll button container with improved positioning */}
      <Box sx={{ 
        position: 'fixed', 
        bottom: 70, 
        right: 16, 
        zIndex: 1000, 
        pointerEvents: 'none',
        opacity: !isAtBottom && messagesWithDateFlags.length > 0 ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out',
        '& > *': {
          pointerEvents: 'auto'
        }
      }}>
        <ScrollToBottomButton 
          onClick={scrollToBottom} 
          visible={true} // Always render the button but control visibility with container opacity
        />
      </Box>

      {/* Delete Message Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteMessageCancel}
        aria-labelledby="delete-message-dialog-title"
        aria-describedby="delete-message-dialog-description"
      >
        <DialogTitle id="delete-message-dialog-title">
          Delete Message
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-message-dialog-description">
            Are you sure you want to delete this message? This action cannot be undone.
          </DialogContentText>
          {messageToDelete && (
            <Box sx={{ mt: 2, p: 2, backgroundColor: '#f5f5f5', borderRadius: 1 }}>
              <Typography variant="body2" noWrap>
                {messageToDelete.text || 'Message with attachments'}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={handleDeleteMessageCancel}
            color="inherit"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleDeleteMessageConfirm}
            color="error"
            variant="contained"
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={16} /> : <DeleteIcon />}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AdminChat; 