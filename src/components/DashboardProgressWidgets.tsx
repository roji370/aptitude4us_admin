import React, { useState, useEffect, useCallback } from 'react';
import {
  Typography,
  Box,
  Card,
  Avatar,
  Chip,
  Skeleton,
  CircularProgress,
  List,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Button,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  WarningAmber as WarningAmberIcon,
  LocalFireDepartment as LocalFireDepartmentIcon,
  TrendingUp as TrendingUpIcon,
  Refresh as RefreshIcon,
  ErrorOutlineOutlined as ErrorOutlineIcon,
} from '@mui/icons-material';
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  getAggregateFromServer,
  getCountFromServer,
  average,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useNavigate } from 'react-router-dom';

// ── Config constants ────────────────────────────────────────────────────────────
const AT_RISK_INACTIVITY_DAYS = 7;
const AT_RISK_READINESS_THRESHOLD = 40;

// ── Types ───────────────────────────────────────────────────────────────────────
interface DashboardProgressWidgetsProps {
  loading: boolean;
}

interface AtRiskStudent {
  id: string;
  name: string;
  reason: string;
}

interface StreakStudent {
  id: string;
  name: string;
  streak: number;
}

interface ReadinessData {
  avg: number;
  count: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

const getReadinessColor = (value: number): string => {
  if (value >= 70) return '#16A34A';
  if (value >= 40) return '#D97706';
  return '#DC2626';
};

const getReadinessLabel = (value: number): string => {
  if (value >= 70) return 'On Track';
  if (value >= 40) return 'Needs Focus';
  return 'At Risk';
};

// ── Card style (matches Dashboard KPI cards) ────────────────────────────────────
const cardSx = {
  p: 2.5,
  borderRadius: 3.5,
  backgroundColor: '#FFFFFF',
  border: '1px solid #E2E8F0',
  boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
  height: '100%',
  display: 'flex',
  flexDirection: 'column' as const,
};

// ── Component ───────────────────────────────────────────────────────────────────
const DashboardProgressWidgets: React.FC<DashboardProgressWidgetsProps> = ({ loading: parentLoading }) => {
  const navigate = useNavigate();

  // Per-widget state
  const [atRiskStudents, setAtRiskStudents] = useState<AtRiskStudent[]>([]);
  const [atRiskLoading, setAtRiskLoading] = useState(true);
  const [atRiskError, setAtRiskError] = useState<string | null>(null);

  const [streakStudents, setStreakStudents] = useState<StreakStudent[]>([]);
  const [streakLoading, setStreakLoading] = useState(true);
  const [streakError, setStreakError] = useState<string | null>(null);

  const [readiness, setReadiness] = useState<ReadinessData>({ avg: 0, count: 0 });
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState<string | null>(null);

  // ── At-Risk Students ────────────────────────────────────────────────
  const fetchAtRisk = useCallback(async () => {
    try {
      setAtRiskLoading(true);
      setAtRiskError(null);

      const q = query(collection(db, 'users'), where('role', '==', 'student'));
      const snapshot = await getDocs(q);

      const now = new Date();
      const cutoff = new Date(now.getTime() - AT_RISK_INACTIVITY_DAYS * 24 * 60 * 60 * 1000);

      const results: AtRiskStudent[] = [];

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const name = data.displayName || data.name || 'Unknown';
        const lastActivity = data.lastActivityAt?.toDate?.() ?? null;
        const examReadiness: number | undefined = data.examReadiness;

        if (!lastActivity) {
          results.push({ id: doc.id, name, reason: 'Never started' });
        } else if (lastActivity < cutoff) {
          const daysInactive = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
          results.push({ id: doc.id, name, reason: `Inactive ${daysInactive}d` });
        } else if (examReadiness !== undefined && examReadiness < AT_RISK_READINESS_THRESHOLD) {
          results.push({ id: doc.id, name, reason: `Readiness ${Math.round(examReadiness)}%` });
        }
      });

      setAtRiskStudents(results.slice(0, 5));
    } catch (err) {
      console.error('Error fetching at-risk students:', err);
      setAtRiskError('Failed to load at-risk data');
    } finally {
      setAtRiskLoading(false);
    }
  }, []);

  // ── Most Active (Streaks) ───────────────────────────────────────────
  const fetchStreaks = useCallback(async () => {
    try {
      setStreakLoading(true);
      setStreakError(null);

      // orderBy('currentStreak') only returns docs where the field exists,
      // so this returns [] before any student has activity. That's correct.
      const q = query(
        collection(db, 'users'),
        where('role', '==', 'student'),
        orderBy('currentStreak', 'desc'),
        limit(10),
      );
      const snapshot = await getDocs(q);

      const results: StreakStudent[] = snapshot.docs
        .map((d) => ({
          id: d.id,
          name: d.data().displayName || d.data().name || 'Unknown',
          streak: d.data().currentStreak ?? 0,
        }))
        .filter((s) => s.streak > 0)
        .slice(0, 5);

      setStreakStudents(results);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      const msg = (err as { message?: string })?.message ?? '';
      console.error('Error fetching streak students:', err);
      if (code === 'failed-precondition' && msg.includes('index')) {
        setStreakError('Index still building — retry shortly');
      } else {
        setStreakError('Failed to load streak data');
      }
    } finally {
      setStreakLoading(false);
    }
  }, []);

  // ── Average Readiness ───────────────────────────────────────────────
  const fetchReadiness = useCallback(async () => {
    try {
      setReadinessLoading(true);
      setReadinessError(null);

      const q = query(collection(db, 'users'), where('role', '==', 'student'));

      const [aggregateSnapshot, countSnapshot] = await Promise.all([
        getAggregateFromServer(q, { avgReadiness: average('examReadiness') }),
        getCountFromServer(q),
      ]);

      const avg = aggregateSnapshot.data().avgReadiness ?? 0;
      const count = countSnapshot.data().count;
      setReadiness({ avg: Math.round(avg), count });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      const msg = (err as { message?: string })?.message ?? '';
      console.error('Error fetching readiness data:', err);
      if (code === 'failed-precondition' && msg.includes('index')) {
        setReadinessError('Index still building — retry shortly');
      } else {
        setReadinessError('Failed to load readiness');
      }
    } finally {
      setReadinessLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.allSettled([fetchAtRisk(), fetchStreaks(), fetchReadiness()]);
  }, [fetchAtRisk, fetchStreaks, fetchReadiness]);

  // ── Shared sub-components ─────────────────────────────────────────────────
  const renderCardHeader = (
    title: string,
    icon: React.ReactNode,
    iconBgColor: string,
    iconColor: string,
    badge?: string,
  ) => (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
      <Box>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            fontSize: '0.6875rem',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: '#64748B',
          }}
        >
          {title}
        </Typography>
        {badge && (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              mt: 0.5,
              fontWeight: 700,
              color: '#071A52',
              fontSize: '1.125rem',
              letterSpacing: '-0.01em',
            }}
          >
            {badge}
          </Typography>
        )}
      </Box>
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: 2.5,
          backgroundColor: iconBgColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: iconColor,
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
    </Box>
  );

  const renderSkeletonList = (count = 3) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
      {[...Array(count)].map((_, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Skeleton variant="circular" width={36} height={36} />
          <Box sx={{ flex: 1 }}>
            <Skeleton width="60%" height={16} />
            <Skeleton width="40%" height={14} sx={{ mt: 0.5 }} />
          </Box>
        </Box>
      ))}
    </Box>
  );

  const renderErrorState = (message: string, onRetry: () => void) => (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minHeight: 120,
        gap: 1.5,
        py: 2,
      }}
    >
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          backgroundColor: '#FEF2F2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ErrorOutlineIcon sx={{ fontSize: 22, color: '#DC2626' }} />
      </Box>
      <Typography
        variant="body2"
        sx={{
          color: '#64748B',
          textAlign: 'center',
          fontSize: '0.8125rem',
          fontWeight: 500,
          lineHeight: 1.4,
        }}
      >
        {message}
      </Typography>
      <Button
        variant="outlined"
        size="small"
        onClick={onRetry}
        startIcon={<RefreshIcon sx={{ fontSize: 14 }} />}
        sx={{
          borderColor: '#E2E8F0',
          color: '#071A52',
          fontWeight: 600,
          fontSize: '0.75rem',
          height: 30,
          borderRadius: '6px',
          textTransform: 'none',
          '&:hover': { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
        }}
      >
        Retry
      </Button>
    </Box>
  );

  const renderEmpty = (message: string) => (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minHeight: 120,
      }}
    >
      <Typography variant="body2" sx={{ color: '#94A3B8', textAlign: 'center', fontSize: '0.8125rem' }}>
        {message}
      </Typography>
    </Box>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ mb: 3 }}>
      {/* Section Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
        }}
      >
        <Box>
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 700,
              color: '#071A52',
              fontSize: '0.9375rem',
              letterSpacing: '-0.01em',
            }}
          >
            Progress Insights
          </Typography>
          <Typography variant="caption" sx={{ color: '#94A3B8', fontSize: '0.75rem' }}>
            Student engagement and readiness overview
          </Typography>
        </Box>
        <Tooltip title="Refresh progress data">
          <IconButton
            size="small"
            onClick={() => {
              Promise.allSettled([fetchAtRisk(), fetchStreaks(), fetchReadiness()]);
            }}
            sx={{
              border: '1px solid #E2E8F0',
              borderRadius: 2,
              color: '#64748B',
              width: 32,
              height: 32,
              '&:hover': { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1' },
            }}
          >
            <RefreshIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Cards Grid */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            lg: 'repeat(3, 1fr)',
          },
          gap: 2.5,
        }}
      >
        {/* Card 1: At-Risk Students */}
        <Card sx={cardSx}>
          {renderCardHeader(
            'At Risk',
            <WarningAmberIcon sx={{ fontSize: 22 }} />,
            '#FEF3C7',
            '#D97706',
            atRiskLoading
              ? undefined
              : `${atRiskStudents.length} student${atRiskStudents.length !== 1 ? 's' : ''}`,
          )}

          {atRiskLoading || parentLoading ? (
            renderSkeletonList(3)
          ) : atRiskError ? (
            renderErrorState(atRiskError, fetchAtRisk)
          ) : atRiskStudents.length === 0 ? (
            renderEmpty('No at-risk students 🎉')
          ) : (
            <List disablePadding sx={{ mx: -1 }}>
              {atRiskStudents.map((student) => (
                <ListItemButton
                  key={student.id}
                  onClick={() => navigate(`/users/${student.id}`)}
                  sx={{
                    borderRadius: 2,
                    py: 1,
                    px: 1,
                    '&:hover': { backgroundColor: '#F8FAFC' },
                  }}
                >
                  <ListItemAvatar sx={{ minWidth: 44 }}>
                    <Avatar
                      sx={{
                        width: 36,
                        height: 36,
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        backgroundColor: 'rgba(217, 119, 6, 0.10)',
                        color: '#92400E',
                        border: '1px solid rgba(217, 119, 6, 0.20)',
                      }}
                    >
                      {getInitials(student.name)}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={student.name}
                    primaryTypographyProps={{
                      variant: 'body2',
                      fontWeight: 600,
                      color: '#071A52',
                      fontSize: '0.84375rem',
                      noWrap: true,
                    }}
                  />
                  <Chip
                    label={student.reason}
                    size="small"
                    sx={{
                      height: 22,
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      backgroundColor: '#FEF3C7',
                      color: '#92400E',
                      border: '1px solid #FDE68A',
                      '& .MuiChip-label': { px: 1 },
                      flexShrink: 0,
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Card>

        {/* Card 2: Most Active (Streaks) */}
        <Card sx={cardSx}>
          {renderCardHeader(
            'Most Active',
            <LocalFireDepartmentIcon sx={{ fontSize: 22 }} />,
            '#FEF3C7',
            '#D97706',
          )}

          {streakLoading || parentLoading ? (
            renderSkeletonList(3)
          ) : streakError ? (
            renderErrorState(streakError, fetchStreaks)
          ) : streakStudents.length === 0 ? (
            renderEmpty('No streak data yet')
          ) : (
            <List disablePadding sx={{ mx: -1 }}>
              {streakStudents.map((student, index) => (
                <ListItemButton
                  key={student.id}
                  onClick={() => navigate(`/users/${student.id}`)}
                  sx={{
                    borderRadius: 2,
                    py: 1,
                    px: 1,
                    '&:hover': { backgroundColor: '#F8FAFC' },
                  }}
                >
                  <ListItemAvatar sx={{ minWidth: 44 }}>
                    <Avatar
                      sx={{
                        width: 36,
                        height: 36,
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        backgroundColor:
                          index === 0
                            ? 'rgba(217, 119, 6, 0.15)'
                            : 'rgba(217, 119, 6, 0.08)',
                        color: '#92400E',
                        border:
                          index === 0
                            ? '1.5px solid rgba(217, 119, 6, 0.30)'
                            : '1px solid rgba(217, 119, 6, 0.15)',
                      }}
                    >
                      {getInitials(student.name)}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={student.name}
                    primaryTypographyProps={{
                      variant: 'body2',
                      fontWeight: 600,
                      color: '#071A52',
                      fontSize: '0.84375rem',
                      noWrap: true,
                    }}
                  />
                  <Chip
                    label={`🔥 ${student.streak}d`}
                    size="small"
                    sx={{
                      height: 22,
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      backgroundColor: index === 0 ? '#FEF3C7' : '#FFFBEB',
                      color: '#92400E',
                      border: `1px solid ${index === 0 ? '#FDE68A' : '#FEF3C7'}`,
                      '& .MuiChip-label': { px: 1 },
                      flexShrink: 0,
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Card>

        {/* Card 3: Average Readiness */}
        <Card sx={cardSx}>
          {renderCardHeader(
            'Avg. Exam Readiness',
            <TrendingUpIcon sx={{ fontSize: 22 }} />,
            'rgba(0, 107, 95, 0.10)',
            '#006B5F',
          )}

          {readinessLoading || parentLoading ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                minHeight: 140,
                gap: 1.5,
              }}
            >
              <Skeleton variant="circular" width={100} height={100} />
              <Skeleton width={90} height={14} />
            </Box>
          ) : readinessError ? (
            renderErrorState(readinessError, fetchReadiness)
          ) : (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                minHeight: 140,
                gap: 1.5,
              }}
            >
              <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                {/* Background track */}
                <CircularProgress
                  variant="determinate"
                  value={100}
                  size={100}
                  thickness={4}
                  sx={{ color: '#F1F5F9', position: 'absolute' }}
                />
                {/* Foreground value */}
                <CircularProgress
                  variant="determinate"
                  value={Math.min(readiness.avg, 100)}
                  size={100}
                  thickness={4}
                  sx={{
                    color: getReadinessColor(readiness.avg),
                    '& .MuiCircularProgress-circle': {
                      strokeLinecap: 'round',
                    },
                  }}
                />
                <Box
                  sx={{
                    top: 0,
                    left: 0,
                    bottom: 0,
                    right: 0,
                    position: 'absolute',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Typography
                    variant="h4"
                    sx={{
                      fontWeight: 800,
                      color: getReadinessColor(readiness.avg),
                      fontSize: '1.5rem',
                      letterSpacing: '-0.02em',
                      lineHeight: 1,
                    }}
                  >
                    {readiness.avg}%
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ textAlign: 'center' }}>
                <Chip
                  label={getReadinessLabel(readiness.avg)}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    backgroundColor:
                      readiness.avg >= 70
                        ? 'rgba(167, 255, 131, 0.35)'
                        : readiness.avg >= 40
                          ? '#FEF3C7'
                          : '#FEF2F2',
                    color:
                      readiness.avg >= 70
                        ? '#065F46'
                        : readiness.avg >= 40
                          ? '#92400E'
                          : '#991B1B',
                    mb: 0.75,
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    color: '#94A3B8',
                    fontSize: '0.75rem',
                  }}
                >
                  across {readiness.count} student{readiness.count !== 1 ? 's' : ''}
                </Typography>
              </Box>
            </Box>
          )}
        </Card>
      </Box>
    </Box>
  );
};

export default DashboardProgressWidgets;
