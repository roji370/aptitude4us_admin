import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Box, 
  Typography, 
  Paper, 
  Button, 
  CircularProgress, 
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  OutlinedInput,
  Checkbox,
  ListItemText,
  SelectChangeEvent,
  Alert,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Grid,
  Fab,
  TextField
} from '@mui/material';
import { 
  ArrowBack as ArrowBackIcon, 
  Delete as DeleteIcon, 
  Add as AddIcon, 
  Payment as PaymentIcon,
  Edit as EditIcon,
  Check as CheckIcon,
  DeleteForever as DeleteForeverIcon,
  Shield as ShieldIcon
} from '@mui/icons-material';
import { getUserById } from '../services/userService';
import { updateUserAssignedCourses, deleteUser } from '../services/authService';
import { getCourses } from '../services/courseService';
import type { Course } from '../services/courseService';
import type { UserDetails } from '../services/userService';
import UserCoursesDebug from '../components/UserCoursesDebug';
import { 
  createSubscription,
  getUserSubscriptions, 
  getSubscriptionPlans,
  updateSubscriptionExamDate,
  computeEffectiveEndDate
} from '../services/subscriptionService';
import { checkUserActiveSubscription } from '../services/courseService';
import { SubscriptionPlan } from '../types/subscription';
import NotificationStatusIndicator from '../components/NotificationStatusIndicator';
import { useAuth } from '../context/AuthContext';
import SubscriptionCard from '../components/SubscriptionCard';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import {
  getUserPendingDeletion,
  cancelPendingDeletion,
  exemptUserFromDeletion,
  isUserExemptFromDeletion,
  type PendingDeletion,
  getDaysSinceLapse
} from '../services/dataPurgeService';

const UserDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [user, setUser] = useState<UserDetails | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCourseSelect, setShowCourseSelect] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  
  // New subscription-related state
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
  const [openSubscriptionDialog, setOpenSubscriptionDialog] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [addingSubscription, setAddingSubscription] = useState(false);
  const [examDate, setExamDate] = useState<Date | null>(null);

  // Exam date edit state (for existing subscriptions)
  const [editExamDateDialogOpen, setEditExamDateDialogOpen] = useState(false);
  const [editExamDate, setEditExamDate] = useState<Date | null>(null);
  const [editingSubscriptionId, setEditingSubscriptionId] = useState<string>('');
  const [savingExamDate, setSavingExamDate] = useState(false);

  // Prevent wheel/touch events on date picker popper from scrolling the background page
  const handlePopperWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  // Pending deletion state (30-day auto-delete)
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const [isExempt, setIsExempt] = useState(false);
  const [processingDeletionAction, setProcessingDeletionAction] = useState(false);

  useEffect(() => {
    const fetchUserAndCourses = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
        // Also fetch subscriptions and subscription plans
        const [userData, coursesData, userSubscriptions, plans] = await Promise.all([
          getUserById(id),
          getCourses(),
          getUserSubscriptions(id),
          getSubscriptionPlans()
        ]);

        // Fetch pending deletion and exemption status (non-blocking)
        try {
          const [pd, exempt] = await Promise.all([
            getUserPendingDeletion(id),
            isUserExemptFromDeletion(id)
          ]);
          setPendingDeletion(pd);
          setIsExempt(exempt);
        } catch (pdErr) {
          console.warn('Failed to fetch deletion status (non-fatal):', pdErr);
        }
        
        if (!userData) {
          setError('User not found');
          setLoading(false);
          return;
        }
        
        setUser(userData);
        setCourses(coursesData);
        setSubscriptions(userSubscriptions || []);
        setSubscriptionPlans(plans || []);
        
        console.log('User data:', userData); // For debugging
        // Initialize selected courses from user data
        if (userData.assignedCourseIds && userData.assignedCourseIds.length > 0) {
          // Filter out any assigned course IDs that no longer exist in the courses list
          const validCourseIds = userData.assignedCourseIds.filter(
            courseId => coursesData.some(course => course.id === courseId)
          );
          
          if (validCourseIds.length !== userData.assignedCourseIds.length) {
            console.warn('Some assigned courses no longer exist:', 
              userData.assignedCourseIds.filter(id => !validCourseIds.includes(id)));
          }
          
          console.log('Setting valid selected courses:', validCourseIds);
          setSelectedCourses(validCourseIds);
          
          // If there are invalid courses, update the user's course assignments
          if (validCourseIds.length !== userData.assignedCourseIds.length) {
            try {
              await updateUserAssignedCourses(id, validCourseIds);
              console.log('Updated user with valid course IDs only');
            } catch (updateError) {
              console.error('Failed to update user with valid course IDs:', updateError);
            }
          }
          
          // Hide the course selection if user already has courses assigned
          setShowCourseSelect(false);
        } else {
          console.log('No assigned courses found');
          setSelectedCourses([]);
          // Show the course selection if user has no courses assigned
          setShowCourseSelect(true);
        }
      } catch (error) {
        console.error('Error fetching user details:', error);
        setError('Failed to load user details');
      } finally {
        setLoading(false);
      }
    };
    
    fetchUserAndCourses();
  }, [id]);

  const handleBackClick = () => {
    navigate('/users');
  };

  const handleEditUser = () => {
    navigate(`/users/${id}/edit`);
  };

  const handleCourseChange = (event: SelectChangeEvent<string[]>) => {
    const { value } = event.target;
    const newSelected = typeof value === 'string' ? value.split(',') : value;
    console.log('Selected courses changed:', newSelected);
    setSelectedCourses(newSelected);
  };

  const handleSelectAllCourses = (event: React.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.target.checked) {
      // Select all courses
      const allCourseIds = courses.map(course => course.id);
      setSelectedCourses(allCourseIds);
      console.log('Selected all courses:', allCourseIds);
    } else {
      // Deselect all courses
      setSelectedCourses([]);
      console.log('Deselected all courses');
    }
  };

  const handleSaveCourses = async () => {
    if (!id || !currentUser) return;
    
    try {
      setSaving(true);
      console.log('Saving courses for user:', id);
      console.log('Selected courses to save:', selectedCourses);
      
      // CRITICAL: Validate subscription before assigning courses
      if (selectedCourses.length > 0) {
        const hasActiveSubscription = await checkUserActiveSubscription(id);
        
        if (!hasActiveSubscription) {
          setError('Cannot assign courses: User does not have an active subscription. Please add a subscription first.');
          setSaving(false);
          return;
        }
      }
      
      // Update courses with notification support
      const result = await updateUserAssignedCourses(id, selectedCourses, {
        sendNotifications: true,
        adminId: currentUser.uid
      });
      
      console.log('Courses successfully saved to database:', result);
      
      // Update local state
      if (user) {
        const updatedUser = {
          ...user,
          assignedCourseIds: selectedCourses
        };
        console.log('Updating local user state:', updatedUser);
        setUser(updatedUser);
      }
      
      // Show success message with notification info
      let successMessage = 'Courses assigned successfully';
      if (result.newlyAssigned.length > 0) {
        successMessage += ` (${result.newlyAssigned.length} new course${result.newlyAssigned.length > 1 ? 's' : ''} assigned)`;
        
        // Check if notifications were sent (same format as bulk assign)
        if (result.notificationResult) {
          if (result.notificationResult.success) {
            const totalNotifications = result.notificationResult.summary?.successful || 0;
            successMessage += ` 📱 Mobile notifications sent for ${totalNotifications} course${totalNotifications !== 1 ? 's' : ''}`;
          } else {
            successMessage += ` ⚠️ Courses assigned but notifications failed`;
          }
          
          if (result.notificationResult.errors && result.notificationResult.errors.length > 0) {
            console.warn('Some notifications failed:', result.notificationResult.errors);
            successMessage += ` (${result.notificationResult.errors.length} notification${result.notificationResult.errors.length > 1 ? 's' : ''} failed)`;
          }
        }
      }
      
      setSuccess(successMessage);
      
      // Hide the course selection after successful save
      setShowCourseSelect(false);
      
      // Increment refresh key to force component update
      setRefreshKey(prevKey => prevKey + 1);
      
      // Clear success message after 5 seconds (longer for more detailed message)
      setTimeout(() => {
        setSuccess(null);
      }, 5000);
    } catch (error) {
      console.error('Error assigning courses:', error);
      setError('Failed to assign courses');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!id) return;
    
    try {
      setDeleting(true);
      await deleteUser(id);
      // Redirect to users list with success message
      navigate('/users', { state: { success: `User ${user?.displayName || id} deleted successfully` } });
    } catch (error) {
      console.error('Error deleting user:', error);
      setError('Failed to delete user');
      setDeleteDialogOpen(false);
      setDeleting(false);
    }
  };

  const handleOpenDeleteDialog = () => {
    setDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = () => {
    setDeleteDialogOpen(false);
  };

  // New handlers for subscription operations
  const handleOpenSubscriptionDialog = () => {
    setOpenSubscriptionDialog(true);
  };

  const handleCloseSubscriptionDialog = () => {
    setOpenSubscriptionDialog(false);
    setSelectedPlanId('');
    setExamDate(null);
  };

  const handleAddSubscription = async () => {
    if (!id || !selectedPlanId) return;
    
    try {
      setAddingSubscription(true);
      
      // Get the selected plan details
      const selectedPlan = subscriptionPlans.find(plan => plan.id === selectedPlanId);
      if (!selectedPlan) {
        throw new Error('Selected plan not found');
      }
      
      // Determine the duration based on the selected plan
      const duration = selectedPlan.durationInDays !== null ? 
        selectedPlan.durationInDays : 
        selectedPlan.durationMonths || 1;
      
      // Determine if duration is in days
      const isDurationInDays = selectedPlan.durationInDays !== null;
      
      // Parse exam date if provided
      const parsedExamDate = examDate || null;
      
      // Create the subscription
      await createSubscription(
        id,
        selectedPlan.id,
        selectedPlan.name,
        duration,
        selectedPlan.price,
        isDurationInDays,
        parsedExamDate
      );
      
      // Refresh subscriptions
      const userSubscriptions = await getUserSubscriptions(id);
      setSubscriptions(userSubscriptions || []);
      
      handleCloseSubscriptionDialog();
      setSuccess('Subscription added successfully');
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccess(null);
      }, 3000);
    } catch (error) {
      console.error('Error adding subscription:', error);
      setError('Failed to add subscription');
    } finally {
      setAddingSubscription(false);
    }
  };

  // Exam date edit handlers
  const handleOpenExamDateDialog = (subscriptionId: string, currentExamDate?: Date | null) => {
    setEditingSubscriptionId(subscriptionId);
    setEditExamDate(currentExamDate || null);
    setEditExamDateDialogOpen(true);
  };

  const handleCloseExamDateDialog = () => {
    setEditExamDateDialogOpen(false);
    setEditExamDate(null);
    setEditingSubscriptionId('');
  };

  const handleSaveExamDate = async () => {
    if (!editingSubscriptionId || !id) return;
    
    try {
      setSavingExamDate(true);
      await updateSubscriptionExamDate(editingSubscriptionId, editExamDate);
      
      // Refresh subscriptions
      const userSubscriptions = await getUserSubscriptions(id);
      setSubscriptions(userSubscriptions || []);
      
      handleCloseExamDateDialog();
      setSuccess(editExamDate ? 'Exam date updated successfully' : 'Exam date removed successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error updating exam date:', error);
      setError('Failed to update exam date');
    } finally {
      setSavingExamDate(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ mt: 4 }}>
        <Alert severity="error">{error}</Alert>
        <Button 
          sx={{ mt: 2 }} 
          variant="outlined" 
          startIcon={<ArrowBackIcon />}
          onClick={handleBackClick}
        >
          Back to Users
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* Success message */}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}
      
      {/* Error message */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Pending deletion warning banner */}
      {pendingDeletion && (
        <Alert
          severity="error"
          icon={<DeleteForeverIcon />}
          sx={{ mb: 2, border: '2px solid', borderColor: 'error.main' }}
          action={
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                color="inherit"
                size="small"
                variant="outlined"
                disabled={processingDeletionAction}
                onClick={async () => {
                  if (!id) return;
                  setProcessingDeletionAction(true);
                  try {
                    const result = await cancelPendingDeletion(id);
                    if (result.success) {
                      setPendingDeletion(null);
                      setSuccess('Pending deletion cancelled successfully.');
                    } else {
                      // e.g., purge is already in_progress
                      setError(result.message || 'Could not cancel deletion.');
                    }
                  } catch (err) {
                    setError('Failed to cancel pending deletion.');
                  } finally {
                    setProcessingDeletionAction(false);
                  }
                }}
              >
                Cancel Deletion
              </Button>
              {!isExempt && (
                <Button
                  color="inherit"
                  size="small"
                  variant="outlined"
                  startIcon={<ShieldIcon />}
                  disabled={processingDeletionAction}
                  onClick={async () => {
                    if (!id) return;
                    setProcessingDeletionAction(true);
                    try {
                      await exemptUserFromDeletion(id, true);
                      setIsExempt(true);
                      setPendingDeletion(null);
                      setSuccess('User exempted from auto-deletion.');
                    } catch (err) {
                      setError('Failed to exempt user.');
                    } finally {
                      setProcessingDeletionAction(false);
                    }
                  }}
                >
                  Exempt User
                </Button>
              )}
            </Box>
          }
        >
          <strong>Scheduled for data deletion.</strong> This user's data (profile, progress, subscriptions, chat history) will be permanently deleted.
          {` Subscription lapsed ${getDaysSinceLapse(pendingDeletion)} days ago.`}
        </Alert>
      )}

      {/* Exemption indicator */}
      {isExempt && !pendingDeletion && (
        <Alert
          severity="info"
          icon={<ShieldIcon />}
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              variant="outlined"
              disabled={processingDeletionAction}
              onClick={async () => {
                if (!id) return;
                setProcessingDeletionAction(true);
                try {
                  await exemptUserFromDeletion(id, false);
                  setIsExempt(false);
                  setSuccess('Auto-deletion exemption removed.');
                } catch (err) {
                  setError('Failed to remove exemption.');
                } finally {
                  setProcessingDeletionAction(false);
                }
              }}
            >
              Remove Exemption
            </Button>
          }
        >
          This user is <strong>exempt from auto-deletion</strong>. Their data will be retained even if all subscriptions expire.
        </Alert>
      )}
      
      {/* Header with back button, user info, and action buttons */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <IconButton 
            onClick={handleBackClick} 
            sx={{ 
              mr: 1.5,
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              color: '#071A52',
              '&:hover': {
                bgcolor: 'rgba(7, 26, 82, 0.04)',
                borderColor: '#CBD5E1'
              }
            }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Box>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700, color: '#071A52' }}>
              {user?.displayName || 'User Details'}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
              User ID: {user?.uid}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {(user?.role === 'student' || user?.role === 'admin') && (
            <Button 
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={handleOpenSubscriptionDialog}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: '8px',
                px: 2
              }}
            >
              Add Subscription
            </Button>
          )}
          <Button
            variant="outlined"
            startIcon={<EditIcon />}
            onClick={handleEditUser}
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
            Edit User
          </Button>
          {user?.role !== 'admin' && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={handleOpenDeleteDialog}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: '8px'
              }}
            >
              Delete User
            </Button>
          )}
        </Box>
      </Box>

      {/* User info dossier card */}
      <Paper elevation={0} sx={{ p: 3.5, mb: 4, borderRadius: '16px', border: '1px solid #E2E8F0', bgcolor: '#FFFFFF' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, mb: 2 }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: '14px',
              bgcolor: '#071A52',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '1.4rem'
            }}
          >
            {(user?.displayName?.charAt(0) || user?.email?.charAt(0) || 'U').toUpperCase()}
          </Box>
          <Box sx={{ flexGrow: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography variant="h5" sx={{ fontWeight: 700, color: '#071A52' }}>
                {user?.displayName || 'User'}
              </Typography>
              <Chip 
                label={user?.role?.toUpperCase() || 'STUDENT'} 
                size="small" 
                sx={{ 
                  bgcolor: user?.role === 'admin' ? 'rgba(7, 26, 82, 0.08)' : 'rgba(0, 107, 95, 0.1)',
                  color: user?.role === 'admin' ? '#071A52' : '#006B5F',
                  fontWeight: 700,
                  fontSize: '0.7rem',
                  borderRadius: '6px'
                }} 
              />
            </Box>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {user?.email}
            </Typography>
          </Box>
        </Box>
      </Paper>

      {/* Subscriptions section for students and admins */}
      {(user?.role === 'student' || user?.role === 'admin') && (
        <Paper elevation={0} sx={{ p: 3.5, mb: 4, borderRadius: '16px', border: '1px solid #E2E8F0', bgcolor: '#FFFFFF' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', fontWeight: 600, color: '#071A52' }}>
              <PaymentIcon sx={{ mr: 1, color: '#006B5F' }} />
              Active Platform Subscriptions
            </Typography>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={handleOpenSubscriptionDialog}
              size="small"
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: '8px'
              }}
            >
              Add Subscription
            </Button>
          </Box>
          
          {subscriptions.length === 0 ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              This user has no active subscriptions. Add a subscription to grant access to the platform.
            </Alert>
          ) : (
            <Box 
              sx={{ 
                mt: 1, 
                display: 'flex',
                overflowX: 'auto',
                pb: 2, // Add padding bottom for scrollbar
                '&::-webkit-scrollbar': {
                  height: 8,
                },
                '&::-webkit-scrollbar-track': {
                  backgroundColor: 'rgba(0,0,0,0.05)',
                  borderRadius: 4,
                },
                '&::-webkit-scrollbar-thumb': {
                  backgroundColor: 'rgba(0,0,0,0.2)',
                  borderRadius: 4,
                },
              }}
            >
              {subscriptions.map(subscription => (
                <Box 
                  key={subscription.id} 
                  sx={{ 
                    minWidth: 300,
                    maxWidth: 350, 
                    mr: 2,
                    flexShrink: 0
                  }}
                >
                  <SubscriptionCard 
                    subscription={subscription} 
                    userName={user?.displayName ?? undefined}
                    onSetExamDate={(subId: string, currentExamDate?: Date | null) => handleOpenExamDateDialog(subId, currentExamDate)}
                  />
                </Box>
              ))}
            </Box>
          )}
        </Paper>
      )}

      {/* Show course assignment for students and admins */}
      {(user?.role === 'student' || user?.role === 'admin') && (
        <Paper elevation={0} sx={{ p: 3.5, borderRadius: '16px', border: '1px solid #E2E8F0', bgcolor: '#FFFFFF' }}>
          <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#071A52' }}>
            Curriculum Access & Course Assignments
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Configure examination modules and curricula this candidate is permitted to access.
          </Typography>
          
          {/* Show course selection form only when showCourseSelect is true */}
          {showCourseSelect && (
            <>
          <FormControl fullWidth sx={{ mb: 3 }}>
                <InputLabel id="courses-select-label">Select Courses</InputLabel>
            <Select
              labelId="courses-select-label"
              id="courses-select"
              multiple
              value={selectedCourses}
              onChange={handleCourseChange}
                  input={<OutlinedInput label="Select Courses" />}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {selected
                    .map((courseId) => courses.find(c => c.id === courseId))
                    .filter(course => course !== undefined)
                    .sort((a, b) => a!.title.localeCompare(b!.title))
                    .map((course) => (
                      <Chip 
                        key={course!.id} 
                        label={course!.title} 
                        color="default"
                      />
                    ))
                  }
                  {selected
                    .filter(courseId => !courses.find(c => c.id === courseId))
                    .map((courseId) => (
                      <Chip 
                        key={courseId} 
                        label={`Unknown course (${courseId})`} 
                        color="error"
                      />
                    ))
                  }
                </Box>
              )}
                  MenuProps={{
                    slotProps: {
                      paper: {
                        style: {
                          maxHeight: 300
                        }
                      },
                      list: {
                        sx: { pb: 0 }
                      }
                    }
                  }}
            >
              {/* Select All Option */}
              <MenuItem 
                key="select-all" 
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                sx={{ 
                  borderBottom: 1, 
                  borderColor: 'divider',
                  mb: 1,
                  backgroundColor: 'grey.50',
                  '&:hover': {
                    backgroundColor: 'grey.100'
                  }
                }}
              >
                <Checkbox 
                  checked={selectedCourses.length === courses.length && courses.length > 0}
                  indeterminate={selectedCourses.length > 0 && selectedCourses.length < courses.length}
                  onChange={handleSelectAllCourses}
                  onClick={(event) => event.stopPropagation()}
                />
                <ListItemText 
                  primary={`Select All (${selectedCourses.length}/${courses.length} courses)`}
                  slotProps={{ primary: {
                    sx: { fontWeight: 'medium', color: 'primary.main' }
                  } }}
                />
              </MenuItem>
              
              {/* Individual Course Options */}
              {courses
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((course) => (
                <MenuItem key={course.id} value={course.id}>
                  <Checkbox checked={selectedCourses.indexOf(course.id) > -1} />
                  <ListItemText 
                    primary={`${course.title} (${course.id})`}
                    secondary={course.description?.substring(0, 60) + '...'}
                  />
                </MenuItem>
              ))}
                  <Box sx={{ 
                    display: 'flex', 
                    justifyContent: 'flex-end',
                    p: 1, 
                    borderTop: 1, 
                    borderColor: 'divider',
                    position: 'sticky',
                    bottom: 0,
                    bgcolor: 'background.paper',
                    zIndex: 1,
                    width: '100%'
                  }}>
            <Button 
              variant="contained" 
              color="primary" 
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSaveCourses();
                      }}
              disabled={saving}
            >
                      {saving ? <CircularProgress size={20} /> : 'Save Assigned Courses'}
            </Button>
          </Box>
                </Select>
              </FormControl>
          
          <Divider sx={{ my: 3 }} />
            </>
          )}
          
          {/* Current course list */}
          {id && (
            <UserCoursesDebug userId={id} refreshKey={refreshKey} />
          )}

          {/* Button to add more courses */}
          {!showCourseSelect && selectedCourses.length > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
              <Button 
                variant="outlined"
                color="primary"
                onClick={() => setShowCourseSelect(true)}
              >
                Modify Assigned Courses
              </Button>
            </Box>
          )}
        </Paper>
      )}

      {/* Edit Exam Date Dialog */}
      <Dialog
        open={editExamDateDialogOpen}
        onClose={handleCloseExamDateDialog}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Set Exam Date</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Set the exam date for this subscription. If the exam date is before the subscription end date, access will end on the exam date.
          </DialogContentText>
          
          <LocalizationProvider dateAdapter={AdapterDateFns}>
            <DatePicker
              label="Exam Date"
              value={editExamDate}
              minDate={new Date()}
              onChange={(newValue) => setEditExamDate(newValue)}
              slotProps={{
                textField: {
                  fullWidth: true,
                  sx: { mt: 1 }
                },
                popper: {
                  placement: 'top-start',
                  sx: { zIndex: 1400 },
                  onWheel: handlePopperWheel,
                },
                desktopPaper: {
                  sx: { overscrollBehavior: 'contain' },
                  onWheel: handlePopperWheel,
                },
              }}
            />
          </LocalizationProvider>
        </DialogContent>
        <DialogActions>
          {editExamDate && (
            <Button 
              onClick={() => setEditExamDate(null)} 
              color="warning"
              disabled={savingExamDate}
            >
              Clear Exam Date
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={handleCloseExamDateDialog} disabled={savingExamDate}>
            Cancel
          </Button>
          <Button 
            onClick={handleSaveExamDate} 
            color="primary" 
            variant="contained"
            disabled={savingExamDate}
          >
            {savingExamDate ? <CircularProgress size={24} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Subscription Dialog */}
      <Dialog
        open={openSubscriptionDialog}
        onClose={handleCloseSubscriptionDialog}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Add Subscription</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Select a subscription plan for {user?.displayName || 'this user'}.
          </DialogContentText>
          
          <FormControl fullWidth sx={{ mb: 3, mt: 1 }}>
            <InputLabel id="plan-select-label">Subscription Plan</InputLabel>
            <Select
              labelId="plan-select-label"
              id="plan-select"
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value as string)}
              label="Subscription Plan"
            >
              {subscriptionPlans.map((plan) => (
                <MenuItem key={plan.id} value={plan.id}>
                  {plan.name} - ${plan.price} {plan.durationInDays !== null ? 
                    `(${plan.durationInDays} days)` : 
                    `(${plan.durationMonths} month${plan.durationMonths !== 1 ? 's' : ''})`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          
          {selectedPlanId && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                This plan has a predefined duration of{' '}
                {(() => {
                  const plan = subscriptionPlans.find(p => p.id === selectedPlanId);
                  if (plan) {
                    return plan.durationInDays !== null ? 
                      `${plan.durationInDays} days` : 
                      `${plan.durationMonths} month${plan.durationMonths !== 1 ? 's' : ''}`;
                  }
                  return '';
                })()}
              </Typography>
              
              <LocalizationProvider dateAdapter={AdapterDateFns}>
                <DatePicker
                  label="Exam Date (Optional)"
                  value={examDate}
                  minDate={new Date()}
                  onChange={(newValue) => setExamDate(newValue)}
                  slotProps={{
                    textField: {
                      fullWidth: true,
                      helperText: 'If exam date is before subscription end date, access will end on the exam date',
                      sx: { mt: 1 }
                    },
                    popper: {
                      sx: { zIndex: 1400 },
                      onWheel: handlePopperWheel,
                    },
                    desktopPaper: {
                      sx: { overscrollBehavior: 'contain' },
                      onWheel: handlePopperWheel,
                    },
                  }}
                />
              </LocalizationProvider>
              
              {examDate && (() => {
                const plan = subscriptionPlans.find(p => p.id === selectedPlanId);
                if (plan) {
                  const endDate = new Date();
                  if (plan.durationInDays !== null) {
                    endDate.setDate(endDate.getDate() + (plan.durationInDays || 0));
                  } else {
                    endDate.setMonth(endDate.getMonth() + (plan.durationMonths || 1));
                  }
                  // Use the same end-of-day normalization the backend will apply.
                  const effectiveEnd = computeEffectiveEndDate(endDate, examDate);
                  const isExamBeforeEnd = effectiveEnd < endDate;
                  
                  return (
                    <Alert severity={isExamBeforeEnd ? 'info' : 'success'} sx={{ mt: 2 }}>
                      {isExamBeforeEnd ? (
                        <>Subscription will effectively end on <strong>{examDate.toLocaleDateString()}</strong> (exam date) instead of {endDate.toLocaleDateString()}</>
                      ) : (
                        <>Exam date ({examDate.toLocaleDateString()}) is after subscription end date ({endDate.toLocaleDateString()}). Subscription end date will be used.</>
                      )}
                    </Alert>
                  );
                }
                return null;
              })()}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseSubscriptionDialog} disabled={addingSubscription}>
            Cancel
          </Button>
          <Button 
            onClick={handleAddSubscription} 
            color="primary" 
            variant="contained"
            disabled={addingSubscription || !selectedPlanId}
          >
            {addingSubscription ? <CircularProgress size={24} /> : 'Add Subscription'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete User Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleCloseDeleteDialog}
      >
        <DialogTitle>Delete User</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete {user?.displayName || 'this user'}? This action cannot be undone. 
            All user data including assigned courses and progress will be permanently removed.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDeleteDialog} disabled={deleting}>
            Cancel
          </Button>
          <Button 
            onClick={handleDeleteUser} 
            color="error" 
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={20} /> : <DeleteIcon />}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UserDetail; 