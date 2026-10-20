import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  Table, 
  TableBody, 
  TableCell, 
  TableContainer, 
  TableHead, 
  TableRow,
  TablePagination,
  Button,
  IconButton,
  TextField,
  InputAdornment,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Grid,
  Tooltip,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  Divider,
  Card,
  CardContent,
  CardActions,
  Switch,
  FormControlLabel,
  Checkbox,
  Alert,
  ListItemButton,
  ListItemIcon,
  ToggleButtonGroup,
  ToggleButton,
  RadioGroup,
  Radio,
  SelectChangeEvent
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterList as FilterListIcon,
  Refresh as RefreshIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  Add as AddIcon,
  Group as GroupIcon,
  CreditCard as CreditCardIcon,
  Save as SaveIcon,
  DeleteForever as DeleteForeverIcon
} from '@mui/icons-material';
import { getPendingDeletions, type PendingDeletion } from '../services/dataPurgeService';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  getAllSubscriptions, 
  cancelSubscription,
  renewSubscription,
  getSubscriptionPlans,
  createSubscriptionPlan,
  createSubscription,
  updateSubscriptionPlan,
  deleteSubscriptionPlan,
  bulkCancelSubscriptions,
  computeEffectiveEndDate
} from '../services/subscriptionService';
import { getUserById, getUsersByRole } from '../services/userService';
import { Subscription, SubscriptionPlan } from '../types/subscription';
import { Timestamp } from 'firebase/firestore';
import { UserDetails } from '../services/userService';

// Tab Panel component
interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <Box
      role="tabpanel"
      hidden={value !== index}
      id={`subscription-tabpanel-${index}`}
      aria-labelledby={`subscription-tab-${index}`}
      sx={{ marginTop: 2 }}
      {...other}
    >
      {value === index && <Box>{children}</Box>}
    </Box>
  );
}

const SubscriptionManagement: React.FC = () => {
  // Tab state
  const [tabValue, setTabValue] = useState(0);
  
  const [subscriptions, setSubscriptions] = useState<(Subscription & { userName?: string; userEmail?: string })[]>([]);
  const [filteredSubscriptions, setFilteredSubscriptions] = useState<(Subscription & { userName?: string; userEmail?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'expired' | 'cancelled' | 'pending_deletion'>(() => {
    const filterParam = searchParams.get('filter');
    if (filterParam === 'pending_deletion' || filterParam === 'active' || filterParam === 'expired' || filterParam === 'cancelled') {
      return filterParam;
    }
    return 'all';
  });
  const [openRenewDialog, setOpenRenewDialog] = useState(false);
  const [openCancelDialog, setOpenCancelDialog] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState<Subscription | null>(null);
  const [processing, setProcessing] = useState(false);

  // Plans management state
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
  const [newPlanDialogOpen, setNewPlanDialogOpen] = useState(false);
  const [editPlanDialogOpen, setEditPlanDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [planName, setPlanName] = useState('');
  const [planDescription, setPlanDescription] = useState('');
  const [planPrice, setPlanPrice] = useState('');
  const [planDuration, setPlanDuration] = useState(30);
  const [planFeature, setPlanFeature] = useState('');
  const [planFeatures, setPlanFeatures] = useState<string[]>([]);
  const [planIsActive, setPlanIsActive] = useState(true);
  const [savingPlan, setSavingPlan] = useState(false);

  // Bulk operations state
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [students, setStudents] = useState<UserDetails[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [processingBulk, setProcessingBulk] = useState(false);
  
  // Bulk cancellation state
  const [bulkCancelDialogOpen, setBulkCancelDialogOpen] = useState(false);
  const [selectedSubscriptions, setSelectedSubscriptions] = useState<string[]>([]);
  const [processingBulkCancel, setProcessingBulkCancel] = useState(false);
  const [bulkCancelProgress, setBulkCancelProgress] = useState('');
  
  // Add state for custom duration
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [customDuration, setCustomDuration] = useState('');

  // Add duration unit state
  const [durationUnit, setDurationUnit] = useState<'days' | 'months'>('days');

  // Note: isCustomRenewal, renewalUnit, and customRenewalDuration variables were removed as they are unused
  
  // Add success/error state
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add state for confirming plan deletion
  const [deletePlanDialogOpen, setDeletePlanDialogOpen] = useState(false);
  const [planToDelete, setPlanToDelete] = useState<SubscriptionPlan | null>(null);
  
  // Add state for duration unit
  const [editDurationUnit, setEditDurationUnit] = useState<'days' | 'months'>('months');

  // Pending deletion tracking (30-day auto-delete)
  const [pendingDeletionUserIds, setPendingDeletionUserIds] = useState<Set<string>>(new Set());

  const navigate = useNavigate();

  // Memoized filtered active subscriptions for bulk cancellation
  const activeSubscriptions = useMemo(() => 
    filteredSubscriptions.filter(sub => ['active', 'expired'].includes(sub.status)), 
    [filteredSubscriptions]
  );

  // Memoized Set for faster subscription selection lookups
  const selectedSubscriptionsSet = useMemo(() => 
    new Set(selectedSubscriptions), 
    [selectedSubscriptions]
  );

  // Memoized subscription list item component for better performance
  const SubscriptionListItem = React.memo(({ subscription }: { subscription: Subscription & { userName?: string; userEmail?: string } }) => {
    const endDate = subscription.endDate instanceof Date 
      ? subscription.endDate 
      : subscription.endDate.toDate();
    
    const isSelected = selectedSubscriptionsSet.has(subscription.id);
    
    return (
      <ListItem key={subscription.id} disablePadding>
        <ListItemButton
          onClick={() => handleSubscriptionToggle(subscription.id)}
          disabled={processingBulkCancel}
          dense
        >
          <ListItemIcon>
            <Checkbox
              edge="start"
              checked={isSelected}
              tabIndex={-1}
              disableRipple
            />
          </ListItemIcon>
          <ListItemText 
            primary={`${subscription.userName || subscription.userEmail || 'Unknown User'} - ${subscription.planName}`}
            secondary={
              <React.Fragment>
                <Typography variant="caption" component="span" sx={{ display: "block" }}>
                  Status: <Chip 
                    label={subscription.status.toUpperCase()} 
                    color={subscription.status === 'active' ? 'success' : 'warning'} 
                    size="small" 
                    sx={{ ml: 0.5 }}
                  />
                </Typography>
                <Typography variant="caption" component="span" sx={{ display: "block" }}>
                  Expires: {endDate.toLocaleDateString()}
                </Typography>
              </React.Fragment>
            }
          />
        </ListItemButton>
      </ListItem>
    );
  });

  // Fetch all subscriptions
  const fetchSubscriptions = async () => {
    try {
      setRefreshing(true);
      const allSubscriptions = await getAllSubscriptions();
      
      // Enhance subscriptions with user data
      const enhancedSubscriptions = await Promise.all(
        allSubscriptions.map(async (sub) => {
          try {
            const user = await getUserById(sub.userId);
            return {
              ...sub,
              userName: user?.displayName || 'Unknown User',
              userEmail: user?.email || 'No Email'
            };
          } catch (error) {
            console.error(`Error fetching user data for ${sub.userId}:`, error);
            return {
              ...sub,
              userName: 'Unknown User',
              userEmail: 'No Email'
            };
          }
        })
      );
      
      setSubscriptions(enhancedSubscriptions);
      setFilteredSubscriptions(enhancedSubscriptions);

      // Fetch pending deletions for the badge indicators
      try {
        const pendingDeletions = await getPendingDeletions();
        setPendingDeletionUserIds(new Set(pendingDeletions.map(pd => pd.userId)));
      } catch (pdError) {
        console.warn('Failed to fetch pending deletions (non-fatal):', pdError);
      }
    } catch (error) {
      console.error('Error fetching subscriptions:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Fetch subscription plans
  const fetchSubscriptionPlans = async () => {
    try {
      const plans = await getSubscriptionPlans();
      setSubscriptionPlans([...plans]);
    } catch (error) {
      console.error('Error fetching subscription plans:', error);
    }
  };

  // Fetch students for bulk operations
  const fetchStudents = async () => {
    try {
      setLoadingStudents(true);
      const studentUsers = await getUsersByRole('student');
      setStudents(studentUsers || []);
    } catch (error) {
      console.error('Error fetching students:', error);
      // Set empty array on error rather than keeping previous state
      setStudents([]);
      // Show error message to user
      setError('Failed to load students. Please try again later.');
    } finally {
      setLoadingStudents(false);
    }
  };

  useEffect(() => {
    fetchSubscriptions();
    fetchSubscriptionPlans();
  }, []);

  // Apply filters whenever searchTerm or statusFilter changes
  useEffect(() => {
    let filtered = [...subscriptions];
    
    // Apply status filter
    if (statusFilter === 'pending_deletion') {
      filtered = filtered.filter(sub => pendingDeletionUserIds.has(sub.userId));
    } else if (statusFilter !== 'all') {
      filtered = filtered.filter(sub => sub.status === statusFilter);
    }
    
    // Apply search filter
    if (searchTerm.trim() !== '') {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        sub => 
          sub.userName?.toLowerCase().includes(term) ||
          sub.userEmail?.toLowerCase().includes(term) ||
          sub.planName.toLowerCase().includes(term)
      );
    }
    
    setFilteredSubscriptions(filtered);
    setPage(0); // Reset to first page when filters change
  }, [searchTerm, statusFilter, subscriptions, pendingDeletionUserIds]);

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  };

  const handleStatusFilterChange = (event: SelectChangeEvent<"all" | "active" | "expired" | "cancelled" | "pending_deletion">) => {
    setStatusFilter(event.target.value as "all" | "active" | "expired" | "cancelled" | "pending_deletion");
  };

  const handleOpenRenewDialog = (subscription: Subscription) => {
    setSelectedSubscription(subscription);
    setOpenRenewDialog(true);
  };

  const handleCloseRenewDialog = () => {
    setOpenRenewDialog(false);
    setSelectedSubscription(null);
  };

  const handleOpenCancelDialog = (subscription: Subscription) => {
    setSelectedSubscription(subscription);
    setOpenCancelDialog(true);
  };

  const handleCloseCancelDialog = () => {
    setOpenCancelDialog(false);
    setSelectedSubscription(null);
  };

  const handleRenewSubscription = async () => {
    if (!selectedSubscription) return;
    
    setProcessing(true);
    try {
      // Get the subscription details to determine its duration type
      const subscriptionPlan = subscriptionPlans.find(plan => plan.id === selectedSubscription.planId);
      
      // Default to 1 month renewal if we can't find the plan
      let duration = 1;
      let isInDays = false;
      
      if (subscriptionPlan) {
        // Use the plan's existing duration settings
        if (subscriptionPlan.durationInDays !== null && subscriptionPlan.durationInDays !== undefined) {
          duration = subscriptionPlan.durationInDays;
          isInDays = true;
        } else if (subscriptionPlan.durationMonths !== null && subscriptionPlan.durationMonths !== undefined) {
          duration = subscriptionPlan.durationMonths;
        }
      }
      
      // Call the service with the original plan duration and unit
      await renewSubscription(selectedSubscription.id, duration, isInDays);
      
      // Show success message
      setSuccess(`Subscription renewed successfully`);
      
      // Refresh the data
      await fetchSubscriptions();
      handleCloseRenewDialog();
    } catch (error) {
      console.error('Error renewing subscription:', error);
      setError('Failed to renew subscription. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!selectedSubscription) return;
    
    setProcessing(true);
    try {
      await cancelSubscription(selectedSubscription.id);
      // Refresh the data
      await fetchSubscriptions();
      handleCloseCancelDialog();
    } catch (error) {
      console.error('Error cancelling subscription:', error);
    } finally {
      setProcessing(false);
    }
  };

  const getDaysRemaining = (endDate: Date | Timestamp): number => {
    const end = endDate instanceof Date ? endDate : endDate.toDate();
    const now = new Date();
    const diffTime = end.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getStatusChip = (subscription: Subscription) => {
    if (subscription.status === 'cancelled') {
      return <Chip label="Cancelled" color="default" size="small" />;
    }
    
    // Compute effective end date considering exam date
    const endDate = subscription.endDate instanceof Date ? subscription.endDate : (subscription.endDate as Timestamp).toDate();
    const examDate = subscription.examDate ? 
      (subscription.examDate instanceof Date ? subscription.examDate : (subscription.examDate as Timestamp)?.toDate?.() || null)
      : null;
    const effectiveEndDate = computeEffectiveEndDate(endDate, examDate);
    
    const daysRemaining = getDaysRemaining(effectiveEndDate);
    
    if (daysRemaining < 0) {
      return <Chip label="Expired" color="error" size="small" icon={<ErrorIcon />} />;
    } else if (daysRemaining === 0) {
      return <Chip label="Expires Today" color="error" size="small" icon={<WarningIcon />} />;
    } else if (daysRemaining <= 3) {
      return <Chip label={`${daysRemaining} Day${daysRemaining !== 1 ? 's' : ''} Left`} color="warning" size="small" icon={<WarningIcon />} />;
    } else {
      return <Chip label={`${daysRemaining} Days Left`} color="success" size="small" icon={<CheckCircleIcon />} />;
    }
  };

  // Handle tab change
  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    if (newValue === 2) { // If switching to bulk operations tab
      fetchStudents();
    }
  };

  // Plan management handlers
  const handleOpenNewPlanDialog = () => {
    setPlanName('');
    setPlanDescription('');
    setPlanPrice('');
    setPlanDuration(30); // Default to 30 days
    setPlanFeatures([]);
    setPlanIsActive(true);
    setDurationUnit('days'); // Default to days
    setNewPlanDialogOpen(true);
  };

  const handleCloseNewPlanDialog = () => {
    setNewPlanDialogOpen(false);
  };

  const handleOpenEditPlanDialog = (plan: SubscriptionPlan) => {
    setSelectedPlan(plan);
    setPlanName(plan.name);
    setPlanDescription(plan.description);
    setPlanPrice(plan.price.toString());
    
    // Determine if plan uses days or months and set appropriate values
    if (plan.durationInDays !== null && plan.durationInDays !== undefined) {
      // This plan uses days for duration
      setEditDurationUnit('days');
      setIsCustomDuration(true);
      setCustomDuration(plan.durationInDays.toString());
      setPlanDuration(1); // Default
    } else {
      // This plan uses months
      setEditDurationUnit('months');
      
      // Check if the plan has a standard duration
      const isStandard = [1, 3, 6, 12].includes(plan.durationMonths || 0);
      setIsCustomDuration(!isStandard);
      
      if (isStandard && plan.durationMonths) {
        setPlanDuration(plan.durationMonths);
        setCustomDuration('');
      } else {
        setCustomDuration(plan.durationMonths?.toString() || '1');
        setPlanDuration(1); // Default
      }
    }
    
    setPlanFeatures([...plan.features]);
    setPlanIsActive(plan.isActive);
    setEditPlanDialogOpen(true);
  };

  const handleCloseEditPlanDialog = () => {
    setEditPlanDialogOpen(false);
    setSelectedPlan(null);
  };

  const handleAddFeature = () => {
    if (planFeature.trim()) {
      setPlanFeatures([...planFeatures, planFeature.trim()]);
      setPlanFeature('');
    }
  };

  const handleRemoveFeature = (index: number) => {
    const newFeatures = [...planFeatures];
    newFeatures.splice(index, 1);
    setPlanFeatures(newFeatures);
  };

  const handleCreatePlan = async () => {
    if (!planName || !planPrice || !planDuration) return;
    
    setSavingPlan(true);
    try {
      const duration = parseInt(planDuration.toString(), 10);
      
      if (isNaN(duration) || duration <= 0) {
        setError('Invalid duration value');
        setSavingPlan(false);
        return;
      }
      
      await createSubscriptionPlan(
        planName,
        planDescription || `${planName} Subscription Plan`,
        duration,
        parseFloat(planPrice),
        planFeatures,
        durationUnit === 'days' // Pass flag indicating if duration is in days
      );
      
      // Show success message
      setSuccess('Plan created successfully!');
      
      // Refresh plans
      await fetchSubscriptionPlans();
      handleCloseNewPlanDialog();
    } catch (error) {
      console.error('Error creating plan:', error);
      setError('Failed to create the plan. Please try again.');
    } finally {
      setSavingPlan(false);
    }
  };

  const handleUpdatePlan = async () => {
    if (!selectedPlan || !planName || !planPrice) return;
    
    setSavingPlan(true);
    try {
      let duration: number;
      
      if (isCustomDuration) {
        const customDurationNum = parseInt(customDuration, 10);
        if (isNaN(customDurationNum) || customDurationNum <= 0) {
          throw new Error('Invalid duration');
        }
        duration = customDurationNum;
      } else {
        duration = planDuration;
      }
      
      await updateSubscriptionPlan(
        selectedPlan.id,
        planName,
        planDescription || `${planName} Subscription Plan`,
        duration,
        parseFloat(planPrice),
        planFeatures,
        planIsActive,
        editDurationUnit === 'days' // Pass flag indicating if duration is in days
      );
      
      // Show success message
      setSuccess('Plan updated successfully!');
      
      // Force refresh plans from Firestore to ensure UI is updated
      await fetchSubscriptionPlans();
      
      handleCloseEditPlanDialog();
    } catch (error) {
      console.error('Error updating plan:', error);
      setError('Failed to update the plan. Please try again.');
    } finally {
      setSavingPlan(false);
    }
  };

  // Handle opening the delete dialog
  const handleOpenDeletePlanDialog = (plan: SubscriptionPlan) => {
    setPlanToDelete(plan);
    setDeletePlanDialogOpen(true);
  };
  
  // Handle closing the delete dialog
  const handleCloseDeletePlanDialog = () => {
    setDeletePlanDialogOpen(false);
    setPlanToDelete(null);
  };
  
  // Handle plan deletion
  const handleDeletePlan = async () => {
    if (!planToDelete) return;
    
    try {
      setProcessing(true);
      await deleteSubscriptionPlan(planToDelete.id);
      
      // Show success message
      setSuccess(`Plan "${planToDelete.name}" has been deleted successfully.`);
      
      // Refresh plans list
      await fetchSubscriptionPlans();
      
      // Close dialog
      handleCloseDeletePlanDialog();
    } catch (error) {
      console.error('Error deleting plan:', error);
      setError('Failed to delete the plan. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  // Bulk subscription handlers
  const handleOpenBulkDialog = () => {
    setSelectedStudents([]);
    setSelectedPlanId('');
    setBulkDialogOpen(true);
    fetchStudents();
  };

  const handleCloseBulkDialog = () => {
    setBulkDialogOpen(false);
  };

  const handleStudentSelection = (userId: string) => {
    if (processingBulk) return; // Don't allow selection during processing

    setSelectedStudents(prev => {
      const isSelected = prev.includes(userId);
      if (isSelected) {
        return prev.filter(id => id !== userId);
      } else {
        return [...prev, userId];
      }
    });
  };

  const handleSelectAllStudents = () => {
    if (processingBulk) return; // Don't allow selection during processing

    if (students.length === 0) return;

    if (selectedStudents.length === students.length) {
      // Deselect all
      setSelectedStudents([]);
    } else {
      // Select all
      setSelectedStudents(students.map(student => student.uid));
    }
  };

  // Bulk cancellation handlers
  const handleOpenBulkCancelDialog = async () => {
    setBulkCancelDialogOpen(true);
    setError(null);
    setSuccess(null);
    setSelectedSubscriptions([]);
  };

  const handleCloseBulkCancelDialog = () => {
    setBulkCancelDialogOpen(false);
    setSelectedSubscriptions([]);
    setError(null);
    setSuccess(null);
  };

  const handleSubscriptionToggle = useCallback((subscriptionId: string) => {
    if (processingBulkCancel) return; // Don't allow selection during processing
    
    setSelectedSubscriptions(prev => {
      const currentSet = new Set(prev);
      if (currentSet.has(subscriptionId)) {
        currentSet.delete(subscriptionId);
      } else {
        currentSet.add(subscriptionId);
      }
      return Array.from(currentSet);
    });
  }, [processingBulkCancel]);

  const handleSelectAllSubscriptions = useCallback(() => {
    if (processingBulkCancel) return;

    if (selectedSubscriptions.length === activeSubscriptions.length) {
      setSelectedSubscriptions([]);
    } else {
      setSelectedSubscriptions(activeSubscriptions.map(sub => sub.id));
    }
  }, [processingBulkCancel, selectedSubscriptions.length, activeSubscriptions]);

  const handleBulkCancelSubscriptions = useCallback(async () => {
    if (selectedSubscriptions.length === 0) {
      setError('Please select subscriptions to cancel');
      return;
    }

    setProcessingBulkCancel(true);
    setError(null);
    setSuccess(null);
    setBulkCancelProgress('🚀 Initializing bulk cancellation...');

    try {
      setBulkCancelProgress(`⚡ Cancelling ${selectedSubscriptions.length} subscription(s) using optimized batch processing...`);
      
      const result = await bulkCancelSubscriptions(selectedSubscriptions);
      
      setBulkCancelProgress('📊 Refreshing subscription data...');
      
      // Refresh subscriptions
      await fetchSubscriptions();
      
      if (result.failCount === 0) {
        setSuccess(`✅ Successfully cancelled ${result.successCount} subscription(s) and revoked course access!`);
        setBulkCancelProgress('');
        setTimeout(() => handleCloseBulkCancelDialog(), 2000);
      } else {
        setSuccess(`⚡ Cancelled ${result.successCount} subscription(s) successfully!`);
        if (result.failCount > 0) {
          const failureReasons = [...new Set(result.failedSubscriptions.map(f => f.reason))];
          setError(`⚠️ ${result.failCount} cancellation(s) failed: ${failureReasons.join(', ')}`);
        }
        setBulkCancelProgress('');
      }
    } catch (error) {
      console.error('Error in bulk subscription cancellation:', error);
      setError('❌ Failed to cancel subscriptions. Please try again.');
      setBulkCancelProgress('');
    } finally {
      setProcessingBulkCancel(false);
    }
  }, [selectedSubscriptions]);

  const handleBulkAddSubscriptions = async () => {
    if (selectedStudents.length === 0 || !selectedPlanId) {
      setError('Please select students and a subscription plan');
      return;
    }
    
    // Get duration from the selected plan
    const selectedPlan = subscriptionPlans.find(plan => plan.id === selectedPlanId);
    if (!selectedPlan) {
      setError('Selected plan not found');
      return;
    }
    
    // Determine duration and whether it's in days or months
    let finalDuration: number;
    let isDurationInDays: boolean = false;
    
    if (selectedPlan.durationInDays !== null && selectedPlan.durationInDays !== undefined) {
      finalDuration = selectedPlan.durationInDays;
      isDurationInDays = true;
    } else if (selectedPlan.durationMonths !== null && selectedPlan.durationMonths !== undefined) {
      finalDuration = selectedPlan.durationMonths;
      isDurationInDays = false;
    } else {
      setError('Selected plan has invalid duration configuration');
      return;
    }
    
    setProcessingBulk(true);
    setError(null);
    setSuccess(null);
    
    try {
      // Track successful and failed operations
      let successCount = 0;
      let failCount = 0;
      
      // Process subscriptions in batches to not overload the system
      for (const userId of selectedStudents) {
        try {
          const result = await createSubscription(
            userId,
            selectedPlan.id,
            selectedPlan.name,
            finalDuration,
            selectedPlan.price,
            isDurationInDays
          );
          
          if (result.id === 'error') {
            failCount++;
          } else {
            successCount++;
          }
        } catch (err) {
          failCount++;
          console.error(`Error adding subscription for user ${userId}:`, err);
        }
      }
      
      // Refresh subscriptions
      await fetchSubscriptions();
      
      if (failCount === 0) {
        setSuccess(`Successfully added ${successCount} subscription(s)`);
        handleCloseBulkDialog();
      } else {
        setError(`Added ${successCount} subscription(s), but failed to add ${failCount}`);
      }
    } catch (error) {
      console.error('Error adding bulk subscriptions:', error);
      setError('Failed to add subscriptions. Please try again.');
    } finally {
      setProcessingBulk(false);
    }
  };

  if (loading && tabValue === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 2, mb: 3 }}>
        <Typography variant="h4" component="h1">
          Manage Subscriptions
        </Typography>
        <Box>
          <Tooltip title="Refresh Data">
            <IconButton onClick={fetchSubscriptions} disabled={refreshing}>
              {refreshing ? <CircularProgress size={24} /> : <RefreshIcon />}
            </IconButton>
          </Tooltip>
          <Button 
            variant="contained" 
            color="primary" 
            onClick={() => navigate('/subscriptions')}
            sx={{ ml: 1 }}
          >
            Dashboard
          </Button>
        </Box>
      </Box>
      
      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tabValue} onChange={handleTabChange} aria-label="subscription management tabs" variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
          <Tab label="Active Subscriptions" icon={<CreditCardIcon />} iconPosition="start" />
          <Tab label="Plan Management" icon={<EditIcon />} iconPosition="start" />
          <Tab label="Bulk Operations" icon={<GroupIcon />} iconPosition="start" />
        </Tabs>
      </Box>
      
      {/* Subscriptions Tab */}
      <TabPanel value={tabValue} index={0}>
        {/* Filters */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label="Search"
              variant="outlined"
              size="small"
              value={searchTerm}
              onChange={handleSearchChange}
              slotProps={{ input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              } }}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <FormControl fullWidth size="small" variant="outlined">
              <InputLabel id="status-filter-label">Status</InputLabel>
              <Select
                labelId="status-filter-label"
                id="status-filter"
                value={statusFilter}
                onChange={handleStatusFilterChange}
                label="Status"
                startAdornment={
                  <InputAdornment position="start">
                    <FilterListIcon />
                  </InputAdornment>
                }
              >
                <MenuItem value="all">All Statuses</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="expired">Expired</MenuItem>
                <MenuItem value="cancelled">Cancelled</MenuItem>
                <MenuItem value="pending_deletion" sx={{ color: 'error.main', fontWeight: 'bold' }}>
                  🗑️ Pending Deletion ({pendingDeletionUserIds.size})
                </MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
        
        {/* Subscriptions Table */}
        <Paper sx={{ width: '100%', overflow: 'hidden' }}>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table stickyHeader aria-label="subscriptions table">
              <TableHead>
                <TableRow>
                  <TableCell>Student</TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Email</TableCell>
                  <TableCell>Plan</TableCell>
                  <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Start Date</TableCell>
                  <TableCell>End Date</TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Exam Date</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredSubscriptions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center">
                      No subscriptions found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSubscriptions
                    .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                    .map((subscription) => {
                      const startDate = subscription.startDate instanceof Date 
                        ? subscription.startDate 
                        : subscription.startDate.toDate();
                      
                      const endDate = subscription.endDate instanceof Date 
                        ? subscription.endDate 
                        : subscription.endDate.toDate();

                      // Parse exam date
                      const examDate = subscription.examDate ? 
                        (subscription.examDate instanceof Date ? 
                          subscription.examDate : 
                          (subscription.examDate as Timestamp)?.toDate?.() || null)
                        : null;
                      const effectiveEndDate = computeEffectiveEndDate(endDate, examDate);
                      const isExamBeforeEnd = effectiveEndDate < endDate;
                      
                      return (
                        <TableRow 
                          hover 
                          key={subscription.id}
                          sx={{ 
                            cursor: 'pointer',
                            '&:hover td': { bgcolor: 'action.hover' },
                            bgcolor: 
                              subscription.status === 'cancelled' ? 'grey.100' :
                              getDaysRemaining(effectiveEndDate) <= 0 ? 'error.light' : 
                              getDaysRemaining(effectiveEndDate) <= 3 ? 'warning.light' : 
                              undefined
                          }}
                        >
                          <TableCell onClick={() => navigate(`/users/${subscription.userId}`)}>
                            {subscription.userName}
                          </TableCell>
                          <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{subscription.userEmail}</TableCell>
                          <TableCell>{subscription.planName}</TableCell>
                          <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>{startDate.toLocaleDateString()}</TableCell>
                          <TableCell>{endDate.toLocaleDateString()}</TableCell>
                          <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                            {examDate ? (
                              <Chip 
                                label={examDate.toLocaleDateString()} 
                                size="small" 
                                color={isExamBeforeEnd ? 'info' : 'default'}
                                variant={isExamBeforeEnd ? 'filled' : 'outlined'}
                              />
                            ) : (
                              <Typography variant="body2" color="text.disabled">—</Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                              {getStatusChip(subscription)}
                              {pendingDeletionUserIds.has(subscription.userId) && (
                                <Chip
                                  label="Pending Deletion"
                                  size="small"
                                  icon={<DeleteForeverIcon />}
                                  sx={{
                                    bgcolor: '#d32f2f',
                                    color: '#fff',
                                    '& .MuiChip-icon': { color: '#fff' },
                                    fontWeight: 600,
                                    fontSize: '0.7rem'
                                  }}
                                />
                              )}
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                              <Tooltip title="View Details">
                                <IconButton 
                                  size="small" 
                                  onClick={() => navigate(`/subscriptions/detail/${subscription.id}`)}
                                >
                                  <EditIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              
                              {subscription.status !== 'cancelled' && (
                                <Tooltip title="Renew Subscription">
                                  <IconButton 
                                    size="small" 
                                    color="primary"
                                    onClick={() => handleOpenRenewDialog(subscription)}
                                  >
                                    <RefreshIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
                              
                              {subscription.status === 'active' && (
                                <Tooltip title="Cancel Subscription">
                                  <IconButton 
                                    size="small" 
                                    color="error"
                                    onClick={() => handleOpenCancelDialog(subscription)}
                                  >
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Box>
                          </TableCell>
                        </TableRow>
                      );
                    })
                )}
              </TableBody>
            </Table>
          </TableContainer>
          
          <TablePagination
            rowsPerPageOptions={[5, 10, 25, 50]}
            component="div"
            count={filteredSubscriptions.length}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={handleChangePage}
            onRowsPerPageChange={handleChangeRowsPerPage}
          />
        </Paper>
      </TabPanel>
      
      {/* Plan Management Tab */}
      <TabPanel value={tabValue} index={1}>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">
            Subscription Plans
          </Typography>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={handleOpenNewPlanDialog}
          >
            Add New Plan
          </Button>
        </Box>
        
        {subscriptionPlans.length === 0 ? (
          <Paper sx={{ p: 3, textAlign: 'center' }}>
            <Typography color="textSecondary">
              No subscription plans found. Create your first plan to get started.
            </Typography>
          </Paper>
        ) : (
          <Grid container spacing={3}>
            {subscriptionPlans.map(plan => (
              <Grid size={{ xs: 12, md: 6, lg: 4 }} key={plan.id}>
                <Card 
                  sx={{ 
                    height: '100%', 
                    display: 'flex', 
                    flexDirection: 'column',
                    opacity: plan.isActive ? 1 : 0.7,
                    border: plan.isActive ? 'none' : '1px dashed grey'
                  }}
                  variant="outlined"
                >
                  <CardContent sx={{ flexGrow: 1, pb: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography variant="h6" component="h2">
                        {plan.name}
                      </Typography>
                      <Chip 
                        label={plan.isActive ? 'Active' : 'Inactive'}
                        color={plan.isActive ? 'success' : 'default'}
                        size="small"
                      />
                    </Box>
                    <Typography variant="h5" color="primary" gutterBottom>
                      ${plan.price}
                    </Typography>
                    
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography variant="body2" color="text.secondary">
                        Duration:
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: "medium" }}>
                        {plan.durationInDays !== null ? `${plan.durationInDays} days` : `${plan.durationMonths} month${plan.durationMonths !== 1 ? 's' : ''}`}
                      </Typography>
                    </Box>
                    
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {plan.description}
                    </Typography>
                    
                    {plan.features.length > 0 && (
                      <>
                        <Typography variant="subtitle2" gutterBottom>
                          Features:
                        </Typography>
                        <List dense disablePadding sx={{ '& .MuiListItem-root': { py: 0.25 } }}>
                          {plan.features.map((feature, index) => (
                            <ListItem key={index} disablePadding>
                              <ListItemIcon sx={{ minWidth: 24 }}>
                                <CheckCircleIcon color="success" fontSize="small" />
                              </ListItemIcon>
                              <ListItemText 
                                primary={feature} 
                                slotProps={{ primary: { variant: 'body2' } }}
                              />
                            </ListItem>
                          ))}
                        </List>
                      </>
                    )}
                  </CardContent>
                  <Box sx={{ p: 1, mt: 'auto' }}>
                    <Divider />
                    <CardActions>
                      <Button 
                        size="small" 
                        color="primary"
                        onClick={() => handleOpenEditPlanDialog(plan)}
                        startIcon={<EditIcon fontSize="small" />}
                      >
                        Edit
                      </Button>
                      <Button 
                        size="small" 
                        color="error"
                        onClick={() => handleOpenDeletePlanDialog(plan)}
                        startIcon={<DeleteIcon fontSize="small" />}
                      >
                        Delete
                      </Button>
                    </CardActions>
                  </Box>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </TabPanel>
      
      {/* Bulk Operations Tab */}
      <TabPanel value={tabValue} index={2}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" gutterBottom>
            Bulk Subscription Management
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            Add or cancel subscriptions for multiple students at once.
          </Typography>
          
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          
          {success && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
              {success}
            </Alert>
          )}
          
          <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={handleOpenBulkDialog}
          >
              Bulk Add Subscriptions
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={handleOpenBulkCancelDialog}
            >
              Bulk Cancel Subscriptions
          </Button>
          </Box>
        </Box>
      </TabPanel>
      
      {/* Renew Dialog */}
      <Dialog open={openRenewDialog} onClose={handleCloseRenewDialog}>
        <DialogTitle>Renew Subscription</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to renew this subscription?
            The subscription will be renewed with the same plan details.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseRenewDialog} disabled={processing}>
            Cancel
          </Button>
          <Button 
            onClick={handleRenewSubscription} 
            disabled={processing} 
            color="primary"
            variant="contained"
          >
            {processing ? <CircularProgress size={24} /> : 'Renew Subscription'}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Cancel Dialog */}
      <Dialog open={openCancelDialog} onClose={handleCloseCancelDialog}>
        <DialogTitle>Cancel Subscription</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to cancel this subscription?
            This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCancelDialog} disabled={processing}>
            Keep Subscription
          </Button>
          <Button 
            onClick={handleCancelSubscription} 
            disabled={processing} 
            color="error"
            variant="contained"
          >
            {processing ? <CircularProgress size={24} /> : 'Cancel Subscription'}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* New Plan Dialog */}
      <Dialog 
        open={newPlanDialogOpen} 
        onClose={handleCloseNewPlanDialog}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Create New Subscription Plan</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Plan Name *"
                fullWidth
                variant="outlined"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                required
                error={!planName}
                helperText={!planName ? "Plan name is required" : ""}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Plan Description"
                fullWidth
                variant="outlined"
                value={planDescription}
                onChange={(e) => setPlanDescription(e.target.value)}
                placeholder="Enter plan description"
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                label="Price per Month ($) *"
                fullWidth
                variant="outlined"
                value={planPrice}
                onChange={(e) => setPlanPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                type="text"
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                required
                error={!planPrice}
                helperText={!planPrice ? "Price is required" : ""}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {/* Duration unit selection */}
                <Box>
                  <Typography variant="body2" sx={{ mb: 1 }}>Duration unit</Typography>
                  <RadioGroup 
                    row 
                    value={durationUnit} 
                    onChange={(e) => setDurationUnit(e.target.value as 'days' | 'months')}
                  >
                    <FormControlLabel value="days" control={<Radio />} label="Days" />
                    <FormControlLabel value="months" control={<Radio />} label="Months" />
                  </RadioGroup>
                </Box>
                
                {/* Direct duration input */}
                <TextField
                  label={`Duration (${durationUnit}) *`}
                  fullWidth
                  variant="outlined"
                  type="number"
                  value={planDuration}
                  onChange={(e) => setPlanDuration(parseInt(e.target.value) || 0)}
                  slotProps={{ htmlInput: { min: 1, step: 1 } }}
                  disabled={savingPlan}
                  required
                  error={!planDuration || planDuration <= 0}
                  helperText={!planDuration || planDuration <= 0 ? "Valid duration required" : ""}
                />
              </Box>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={planIsActive}
                    onChange={(e) => setPlanIsActive(e.target.checked)}
                    color="primary"
                  />
                }
                label="Plan Active"
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Typography variant="subtitle2" gutterBottom>Features</Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <TextField
                  label="Add Feature"
                  fullWidth
                  variant="outlined"
                  value={planFeature}
                  onChange={(e) => setPlanFeature(e.target.value)}
                  size="small"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddFeature();
                    }
                  }}
                />
                <Button 
                  variant="outlined" 
                  onClick={handleAddFeature}
                  disabled={!planFeature.trim()}
                >
                  Add
                </Button>
              </Box>
              
              <Paper variant="outlined" sx={{ maxHeight: 150, overflow: 'auto', p: 1 }}>
                {planFeatures.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 1, textAlign: 'center' }}>
                    No features added yet
                  </Typography>
                ) : (
                  <List dense>
                    {planFeatures.map((feature, index) => (
                      <ListItem 
                        key={index}
                        secondaryAction={
                          <IconButton edge="end" onClick={() => handleRemoveFeature(index)} size="small">
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        }
                      >
                        <ListItemIcon sx={{ minWidth: 32 }}>
                          <CheckCircleIcon color="success" fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary={feature} />
                      </ListItem>
                    ))}
                  </List>
                )}
              </Paper>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseNewPlanDialog} disabled={savingPlan}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreatePlan} 
            variant="contained" 
            color="primary"
            disabled={savingPlan || !planName || !planPrice || !planDuration}
            startIcon={savingPlan ? <CircularProgress size={20} /> : <SaveIcon />}
          >
            {savingPlan ? 'Saving...' : 'Create Plan'}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Edit Plan Dialog */}
      <Dialog 
        open={editPlanDialogOpen} 
        onClose={handleCloseEditPlanDialog}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Edit Subscription Plan</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Plan Name *"
                fullWidth
                variant="outlined"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                required
              />
            </Grid>
            {/* Description field is now hidden */}
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                label="Price per Month ($) *"
                fullWidth
                variant="outlined"
                value={planPrice}
                onChange={(e) => setPlanPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                type="text"
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                required
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth variant="outlined">
                <InputLabel id="edit-plan-duration-label">Duration</InputLabel>
                <Select
                  labelId="edit-plan-duration-label"
                  value={isCustomDuration ? "custom" : planDuration}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "custom") {
                      setIsCustomDuration(true);
                    } else {
                      setIsCustomDuration(false);
                      setPlanDuration(Number(value));
                    }
                  }}
                  label="Duration"
                  disabled={savingPlan}
                >
                  <MenuItem value={1}>1 Month</MenuItem>
                  <MenuItem value={3}>3 Months</MenuItem>
                  <MenuItem value={6}>6 Months</MenuItem>
                  <MenuItem value={12}>12 Months (1 Year)</MenuItem>
                  <MenuItem value="custom">Custom Duration</MenuItem>
                </Select>
              </FormControl>
              
              {isCustomDuration && (
                <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                  <TextField
                    label="Custom Duration *"
                    fullWidth
                    variant="outlined"
                    type="number"
                    value={customDuration}
                    onChange={(e) => setCustomDuration(e.target.value)}
                    slotProps={{ htmlInput: { min: 1, step: 1 } }}
                    disabled={savingPlan}
                    required
                  />
                  <FormControl sx={{ minWidth: 120 }}>
                    <InputLabel id="edit-duration-unit-label">Unit</InputLabel>
                    <Select
                      labelId="edit-duration-unit-label"
                      value={editDurationUnit}
                      onChange={(e) => setEditDurationUnit(e.target.value as 'days' | 'months')}
                      label="Unit"
                      disabled={savingPlan}
                    >
                      <MenuItem value="days">Days</MenuItem>
                      <MenuItem value="months">Months</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              )}
            </Grid>
            <Grid size={{ xs: 12 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={planIsActive}
                    onChange={(e) => setPlanIsActive(e.target.checked)}
                    color="primary"
                  />
                }
                label="Plan Active"
              />
            </Grid>
            {/* Add duration unit selection */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, my: 2 }}>
              <Typography variant="subtitle1" component="span">
                Duration unit:
              </Typography>
              <ToggleButtonGroup
                value={editDurationUnit}
                exclusive
                onChange={(_, newUnit) => newUnit && setEditDurationUnit(newUnit)}
                size="small"
              >
                <ToggleButton value="days">
                  Days
                </ToggleButton>
                <ToggleButton value="months">
                  Months
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEditPlanDialog} disabled={savingPlan}>
            Cancel
          </Button>
          <Button 
            onClick={handleUpdatePlan} 
            variant="contained" 
            color="primary"
            disabled={savingPlan || !planName || !planPrice}
            startIcon={savingPlan ? <CircularProgress size={20} /> : <SaveIcon />}
          >
            {savingPlan ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Bulk Add Subscriptions Dialog */}
      <Dialog
        open={bulkDialogOpen}
        onClose={processingBulk ? undefined : handleCloseBulkDialog}
        fullWidth
        maxWidth="md"
        aria-labelledby="bulk-subscription-dialog-title"
      >
        <DialogTitle id="bulk-subscription-dialog-title">
          Add Subscriptions in Bulk
        </DialogTitle>
        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Plan selection */}
            <FormControl fullWidth>
              <InputLabel id="bulk-plan-select-label">Subscription Plan *</InputLabel>
              <Select
                labelId="bulk-plan-select-label"
                id="bulk-plan-select"
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                label="Subscription Plan *"
                disabled={processingBulk}
                error={!selectedPlanId}
              >
                {subscriptionPlans
                  .filter(plan => plan.isActive)
                  .map((plan) => (
                    <MenuItem key={plan.id} value={plan.id}>
                      {plan.name} - ${plan.price} {plan.durationInDays !== null ? 
                        `(${plan.durationInDays} days)` : 
                        `(${plan.durationMonths} month${plan.durationMonths !== 1 ? 's' : ''})`}
                    </MenuItem>
                  ))
                }
              </Select>
            </FormControl>
            
            {/* Show selected plan duration */}
            {selectedPlanId && (
              <Box sx={{ mt: 2, p: 2, bgcolor: 'primary.50', borderRadius: 1, border: '1px solid', borderColor: 'primary.200' }}>
                <Typography variant="body2" color="primary.main" sx={{ fontWeight: "medium" }}>
                  📅 Selected Duration: {(() => {
                    const plan = subscriptionPlans.find(p => p.id === selectedPlanId);
                    if (!plan) return 'Unknown';
                    if (plan.durationInDays !== null) return `${plan.durationInDays} days`;
                    return `${plan.durationMonths} month${plan.durationMonths !== 1 ? 's' : ''}`;
                  })()}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  All subscriptions will use this duration automatically
                </Typography>
              </Box>
            )}

            {/* Student selection */}
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: "medium" }}>
                  Select Students
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleSelectAllStudents}
                  disabled={processingBulk || students.length === 0}
                >
                  {selectedStudents.length === students.length && selectedStudents.length > 0
                    ? 'Deselect All' 
                    : 'Select All'
                  }
                </Button>
              </Box>
              
              <Paper 
                variant="outlined" 
                sx={{ 
                  height: 240, 
                  overflow: 'auto', 
                  px: 0,
                  borderRadius: 1,
                  bgcolor: 'background.paper'
                }}
              >
                {loadingStudents ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                    <CircularProgress size={32} />
                  </Box>
                ) : students.length === 0 ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                    <Typography color="text.secondary">
                      No students found
                    </Typography>
                  </Box>
                ) : (
                  <List disablePadding>
                    {students.map((student) => (
                      <ListItem
                        key={student.uid}
                        disablePadding
                      >
                        <ListItemButton 
                          role={undefined} 
                          dense 
                          onClick={() => !processingBulk && handleStudentSelection(student.uid)}
                          disabled={processingBulk}
                        >
                          <ListItemIcon sx={{ minWidth: 42 }}>
                            <Checkbox
                              edge="start"
                              checked={selectedStudents.includes(student.uid)}
                              tabIndex={-1}
                              disableRipple
                              disabled={processingBulk}
                              size="small"
                            />
                          </ListItemIcon>
                          <ListItemText 
                            primary={student.displayName || 'Unnamed User'} 
                            secondary={student.email}
                            slotProps={{ primary: { 
                              variant: 'body2',
                              sx: { fontWeight: 'medium' }
                            } , secondary: {
                              variant: 'caption'
                            } }}
                          />
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                )}
              </Paper>
              
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                {selectedStudents.length} student{selectedStudents.length !== 1 ? 's' : ''} selected
              </Typography>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button 
            onClick={handleCloseBulkDialog} 
            disabled={processingBulk}
            color="inherit"
            variant="outlined"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleBulkAddSubscriptions} 
            variant="contained" 
            color="primary"
            disabled={processingBulk || selectedStudents.length === 0 || !selectedPlanId}
            startIcon={processingBulk ? <CircularProgress size={20} /> : null}
          >
            {processingBulk ? 'Processing...' : `Add Subscriptions (${selectedStudents.length})`}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Delete Plan Dialog */}
      <Dialog
        open={deletePlanDialogOpen}
        onClose={handleCloseDeletePlanDialog}
        aria-labelledby="delete-plan-dialog-title"
      >
        <DialogTitle id="delete-plan-dialog-title">
          Delete Subscription Plan
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the "{planToDelete?.name}" plan? 
            This action cannot be undone and may affect users who are currently subscribed to this plan.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDeletePlanDialog} color="primary">
            Cancel
          </Button>
          <Button 
            onClick={handleDeletePlan} 
            color="error" 
            variant="contained"
            disabled={processing}
          >
            {processing ? <CircularProgress size={24} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk Cancel Subscriptions Dialog */}
      <Dialog
        open={bulkCancelDialogOpen}
        onClose={processingBulkCancel ? undefined : handleCloseBulkCancelDialog}
        fullWidth
        maxWidth="md"
        aria-labelledby="bulk-cancel-dialog-title"
      >
        <DialogTitle id="bulk-cancel-dialog-title">
          🗑️ Bulk Cancel Subscriptions
        </DialogTitle>
        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          
          {success && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
              {success}
            </Alert>
          )}
          
          {processingBulkCancel && bulkCancelProgress && (
            <Alert severity="info" sx={{ mb: 2 }} icon={<CircularProgress size={20} />}>
              {bulkCancelProgress}
            </Alert>
          )}
          
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography variant="body2" color="text.secondary">
                Select active subscriptions to cancel. ⚠️ This will immediately revoke all course access for affected users.
              </Typography>
              {processingBulkCancel && (
                <Typography variant="body2" color="primary" sx={{ mt: 1, fontWeight: 'bold' }}>
                  ⚡ Using optimized batch cancellation for faster processing!
                </Typography>
              )}
            </Box>
            
            {/* Select All */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', pb: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={selectedSubscriptions.length === activeSubscriptions.length && activeSubscriptions.length > 0}
                    indeterminate={selectedSubscriptions.length > 0 && selectedSubscriptions.length < activeSubscriptions.length}
                    onChange={handleSelectAllSubscriptions}
                    disabled={processingBulkCancel}
                  />
                }
                label={`Select All Active (${activeSubscriptions.length} subscriptions)`}
              />
            </Box>
            
            {/* Subscription List */}
            <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
              {activeSubscriptions.length === 0 ? (
                <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                  No active subscriptions found
                </Typography>
              ) : (
                <List dense sx={{ width: '100%' }}>
                  {activeSubscriptions.map((subscription) => (
                    <SubscriptionListItem key={subscription.id} subscription={subscription} />
                  ))}
                </List>
              )}
            </Box>
            
            {selectedSubscriptions.length > 0 && (
              <Box sx={{ mt: 2, p: 2, bgcolor: 'error.light', borderRadius: 1, color: 'error.contrastText' }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                    ⚠️ Warning: {selectedSubscriptions.length} subscription(s) selected for cancellation
                  </Typography>
                  <Typography variant="caption" sx={{ mt: 0.5, display: 'block' }}>
                    This action will immediately revoke course access for all affected users.
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button 
            onClick={handleCloseBulkCancelDialog} 
            disabled={processingBulkCancel}
            color="inherit"
            variant="outlined"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleBulkCancelSubscriptions} 
            variant="contained" 
            color="error"
            disabled={processingBulkCancel || selectedSubscriptions.length === 0}
            startIcon={processingBulkCancel ? <CircularProgress size={20} /> : <DeleteIcon />}
          >
            {processingBulkCancel ? '⚡ Cancelling...' : `🗑️ Cancel ${selectedSubscriptions.length} Subscription(s)`}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SubscriptionManagement; 