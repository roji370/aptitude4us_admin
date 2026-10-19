import React, { useState } from 'react';
import { Box, Snackbar, Alert } from '@mui/material';
import ViolationsDashboard from '../components/ViolationsDashboard';
import UserViolationDetail from '../components/UserViolationDetail';
import ResetViolationsDialog from '../components/ResetViolationsDialog';
import { 
  getUserViolations, 
  resetUserViolations 
} from '../services/violationService';
import { getUserById } from '../services/userService';
import { useAuth } from '../context/AuthContext';
import { 
  ScreenshotViolation, 
  ViolationResetRequest 
} from '../types/violations';
import type { UserDetails } from '../services/userService';

type ViewMode = 'dashboard' | 'user-detail';

const PiracyTracking: React.FC = () => {
  const { currentUser } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [violation, setViolation] = useState<ScreenshotViolation | null>(null);
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(false);
  // Removed refreshTrigger - now using real-time listeners
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'warning' | 'info';
  }>({
    open: false,
    message: '',
    severity: 'success'
  });

  const showSnackbar = (message: string, severity: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleCloseSnackbar = () => {
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  const handleViewUser = (userId: string) => {
    setSelectedUserId(userId);
    setViewMode('user-detail');
  };

  const handleBackToDashboard = () => {
    setViewMode('dashboard');
    setSelectedUserId(null);
  };

  const handleOpenResetDialog = async (userId: string) => {
    try {
      setLoading(true);
      setResetUserId(userId);

      // Fetch violation and user details
      const [violationData, userData] = await Promise.all([
        getUserViolations(userId),
        getUserById(userId)
      ]);

      setViolation(violationData);
      setUserDetails(userData);
      setResetDialogOpen(true);
    } catch (error) {
      console.error('Error loading reset dialog data:', error);
      showSnackbar('Failed to load user data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseResetDialog = () => {
    setResetDialogOpen(false);
    setResetUserId(null);
    setViolation(null);
    setUserDetails(null);
  };

  const handleResetViolations = async (resetRequest: ViolationResetRequest) => {
    if (!resetUserId || !currentUser) {
      throw new Error('Missing required data for reset');
    }

    try {
      await resetUserViolations(resetUserId, resetRequest, currentUser.uid);
      
      showSnackbar(
        `Successfully reset violations for ${userDetails?.email || 'user'}`,
        'success'
      );
      
      // Real-time listeners will automatically update the dashboard
    } catch (error) {
      console.error('Error resetting violations:', error);
      throw error; // Re-throw so the dialog can handle it
    }
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      {viewMode === 'dashboard' && (
        <ViolationsDashboard
          onViewUser={handleViewUser}
          onResetUser={handleOpenResetDialog}
        />
      )}

      {viewMode === 'user-detail' && selectedUserId && (
        <UserViolationDetail
          userId={selectedUserId}
          onBack={handleBackToDashboard}
          onReset={handleOpenResetDialog}
        />
      )}

      {/* Reset Violations Dialog */}
      <ResetViolationsDialog
        open={resetDialogOpen}
        onClose={handleCloseResetDialog}
        onReset={handleResetViolations}
        violation={violation}
        userEmail={userDetails?.email ?? undefined}
        loading={loading}
      />

      {/* Success/Error Messages */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default PiracyTracking;
