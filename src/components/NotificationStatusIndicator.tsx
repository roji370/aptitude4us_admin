import React, { useState, useEffect } from 'react';
import {
  Box,
  Chip,
  Tooltip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  Alert
} from '@mui/material';
import {
  Notifications as NotificationsIcon,
  NotificationsOff as NotificationsOffIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon
} from '@mui/icons-material';
import { 
  getCourseNotificationStats,
  getNotificationTrackingRecords,
  checkUserNotificationStatus,
  NotificationResult,
  NotificationTrackingRecord
} from '../services/courseAssignmentNotificationService';

interface NotificationStatusIndicatorProps {
  courseId?: string;
  userId?: string;
  variant?: 'compact' | 'detailed';
  showDialog?: boolean;
}

const NotificationStatusIndicator: React.FC<NotificationStatusIndicatorProps> = ({
  courseId,
  userId,
  variant = 'compact',
  showDialog = false
}) => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [userStatus, setUserStatus] = useState<any>(null);
  const [trackingRecords, setTrackingRecords] = useState<NotificationTrackingRecord[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadNotificationData();
  }, [courseId, userId]);

  const loadNotificationData = async () => {
    try {
      setLoading(true);
      setError(null);

      if (courseId && userId) {
        // Load specific user notification status for a course
        const status = await checkUserNotificationStatus(userId, courseId);
        setUserStatus(status);
      } else if (courseId) {
        // Load course notification statistics
        const courseStats = await getCourseNotificationStats(courseId);
        setStats(courseStats);
        
        if (showDialog) {
          const records = await getNotificationTrackingRecords(courseId);
          setTrackingRecords(records);
        }
      }
    } catch (err) {
      console.error('Error loading notification data:', err);
      setError('Failed to load notification status');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = () => {
    setDialogOpen(true);
    if (trackingRecords.length === 0 && courseId) {
      loadTrackingRecords();
    }
  };

  const loadTrackingRecords = async () => {
    if (!courseId) return;
    
    try {
      const records = await getNotificationTrackingRecords(courseId);
      setTrackingRecords(records);
    } catch (err) {
      console.error('Error loading tracking records:', err);
      setError('Failed to load notification history');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'success';
      case 'partial_success':
        return 'warning';
      case 'failed':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircleIcon fontSize="small" />;
      case 'partial_success':
        return <WarningIcon fontSize="small" />;
      case 'failed':
        return <ErrorIcon fontSize="small" />;
      default:
        return <NotificationsIcon fontSize="small" />;
    }
  };

  if (loading) {
    return (
      <Chip
        icon={<NotificationsIcon />}
        label="Loading..."
        size="small"
        variant="outlined"
      />
    );
  }

  if (error) {
    return (
      <Tooltip title={error}>
        <Chip
          icon={<ErrorIcon />}
          label="Error"
          size="small"
          color="error"
          variant="outlined"
        />
      </Tooltip>
    );
  }

  // User-specific status
  if (userId && userStatus) {
    if (!userStatus.hasReceived) {
      return (
        <Tooltip title="No notification sent to this user">
          <Chip
            icon={<NotificationsOffIcon />}
            label="Not Notified"
            size="small"
            variant="outlined"
          />
        </Tooltip>
      );
    }

    return (
      <Tooltip title={`Notification sent: ${userStatus.timestamp?.toLocaleString()}`}>
        <Chip
          icon={getStatusIcon(userStatus.status)}
          label="Notified"
          size="small"
          color={getStatusColor(userStatus.status) as any}
          variant="outlined"
        />
      </Tooltip>
    );
  }

  // Course-level statistics
  if (stats) {
    if (stats.totalNotificationsSent === 0) {
      return (
        <Tooltip title="No notifications have been sent for this course">
          <Chip
            icon={<NotificationsOffIcon />}
            label="No Notifications"
            size="small"
            variant="outlined"
          />
        </Tooltip>
      );
    }

    const tooltipText = `${stats.totalUsersNotified} users notified, ${stats.successRate.toFixed(1)}% success rate`;

    if (variant === 'compact') {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title={tooltipText}>
            <Chip
              icon={<NotificationsIcon />}
              label={`${stats.totalUsersNotified} notified`}
              size="small"
              color={stats.successRate >= 80 ? 'success' : stats.successRate >= 50 ? 'warning' : 'error'}
              variant="outlined"
              onClick={showDialog ? handleOpenDialog : undefined}
              clickable={showDialog}
            />
          </Tooltip>
        </Box>
      );
    }

    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip
          icon={<NotificationsIcon />}
          label={`${stats.totalUsersNotified} users notified`}
          size="small"
          color={stats.successRate >= 80 ? 'success' : stats.successRate >= 50 ? 'warning' : 'error'}
          variant="outlined"
        />
        <Chip
          label={`${stats.successRate.toFixed(1)}% success`}
          size="small"
          color={stats.successRate >= 80 ? 'success' : stats.successRate >= 50 ? 'warning' : 'error'}
          variant="outlined"
        />
        {showDialog && (
          <IconButton size="small" onClick={handleOpenDialog}>
            <NotificationsIcon />
          </IconButton>
        )}
      </Box>
    );
  }

  return null;

  // Notification History Dialog
  const renderDialog = () => (
    <Dialog
      open={dialogOpen}
      onClose={() => setDialogOpen(false)}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        Course Assignment Notification History
      </DialogTitle>
      <DialogContent>
        {trackingRecords.length === 0 ? (
          <Alert severity="info">
            No notification history found for this course.
          </Alert>
        ) : (
          <List>
            {trackingRecords.map((record) => (
              <React.Fragment key={record.id}>
                <ListItemButton
                  onClick={() => setExpandedRecord(
                    expandedRecord === record.id ? null : record.id
                  )}
                >
                  <ListItemIcon>
                    {record.summary.failed > 0 ? (
                      <WarningIcon color="warning" />
                    ) : (
                      <CheckCircleIcon color="success" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={`${record.summary.successful}/${record.summary.totalUsers} users notified`}
                    secondary={`${record.timestamp.toLocaleString()} - ${record.assignedUsers.length} users assigned`}
                  />
                  {expandedRecord === record.id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </ListItemButton>
                <Collapse in={expandedRecord === record.id} timeout="auto" unmountOnExit>
                  <Box sx={{ pl: 4, pr: 2, pb: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Notification Results:
                    </Typography>
                    {record.results.map((result: NotificationResult, index: number) => (
                      <Box key={index} sx={{ mb: 1 }}>
                        <Chip
                          icon={getStatusIcon(result.status)}
                          label={`User ${result.userId} - ${result.status}`}
                          size="small"
                          color={getStatusColor(result.status) as any}
                          variant="outlined"
                          sx={{ mr: 1, mb: 0.5 }}
                        />
                        {result.directPushSent && (
                          <Chip
                            label={`${result.successfulSends}/${result.tokenCount} devices`}
                            size="small"
                            variant="outlined"
                            sx={{ mr: 1, mb: 0.5 }}
                          />
                        )}
                      </Box>
                    ))}
                    {record.errors.length > 0 && (
                      <Box sx={{ mt: 1 }}>
                        <Typography variant="subtitle2" color="error">
                          Errors:
                        </Typography>
                        {record.errors.map((error, index) => (
                          <Typography key={index} variant="body2" color="error">
                            User {error.userId}: {error.error}
                          </Typography>
                        ))}
                      </Box>
                    )}
                  </Box>
                </Collapse>
              </React.Fragment>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setDialogOpen(false)}>Close</Button>
      </DialogActions>
    </Dialog>
  );

  return (
    <>
      {/* Main component content above */}
      {renderDialog()}
    </>
  );
};

export default NotificationStatusIndicator;
