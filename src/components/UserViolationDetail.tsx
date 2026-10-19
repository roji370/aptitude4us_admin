import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Chip,
  Divider,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  Grid,
  IconButton,
  Tooltip,
  List,
  ListItem,
  ListItemIcon,
  ListItemText
} from '@mui/material';

import {
  Person as PersonIcon,
  Warning as WarningIcon,
  Block as BlockIcon,
  RestartAlt as ResetIcon,
  CheckCircle as CheckCircleIcon,
  ArrowBack as ArrowBackIcon,
  Email as EmailIcon,
  AccessTime as TimeIcon
} from '@mui/icons-material';
import { Timestamp } from 'firebase/firestore';
import { ScreenshotViolation, ViolationReset } from '../types/violations';
import { getUserViolations } from '../services/violationService';
import { getUserById } from '../services/userService';
import type { UserDetails } from '../services/userService';

interface UserViolationDetailProps {
  userId: string;
  onBack: () => void;
  onReset: (userId: string) => void;
}

const UserViolationDetail: React.FC<UserViolationDetailProps> = ({
  userId,
  onBack,
  onReset
}) => {
  const [violation, setViolation] = useState<ScreenshotViolation | null>(null);
  const [user, setUser] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [violationData, userData] = await Promise.all([
          getUserViolations(userId),
          getUserById(userId)
        ]);

        setViolation(violationData);
        setUser(userData);
      } catch (error) {
        console.error('Error fetching violation details:', error);
        setError('Failed to load violation details');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [userId]); // Re-fetch when userId changes

  const formatDate = (date?: Date | Timestamp) => {
    if (!date) return 'Never';
    const d = date instanceof Timestamp ? date.toDate() : date;
    return new Intl.DateTimeFormat(navigator.language, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
  };

  const getStatusInfo = () => {
    if (!violation) return { status: 'CLEAN', color: 'success', icon: CheckCircleIcon };
    
    if (violation.violations.isBlocked) {
      return { status: 'BLOCKED', color: 'error', icon: BlockIcon };
    } else if (violation.violations.count > 0) {
      return { status: 'WARNING', color: 'warning', icon: WarningIcon };
    } else {
      return { status: 'CLEAN', color: 'success', icon: CheckCircleIcon };
    }
  };

  const statusInfo = getStatusInfo();
  const StatusIcon = statusInfo.icon;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
        <Button onClick={onBack} sx={{ ml: 2 }}>
          Go Back
        </Button>
      </Alert>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton onClick={onBack} sx={{ mr: 1 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4" component="h1">
          Violation Details
        </Typography>
      </Box>

      {/* User Information Card */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <PersonIcon sx={{ fontSize: 40, color: 'primary.main' }} />
              <Box>
                <Typography variant="h5" gutterBottom>
                  {user?.displayName || 'Unknown User'}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <EmailIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary">
                    {user?.email || 'No email'}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  User ID: {userId}
                </Typography>
              </Box>
            </Box>
            
            <Box sx={{ textAlign: 'right' }}>
              <Chip
                icon={<StatusIcon />}
                label={statusInfo.status}
                color={statusInfo.color as any}
                size="medium"
                sx={{ fontWeight: 'bold', mb: 1 }}
              />
              <Typography variant="body2" color="text.secondary">
                Current Status
              </Typography>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Violation Statistics */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="error.main" sx={{ fontWeight: "bold" }}>
              {violation?.violations.count || 0}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Total Violations
            </Typography>
          </Paper>
        </Grid>
        
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h4" color="primary.main" sx={{ fontWeight: "bold" }}>
              {violation?.violations.resetHistory.length || 0}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Times Reset
            </Typography>
          </Paper>
        </Grid>
        
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="body1" sx={{ fontWeight: "medium" }}>
              {violation?.violations.firstWarning 
                ? formatDate(violation.violations.firstWarning)
                : 'Never'
              }
            </Typography>
            <Typography variant="body2" color="text.secondary">
              First Warning
            </Typography>
          </Paper>
        </Grid>
        
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="body1" sx={{ fontWeight: "medium" }}>
              {violation?.violations.blockedAt 
                ? formatDate(violation.violations.blockedAt)
                : 'Never'
              }
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Blocked At
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Action Buttons */}
      {violation && violation.violations.count > 0 && (
        <Box sx={{ mb: 3 }}>
          <Button
            variant="contained"
            startIcon={<ResetIcon />}
            onClick={() => onReset(userId)}
            color="primary"
            size="large"
          >
            Reset Violations
          </Button>
        </Box>
      )}

      {/* Event History */}
      {violation && (violation.violations.count > 0 || violation.violations.resetHistory.length > 0) && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TimeIcon />
            Violation History
          </Typography>
          <Divider sx={{ mb: 2 }} />
          
          <List>
            {/* Current Status */}
            <ListItem>
              <ListItemIcon>
                <StatusIcon color={statusInfo.color as any} />
              </ListItemIcon>
              <ListItemText
                primary={`Current Status: ${statusInfo.status}`}
                secondary={`${violation.violations.count} violation(s) total`}
                slotProps={{ primary: { component: 'div' } , secondary: { component: 'div' } }}
              />
            </ListItem>

            {/* Reset History */}
            {violation.violations.resetHistory.map((reset: ViolationReset, index) => (
              <ListItem key={index}>
                <ListItemIcon>
                  <ResetIcon color="primary" />
                </ListItemIcon>
                <ListItemText
                  primary="Violations Reset"
                  slotProps={{ primary: { component: 'div' } }}
                  secondary={
                    <Box component="div">
                      <Typography variant="body2" component="div">
                        {formatDate(reset.resetAt)}
                      </Typography>
                      <Typography variant="body2" component="div">
                        <strong>Reason:</strong> {reset.reason.replace('_', ' ')}
                      </Typography>
                      <Typography variant="body2" component="div">
                        <strong>Reset by:</strong> {reset.resetByEmail || 'Unknown Admin'}
                      </Typography>
                      {reset.notes && (
                        <Typography variant="body2" component="div">
                          <strong>Notes:</strong> {reset.notes}
                        </Typography>
                      )}
                    </Box>
                  }
                />
              </ListItem>
            ))}

            {/* Blocked Event */}
            {violation.violations.blockedAt && (
              <ListItem>
                <ListItemIcon>
                  <BlockIcon color="error" />
                </ListItemIcon>
                <ListItemText
                  primary="Access Blocked"
                  slotProps={{ primary: { component: 'div' } }}
                  secondary={
                    <Box component="div">
                      <Typography variant="body2" component="div">
                        {formatDate(violation.violations.blockedAt)}
                      </Typography>
                      <Typography variant="body2" component="div">
                        User exceeded maximum violations (2)
                      </Typography>
                    </Box>
                  }
                />
              </ListItem>
            )}

            {/* First Warning */}
            {violation.violations.firstWarning && (
              <ListItem>
                <ListItemIcon>
                  <WarningIcon color="warning" />
                </ListItemIcon>
                <ListItemText
                  primary="First Warning"
                  slotProps={{ primary: { component: 'div' } }}
                  secondary={
                    <Box component="div">
                      <Typography variant="body2" component="div">
                        {formatDate(violation.violations.firstWarning)}
                      </Typography>
                      <Typography variant="body2" component="div">
                        User attempted to take a screenshot
                      </Typography>
                    </Box>
                  }
                />
              </ListItem>
            )}
          </List>
        </Paper>
      )}

      {/* No Violations Message */}
      {!violation || (violation.violations.count === 0 && violation.violations.resetHistory.length === 0) && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <CheckCircleIcon sx={{ fontSize: 60, color: 'success.main', mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            No Violations Found
          </Typography>
          <Typography variant="body1" color="text.secondary">
            This user has no screenshot violation history.
          </Typography>
        </Paper>
      )}
    </Box>
  );
};

export default UserViolationDetail;
