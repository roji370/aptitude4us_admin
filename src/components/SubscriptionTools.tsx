import React, { useState } from 'react';
import { 
  Box, 
  Button, 
  Card, 
  CardContent, 
  Typography, 
  Divider,
  Alert,
  CircularProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText
} from '@mui/material';
import { manualTriggerSubscriptionNotifications } from '../services/subscriptionNotificationService';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import HistoryIcon from '@mui/icons-material/History';
import WarningIcon from '@mui/icons-material/Warning';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import NotificationsIcon from '@mui/icons-material/Notifications';
import BlockIcon from '@mui/icons-material/Block';

interface SubscriptionStats {
  processed: number;
  notificationsSent: number;
  studentsNotified: number;
  expiringTomorrow: number;
  expiredCount: number;
}

const SubscriptionTools = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success?: boolean;
    message?: string;
    stats?: SubscriptionStats;
    error?: string;
  } | null>(null);

  const handleManualCheck = async () => {
    setLoading(true);
    setResult(null);
    
    try {
      const response = await manualTriggerSubscriptionNotifications();
      
      setResult({
        success: response.success,
        message: response.message,
        stats: response.stats
      });
    } catch (error: unknown) {
      console.error('Error triggering subscription check:', error);
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'An unknown error occurred'
      });
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Subscription Management Tools
        </Typography>
        <Divider sx={{ my: 2 }} />
        
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            <NotificationsActiveIcon fontSize="small" sx={{ mr: 1, verticalAlign: 'middle' }} />
            Notification Controls
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Manually trigger subscription expiration checks and notifications to students.
          </Typography>
          <Button 
            variant="contained" 
            color="primary" 
            onClick={handleManualCheck}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <HistoryIcon />}
          >
            {loading ? 'Processing...' : 'Run Subscription Check'}
          </Button>
          
          {result && (
            <Box sx={{ mt: 2 }}>
              {result.success ? (
                <>
                  <Alert severity="success" sx={{ mb: 2 }}>
                    {result.message}
                  </Alert>
                  {result.stats && (
                    <Card variant="outlined" sx={{ mt: 2 }}>
                      <CardContent>
                        <Typography variant="subtitle2" gutterBottom>
                          Results:
                        </Typography>
                        <List dense>
                          <ListItem>
                            <ListItemIcon>
                              <CheckCircleIcon color="primary" fontSize="small" />
                            </ListItemIcon>
                            <ListItemText 
                              primary={`${result.stats.processed} subscriptions processed`} 
                            />
                          </ListItem>
                          <ListItem>
                            <ListItemIcon>
                              <NotificationsIcon color="warning" fontSize="small" />
                            </ListItemIcon>
                            <ListItemText 
                              primary={`${result.stats.notificationsSent} notifications sent`} 
                              secondary={`${result.stats.studentsNotified} students notified`}
                            />
                          </ListItem>
                          <ListItem>
                            <ListItemIcon>
                              <WarningIcon color="warning" fontSize="small" />
                            </ListItemIcon>
                            <ListItemText 
                              primary={`${result.stats.expiringTomorrow} subscriptions expiring tomorrow`} 
                            />
                          </ListItem>
                          <ListItem>
                            <ListItemIcon>
                              <BlockIcon color="error" fontSize="small" />
                            </ListItemIcon>
                            <ListItemText 
                              primary={`${result.stats.expiredCount} subscriptions marked as expired`} 
                            />
                          </ListItem>
                        </List>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : (
                <Alert severity="error">
                  <Typography variant="body2">
                    {result.error || 'Failed to process subscription check'}
                  </Typography>
                </Alert>
              )}
            </Box>
          )}
        </Box>
        
        <Divider sx={{ my: 2 }} />
        
        <Box>
          <Typography variant="body2" color="text.secondary">
            <WarningIcon fontSize="small" sx={{ mr: 1, verticalAlign: 'middle', color: 'warning.main' }} />
            This tool will:
          </Typography>
          <ul style={{ padding: '0 0 0 16px', margin: '8px 0' }}>
            <li>Check for subscriptions expiring in the next 7 days</li>
            <li>Send notifications to students 1 day before expiry</li>
            <li>Mark expired subscriptions as "expired"</li>
          </ul>
        </Box>
      </CardContent>
    </Card>
  );
};

export default SubscriptionTools; 