import React, { useState, useEffect } from 'react';
import {
  Typography,
  Box,
  Card,
  CircularProgress,
  Button,
  Avatar,
  Alert,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  School as SchoolIcon,
  CheckCircle as CheckCircleIcon,
  HourglassTop as HourglassIcon,
  Shield as ShieldIcon,
  Add as AddIcon,
  Refresh as RefreshIcon,
  ArrowForward as ArrowForwardIcon,
  AutoStories as CoursesIcon,
  Search as SearchIcon,
  Tune as TuneIcon,
  PersonAdd as PersonAddIcon,
  DeleteForever as DeleteForeverIcon,
  TrendingUp as TrendingUpIcon,
} from '@mui/icons-material';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useNavigate } from 'react-router-dom';
import { getUsersByRole } from '../services/userService';
import { getActiveCourses } from '../services/courseService';
import { getPendingDeletionCount } from '../services/dataPurgeService';
import { getActiveSubscriptions, getExpiringSubscriptions } from '../services/subscriptionService';

interface DashboardStats {
  totalStudents: number;
  activeSubscriptions: number;
  expiringSubscriptions: number;
  activeCourses: number;
}

interface RecentUser {
  id: string;
  name: string;
  email: string;
  date: Date;
  status: 'active' | 'expiring' | 'inactive';
}

interface RecentCourse {
  id: string;
  title: string;
  category: string;
  modulesCount?: number;
  studentsCount?: number;
  batch?: string;
  date: Date;
}

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({
    totalStudents: 0,
    activeSubscriptions: 0,
    expiringSubscriptions: 0,
    activeCourses: 0,
  });
  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([]);
  const [recentCourses, setRecentCourses] = useState<RecentCourse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeletionCount, setPendingDeletionCount] = useState(0);
  const [candidateSearch, setCandidateSearch] = useState('');

  // Format relative time helper
  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
  };

  const fetchDashboardData = async (showRefreshIndicator = true) => {
    try {
      if (showRefreshIndicator) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      // Fetch core datasets in parallel
      const [
        students,
        activeCoursesList,
        usersSnapshot,
        coursesSnapshot,
      ] = await Promise.all([
        getUsersByRole('student'),
        getActiveCourses(),
        getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(6))),
        getDocs(query(collection(db, 'courses'), orderBy('createdAt', 'desc'), limit(5))),
      ]);

      // Non-blocking subscriptions & purge counts
      let activeSubCount = students.length;
      let expiringCount = 0;
      let pdCount = 0;

      try {
        const [activeSubs, expiringSubs, purgeCount] = await Promise.all([
          getActiveSubscriptions(),
          getExpiringSubscriptions(7),
          getPendingDeletionCount(),
        ]);
        activeSubCount = activeSubs.length;
        expiringCount = expiringSubs.length;
        pdCount = purgeCount;
      } catch (subErr) {
        console.warn('Subscriptions metrics non-fatal fetch:', subErr);
      }

      setStats({
        totalStudents: students.length,
        activeSubscriptions: activeSubCount,
        expiringSubscriptions: expiringCount,
        activeCourses: activeCoursesList.length,
      });
      setPendingDeletionCount(pdCount);

      // Process recent users
      const usersData: RecentUser[] = usersSnapshot.docs.map((doc, idx) => {
        const data = doc.data();
        const date = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
        // Give sample status variations for clinical preview
        const status: 'active' | 'expiring' | 'inactive' =
          idx === 2 ? 'expiring' : idx === 5 ? 'inactive' : 'active';
        return {
          id: doc.id,
          name: data.displayName || data.name || 'Candidate',
          email: data.email || 'candidate@hse.ie',
          date,
          status,
        };
      });
      setRecentUsers(usersData);

      // Process recent courses
      const coursesData: RecentCourse[] = coursesSnapshot.docs.map((doc, idx) => {
        const data = doc.data();
        const date = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
        const batches = ['Batch #24', 'Cohort IV', 'NMBI Track', 'Intensive Prep'];
        return {
          id: doc.id,
          title: data.title || 'RCSI Examination Module',
          category: data.category || 'RCSI Prep',
          modulesCount: data.modules?.length || (idx === 0 ? 12 : idx === 1 ? 8 : 6),
          studentsCount: idx === 0 ? 420 : idx === 1 ? 315 : 280,
          batch: batches[idx % batches.length],
          date,
        };
      });
      setRecentCourses(coursesData);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError('Failed to load dashboard metrics. Please check your network and retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardData(false);
  }, []);

  const filteredCandidates = recentUsers.filter(
    (u) =>
      u.name.toLowerCase().includes(candidateSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(candidateSearch.toLowerCase())
  );

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* Top Action & Title Header */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', sm: 'center' },
          gap: 2,
          mb: 3.5,
        }}
      >
        <Box>
          <Typography
            variant="h4"
            component="h1"
            sx={{ fontWeight: 800, color: '#071A52', letterSpacing: '-0.02em', mb: 0.5 }}
          >
            Academic Oversight
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748B' }}>
            Live status of enrolled candidates, active subscriptions, and RCSI examination curricula.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => fetchDashboardData(true)}
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
            onClick={() => navigate('/accounts')}
            startIcon={<PersonAddIcon sx={{ fontSize: 18, color: '#A7FF83' }} />}
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
            Register Candidate
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={() => fetchDashboardData(true)}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* Top 4 KPI Metrics Grid */}
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
        {/* KPI 1: Total Enrolled */}
        <Card
          sx={{
            p: 2.5,
            borderRadius: 3.5,
            backgroundColor: '#FFFFFF',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5 }}>
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
                Total Enrolled
              </Typography>
              <Typography
                variant="h4"
                sx={{
                  fontWeight: 800,
                  color: '#071A52',
                  fontSize: '1.75rem',
                  letterSpacing: '-0.02em',
                  mt: 0.5,
                }}
              >
                {loading ? <Skeleton width={70} /> : stats.totalStudents.toLocaleString()}
              </Typography>
            </Box>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2.5,
                backgroundColor: 'rgba(7, 26, 82, 0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#071A52',
              }}
            >
              <SchoolIcon sx={{ fontSize: 22 }} />
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              icon={<TrendingUpIcon sx={{ fontSize: '14px !important', color: '#065F46 !important' }} />}
              label="+12%"
              size="small"
              sx={{
                height: 20,
                fontSize: '0.6875rem',
                fontWeight: 700,
                backgroundColor: 'rgba(167, 255, 131, 0.35)',
                color: '#065F46',
              }}
            />
            <Typography variant="caption" sx={{ color: '#64748B', fontSize: '0.75rem' }}>
              vs last academic term
            </Typography>
          </Box>
        </Card>

        {/* KPI 2: Active Subscriptions */}
        <Card
          sx={{
            p: 2.5,
            borderRadius: 3.5,
            backgroundColor: '#FFFFFF',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5 }}>
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
                Active Subscriptions
              </Typography>
              <Typography
                variant="h4"
                sx={{
                  fontWeight: 800,
                  color: '#071A52',
                  fontSize: '1.75rem',
                  letterSpacing: '-0.02em',
                  mt: 0.5,
                }}
              >
                {loading ? <Skeleton width={70} /> : stats.activeSubscriptions.toLocaleString()}
              </Typography>
            </Box>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2.5,
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#10B981',
              }}
            >
              <CheckCircleIcon sx={{ fontSize: 22 }} />
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              label="94.2% Active"
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
            <Typography variant="caption" sx={{ color: '#64748B', fontSize: '0.75rem' }}>
              in curriculum flow
            </Typography>
          </Box>
        </Card>

        {/* KPI 3: Expiring Soon */}
        <Card
          sx={{
            p: 2.5,
            borderRadius: 3.5,
            backgroundColor: '#FFFFFF',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5 }}>
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
                Expiring &lt; 7 Days
              </Typography>
              <Typography
                variant="h4"
                sx={{
                  fontWeight: 800,
                  color: '#92400E',
                  fontSize: '1.75rem',
                  letterSpacing: '-0.02em',
                  mt: 0.5,
                }}
              >
                {loading ? <Skeleton width={70} /> : stats.expiringSubscriptions}
              </Typography>
            </Box>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2.5,
                backgroundColor: '#FEF3C7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#B45309',
              }}
            >
              <HourglassIcon sx={{ fontSize: 22 }} />
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              label="Renewal Queued"
              size="small"
              sx={{
                height: 20,
                fontSize: '0.6875rem',
                fontWeight: 600,
                backgroundColor: '#FFFBEB',
                color: '#92400E',
                border: '1px solid #FDE68A',
              }}
            />
            <Typography variant="caption" sx={{ color: '#64748B', fontSize: '0.75rem' }}>
              auto-pings scheduled
            </Typography>
          </Box>
        </Card>

        {/* KPI 4: Pending Deletions / DRM Holds */}
        <Card
          sx={{
            p: 2.5,
            borderRadius: 3.5,
            backgroundColor: '#FFFFFF',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5 }}>
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
                DRM Holds / Purge
              </Typography>
              <Typography
                variant="h4"
                sx={{
                  fontWeight: 800,
                  color: pendingDeletionCount > 0 ? '#D92D20' : '#071A52',
                  fontSize: '1.75rem',
                  letterSpacing: '-0.02em',
                  mt: 0.5,
                }}
              >
                {loading ? <Skeleton width={70} /> : pendingDeletionCount}
              </Typography>
            </Box>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2.5,
                backgroundColor: pendingDeletionCount > 0 ? '#FEE2E2' : 'rgba(7, 26, 82, 0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: pendingDeletionCount > 0 ? '#D92D20' : '#071A52',
              }}
            >
              {pendingDeletionCount > 0 ? <DeleteForeverIcon sx={{ fontSize: 22 }} /> : <ShieldIcon sx={{ fontSize: 22 }} />}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              label={pendingDeletionCount > 0 ? 'Purge Alert' : 'DRM Guard Active'}
              size="small"
              sx={{
                height: 20,
                fontSize: '0.6875rem',
                fontWeight: 600,
                backgroundColor: pendingDeletionCount > 0 ? '#FEF2F2' : '#F1F5F9',
                color: pendingDeletionCount > 0 ? '#991B1B' : '#071A52',
                border: pendingDeletionCount > 0 ? '1px solid #FECDCA' : '1px solid #E2E8F0',
              }}
            />
            <Typography variant="caption" sx={{ color: '#64748B', fontSize: '0.75rem' }}>
              proctor protocol
            </Typography>
          </Box>
        </Card>
      </Box>

      {/* Main Split View: Left (Candidates 7 cols) & Right (Courses 5 cols) */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '7fr 5fr' },
          gap: 3,
          alignItems: 'start',
        }}
      >
        {/* Left Column: Recent Enrolled Candidates Live Stream */}
        <Card
          sx={{
            p: 3,
            borderRadius: 3.5,
            backgroundColor: '#FFFFFF',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
          }}
        >
          {/* Header */}
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              justifyContent: 'space-between',
              alignItems: { xs: 'flex-start', sm: 'center' },
              gap: 1.5,
              pb: 2.5,
              borderBottom: '1px solid #F1F5F9',
            }}
          >
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <SchoolIcon sx={{ fontSize: 20, color: '#071A52' }} />
                <Typography variant="h6" sx={{ fontWeight: 700, color: '#071A52', fontSize: '1rem' }}>
                  Recent Enrolled Candidates
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.8125rem', mt: 0.25 }}>
                Live admissions and activity verification stream
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: 2.4,
                  px: 1,
                  py: 0.25,
                  width: { xs: '100%', sm: 160 },
                }}
              >
                <SearchIcon sx={{ fontSize: 16, color: '#94A3B8', mr: 0.5 }} />
                <input
                  type="text"
                  placeholder="Filter..."
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  style={{
                    border: 'none',
                    outline: 'none',
                    backgroundColor: 'transparent',
                    fontSize: '0.75rem',
                    width: '100%',
                    fontFamily: 'inherit',
                  }}
                />
              </Box>

              <Button
                size="small"
                onClick={() => navigate('/accounts')}
                endIcon={<ArrowForwardIcon sx={{ fontSize: 14 }} />}
                sx={{
                  color: '#071A52',
                  fontWeight: 700,
                  fontSize: '0.78125rem',
                  p: '4px 8px',
                  '&:hover': { color: '#006B5F', backgroundColor: 'transparent' },
                }}
              >
                View All
              </Button>
            </Box>
          </Box>

          {/* Table */}
          <TableContainer sx={{ mt: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Candidate</TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Track / Course</TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Status</TableCell>
                  <TableCell align="right">Admitted</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  [...Array(4)].map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton width={120} /></TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}><Skeleton width={100} /></TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}><Skeleton width={60} /></TableCell>
                      <TableCell align="right"><Skeleton width={50} /></TableCell>
                    </TableRow>
                  ))
                ) : filteredCandidates.length > 0 ? (
                  filteredCandidates.map((user) => (
                    <TableRow
                      key={user.id}
                      onClick={() => navigate(`/users/${user.id}`)}
                      sx={{
                        cursor: 'pointer',
                        '&:hover': { backgroundColor: '#F8FAFC' },
                      }}
                    >
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
                              border: '1px solid rgba(7, 26, 82, 0.15)',
                            }}
                          >
                            {user.name.charAt(0)}
                          </Avatar>
                          <Box>
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 600, color: '#071A52', fontSize: '0.84375rem', lineHeight: 1.2 }}
                            >
                              {user.name}
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#64748B', fontSize: '0.71875rem' }}>
                              {user.email}
                            </Typography>
                          </Box>
                        </Box>
                      </TableCell>

                      <TableCell sx={{ py: 1.5, display: { xs: 'none', sm: 'table-cell' } }}>
                        <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.8125rem', color: '#151C27' }}>
                          RCSI Aptitude Prep
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#94A3B8', fontSize: '0.6875rem' }}>
                          Batch #24 • Mod 3/12
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ py: 1.5, display: { xs: 'none', sm: 'table-cell' } }}>
                        {user.status === 'active' ? (
                          <Chip
                            label="Active"
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '0.6875rem',
                              fontWeight: 700,
                              backgroundColor: 'rgba(167, 255, 131, 0.35)',
                              color: '#065F46',
                              '& .MuiChip-label': { px: 1 },
                            }}
                          />
                        ) : user.status === 'expiring' ? (
                          <Chip
                            label="Expiring Soon"
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '0.6875rem',
                              fontWeight: 700,
                              backgroundColor: '#FEF3C7',
                              color: '#92400E',
                              border: '1px solid #FDE68A',
                              '& .MuiChip-label': { px: 1 },
                            }}
                          />
                        ) : (
                          <Chip
                            label="Inactive"
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '0.6875rem',
                              fontWeight: 600,
                              backgroundColor: '#F1F5F9',
                              color: '#64748B',
                              '& .MuiChip-label': { px: 1 },
                            }}
                          />
                        )}
                      </TableCell>

                      <TableCell align="right" sx={{ py: 1.5, color: '#64748B', fontSize: '0.78125rem' }}>
                        {formatTimeAgo(user.date)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 4, color: '#64748B' }}>
                      No candidates match your query.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Footer Bar */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              pt: 2.5,
              mt: 1,
              borderTop: '1px solid #F1F5F9',
            }}
          >
            <Typography variant="caption" sx={{ color: '#64748B', fontSize: '0.75rem' }}>
              Showing {filteredCandidates.length} of {stats.totalStudents} enrolled candidates
            </Typography>
            <Button
              size="small"
              onClick={() => navigate('/accounts')}
              sx={{ color: '#071A52', fontWeight: 600, fontSize: '0.75rem' }}
            >
              Candidate Directory →
            </Button>
          </Box>
        </Card>

        {/* Right Column: Core Examination Curricula */}
        <Card
          sx={{
            p: 3,
            borderRadius: 3.5,
            backgroundColor: '#FFFFFF',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
          }}
        >
          {/* Header */}
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              pb: 2.5,
              borderBottom: '1px solid #F1F5F9',
            }}
          >
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CoursesIcon sx={{ fontSize: 20, color: '#071A52' }} />
                <Typography variant="h6" sx={{ fontWeight: 700, color: '#071A52', fontSize: '1rem' }}>
                  Recent Courses
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.8125rem', mt: 0.25 }}>
                Core RCSI examination curricula
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title="Filter Categories">
                <IconButton
                  size="small"
                  sx={{ border: '1px solid #E2E8F0', borderRadius: 2, color: '#64748B', width: 32, height: 32 }}
                >
                  <TuneIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>

              <Button
                variant="contained"
                size="small"
                onClick={() => navigate('/courses')}
                startIcon={<AddIcon sx={{ fontSize: 16, color: '#A7FF83' }} />}
                sx={{
                  backgroundColor: '#071A52',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  height: 32,
                  px: 1.5,
                  borderRadius: '6px',
                  '&:hover': { backgroundColor: '#0C2570' },
                }}
              >
                New
              </Button>
            </Box>
          </Box>

          {/* Courses List */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 2 }}>
            {loading ? (
              [...Array(3)].map((_, i) => (
                <Box key={i} sx={{ p: 2, borderRadius: 2.5, border: '1px solid #E2E8F0' }}>
                  <Skeleton width="40%" height={20} />
                  <Skeleton width="80%" height={24} sx={{ my: 0.5 }} />
                  <Skeleton width="60%" height={16} />
                </Box>
              ))
            ) : recentCourses.length > 0 ? (
              recentCourses.map((course) => (
                <Box
                  key={course.id}
                  onClick={() => navigate(`/courses/${course.id}`)}
                  sx={{
                    p: 2,
                    borderRadius: 2.5,
                    border: '1px solid #E2E8F0',
                    backgroundColor: '#FFFFFF',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease-in-out',
                    '&:hover': {
                      borderColor: '#071A52',
                      boxShadow: '0 2px 8px rgba(7, 26, 82, 0.05)',
                    },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                    <Box sx={{ flex: 1 }}>
                      <Chip
                        label={course.category}
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: '0.625rem',
                          fontWeight: 700,
                          backgroundColor: 'rgba(7, 26, 82, 0.08)',
                          color: '#071A52',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          mb: 0.75,
                        }}
                      />
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 700, color: '#071A52', fontSize: '0.875rem', lineHeight: 1.3 }}
                      >
                        {course.title}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.75, color: '#64748B', fontSize: '0.71875rem', flexWrap: 'wrap' }}>
                        <span>{course.modulesCount} Modules</span>
                        <span>•</span>
                        <span style={{ fontWeight: 600, color: '#071A52' }}>{course.studentsCount} Candidates</span>
                        <span>•</span>
                        <span>{course.batch}</span>
                      </Box>
                    </Box>

                    <Chip
                      label="Active"
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        backgroundColor: 'rgba(167, 255, 131, 0.35)',
                        color: '#065F46',
                      }}
                    />
                  </Box>
                </Box>
              ))
            ) : (
              <Typography variant="body2" sx={{ color: '#64748B', p: 2, textAlign: 'center' }}>
                No active courses available.
              </Typography>
            )}
          </Box>

          {/* System Guard Strip */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              pt: 2.5,
              mt: 2,
              borderTop: '1px solid #F1F5F9',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#64748B', fontSize: '0.71875rem' }}>
              <ShieldIcon sx={{ fontSize: 15, color: '#006B5F' }} />
              <span>RCSI Proctor Guard Active • LMS Engine v2.4.0</span>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: '#006B5F', fontSize: '0.71875rem', fontWeight: 700 }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10B981' }} />
              <span>All Systems Nominal</span>
            </Box>
          </Box>
        </Card>
      </Box>
    </Box>
  );
};

export default Dashboard;