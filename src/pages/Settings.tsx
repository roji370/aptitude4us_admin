import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Switch, 
  FormControlLabel, 
  Divider, 
  Button, 
  TextField,
  Alert,
  Snackbar,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Card,
  CardContent,
  InputAdornment,
  IconButton,
  CircularProgress
} from '@mui/material';
import { 
  Notifications as NotificationsIcon, 
  Security as SecurityIcon, 
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  AdminPanelSettings as AdminIcon,
  SyncAlt as SyncIcon
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { updatePassword, reauthenticateUser } from '../services/authService';
import { updateAllUserClaims } from '../services/adminService';

const Settings: React.FC = () => {
  const { currentUser, isAdmin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Notification settings
  const [notificationSettings, setNotificationSettings] = useState({
    pushNotifications: true,
    chatNotifications: true
  });
  
  // Security settings
  const [passwordChangeDialogOpen, setPasswordChangeDialogOpen] = useState(false);
  const [showDeleteAccountDialog, setShowDeleteAccountDialog] = useState(false);
  
  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  
  // Reauthentication state
  const [reauthDialogOpen, setReauthDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [pendingPasswordChange, setPendingPasswordChange] = useState(false);
  
  // Admin settings
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  
  const handleNotificationChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Update state
    const updatedSettings = {
      ...notificationSettings,
      [event.target.name]: event.target.checked
    };
    
    setNotificationSettings(updatedSettings);
    
    // Save to localStorage immediately
    localStorage.setItem('notificationSettings', JSON.stringify(updatedSettings));
    
    // Show success message
    setSuccess('Notification settings updated');
  };
  
  const handlePasswordChange = async () => {
    // Reset error state
    setPasswordError(null);
    
    // Validate passwords
    if (!newPassword) {
      setPasswordError('Please enter a new password');
      return;
    }
    
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    
    try {
      setLoading(true);
      await updatePassword(newPassword);
      setPasswordChangeDialogOpen(false);
      setSuccess('Password updated successfully');
      // Clear password fields
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error('Error updating password:', err);
      if (err instanceof Error) {
        // Check for specific Firebase error codes
        if (err.message.includes('requires-recent-login')) {
          setPendingPasswordChange(true);
          setPasswordChangeDialogOpen(false);
          setReauthDialogOpen(true);
        } else {
          setPasswordError(err.message);
        }
      } else {
        setPasswordError('Failed to update password');
      }
    } finally {
      setLoading(false);
    }
  };
  
  const handleReauthenticate = async () => {
    // Reset error state
    setReauthError(null);
    
    if (!currentPassword) {
      setReauthError('Please enter your current password');
      return;
    }
    
    try {
      setLoading(true);
      await reauthenticateUser(currentPassword);
      
      // If reauthentication is successful and we have a pending password change
      if (pendingPasswordChange) {
        await updatePassword(newPassword);
        setSuccess('Password updated successfully');
        setPendingPasswordChange(false);
        // Clear password fields
        setNewPassword('');
        setConfirmPassword('');
        setCurrentPassword('');
      }
      
      setReauthDialogOpen(false);
    } catch (err) {
      console.error('Reauthentication error:', err);
      if (err instanceof Error) {
        setReauthError(err.message.includes('auth/wrong-password') 
          ? 'Incorrect password' 
          : err.message);
      } else {
        setReauthError('Failed to authenticate');
      }
    } finally {
      setLoading(false);
    }
  };
  
  const handleCloseSnackbar = () => {
    setSuccess(null);
    setError(null);
  };
  
  // Load saved settings from localStorage on component mount
  useEffect(() => {
    const savedNotificationSettings = localStorage.getItem('notificationSettings');
    
    if (savedNotificationSettings) {
      const parsedSettings = JSON.parse(savedNotificationSettings);
      // Only apply the settings we're still using
      setNotificationSettings({
        pushNotifications: parsedSettings.pushNotifications ?? true,
        chatNotifications: parsedSettings.chatNotifications ?? true
      });
    }
  }, [currentUser]);

  // Handle sync custom claims
  const handleSyncDialogOpen = () => {
    setSyncDialogOpen(true);
  };

  const handleSyncDialogClose = () => {
    setSyncDialogOpen(false);
  };
  
  const handleSyncCustomClaims = async () => {
    try {
      setSyncing(true);
      const result = await updateAllUserClaims();
      
      if (result.success) {
        setSuccess(result.message);
      } else {
        setError(result.message);
      }
    } catch (error) {
      console.error('Error syncing custom claims:', error);
      setError('Failed to sync custom claims. Please try again.');
    } finally {
      setSyncing(false);
      setSyncDialogOpen(false);
    }
  };

  return (
    <Box sx={{ flexGrow: 1, maxWidth: 900, mx: 'auto' }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700, color: '#071A52', mb: 0.5 }}>
          Portal Settings
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
          Manage notifications, security credentials, and administrative synchronization
        </Typography>
      </Box>
      
      {/* Notification Settings Card */}
      <Card elevation={0} sx={{ mb: 3, borderRadius: '16px', border: '1px solid #E2E8F0', bgcolor: '#FFFFFF' }}>
        <CardContent sx={{ p: 3.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <NotificationsIcon sx={{ mr: 1.5, color: '#071A52' }} />
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#071A52' }}>
              Notification Preferences
            </Typography>
          </Box>
          <Divider sx={{ mb: 3, borderColor: '#F1F5F9' }} />
          
          <Box sx={{ px: 1 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={notificationSettings.pushNotifications}
                    onChange={handleNotificationChange}
                    name="pushNotifications"
                    color="primary"
                  />
                }
                label={<Typography sx={{ fontWeight: 500, fontSize: '0.95rem' }}>Push Notifications</Typography>}
              />
            <Typography variant="body2" color="text.secondary" sx={{ ml: 4, mb: 2 }}>
                Receive immediate examination and portal alerts in your browser
              </Typography>
            
              <FormControlLabel
                control={
                  <Switch
                    checked={notificationSettings.chatNotifications}
                    onChange={handleNotificationChange}
                    name="chatNotifications"
                    color="primary"
                  />
                }
                label={<Typography sx={{ fontWeight: 500, fontSize: '0.95rem' }}>Chat Notifications</Typography>}
              />
              <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                Get notified when candidates post questions or inquiries
              </Typography>
          </Box>
        </CardContent>
      </Card>
      
      {/* Security Settings Card */}
      <Card elevation={0} sx={{ mb: 3, borderRadius: '16px', border: '1px solid #E2E8F0', bgcolor: '#FFFFFF' }}>
        <CardContent sx={{ p: 3.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <SecurityIcon sx={{ mr: 1.5, color: '#071A52' }} />
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#071A52' }}>
              Account Security & Access
            </Typography>
          </Box>
          <Divider sx={{ mb: 3, borderColor: '#F1F5F9' }} />
          
          <List disablePadding>
            <ListItem sx={{ px: 1, flexWrap: 'wrap', gap: 1 }}>
              <ListItemText
                primary="Change Password"
                secondary="Update your account password"
              />
              <ListItemSecondaryAction>
                <Button
                  variant="outlined"
                  color="primary"
                  onClick={() => setPasswordChangeDialogOpen(true)}
                  size="medium"
                >
                  Change Password
                </Button>
              </ListItemSecondaryAction>
            </ListItem>
            
            <Divider sx={{ my: 1.5 }} />
            
            <ListItem sx={{ px: 1, flexWrap: 'wrap', gap: 1 }}>
              <ListItemText
                primary="Delete Account"
                secondary="Permanently delete your account and all associated data"
              />
              <ListItemSecondaryAction>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={() => setShowDeleteAccountDialog(true)}
                  size="medium"
                >
                  Delete Account
                </Button>
              </ListItemSecondaryAction>
            </ListItem>
          </List>
        </CardContent>
      </Card>
      
      {/* Admin Tools Card - Only shown to admins */}
      {isAdmin && (
        <Card elevation={0} sx={{ mb: 3, borderRadius: '16px', border: '1px solid #E2E8F0', bgcolor: '#FFFFFF' }}>
          <CardContent sx={{ p: 3.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <AdminIcon sx={{ mr: 1.5, color: '#071A52' }} />
              <Typography variant="h6" sx={{ fontWeight: 600, color: '#071A52' }}>
                System Administration & Sync Engine
              </Typography>
            </Box>
            <Divider sx={{ mb: 3, borderColor: '#F1F5F9' }} />
            
            <List disablePadding>
              <ListItem sx={{ px: 1, flexWrap: 'wrap', gap: 1 }}>
                <ListItemText
                  primary={<Typography sx={{ fontWeight: 600, color: '#071A52' }}>Sync Custom Claims</Typography>}
                  secondary="Update Firebase authentication claims for all users based on their roles in the database"
                />
                <ListItemSecondaryAction>
                  <Button
                    variant="outlined"
                    startIcon={<SyncIcon />}
                    onClick={handleSyncDialogOpen}
                    sx={{
                      textTransform: 'none',
                      fontWeight: 600,
                      borderColor: '#E2E8F0',
                      color: '#071A52',
                      borderRadius: '8px',
                      '&:hover': {
                        borderColor: '#CBD5E1',
                        bgcolor: 'rgba(7, 26, 82, 0.04)'
                      }
                    }}
                  >
                    Sync Claims
                  </Button>
                </ListItemSecondaryAction>
              </ListItem>
            </List>
          </CardContent>
        </Card>
      )}
      
      {/* Password Change Dialog */}
      <Dialog open={passwordChangeDialogOpen} onClose={() => setPasswordChangeDialogOpen(false)}>
        <DialogTitle>Change Password</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Enter your new password below. Password must be at least 6 characters long.
          </DialogContentText>
          
          {passwordError && (
            <Alert severity="error" sx={{ mt: 2, mb: 2 }}>
              {passwordError}
            </Alert>
          )}
          
          <TextField
            margin="dense"
            id="new-password"
            label="New Password"
            type={showNewPassword ? "text" : "password"}
            fullWidth
            variant="outlined"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            sx={{ mt: 2 }}
            slotProps={{ input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="toggle password visibility"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      edge="end"
                    >
                      {showNewPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              } }}
          />
          
          <TextField
            margin="dense"
            id="confirm-password"
            label="Confirm Password"
            type={showConfirmPassword ? "text" : "password"}
            fullWidth
            variant="outlined"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            sx={{ mt: 2 }}
            slotProps={{ input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="toggle password visibility"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      edge="end"
                    >
                      {showConfirmPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasswordChangeDialogOpen(false)} color="primary">
            Cancel
          </Button>
          <Button 
            onClick={handlePasswordChange} 
            color="primary"
            disabled={loading}
          >
            {loading ? 'Updating...' : 'Update Password'}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Reauthentication Dialog */}
      <Dialog open={reauthDialogOpen} onClose={() => setReauthDialogOpen(false)}>
        <DialogTitle>Verify Your Identity</DialogTitle>
        <DialogContent>
          <DialogContentText>
            For security reasons, please enter your current password to continue.
          </DialogContentText>
          
          {reauthError && (
            <Alert severity="error" sx={{ mt: 2, mb: 2 }}>
              {reauthError}
            </Alert>
          )}
          
          <TextField
            autoFocus
            margin="dense"
            id="current-password"
            label="Current Password"
            type={showCurrentPassword ? "text" : "password"}
            fullWidth
            variant="outlined"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            sx={{ mt: 2 }}
            slotProps={{ input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="toggle password visibility"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      edge="end"
                    >
                      {showCurrentPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              } }}
          />
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => {
              setReauthDialogOpen(false);
              setPendingPasswordChange(false);
            }} 
            color="primary"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleReauthenticate} 
            color="primary"
            disabled={loading}
          >
            {loading ? 'Verifying...' : 'Continue'}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Delete Account Dialog */}
      <Dialog open={showDeleteAccountDialog} onClose={() => setShowDeleteAccountDialog(false)}>
        <DialogTitle>Delete Account</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete your account? This action cannot be undone and will permanently delete all your data.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDeleteAccountDialog(false)} color="primary">
            Cancel
          </Button>
          <Button color="error">
            Delete Permanently
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Sync Custom Claims Dialog */}
      <Dialog
        open={syncDialogOpen}
        onClose={handleSyncDialogClose}
        aria-labelledby="sync-dialog-title"
        aria-describedby="sync-dialog-description"
      >
        <DialogTitle id="sync-dialog-title">
          Sync Custom Claims
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="sync-dialog-description">
            This action will update Firebase custom claims for all users based on their roles and permissions in the database.
            This is useful if you've made changes to user roles or permissions that need to be reflected in authentication tokens.
            <br /><br />
            Do you want to continue?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleSyncDialogClose} disabled={syncing}>
            Cancel
          </Button>
          <Button 
            onClick={handleSyncCustomClaims} 
            color="primary" 
            disabled={syncing}
            startIcon={syncing ? <CircularProgress size={20} /> : <SyncIcon />}
          >
            {syncing ? 'Syncing...' : 'Sync Claims'}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Success/Error Snackbar */}
      <Snackbar
        open={!!success || !!error}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert 
          onClose={handleCloseSnackbar} 
          severity={success ? 'success' : 'error'}
          sx={{ width: '100%' }}
        >
          {success || error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Settings; 