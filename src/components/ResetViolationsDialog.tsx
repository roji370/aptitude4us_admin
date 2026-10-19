import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  CircularProgress,
  Divider
} from '@mui/material';
import {
  Warning as WarningIcon,
  RestartAlt as ResetIcon
} from '@mui/icons-material';
import { 
  ViolationResetRequest, 
  ScreenshotViolation
} from '../types/violations';

interface ResetViolationsDialogProps {
  open: boolean;
  onClose: () => void;
  onReset: (resetRequest: ViolationResetRequest) => Promise<void>;
  violation: ScreenshotViolation | null;
  userEmail?: string;
  loading?: boolean;
}

const ResetViolationsDialog: React.FC<ResetViolationsDialogProps> = ({
  open,
  onClose,
  onReset,
  violation,
  userEmail,
  loading = false
}) => {
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    try {
      setResetting(true);
      setError(null);
      
      const resetRequest: ViolationResetRequest = {
        reason: 'support_request' // Simple default reason
      };

      await onReset(resetRequest);
      
      onClose();
    } catch (error) {
      console.error('Error resetting violations:', error);
      setError(error instanceof Error ? error.message : 'Failed to reset violations');
    } finally {
      setResetting(false);
    }
  };

  const handleClose = () => {
    if (resetting) return;
    
    setError(null);
    onClose();
  };

  const canReset = violation && violation.violations.count > 0;

  return (
    <Dialog 
      open={open} 
      onClose={(_e, reason) => {
        if (resetting && reason === 'escapeKeyDown') return;
        handleClose();
      }}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ResetIcon color="primary" />
        Reset Screenshot Violations
      </DialogTitle>
      
      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {/* User Info */}
            <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                User Information
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: "medium" }}>
                {userEmail || 'Unknown User'}
              </Typography>
              
              {violation && (
                <>
                  <Divider sx={{ my: 1 }} />
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mt: 1 }}>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Current Violations
                      </Typography>
                      <Typography variant="h6" color="error.main">
                        {violation.violations.count}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Status
                      </Typography>
                      <Typography 
                        variant="h6" 
                        color={violation.violations.isBlocked ? 'error.main' : 'warning.main'}
                      >
                        {violation.violations.isBlocked ? 'BLOCKED' : 'WARNING'}
                      </Typography>
                    </Box>
                  </Box>
                </>
              )}
            </Box>

            {!canReset ? (
              <Alert severity="info" sx={{ mb: 2 }}>
                This user has no violations to reset.
              </Alert>
            ) : (
              <>
                {/* Warning */}
                <Alert severity="warning" sx={{ mb: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <WarningIcon sx={{ mt: 0.5 }} />
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>
                        Reset Confirmation
                      </Typography>
                      <Typography variant="body2">
                        This will completely reset all violations for this user and restore their access.
                        The user will be able to use the app normally. This action cannot be undone.
                      </Typography>
                    </Box>
                  </Box>
                </Alert>



                {/* Error Display */}
                {error && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {error}
                  </Alert>
                )}
              </>
            )}
          </>
        )}
      </DialogContent>
      
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button 
          onClick={handleClose}
          disabled={resetting}
        >
          Cancel
        </Button>
        
        {canReset && (
          <Button
            variant="contained"
            onClick={handleReset}
            disabled={resetting || loading}
            startIcon={resetting ? <CircularProgress size={20} /> : <ResetIcon />}
            color="primary"
          >
            {resetting ? 'Resetting...' : 'Reset Violations'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ResetViolationsDialog;
