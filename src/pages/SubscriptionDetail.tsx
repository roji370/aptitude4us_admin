// Subscription Detail page - Redesigned UI
import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Button, 
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  TextField,
  Snackbar,
  Alert
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { getSubscriptionById, renewSubscription, cancelSubscription, extendSubscription, computeEffectiveEndDate } from '../services/subscriptionService';
import { getUserById } from '../services/userService';
import type { UserDetails } from '../services/userService';
import { Subscription } from '../types/subscription';
import { createSubscriptionExpiryNotification } from '../services/notificationService';
import { Timestamp } from 'firebase/firestore';
import SubscriptionDetailLayout from '../components/SubscriptionDetailLayout';

const SubscriptionDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [user, setUser] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [openRenewDialog, setOpenRenewDialog] = useState(false);
  const [openCancelDialog, setOpenCancelDialog] = useState(false);
  const [openExtendDialog, setOpenExtendDialog] = useState(false);
  const [renewalMonths, setRenewalMonths] = useState(1);
  const [extensionDays, setExtensionDays] = useState(7);
  const [processing, setProcessing] = useState(false);
  const [sentNotification, setSentNotification] = useState(false);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const navigate = useNavigate();
  
  useEffect(() => {
    if (!id) return;
    
    const fetchData = async () => {
      try {
        setLoading(true);
        const subscriptionData = await getSubscriptionById(id);
        
        if (!subscriptionData) {
          console.error('Subscription not found');
          return;
        }
        
        setSubscription(subscriptionData);
        
        // Get user data
        try {
          const userData = await getUserById(subscriptionData.userId);
          setUser(userData);
        } catch (error) {
          console.error('Error fetching user data:', error);
        }
        
      } catch (error) {
        console.error('Error fetching subscription details:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [id]);
  
  const handleOpenRenewDialog = () => {
    setOpenRenewDialog(true);
  };
  
  const handleCloseRenewDialog = () => {
    setOpenRenewDialog(false);
    setRenewalMonths(1);
  };
  
  const handleOpenCancelDialog = () => {
    setOpenCancelDialog(true);
  };
  
  const handleCloseCancelDialog = () => {
    setOpenCancelDialog(false);
  };
  
  const handleRenewSubscription = async () => {
    if (!subscription) return;
    
    setProcessing(true);
    try {
      await renewSubscription(subscription.id, renewalMonths);
      // Refresh the data
      const updatedSubscription = await getSubscriptionById(subscription.id);
      setSubscription(updatedSubscription);
      handleCloseRenewDialog();
    } catch (error) {
      console.error('Error renewing subscription:', error);
    } finally {
      setProcessing(false);
    }
  };
  
  const handleCancelSubscription = async () => {
    if (!subscription) return;
    
    setProcessing(true);
    try {
      await cancelSubscription(subscription.id);
      // Refresh the data
      const updatedSubscription = await getSubscriptionById(subscription.id);
      setSubscription(updatedSubscription);
      handleCloseCancelDialog();
    } catch (error) {
      console.error('Error cancelling subscription:', error);
    } finally {
      setProcessing(false);
    }
  };
  
  const handleSendNotification = async () => {
    if (!subscription || !user) return;
    
    try {
      // Use effective end date for notification
      const endDate = subscription.endDate instanceof Date ? subscription.endDate : subscription.endDate.toDate();
      const examDate = subscription.examDate ? 
        (subscription.examDate instanceof Date ? subscription.examDate : (subscription.examDate as Timestamp)?.toDate?.() || null) : null;
      const effectiveEnd = computeEffectiveEndDate(endDate, examDate);
      
      await createSubscriptionExpiryNotification(
        subscription.id,
        subscription.userId,
        user.displayName || user.email || 'User',
        getDaysRemaining(effectiveEnd),
        effectiveEnd,
        'student'
      );
      
      setSentNotification(true);
      setTimeout(() => setSentNotification(false), 3000);
    } catch (error) {
      console.error('Error sending notification:', error);
    }
  };
  
  const handleOpenExtendDialog = (days?: number) => {
    setOpenExtendDialog(true);
    setExtensionDays(days || 7); // Use provided days or default to 7
  };
  
  const handleCloseExtendDialog = () => {
    setOpenExtendDialog(false);
  };
  
  const handleExtendSubscription = async () => {
    if (!subscription || !id) return;
    
    setProcessing(true);
    try {
      await extendSubscription(id, extensionDays);
      
      // Refresh the subscription data
      const updatedSubscription = await getSubscriptionById(id);
      setSubscription(updatedSubscription);
      
      // Show success message
      setSnackbarMessage(`Subscription extended by ${extensionDays} days`);
      setSnackbarOpen(true);
      
      // Close the dialog
      handleCloseExtendDialog();
    } catch (error) {
      console.error('Error extending subscription:', error);
      setSnackbarMessage('Failed to extend subscription');
      setSnackbarOpen(true);
    } finally {
      setProcessing(false);
    }
  };
  
  const handleCloseSnackbar = () => {
    setSnackbarOpen(false);
  };
  
  const getDaysRemaining = (endDate: Date | Timestamp): number => {
    const end = endDate instanceof Date ? endDate : endDate.toDate();
    const now = new Date();
    const diffTime = end.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };
  
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  
  if (!subscription) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" color="error">
          Subscription not found
        </Typography>
        <Button
          variant="contained"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/subscriptions/manage')}
          sx={{ mt: 2 }}
        >
          Back to Subscriptions
        </Button>
      </Box>
    );
  }
  
  // Format dates
  const startDate = subscription.startDate instanceof Date ? 
    subscription.startDate : 
    subscription.startDate.toDate();
  
  const endDate = subscription.endDate instanceof Date ? 
    subscription.endDate : 
    subscription.endDate.toDate();

  // Compute effective end date considering exam date
  const examDate = subscription.examDate ? 
    (subscription.examDate instanceof Date ? subscription.examDate : (subscription.examDate as Timestamp)?.toDate?.() || null) : null;
  const effectiveEndDate = computeEffectiveEndDate(endDate, examDate);
  
  const daysRemaining = getDaysRemaining(effectiveEndDate);
  const isActive = subscription.status === 'active';
  const isCancelled = subscription.status === 'cancelled';
  const isExpired = daysRemaining <= 0 && !isCancelled;

  // Adapt UserDetails to the format expected by SubscriptionDetailLayout
  const userInfo = user ? {
    displayName: user.displayName,
    email: user.email,
    uid: user.uid
  } : null;
  
  return (
    <Box sx={{ p: 3 }}>
      {/* Header with back button */}
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        mb: 3,
      }}>
        <IconButton onClick={() => navigate('/subscriptions/manage')} sx={{ mr: 1 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" component="h1">
          Subscription Details
        </Typography>
      </Box>
      
      <SubscriptionDetailLayout 
        subscription={subscription}
        user={userInfo}
        isActive={isActive}
        isCancelled={isCancelled}
        isExpired={isExpired}
        daysRemaining={daysRemaining}
        startDate={startDate}
        endDate={endDate}
        onRenew={handleOpenRenewDialog}
        onExtend={handleOpenExtendDialog}
        onCancel={handleOpenCancelDialog}
        onSendReminder={handleSendNotification}
        sentNotification={sentNotification}
      />
      
      {/* Renew Dialog */}
      <Dialog open={openRenewDialog} onClose={handleCloseRenewDialog}>
        <DialogTitle>Renew Subscription</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Select the duration for which you want to renew this subscription:
          </DialogContentText>
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel id="renewal-period-label">Renewal Period</InputLabel>
            <Select
              labelId="renewal-period-label"
              id="renewal-period"
              value={renewalMonths}
              onChange={(e) => setRenewalMonths(Number(e.target.value))}
              label="Renewal Period"
            >
              <MenuItem value={1}>1 Month</MenuItem>
              <MenuItem value={3}>3 Months</MenuItem>
              <MenuItem value={6}>6 Months</MenuItem>
              <MenuItem value={12}>12 Months (1 Year)</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseRenewDialog} disabled={processing}>
            Cancel
          </Button>
          <Button 
            onClick={handleRenewSubscription} 
            variant="contained" 
            color="primary"
            disabled={processing}
          >
            {processing ? 'Processing...' : 'Renew'}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Extend Dialog */}
      <Dialog open={openExtendDialog} onClose={handleCloseExtendDialog}>
        <DialogTitle>Extend Subscription</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Extend the current subscription by a number of days.
          </DialogContentText>
          <TextField
            autoFocus
            margin="dense"
            id="extension-days"
            label="Number of Days"
            type="number"
            fullWidth
            value={extensionDays}
            onChange={(e) => setExtensionDays(Math.max(1, parseInt(e.target.value) || 0))}
            slotProps={{ input: { inputProps: { min: 1 } } }}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseExtendDialog} disabled={processing}>
            Cancel
          </Button>
          <Button 
            onClick={handleExtendSubscription} 
            variant="contained" 
            color="primary"
            disabled={processing}
          >
            {processing ? 'Processing...' : 'Extend Subscription'}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Cancel Dialog */}
      <Dialog open={openCancelDialog} onClose={handleCloseCancelDialog}>
        <DialogTitle>Cancel Subscription</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to cancel this subscription? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCancelDialog} disabled={processing}>
            No, Keep Subscription
          </Button>
          <Button 
            onClick={handleCancelSubscription} 
            variant="contained" 
            color="error"
            disabled={processing}
          >
            Yes, Cancel Subscription
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Notification Snackbar */}
      <Snackbar 
        open={snackbarOpen} 
        autoHideDuration={6000} 
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={handleCloseSnackbar} 
          severity="success" 
          sx={{ width: '100%' }}
        >
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default SubscriptionDetail; 