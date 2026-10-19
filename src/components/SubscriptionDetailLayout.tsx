import React from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  Button, 
  Divider, 
  Chip,
  Card,
  LinearProgress,
  Avatar,
  useTheme,
  Stack
} from '@mui/material';
import {
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  CalendarToday as CalendarIcon,
  Person as PersonIcon,
  Refresh as RefreshIcon,
  ExtensionOutlined as ExtendIcon,
  CancelOutlined as CancelIcon,
  NotificationsActive as NotificationIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { Subscription } from '../types/subscription';

// Define a UserInfo type to replace 'any'
interface UserInfo {
  displayName?: string | null;
  email?: string | null;
  uid?: string;
  id?: string; // Some services use id instead of uid
}

interface SubscriptionDetailLayoutProps {
  subscription: Subscription;
  user: UserInfo | null;
  isActive: boolean;
  isCancelled: boolean;
  isExpired: boolean;
  daysRemaining: number;
  startDate: Date;
  endDate: Date;
  onRenew: () => void;
  onExtend: (days?: number) => void;
  onCancel: () => void;
  onSendReminder: () => void;
  sentNotification: boolean;
}

const SubscriptionDetailLayout: React.FC<SubscriptionDetailLayoutProps> = ({
  subscription,
  user,
  isActive,
  isCancelled,
  isExpired,
  daysRemaining,
  startDate,
  endDate,
  onRenew,
  onExtend,
  onCancel,
  onSendReminder,
  sentNotification
}) => {
  const navigate = useNavigate();
  const theme = useTheme();
  
  // Calculate percentage of subscription elapsed
  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const daysElapsed = totalDays - daysRemaining;
  const progressPercentage = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));
  
  const getProgressColor = () => {
    if (isExpired || isCancelled) return theme.palette.grey[500];
    if (daysRemaining <= 3) return theme.palette.warning.main;
    return theme.palette.primary.main;
  };
  
  return (
    <Box sx={{ position: 'relative', pb: 4 }}>
      {/* Header section with user info and subscription overview */}
      <Card 
        elevation={0} 
        sx={{ 
          mb: 3, 
          overflow: 'visible',
          borderRadius: 2,
          p: 0, 
          bgcolor: theme.palette.background.paper,
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          position: 'relative',
          border: '1px solid',
          borderColor: 'divider'
        }}
      >
        <Box sx={{ p: { xs: 2, md: 3 } }}>
          {/* Header - User and Status */}
          <Box sx={{ 
            display: 'flex', 
            flexDirection: { xs: 'column', sm: 'row' }, 
            justifyContent: 'space-between', 
            alignItems: { xs: 'flex-start', sm: 'center' }, 
            mb: 2.5 
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: { xs: 2, sm: 0 } }}>
              <Avatar 
                sx={{ 
                  width: 52, 
                  height: 52, 
                  bgcolor: theme.palette.primary.main,
                  color: theme.palette.primary.contrastText,
                  mr: 2,
                  fontWeight: 'bold',
                  fontSize: '1.4rem',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.12)'
                }}
              >
                {user?.displayName ? user.displayName.charAt(0).toUpperCase() : <PersonIcon />}
              </Avatar>
              <Box>
                <Typography variant="h5" sx={{ lineHeight: 1.2, fontWeight: "bold" }}>
                  {user ? user.displayName || user.email : 'Loading...'}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
                  <Chip 
                    label={isActive ? "Active" : (isCancelled ? "Cancelled" : "Expired")}
                    color={isActive ? "success" : (isCancelled ? "default" : "error")}
                    size="small"
                    icon={isActive ? <CheckCircleIcon /> : <WarningIcon />}
                    sx={{ 
                      fontWeight: 'medium', 
                      height: 22,
                      mr: 1.5
                    }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {subscription.planName}
                  </Typography>
                </Box>
              </Box>
            </Box>
            
            <Box sx={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: { xs: 'flex-start', sm: 'flex-end' }
            }}>
              <Typography variant="h4" sx={{ lineHeight: 1.1, fontWeight: "bold" }}>
                ${subscription.price.toFixed(2)}
              </Typography>
              {isActive && !isExpired && (
                <Typography 
                  variant="body2" 
                  color={daysRemaining <= 7 ? "warning.main" : "text.secondary"}
                 
                  sx={{ mt: 0.5, fontWeight: "medium" }}
                >
                  {daysRemaining} day{daysRemaining !== 1 ? 's' : ''} remaining
                </Typography>
              )}
            </Box>
          </Box>
          
          {/* Dates and Progress Bar */}
          <Box sx={{ 
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'stretch', sm: 'center' },
            justifyContent: 'space-between',
            backgroundColor: theme.palette.grey[50],
            border: '1px solid',
            borderColor: theme.palette.grey[200],
            borderRadius: 1.5,
            p: 2,
            mb: isActive && !isExpired ? 2 : 0
          }}>
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              mb: { xs: 1.5, sm: 0 } 
            }}>
              <CalendarIcon fontSize="small" sx={{ color: theme.palette.text.secondary, mr: 1 }} />
              <Typography variant="body2" sx={{ fontWeight: "medium" }}>
                {new Intl.DateTimeFormat(navigator.language, { 
                  month: 'short', 
                  day: 'numeric', 
                  year: 'numeric' 
                }).format(startDate)} - {new Intl.DateTimeFormat(navigator.language, { 
                  month: 'short', 
                  day: 'numeric', 
                  year: 'numeric' 
                }).format(endDate)}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Typography 
                variant="body2" 
                color="text.secondary" 
                sx={{ mr: 1.5 }}
              >
                {daysElapsed} / {totalDays} days
              </Typography>
              <Chip 
                label={`${Math.round(progressPercentage)}% used`} 
                size="small"
                sx={{ 
                  fontWeight: 'medium',
                  bgcolor: theme.palette.primary.light,
                  color: theme.palette.primary.contrastText
                }} 
              />
            </Box>
          </Box>
          
          {isActive && !isExpired && (
            <Box sx={{ mt: 2 }}>
              <LinearProgress 
                variant="determinate" 
                value={progressPercentage} 
                sx={{ 
                  height: 8, 
                  borderRadius: 4,
                  bgcolor: theme.palette.grey[100],
                  '& .MuiLinearProgress-bar': {
                    bgcolor: getProgressColor(),
                    borderRadius: 4
                  }
                }} 
              />
            </Box>
          )}
        </Box>
      </Card>
      
      {/* Customer & Plan Details */}
      <Paper sx={{ 
        borderRadius: 2, 
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
        border: '1px solid',
        borderColor: 'divider',
        mb: 3
      }}>
        <Box sx={{ 
          px: 3, 
          pt: 3, 
          pb: 2,
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center' 
        }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: "bold" }}>
              Customer & Plan Details
            </Typography>
            <Typography variant="body2" color="text.secondary">
              User information and subscription plan
            </Typography>
          </Box>
          <Button
            variant="outlined"
            size="small"
            onClick={() => navigate(`/users/${subscription.userId}`)}
            sx={{ textTransform: 'none' }}
          >
            View Profile
          </Button>
        </Box>
        
        <Divider />
        
        {/* Customer details in a cleaner layout */}
        <Box sx={{ p: 3 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
            {/* Left side: Customer and Plan */}
            <Box sx={{ flex: '1 1 50%' }}>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ 
                    fontWeight: 'medium', 
                    mb: 0.5, 
                    display: 'block', 
                    textTransform: 'uppercase' 
                  }}>
                    Customer Name
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: "medium" }}>
                    {user ? user.displayName || 'Not available' : 'Loading...'}
                  </Typography>
                </Box>
                
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ 
                    fontWeight: 'medium', 
                    mb: 0.5, 
                    display: 'block', 
                    textTransform: 'uppercase' 
                  }}>
                    Email Address
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: "medium" }}>
                    {user ? user.email || 'Not available' : 'Loading...'}
                  </Typography>
                </Box>
                
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ 
                    fontWeight: 'medium', 
                    mb: 0.5, 
                    display: 'block', 
                    textTransform: 'uppercase' 
                  }}>
                    Plan Type
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: "medium" }}>
                    {subscription.planName}
                  </Typography>
                </Box>
                
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ 
                    fontWeight: 'medium', 
                    mb: 0.5, 
                    display: 'block', 
                    textTransform: 'uppercase' 
                  }}>
                    Monthly Rate
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: "bold" }}>
                    ${subscription.price.toFixed(2)}
                  </Typography>
                </Box>
              </Stack>
            </Box>
          </Stack>
        </Box>
      </Paper>
      
      {/* Action Buttons Section */}
      <Paper sx={{ 
        borderRadius: 2, 
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
        border: '1px solid',
        borderColor: 'divider',
        mb: 3
      }}>
        <Box sx={{ 
          px: 3, 
          pt: 3, 
          pb: 2,
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center' 
        }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: "bold" }}>
              Subscription Actions
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Manage this subscription
            </Typography>
          </Box>
        </Box>
        
        <Divider />
        
        <Box sx={{ p: 3 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {isActive && !isExpired && (
              <>
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={<RefreshIcon />}
                  onClick={onRenew}
                >
                  Renew
                </Button>
                
                <Button
                  variant="outlined"
                  color="primary"
                  startIcon={<ExtendIcon />}
                  onClick={() => onExtend()}
                >
                  Extend
                </Button>
                
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<CancelIcon />}
                  onClick={onCancel}
                >
                  Cancel
                </Button>
                
                <Button
                  variant="text"
                  color="primary"
                  startIcon={<NotificationIcon />}
                  onClick={onSendReminder}
                  disabled={sentNotification}
                >
                  {sentNotification ? 'Notification Sent' : 'Send Reminder'}
                </Button>
              </>
            )}
            
            {isCancelled && (
              <Button
                variant="contained"
                color="primary"
                startIcon={<RefreshIcon />}
                onClick={onRenew}
              >
                Renew
              </Button>
            )}
            
            {isExpired && !isCancelled && (
              <Button
                variant="contained"
                color="primary"
                startIcon={<RefreshIcon />}
                onClick={onRenew}
              >
                Renew Now
              </Button>
            )}
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
};

export default SubscriptionDetailLayout;