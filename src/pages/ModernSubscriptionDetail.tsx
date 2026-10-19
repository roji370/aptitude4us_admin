import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Grid, 
  Button, 
  Divider, 
  Chip,
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
  Card,
  CardContent,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Alert
} from '@mui/material';
import {
  Person as PersonIcon,
  CalendarToday as CalendarTodayIcon,
  AccessTime as AccessTimeIcon,
  Payments as PaymentsIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  ArrowBack as ArrowBackIcon,
  Refresh as RefreshIcon,
  Cancel as CancelIcon,
  Email as EmailIcon,
  CreditCard as CreditCardIcon,
  Event as EventIcon
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { getSubscriptionById, renewSubscription, cancelSubscription, computeEffectiveEndDate } from '../services/subscriptionService';
import { getUserById } from '../services/userService';
import type { UserDetails } from '../services/userService';
import { Subscription } from '../types/subscription';
import { createSubscriptionExpiryNotification } from '../services/notificationService';
import { Timestamp } from 'firebase/firestore';

const ModernSubscriptionDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [user, setUser] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [openRenewDialog, setOpenRenewDialog] = useState(false);
  const [openCancelDialog, setOpenCancelDialog] = useState(false);
  const [renewalMonths, setRenewalMonths] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [sentNotification, setSentNotification] = useState(false);
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
  
  const getDaysRemaining = (endDate: Date | Timestamp): number => {
    const end = endDate instanceof Date ? endDate : endDate.toDate();
    const now = new Date();
    const diffTime = end.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };
  
  const getStatusChip = (effectiveDays?: number) => {
    if (!subscription) return null;
    
    if (subscription.status === 'cancelled') {
      return <Chip label="Cancelled" color="default" />;
    }
    
    // Use effective days remaining if provided (accounts for exam date)
    const daysRemaining = effectiveDays !== undefined ? effectiveDays : getDaysRemaining(subscription.endDate);
    
    if (daysRemaining < 0) {
      return <Chip label="Expired" color="error" icon={<ErrorIcon />} />;
    } else if (daysRemaining === 0) {
      return <Chip label="Expires Today" color="error" icon={<WarningIcon />} />;
    } else if (daysRemaining <= 3) {
      return <Chip label={`${daysRemaining} Days Left`} color="warning" icon={<WarningIcon />} />;
    } else {
      return <Chip label="Active" color="success" icon={<CheckCircleIcon />} />;
    }
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

  // Parse exam date
  const examDate = subscription.examDate ? 
    (subscription.examDate instanceof Date ? 
      subscription.examDate : 
      (subscription.examDate as Timestamp)?.toDate?.() || null)
    : null;
  
  // Calculate effective end date: min(endDate, examDate-end-of-day)
  const effectiveEndDate = computeEffectiveEndDate(endDate, examDate);
  const isExamBeforeEnd = effectiveEndDate < endDate;
  
  const daysRemaining = getDaysRemaining(subscription.endDate);
  const effectiveDaysRemaining = Math.ceil((effectiveEndDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  const isActive = subscription.status === 'active';
  const isCancelled = subscription.status === 'cancelled';
  const isExpired = effectiveDaysRemaining <= 0 && !isCancelled;
  
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
      
      <Grid container spacing={3}>
        {/* Status Card */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card 
            sx={{ 
              boxShadow: 2, 
              bgcolor: isActive ? 'success.light' : isCancelled ? 'grey.100' : 'error.light',
              borderRadius: 2,
              height: '100%'
            }}
          >
            <CardContent sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="h6" gutterBottom>
                Subscription Status
              </Typography>
              
              <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                mb: 2 
              }}>
                {isActive && <CheckCircleIcon sx={{ mr: 1, color: 'success.main' }} />}
                {isCancelled && <CancelIcon sx={{ mr: 1, color: 'text.secondary' }} />}
                {isExpired && <ErrorIcon sx={{ mr: 1, color: 'error.main' }} />}
                
                {getStatusChip(effectiveDaysRemaining)}
              </Box>
              
              {isActive && !isExpired && (
                <Box>
                  <Typography variant="body1" sx={{ fontWeight: "medium" }}>
                    {isExamBeforeEnd ? 'Effective end' : 'Expires on'}: {effectiveEndDate.toLocaleDateString()}
                  </Typography>
                  {isExamBeforeEnd && (
                    <Alert severity="info" sx={{ mt: 1, textAlign: 'left' }}>
                      <Typography variant="body2">
                        Exam date ({examDate!.toLocaleDateString()}) is before subscription end ({endDate.toLocaleDateString()}). Access will end on exam date.
                      </Typography>
                    </Alert>
                  )}
                </Box>
              )}
              
              {isActive && (
                <Box 
                  sx={{ 
                    mt: 3, 
                    display: 'flex', 
                    gap: 1,
                    justifyContent: 'center' 
                  }}
                >
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleOpenRenewDialog}
                    startIcon={<RefreshIcon />}
                    size="small"
                  >
                    Renew
                  </Button>
                  
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={handleOpenCancelDialog}
                    startIcon={<CancelIcon />}
                    size="small"
                  >
                    Cancel
                  </Button>
                </Box>
              )}
              
              {isCancelled && (
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleOpenRenewDialog}
                  startIcon={<RefreshIcon />}
                  sx={{ mt: 2 }}
                >
                  Renew
                </Button>
              )}
              
              {isExpired && !isCancelled && (
                <Box>
                  <Alert severity="error" sx={{ mb: 2 }}>
                    This subscription has expired.
                  </Alert>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleOpenRenewDialog}
                    startIcon={<RefreshIcon />}
                  >
                    Renew Now
                  </Button>
                </Box>
              )}
              
              {user && isActive && !isExpired && (
                <Button
                  variant="text"
                  color="primary"
                  onClick={handleSendNotification}
                  sx={{ mt: 2 }}
                  disabled={sentNotification}
                >
                  {sentNotification ? 'Notification Sent' : 'Send Reminder'}
                </Button>
              )}
            </CardContent>
          </Card>
        </Grid>
        
        {/* User Information */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%', borderRadius: 2, boxShadow: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                User Information
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              {user ? (
                <List disablePadding>
                  <ListItem disablePadding sx={{ mb: 2 }}>
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      <PersonIcon />
                    </ListItemIcon>
                    <ListItemText
                      primary="Name"
                      secondary={user.displayName || 'Not available'}
                    />
                  </ListItem>
                  
                  <ListItem disablePadding sx={{ mb: 2 }}>
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      <EmailIcon />
                    </ListItemIcon>
                    <ListItemText
                      primary="Email"
                      secondary={user.email || 'Not available'}
                    />
                  </ListItem>
                  
                  <Box sx={{ ml: 5, mt: 3 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => navigate(`/users/${subscription.userId}`)}
                    >
                      View User Profile
                    </Button>
                  </Box>
                </List>
              ) : (
                <Typography color="text.secondary">
                  User information not available
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        
        {/* Subscription Details */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%', borderRadius: 2, boxShadow: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Plan Details
              </Typography>
              <Divider sx={{ mb: 2 }} />
              
              <List disablePadding>
                <ListItem disablePadding sx={{ mb: 2 }}>
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <CreditCardIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary="Plan"
                    secondary={subscription.planName}
                  />
                </ListItem>
                
                <ListItem disablePadding sx={{ mb: 2 }}>
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <CalendarTodayIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary="Start Date"
                    secondary={startDate.toLocaleDateString()}
                  />
                </ListItem>
                
                <ListItem disablePadding sx={{ mb: 2 }}>
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <CalendarTodayIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary="End Date"
                    secondary={endDate.toLocaleDateString()}
                  />
                </ListItem>

                {examDate && (
                  <ListItem disablePadding sx={{ mb: 2 }}>
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      <EventIcon sx={{ color: isExamBeforeEnd ? 'info.main' : 'text.secondary' }} />
                    </ListItemIcon>
                    <ListItemText
                      primary="Exam Date"
                      secondary={
                        isExamBeforeEnd 
                          ? `${examDate.toLocaleDateString()} (effective end date)` 
                          : examDate.toLocaleDateString()
                      }
                      slotProps={{ secondary: {
                        sx: {
                          color: isExamBeforeEnd ? 'info.main' : 'text.secondary',
                          fontWeight: isExamBeforeEnd ? 'bold' : 'normal'
                        }
                      } }}
                    />
                  </ListItem>
                )}
                
                <ListItem disablePadding sx={{ mb: 2 }}>
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <AccessTimeIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary="Duration"
                    secondary={`${Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30))} month(s)`}
                  />
                </ListItem>
                
                <ListItem disablePadding>
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <PaymentsIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary="Amount"
                    secondary={`$${subscription.price.toFixed(2)}`}
                  />
                </ListItem>
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      
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
            {processing ? <CircularProgress size={24} /> : 'Renew'}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Cancel Dialog */}
      <Dialog open={openCancelDialog} onClose={handleCloseCancelDialog}>
        <DialogTitle>Cancel Subscription</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to cancel this subscription?
            User access will continue until the end date, but the subscription will not auto-renew.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCancelDialog} disabled={processing}>
            No, Keep It
          </Button>
          <Button 
            onClick={handleCancelSubscription} 
            color="error"
            variant="contained"
            disabled={processing}
          >
            {processing ? <CircularProgress size={24} /> : 'Yes, Cancel'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ModernSubscriptionDetail; 