import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Badge,
  IconButton,
  Menu,
  Typography,
  Box,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Button,
  CircularProgress
} from '@mui/material';
import {
  Notifications as NotificationsIcon,
  AccessTime as AccessTimeIcon,
  Error as ErrorIcon,
  EventAvailable as EventAvailableIcon,
  ArrowForward as ArrowForwardIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  getSubscriptionNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  Notification
} from '../services/notificationService';
import { Timestamp } from 'firebase/firestore';

const SubscriptionNotificationCenter: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const open = Boolean(anchorEl);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    if (!currentUser) return;

    try {
      setLoading(true);
      const notifs = await getSubscriptionNotifications('admin', 20);
      setNotifications(notifs);
      setUnreadCount(notifs.filter(n => !n.read).length);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  // Initial load and set up polling
  useEffect(() => {
    if (currentUser) {
      fetchNotifications();
      
      // Poll for new notifications every minute
      pollIntervalRef.current = setInterval(fetchNotifications, 60000);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [currentUser, fetchNotifications]);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleMarkAllAsRead = async () => {
    if (!currentUser) return;
    
    try {
      await markAllNotificationsAsRead(currentUser.uid, 'admin');
      setNotifications(notifications.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking notifications as read:', error);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.id) return;

    try {
      // Mark as read
      if (!notification.read) {
        await markNotificationAsRead(notification.id);
        
        // Update local state
        setNotifications(
          notifications.map(n => 
            n.id === notification.id ? { ...n, read: true } : n
          )
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
      }

      // Navigate if there's a link
      if (notification.subscriptionId) {
        navigate(`/subscriptions/detail/${notification.subscriptionId}`);
      } else if (notification.link) {
        navigate(notification.link);
      }
      
      handleClose();
    } catch (error) {
      console.error('Error handling notification click:', error);
    }
  };

  // Update formatTimeAgo to handle Date or Timestamp
  const formatTimeAgo = (date: Date | Timestamp): string => {
    const dateObj = date instanceof Date ? date : 
                   (date && typeof date.toDate === 'function') ? date.toDate() : 
                   new Date();
    
    const now = new Date();
    const diffMs = now.getTime() - dateObj.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return dateObj.toLocaleDateString();
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'subscription_expiry':
        return <AccessTimeIcon color="warning" />;
      case 'payment_reminder':
        return <ErrorIcon color="error" />;
      default:
        return <NotificationsIcon color="primary" />;
    }
  };

  return (
    <>
      <Tooltip title="Subscription Notifications">
        <IconButton 
          color="inherit"
          onClick={handleOpen}
          sx={{ position: 'relative' }}
          aria-label="subscription notifications"
        >
          <Badge badgeContent={unreadCount} color="error" overlap="circular">
            <EventAvailableIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        slotProps={{ paper: {
          elevation: 3,
          sx: {
            maxHeight: 400,
            width: 360,
            overflow: 'auto',
            mt: 1,
          },
        } }}
      >
        <Box sx={{ display: "flex", px: 2, py: 1, alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Subscription Alerts
          </Typography>
          
          {unreadCount > 0 && (
            <Button size="small" onClick={handleMarkAllAsRead}>
              Mark all as read
            </Button>
          )}
        </Box>
        
        <Divider />
        
        {loading ? (
          <Box sx={{ display: "flex", py: 2, justifyContent: "center" }}>
            <CircularProgress size={24} />
          </Box>
        ) : notifications.length === 0 ? (
          <Box sx={{ py: 3, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              No subscription notifications
            </Typography>
          </Box>
        ) : (
          <>
            <List sx={{ py: 0 }}>
              {notifications.slice(0, 5).map(notification => (
                <ListItemButton 
                  key={notification.id} 
                  onClick={() => handleNotificationClick(notification)}
                  sx={{ 
                    cursor: 'pointer',
                    bgcolor: notification.read ? 'transparent' : 'action.hover',
                    '&:hover': { bgcolor: 'action.selected' }
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    {getNotificationIcon(notification.type)}
                  </ListItemIcon>
                  <ListItemText
                    primary={notification.title}
                    secondary={
                      <React.Fragment>
                        <Typography 
                          component="span" 
                          variant="body2" 
                          color="text.primary"
                          sx={{ display: 'block' }}
                        >
                          {notification.body}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatTimeAgo(notification.timestamp)}
                        </Typography>
                      </React.Fragment>
                    }
                    slotProps={{ primary: { 
                      variant: 'body2',
                      sx: { fontWeight: notification.read ? 'regular' : 'bold' },
                    } }}
                  />
                </ListItemButton>
              ))}
            </List>
            
            <Box sx={{ py: 1, textAlign: "center" }}>
              <Button 
                size="small" 
                endIcon={<ArrowForwardIcon />} 
                sx={{ textTransform: 'none' }}
                onClick={() => {
                  navigate('/subscriptions');
                  handleClose();
                }}
              >
                View All Subscriptions
              </Button>
            </Box>
          </>
        )}
      </Menu>
    </>
  );
};

export default SubscriptionNotificationCenter; 