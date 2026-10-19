import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  TextField, 
  Button, 
  FormControl, 
  InputLabel, 
  Select, 
  MenuItem, 
  SelectChangeEvent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Tabs,
  Tab,
  Divider
} from '@mui/material';
import { 
  Send as SendIcon, 
  Delete as DeleteIcon,
  Notifications as NotificationsIcon,
  Chat as ChatIcon,
  Announcement as AnnouncementIcon,
  School as SchoolIcon,
  Settings as SettingsIcon
} from '@mui/icons-material';
import { collection, onSnapshot, query, orderBy, limit as firestoreLimit } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { 
  sendNotification, 
  type Notification, 
  deleteNotification, 
  getRecentNotifications,
  getNotificationsByType
} from '../services/notificationService';
import { getUsers } from '../services/userService';
import { useAuth } from '../context/AuthContext';
import { initializeMessaging } from '../services/fcmService';

// Interface for user data in the component
interface User {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

// Add type for the chip color
type ChipColor = 'primary' | 'secondary' | 'success' | 'warning' | 'default';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel = (props: TabPanelProps) => {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`notification-tabpanel-${index}`}
      aria-labelledby={`notification-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
};

const Notifications: React.FC = () => {
  const { currentUser } = useAuth();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<'chat' | 'system' | 'announcement' | 'course'>('system');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [notificationToDelete, setNotificationToDelete] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [courseId, setCourseId] = useState('');
  const [link, setLink] = useState('');
  const [notificationPermission, setNotificationPermission] = useState<string>('default');
  const [fcmToken, setFcmToken] = useState<string | null>(null);

  // Fetch users and notifications
  useEffect(() => {
    // Check if user is authenticated
    if (!currentUser) {
      setError('You must be logged in to access notifications');
      setLoading(false);
      return () => {};
    }

    const fetchUsers = async () => {
      try {
        const fetchedUsers = await getUsers();
        // Transform UserDetails to User interface
        const transformedUsers: User[] = fetchedUsers.map(user => ({
          id: user.uid,
          displayName: user.displayName || 'Unknown User',
          email: user.email || 'No email',
          role: user.role
        }));
        setUsers(transformedUsers);
      } catch (err) {
        console.error('Error fetching users:', err);
        setError('Failed to load users');
      }
    };

    fetchUsers();

    // Real-time listener for notifications
    const q = query(
      collection(db, 'notifications'),
      orderBy('timestamp', 'desc'),
      firestoreLimit(100)
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const fetchedNotifications: Notification[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        fetchedNotifications.push({
          id: doc.id,
          ...data,
          timestamp: data.timestamp?.toDate() || new Date(),
          readTimestamp: data.readTimestamp?.toDate()
        } as Notification);
      });
      setNotifications(fetchedNotifications);
      setLoading(false);
    }, (err) => {
      console.error('Error listening to notifications:', err);
      setError('Failed to load notifications');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Add new useEffect for notification permission status
  useEffect(() => {
    // Check notification permission status
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    
    // Filter notifications by type based on tab
    const fetchNotificationsByType = async () => {
      try {
        let filteredNotifications: Notification[];
        
        switch (newValue) {
          case 1: // Chat
            filteredNotifications = await getNotificationsByType('chat');
            break;
          case 2: // Announcements
            filteredNotifications = await getNotificationsByType('announcement');
            break;
          case 3: // Course
            filteredNotifications = await getNotificationsByType('course');
            break;
          case 4: // System
            filteredNotifications = await getNotificationsByType('system');
            break;
          default: // All
            filteredNotifications = await getRecentNotifications();
            break;
        }
        
        setNotifications(filteredNotifications);
      } catch (err) {
        console.error('Error fetching notifications by type:', err);
        setError('Failed to filter notifications');
      }
    };
    
    fetchNotificationsByType();
  };

  const handleSendNotification = async () => {
    if (!title.trim() || !body.trim()) return;
    
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setError('You must be logged in to send notifications');
        return;
      }

      await sendNotification(
        title,
        body,
        type,
        currentUser.uid,
        selectedUsers,
        type === 'course' ? courseId : undefined,
        link || undefined
      );

      setTitle('');
      setBody('');
      setCourseId('');
      setLink('');
      setSelectedUsers([]);
    } catch (err) {
      console.error('Error sending notification:', err);
      setError('Failed to send notification');
    }
  };

  const handleUserSelect = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value;
    setSelectedUsers(typeof value === 'string' ? value.split(',') : value);
  };

  const handleTypeChange = (event: SelectChangeEvent) => {
    setType(event.target.value as 'chat' | 'system' | 'announcement' | 'course');
  };

  const handleDeleteClick = (notificationId: string) => {
    setNotificationToDelete(notificationId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!notificationToDelete) return;
    
    try {
      await deleteNotification(notificationToDelete);
      setDeleteDialogOpen(false);
      setNotificationToDelete(null);
    } catch (err) {
      console.error('Error deleting notification:', err);
      setError('Failed to delete notification');
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setNotificationToDelete(null);
  };

  const formatDate = (date: Date) => {
    return date.toLocaleString();
  };

  const getTypeIcon = (notificationType: string) => {
    switch (notificationType) {
      case 'chat':
        return <ChatIcon />;
      case 'announcement':
        return <AnnouncementIcon />;
      case 'course':
        return <SchoolIcon />;
      case 'system':
        return <SettingsIcon />;
      default:
        return <NotificationsIcon />;
    }
  };

  const getTypeColor = (notificationType: string): ChipColor => {
    switch (notificationType) {
      case 'chat':
        return 'primary';
      case 'announcement':
        return 'secondary';
      case 'course':
        return 'success';
      case 'system':
        return 'warning';
      default:
        return 'default';
    }
  };

  // Add handler for requesting notification permission
  const handleRequestPermission = async () => {
    if (!currentUser) return;
    
    try {
      const token = await initializeMessaging(currentUser.uid);
      if (token) {
        setFcmToken(token);
        setNotificationPermission('granted');
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      setError('Failed to request notification permission');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ flexGrow: 1, p: 3 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Notifications
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Browser Notification Settings
        </Typography>
        
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography>
              Push Notifications: {notificationPermission === 'granted' ? 'Enabled' : 'Disabled'}
            </Typography>
            
            {notificationPermission !== 'granted' && (
              <Button 
                variant="contained" 
                onClick={handleRequestPermission}
                disabled={notificationPermission === 'denied'}
              >
                Enable Notifications
              </Button>
            )}
            
            {notificationPermission === 'denied' && (
              <Typography color="error" variant="caption">
                Notifications are blocked. Please enable them in your browser settings.
              </Typography>
            )}
          </Box>
          
          {fcmToken && (
            <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
              Device registered for notifications
            </Typography>
          )}
        </Box>
        
        <Divider sx={{ my: 2 }} />
        
        <Typography variant="h6" gutterBottom>
          Send New Notification
        </Typography>
        
        <Box component="form" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Title"
            fullWidth
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          
          <TextField
            label="Message"
            fullWidth
            multiline
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
          
          <FormControl fullWidth>
            <InputLabel id="notification-type-label">Notification Type</InputLabel>
            <Select
              labelId="notification-type-label"
              id="notification-type"
              value={type}
              label="Notification Type"
              onChange={handleTypeChange}
            >
              <MenuItem value="system">System</MenuItem>
              <MenuItem value="chat">Chat</MenuItem>
              <MenuItem value="announcement">Announcement</MenuItem>
              <MenuItem value="course">Course</MenuItem>
            </Select>
          </FormControl>
          
          {type === 'course' && (
            <TextField
              label="Course ID"
              fullWidth
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              helperText="Enter the course ID this notification relates to"
            />
          )}
          
          <TextField
            label="Link (Optional)"
            fullWidth
            value={link}
            onChange={(e) => setLink(e.target.value)}
            helperText="Optional deep link URL for the notification"
          />
          
          <FormControl fullWidth>
            <InputLabel id="recipients-label">Recipients (empty for broadcast)</InputLabel>
            <Select
              labelId="recipients-label"
              id="recipients-select"
              multiple
              value={selectedUsers}
              onChange={handleUserSelect}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {selected.map((value) => {
                    const user = users.find(u => u.id === value);
                    return (
                      <Chip key={value} label={user?.displayName || value} />
                    );
                  })}
                </Box>
              )}
            >
              {users.map((user) => (
                <MenuItem key={user.id} value={user.id}>
                  {user.displayName} ({user.email})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          
          <Button
            variant="contained"
            color="primary"
            startIcon={<SendIcon />}
            onClick={handleSendNotification}
            disabled={!title.trim() || !body.trim()}
            sx={{ alignSelf: 'flex-end' }}
          >
            Send Notification
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ width: '100%', mb: 2 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={handleTabChange} aria-label="notification tabs">
            <Tab label="All Notifications" />
            <Tab label="Chat" icon={<ChatIcon />} iconPosition="start" />
            <Tab label="Announcements" icon={<AnnouncementIcon />} iconPosition="start" />
            <Tab label="Course" icon={<SchoolIcon />} iconPosition="start" />
            <Tab label="System" icon={<SettingsIcon />} iconPosition="start" />
          </Tabs>
        </Box>
        
        <TabPanel value={tabValue} index={0}>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Message</TableCell>
                  <TableCell>Recipients</TableCell>
                  <TableCell>Sent At</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {notifications.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      No notifications found
                    </TableCell>
                  </TableRow>
                ) : (
                  notifications.map((notification) => (
                    <TableRow key={notification.id}>
                      <TableCell>
                        <Chip
                          icon={getTypeIcon(notification.type)}
                          label={notification.type}
                          color={getTypeColor(notification.type)}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>{notification.title}</TableCell>
                      <TableCell>{notification.body}</TableCell>
                      <TableCell>
                        {notification.recipients && notification.recipients.length > 0 
                          ? `${notification.recipients.length} recipient(s)` 
                          : 'Broadcast'
                        }
                      </TableCell>
                      <TableCell>{formatDate(notification.timestamp)}</TableCell>
                      <TableCell>
                        <IconButton
                          color="error"
                          onClick={() => handleDeleteClick(notification.id || '')}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>
        
        <TabPanel value={tabValue} index={1}>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Title</TableCell>
                  <TableCell>Message</TableCell>
                  <TableCell>Recipients</TableCell>
                  <TableCell>Sent At</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {notifications.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      No chat notifications found
                    </TableCell>
                  </TableRow>
                ) : (
                  notifications.map((notification) => (
                    <TableRow key={notification.id}>
                      <TableCell>{notification.title}</TableCell>
                      <TableCell>{notification.body}</TableCell>
                      <TableCell>
                        {notification.recipients && notification.recipients.length > 0 
                          ? `${notification.recipients.length} recipient(s)` 
                          : 'Broadcast'
                        }
                      </TableCell>
                      <TableCell>{formatDate(notification.timestamp)}</TableCell>
                      <TableCell>
                        <IconButton
                          color="error"
                          onClick={() => handleDeleteClick(notification.id || '')}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </TabPanel>
        
        {/* Similar TabPanels for other notification types (index 2, 3, 4) */}
        {[2, 3, 4].map((index) => (
          <TabPanel key={index} value={tabValue} index={index}>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Title</TableCell>
                    <TableCell>Message</TableCell>
                    <TableCell>Recipients</TableCell>
                    <TableCell>Sent At</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {notifications.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} align="center">
                        No {index === 2 ? 'announcement' : index === 3 ? 'course' : 'system'} notifications found
                      </TableCell>
                    </TableRow>
                  ) : (
                    notifications.map((notification) => (
                      <TableRow key={notification.id}>
                        <TableCell>{notification.title}</TableCell>
                        <TableCell>{notification.body}</TableCell>
                        <TableCell>
                          {notification.recipients && notification.recipients.length > 0 
                            ? `${notification.recipients.length} recipient(s)` 
                            : 'Broadcast'
                          }
                        </TableCell>
                        <TableCell>{formatDate(notification.timestamp)}</TableCell>
                        <TableCell>
                          <IconButton
                            color="error"
                            onClick={() => handleDeleteClick(notification.id || '')}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </TabPanel>
        ))}
      </Paper>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
      >
        <DialogTitle>Delete Notification</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this notification? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error">Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Notifications; 