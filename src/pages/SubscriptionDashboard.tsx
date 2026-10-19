import React, { useState, useEffect } from 'react';
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
  Chip,
  Button,
  CircularProgress,
  IconButton,
  Tooltip,
  Alert,
  Avatar,
} from '@mui/material';
import {
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Refresh as RefreshIcon,
  ArrowForward as ArrowForwardIcon,
  CreditCard as SubscriptionsIcon,
  HourglassTop as HourglassIcon,
  EventBusy as ExpiredIcon,
} from '@mui/icons-material';
import { Link, useNavigate } from 'react-router-dom';
import { getActiveSubscriptions, getAllSubscriptions, computeEffectiveEndDate } from '../services/subscriptionService';
import { getUserById } from '../services/userService';
import { Subscription } from '../types/subscription';
import { Timestamp } from 'firebase/firestore';
import SubscriptionTools from '../components/SubscriptionTools';

const SubscriptionDashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expiringSubscriptions, setExpiringSubscriptions] = useState<
    (Subscription & { userName?: string; userEmail?: string })[]
  >([]);
  const [subscriptionStats, setSubscriptionStats] = useState({
    active: 0,
    expiringInThreeDays: 0,
    expiringToday: 0,
    expired: 0,
  });
  const navigate = useNavigate();

  const fetchSubscriptionData = async () => {
    try {
      setRefreshing(true);

      const activeSubscriptions = await getActiveSubscriptions();

      const now = new Date();
      const sevenDaysFromNow = new Date();
      sevenDaysFromNow.setDate(now.getDate() + 7);

      const expiringInSevenDays = activeSubscriptions.filter((sub) => {
        const endDate = sub.endDate instanceof Date ? sub.endDate : (sub.endDate as Timestamp).toDate();
        const examDate = sub.examDate
          ? sub.examDate instanceof Date
            ? sub.examDate
            : (sub.examDate as Timestamp)?.toDate?.() || null
          : null;
        const effectiveEnd = computeEffectiveEndDate(endDate, examDate);
        return effectiveEnd >= now && effectiveEnd <= sevenDaysFromNow;
      });

      const enhancedSubscriptions = await Promise.all(
        expiringInSevenDays.map(async (sub) => {
          try {
            const user = await getUserById(sub.userId);
            return {
              ...sub,
              userName: user?.displayName || 'Unknown Candidate',
              userEmail: user?.email || 'No Email',
            };
          } catch {
            return {
              ...sub,
              userName: 'Unknown Candidate',
              userEmail: 'No Email',
            };
          }
        })
      );

      enhancedSubscriptions.sort((a, b) => {
        const aEndDate = a.endDate instanceof Date ? a.endDate : a.endDate.toDate();
        const bEndDate = b.endDate instanceof Date ? b.endDate : b.endDate.toDate();
        const aExamDate = a.examDate
          ? a.examDate instanceof Date
            ? a.examDate
            : (a.examDate as Timestamp)?.toDate?.() || null
          : null;
        const bExamDate = b.examDate
          ? b.examDate instanceof Date
            ? b.examDate
            : (b.examDate as Timestamp)?.toDate?.() || null
          : null;
        const aEffective = computeEffectiveEndDate(aEndDate, aExamDate);
        const bEffective = computeEffectiveEndDate(bEndDate, bExamDate);
        return aEffective.getTime() - bEffective.getTime();
      });

      setExpiringSubscriptions(enhancedSubscriptions);

      const allSubscriptions = await getAllSubscriptions();

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      const threeDaysFromNow = new Date(today);
      threeDaysFromNow.setDate(today.getDate() + 3);

      let expiringTodayCount = 0;
      let expiringInThreeDaysCount = 0;

      activeSubscriptions.forEach((sub) => {
        const endDate = sub.endDate instanceof Date ? sub.endDate : (sub.endDate as Timestamp).toDate();
        const examDate = sub.examDate
          ? sub.examDate instanceof Date
            ? sub.examDate
            : (sub.examDate as Timestamp)?.toDate?.() || null
          : null;
        const effectiveEnd = computeEffectiveEndDate(endDate, examDate);

        if (effectiveEnd >= today && effectiveEnd < tomorrow) {
          expiringTodayCount++;
        } else if (effectiveEnd >= today && effectiveEnd <= threeDaysFromNow) {
          expiringInThreeDaysCount++;
        }
      });

      const expiredCount = allSubscriptions.filter((sub) => {
        if (sub.status === 'expired') return true;
        const endDate = sub.endDate instanceof Date ? sub.endDate : (sub.endDate as Timestamp).toDate();
        const examDate = sub.examDate
          ? sub.examDate instanceof Date
            ? sub.examDate
            : (sub.examDate as Timestamp)?.toDate?.() || null
          : null;
        const effectiveEnd = computeEffectiveEndDate(endDate, examDate);
        return effectiveEnd < now;
      }).length;

      setSubscriptionStats({
        active: activeSubscriptions.length,
        expiringInThreeDays: expiringInThreeDaysCount,
        expiringToday: expiringTodayCount,
        expired: expiredCount,
      });
    } catch (error) {
      console.error('Error fetching subscription data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSubscriptionData();
  }, []);

  const getDaysRemaining = (effectiveEnd: Date): number => {
    const now = new Date();
    const diffTime = effectiveEnd.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getStatusChip = (daysRemaining: number) => {
    if (daysRemaining <= 0) {
      return (
        <Chip
          label="Expires Today"
          size="small"
          sx={{
            height: 20,
            fontSize: '0.6875rem',
            fontWeight: 700,
            backgroundColor: '#FEF2F2',
            color: '#991B1B',
            border: '1px solid #FECDCA',
          }}
        />
      );
    } else if (daysRemaining <= 3) {
      return (
        <Chip
          label={`${daysRemaining}d Left`}
          size="small"
          sx={{
            height: 20,
            fontSize: '0.6875rem',
            fontWeight: 700,
            backgroundColor: '#FFFBEB',
            color: '#92400E',
            border: '1px solid #FDE68A',
          }}
        />
      );
    } else {
      return (
        <Chip
          label={`${daysRemaining}d Left`}
          size="small"
          sx={{
            height: 20,
            fontSize: '0.6875rem',
            fontWeight: 700,
            backgroundColor: '#ECFDF5',
            color: '#065F46',
            border: '1px solid #A7F3D0',
          }}
        />
      );
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={40} sx={{ color: '#071A52' }} />
      </Box>
    );
  }

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', sm: 'center' },
          gap: 2,
          mb: 3,
        }}
      >
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SubscriptionsIcon sx={{ fontSize: 26, color: '#071A52' }} />
            <Typography variant="h4" component="h1" sx={{ fontWeight: 800, color: '#071A52', letterSpacing: '-0.02em' }}>
              Subscription Operations
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: '#64748B', mt: 0.5 }}>
            Active candidate access licenses, renewal queues, and expiration audits.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={fetchSubscriptionData}
            disabled={refreshing}
            startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshIcon sx={{ fontSize: 18 }} />}
            sx={{
              borderColor: '#E2E8F0',
              color: '#071A52',
              fontWeight: 600,
              fontSize: '0.8125rem',
              height: 38,
              borderRadius: '8px',
              backgroundColor: '#FFFFFF',
              '&:hover': { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
            }}
          >
            Refresh
          </Button>

          <Button
            variant="contained"
            size="small"
            onClick={() => navigate('/subscriptions/manage')}
            sx={{
              backgroundColor: '#071A52',
              color: '#FFFFFF',
              fontWeight: 600,
              fontSize: '0.8125rem',
              height: 38,
              borderRadius: '8px',
              px: 2,
              '&:hover': { backgroundColor: '#0C2570' },
            }}
          >
            Manage Subscriptions
          </Button>
        </Box>
      </Box>

      {/* 4 Stats Cards */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            lg: 'repeat(4, 1fr)',
          },
          gap: 2.5,
          mb: 4,
        }}
      >
        {/* Active Subscriptions */}
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            borderRadius: 3.5,
            border: '1px solid #E2E8F0',
            backgroundColor: '#FFFFFF',
            boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Active Licenses
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, color: '#071A52', fontSize: '1.75rem', mt: 0.5 }}>
                {subscriptionStats.active}
              </Typography>
            </Box>
            <Box sx={{ width: 42, height: 42, borderRadius: 2.5, backgroundColor: 'rgba(16, 185, 129, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10B981' }}>
              <CheckCircleIcon sx={{ fontSize: 22 }} />
            </Box>
          </Box>
        </Paper>

        {/* Expiring in 3 Days */}
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            borderRadius: 3.5,
            border: '1px solid #E2E8F0',
            backgroundColor: '#FFFFFF',
            boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Expiring &lt; 3 Days
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, color: '#92400E', fontSize: '1.75rem', mt: 0.5 }}>
                {subscriptionStats.expiringInThreeDays}
              </Typography>
            </Box>
            <Box sx={{ width: 42, height: 42, borderRadius: 2.5, backgroundColor: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#B45309' }}>
              <HourglassIcon sx={{ fontSize: 22 }} />
            </Box>
          </Box>
        </Paper>

        {/* Expiring Today */}
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            borderRadius: 3.5,
            border: '1px solid #E2E8F0',
            backgroundColor: '#FFFFFF',
            boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Expiring Today
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, color: '#991B1B', fontSize: '1.75rem', mt: 0.5 }}>
                {subscriptionStats.expiringToday}
              </Typography>
            </Box>
            <Box sx={{ width: 42, height: 42, borderRadius: 2.5, backgroundColor: '#FEF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D92D20' }}>
              <WarningIcon sx={{ fontSize: 22 }} />
            </Box>
          </Box>
        </Paper>

        {/* Expired */}
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            borderRadius: 3.5,
            border: '1px solid #E2E8F0',
            backgroundColor: '#FFFFFF',
            boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Archived / Expired
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, color: '#64748B', fontSize: '1.75rem', mt: 0.5 }}>
                {subscriptionStats.expired}
              </Typography>
            </Box>
            <Box sx={{ width: 42, height: 42, borderRadius: 2.5, backgroundColor: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}>
              <ExpiredIcon sx={{ fontSize: 22 }} />
            </Box>
          </Box>
        </Paper>
      </Box>

      {/* Upcoming Expirations Table */}
      <Paper
        elevation={0}
        sx={{
          borderRadius: 3.5,
          border: '1px solid #E2E8F0',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
          mb: 4,
          overflow: 'hidden',
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 3, pb: 2, borderBottom: '1px solid #F1F5F9' }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, color: '#071A52', fontSize: '1rem' }}>
              Upcoming Expirations (&lt; 7 Days)
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.8125rem', mt: 0.25 }}>
              Candidate licenses reaching effective completion threshold
            </Typography>
          </Box>

          <Button
            size="small"
            component={Link}
            to="/subscriptions/manage"
            endIcon={<ArrowForwardIcon sx={{ fontSize: 14 }} />}
            sx={{ color: '#071A52', fontWeight: 700, fontSize: '0.78125rem' }}
          >
            Full Subscription Ledger
          </Button>
        </Box>

        {expiringSubscriptions.length > 0 ? (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Candidate</TableCell>
                  <TableCell>Access Plan</TableCell>
                  <TableCell>Effective Expiration</TableCell>
                  <TableCell>Validity State</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {expiringSubscriptions.slice(0, 6).map((sub) => {
                  const subEndDate = sub.endDate instanceof Date ? sub.endDate : sub.endDate.toDate();
                  const subExamDate = sub.examDate
                    ? sub.examDate instanceof Date
                      ? sub.examDate
                      : (sub.examDate as Timestamp)?.toDate?.() || null
                    : null;
                  const effectiveEnd = computeEffectiveEndDate(subEndDate, subExamDate);
                  const daysRemaining = getDaysRemaining(effectiveEnd);

                  return (
                    <TableRow key={sub.id} sx={{ '&:hover': { backgroundColor: '#F8FAFC' } }}>
                      <TableCell sx={{ py: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Avatar
                            sx={{
                              width: 32,
                              height: 32,
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              backgroundColor: 'rgba(7, 26, 82, 0.08)',
                              color: '#071A52',
                              border: '1px solid #E2E8F0',
                            }}
                          >
                            {(sub.userName || 'C').charAt(0).toUpperCase()}
                          </Avatar>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#071A52', lineHeight: 1.2 }}>
                              {sub.userName}
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#64748B', fontSize: '0.71875rem' }}>
                              {sub.userEmail}
                            </Typography>
                          </Box>
                        </Box>
                      </TableCell>

                      <TableCell sx={{ py: 1.5 }}>
                        <Chip
                          label={sub.planName}
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            backgroundColor: 'rgba(7, 26, 82, 0.06)',
                            color: '#071A52',
                          }}
                        />
                      </TableCell>

                      <TableCell sx={{ py: 1.5, color: '#151C27', fontSize: '0.8125rem', fontWeight: 500 }}>
                        {effectiveEnd.toLocaleDateString()}
                      </TableCell>

                      <TableCell sx={{ py: 1.5 }}>{getStatusChip(daysRemaining)}</TableCell>

                      <TableCell align="right" sx={{ py: 1.5 }}>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => navigate(`/subscriptions/detail/${sub.id}`)}
                          sx={{
                            borderColor: '#E2E8F0',
                            color: '#071A52',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            height: 28,
                            borderRadius: '6px',
                            backgroundColor: '#FFFFFF',
                            '&:hover': { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
                          }}
                        >
                          Manage
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: '#64748B' }}>
              All candidate subscriptions are active with no expirations within the next 7 days.
            </Typography>
          </Box>
        )}
      </Paper>

      {/* Subscription Tools Section */}
      <Paper
        elevation={0}
        sx={{
          p: 3,
          borderRadius: 3.5,
          border: '1px solid #E2E8F0',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 700, color: '#071A52', fontSize: '1rem', mb: 0.5 }}>
          Subscription Tools & Batch Utilities
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.8125rem', mb: 2 }}>
          Bulk status synchronization, exam date alignment, and plan modification tools.
        </Typography>
        <SubscriptionTools />
      </Paper>
    </Box>
  );
};

export default SubscriptionDashboard;