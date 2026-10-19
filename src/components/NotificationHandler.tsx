import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  initializeMessaging, 
  onForegroundMessage,
  requestNotificationPermission
} from '../services/fcmService';
import { Snackbar, Alert, Button, Box, Typography } from '@mui/material';
import { MessagePayload } from 'firebase/messaging';
import { useNavigate } from 'react-router-dom';
import { getMessaging } from 'firebase/messaging';
import app from '../firebase/config';

interface NotificationMessage {
  title: string;
  body: string;
  link?: string;
  type?: string;
  chatId?: string;
  senderId?: string;
  senderName?: string;
}

const NotificationHandler: React.FC = () => {
  const { currentUser } = useAuth();
  const [notification, setNotification] = useState<NotificationMessage | null>(null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Function to request notification permissions explicitly
  const requestPermissions = useCallback(async () => {
    try {
      // Check current permission first
      if (Notification.permission === 'denied') {
        setPermissionDenied(true);
        return null;
      }
      
      const result = await requestNotificationPermission();
      if (!result) {
        setPermissionDenied(true);
      }
      return result;
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    const setupMessaging = async () => {
      if (!currentUser) return;

      try {
        // Check if notifications are supported
        if (!('Notification' in window)) {
          console.log('This browser does not support notifications');
          return;
        }

        // Check if notifications are already blocked
        if (Notification.permission === 'denied') {
          console.log('Notifications are blocked by user');
          setPermissionDenied(true);
          return;
        }
        
        // Only request permission if not already granted
        let permission: NotificationPermission = Notification.permission;
        if (permission === 'default') {
          permission = await Notification.requestPermission();
        }
        
        if (permission === 'granted') {
          try {
            const token = await initializeMessaging(currentUser.uid);
            if (token) {
              console.log('FCM token obtained:', token);
              
              // Set up foreground message handler using the imported function
              onForegroundMessage().then((payload) => {
              if (!payload) {
                console.log("No payload received or notifications not permitted");
                return;
              }
              
              console.log('Message received:', payload);
              
              // Extract notification data
              const title = payload.notification?.title || 'New Notification';
              const body = payload.notification?.body || '';
              const icon = payload.notification?.icon || '/logo192.png';
              
              // Show the notification using the Notification API
              if ('Notification' in window && Notification.permission === 'granted') {
                const notification = new Notification(title, {
                  body,
                  icon
                });
                
                // Handle notification click
                notification.onclick = () => {
                  console.log('Notification clicked');
                  window.focus();
                  notification.close();
                  
                  // Navigate to notification target if available
                  if (payload.data?.url) {
                    navigate(payload.data.url);
                  }
                };
              }
              
              // Add notification to local state for in-app display
              if (payload.notification) {
                setNotification({
                  title: payload.notification.title || 'New Notification',
                  body: payload.notification.body || '',
                  type: payload.data?.type || 'system',
                  link: payload.data?.url
                });
                setOpen(true);
                
                // Also add to notifications list
                setNotifications(prev => [
                  {
                    id: `local-${Date.now()}`,
                    title: payload.notification?.title || 'New Notification',
                    body: payload.notification?.body || '',
                    timestamp: new Date(),
                    read: false
                  },
                  ...prev
                ]);
                
                // Play notification sound
                playNotificationSound();
              }
            });
            
            // When service worker changes, we need to handle token refresh
            navigator.serviceWorker.addEventListener('message', () => {
              console.log('Service worker message received');
              // Refresh token here if needed
            });
            } else {
              console.log('Failed to get FCM token');
            }
          } catch (fcmError) {
            console.error('FCM initialization error (non-fatal):', fcmError);
            // FCM errors are non-fatal, app should continue to work
          }
        } else {
          console.log("Notification permission denied");
          setPermissionDenied(true);
        }
      } catch (error) {
        console.error('Error setting up messaging:', error);
      }
    };

    setupMessaging();

    // Clean up
    return () => {
      // Nothing to clean up since we're not storing unsubscribe function
    };
  }, [currentUser, navigate]);

  // Simple function to play notification sound
  const playNotificationSound = () => {
    try {
      const audio = new Audio('/notification-sound.mp3');
      audio.play();
    } catch (error) {
      console.error('Error playing notification sound:', error);
    }
  };

  const handleClose = (event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    setOpen(false);
  };

  const handlePermissionSnackbarClose = () => {
    setPermissionDenied(false);
  };

  const handleNotificationClick = () => {
    if (!notification) return;
    
    setOpen(false);
    
    // Handle different notification types
    if (notification.type === 'chat' && notification.chatId) {
      // Navigate to chat page
      navigate('/chat');
    } else if (notification.link) {
      // Navigate to link
      navigate(notification.link);
    }
  };

  return (
    <>
      {/* Regular notifications */}
      <Snackbar
        open={open}
        autoHideDuration={6000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert 
          onClose={handleClose} 
          severity={notification?.type === 'chat' ? 'info' : 'success'}
          sx={{ width: '100%', cursor: 'pointer' }}
          onClick={handleNotificationClick}
          action={
            <Button color="inherit" size="small" onClick={handleNotificationClick}>
              {notification?.type === 'chat' ? 'VIEW CHAT' : 'OPEN'}
            </Button>
          }
        >
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
              {notification?.title}
            </Typography>
            <Typography variant="body2">
              {notification?.body}
            </Typography>
          </Box>
        </Alert>
      </Snackbar>

      {/* Permission denied notification */}
      <Snackbar
        open={permissionDenied}
        autoHideDuration={10000}
        onClose={handlePermissionSnackbarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={handlePermissionSnackbarClose} 
          severity="warning"
          sx={{ width: '100%' }}
        >
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
              Notifications Blocked
            </Typography>
            <Typography variant="body2">
              Please enable notifications in your browser settings to receive important alerts.
            </Typography>
          </Box>
        </Alert>
      </Snackbar>
    </>
  );
};

export default NotificationHandler; 