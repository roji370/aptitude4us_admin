import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Chip,
  Paper,
  Avatar,
  Divider,
  useTheme,
  Stack
} from '@mui/material';
import {
  CalendarToday as CalendarIcon,
  Payments as PaymentsIcon,
  NavigateNext as NavigateNextIcon,
  CheckCircle as CheckCircleIcon,
  CancelOutlined as CancelIcon,
  Warning as WarningIcon,
  Event as EventIcon
} from '@mui/icons-material';
import { Timestamp } from 'firebase/firestore';
import { computeEffectiveEndDate } from '../services/subscriptionService';

interface SubscriptionCardProps {
  subscription: {
    id: string;
    planName: string;
    startDate: Date | Timestamp; // Firestore Timestamp or Date
    endDate: Date | Timestamp;
    examDate?: Date | Timestamp | null;
    price: number;
    status: 'active' | 'expired' | 'cancelled';
    userId?: string;
  };
  userName?: string;
  showManageButton?: boolean;
  onSetExamDate?: (subscriptionId: string, currentExamDate?: Date | null) => void;
}

const SubscriptionCard: React.FC<SubscriptionCardProps> = ({ subscription, userName, showManageButton = true, onSetExamDate }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  
  // Format dates
  const startDate = subscription.startDate instanceof Date ? 
    subscription.startDate : 
    subscription.startDate?.toDate();
  
  const endDate = subscription.endDate instanceof Date ? 
    subscription.endDate : 
    subscription.endDate?.toDate();

  // Parse exam date if present
  const examDate = subscription.examDate ? 
    (subscription.examDate instanceof Date ? 
      subscription.examDate : 
      (subscription.examDate as Timestamp)?.toDate?.() || null) 
    : null;

  // Calculate effective end date using the shared helper so end-of-day
  // normalization stays consistent with the backend access check & cron.
  const effectiveEndDate = endDate ? computeEffectiveEndDate(endDate, examDate) : endDate;
  const hasExamDate = !!examDate;
  const isExamBeforeEnd = !!(effectiveEndDate && endDate && effectiveEndDate < endDate);

  // Calculate remaining days based on effective end date
  const today = new Date();
  const daysRemaining = effectiveEndDate ? 
    Math.ceil((effectiveEndDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : 
    0;
  
  // Status logic
  const isActive = subscription.status === 'active';
  const isCancelled = subscription.status === 'cancelled';
  
  const handleManageClick = () => {
    navigate(`/subscriptions/detail/${subscription.id}`);
  };

  // Status colors
  const statusColors = {
    active: theme.palette.success.main,
    cancelled: theme.palette.grey[500],
    expired: theme.palette.error.main
  };

  const dateFormat = new Intl.DateTimeFormat(navigator.language, { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });

  return (
    <Paper
      elevation={2}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 2,
        overflow: 'hidden',
        height: '100%',
        transition: 'all 0.2s ease-in-out',
        position: 'relative',
        border: '1px solid',
        borderColor: 'divider',
        '&:hover': {
          transform: 'translateY(-3px)',
          boxShadow: theme.shadows[4]
        }
      }}
    >
      {/* Status indicator bar */}
      <Box 
        sx={{ 
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '4px',
          backgroundColor: isActive ? statusColors.active : 
                           isCancelled ? statusColors.cancelled : 
                           statusColors.expired
        }} 
      />
      
      {/* Header */}
      <Box sx={{ p: 2.5 }}>
        {/* User info and plan row */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {userName && (
              <Avatar
                sx={{
                  bgcolor: theme.palette.primary.main,
                  color: theme.palette.primary.contrastText,
                  width: 40,
                  height: 40,
                  mr: 1.5,
                  fontWeight: 'bold'
                }}
              >
                {userName.charAt(0).toUpperCase()}
              </Avatar>
            )}
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 'bold', lineHeight: 1.2 }}>
                {userName || subscription.planName}
              </Typography>
              {userName && (
                <Typography variant="body2" color="text.secondary">
                  {subscription.planName}
                </Typography>
              )}
            </Box>
          </Box>
          
          <Chip 
            label={isActive ? "Active" : (isCancelled ? "Cancelled" : "Expired")}
            color={isActive ? "success" : (isCancelled ? "default" : "error")}
            size="small"
            icon={isActive ? <CheckCircleIcon /> : (isCancelled ? <CancelIcon /> : <WarningIcon />)}
            sx={{ fontWeight: 'medium' }}
          />
        </Box>
        
        <Divider sx={{ mb: 2 }} />
        
        {/* Subscription details */}
        <Stack spacing={1.5}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <CalendarIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary">Period</Typography>
            </Box>
            <Typography variant="body2" sx={{ fontWeight: "medium" }}>
              {dateFormat.format(startDate)} - {dateFormat.format(endDate)}
            </Typography>
          </Box>
          
          {hasExamDate && examDate && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <EventIcon fontSize="small" sx={{ mr: 1, color: isExamBeforeEnd ? 'info.main' : 'text.secondary' }} />
                <Typography variant="body2" color={isExamBeforeEnd ? 'info.main' : 'text.secondary'}>
                  Exam Date
                </Typography>
              </Box>
              <Typography variant="body2" color={isExamBeforeEnd ? 'info.main' : 'text.primary'} sx={{ fontWeight: "medium" }}>
                {dateFormat.format(examDate)}
              </Typography>
            </Box>
          )}

          {isExamBeforeEnd && (
            <Box sx={{ 
              bgcolor: 'info.light', 
              p: 1, 
              borderRadius: 1, 
              display: 'flex', 
              alignItems: 'center'
            }}>
              <EventIcon sx={{ mr: 0.5, fontSize: '0.9rem', color: 'info.dark' }} />
              <Typography variant="caption" color="info.dark">
                Access ends on exam date
              </Typography>
            </Box>
          )}
          
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <PaymentsIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary">Price</Typography>
            </Box>
            <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
              ${subscription.price.toFixed(2)}
            </Typography>
          </Box>
        </Stack>
        
        {/* Expiry warning */}
        {isActive && daysRemaining > 0 && daysRemaining <= 7 && (
          <Box 
            sx={{ 
              bgcolor: 'warning.light', 
              p: 1.5, 
              borderRadius: 1, 
              display: 'flex', 
              alignItems: 'center',
              mt: 2
            }}
          >
            <WarningIcon color="warning" sx={{ mr: 1, fontSize: '1.2rem' }} />
            <Typography variant="body2">
              Expires in {daysRemaining} day{daysRemaining !== 1 ? 's' : ''}
            </Typography>
          </Box>
        )}
        
        {/* Action buttons */}
        <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
          {onSetExamDate && isActive && (
            <Button
              variant="outlined"
              color="info"
              onClick={() => onSetExamDate(subscription.id, examDate)}
              startIcon={<EventIcon />}
              sx={{ flex: 1 }}
              size="small"
            >
              {hasExamDate ? 'Edit Exam Date' : 'Set Exam Date'}
            </Button>
          )}
          {showManageButton && (
            <Button
              variant="outlined"
              color="primary"
              onClick={handleManageClick}
              endIcon={<NavigateNextIcon />}
              sx={{ flex: 1 }}
              size="small"
            >
              View Details
            </Button>
          )}
        </Box>
      </Box>
    </Paper>
  );
};

export default SubscriptionCard; 