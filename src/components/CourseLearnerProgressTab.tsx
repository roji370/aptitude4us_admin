import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Chip,
  Button,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TableSortLabel,
  LinearProgress,
  CircularProgress,
  Alert,
  InputAdornment,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
  People as PeopleIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import { getCourseLearnerProgress } from '../services/progressService';
import type { CourseLearnerProgress } from '../types/progress';

interface CourseLearnerProgressTabProps {
  courseId: string;
}

type SortKey = 'name' | 'status' | 'completion' | 'lastActivity';
type SortDirection = 'asc' | 'desc';

const statusOrder: Record<string, number> = {
  completed: 0,
  in_progress: 1,
  reviewing: 2,
  not_started: 3,
};

const formatRelativeTime = (timestamp: Timestamp | null): string => {
  if (!timestamp) return 'Never';
  const now = Date.now();
  const then = timestamp.toMillis();
  const diffMs = now - then;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffSeconds < 60) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  return `${diffMonths}mo ago`;
};

const getStatusLabel = (status: string): string => {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'in_progress':
      return 'In Progress';
    case 'reviewing':
      return 'In Progress';
    case 'not_started':
    default:
      return 'Not Started';
  }
};

const getStatusStyle = (status: string): { color: string; bgcolor: string } => {
  switch (status) {
    case 'completed':
      return { color: '#006B5F', bgcolor: 'rgba(0, 107, 95, 0.1)' };
    case 'in_progress':
    case 'reviewing':
      return { color: '#1565C0', bgcolor: 'rgba(21, 101, 192, 0.1)' };
    case 'not_started':
    default:
      return { color: '#757575', bgcolor: 'rgba(0, 0, 0, 0.06)' };
  }
};

const CourseLearnerProgressTab: React.FC<CourseLearnerProgressTabProps> = ({ courseId }) => {
  const navigate = useNavigate();

  const [students, setStudents] = useState<CourseLearnerProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('completion');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getCourseLearnerProgress(courseId);
        setStudents(data);
      } catch (err) {
        console.error('Failed to load learner progress:', err);
        setError('Failed to load learner progress. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [courseId]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCourseLearnerProgress(courseId);
      setStudents(data);
    } catch (err) {
      console.error('Failed to load learner progress:', err);
      setError('Failed to load learner progress. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  // Filtered students
  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return students;
    const q = searchQuery.toLowerCase().trim();
    return students.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q)
    );
  }, [students, searchQuery]);

  // Sorted students
  const sortedStudents = useMemo(() => {
    const sorted = [...filteredStudents];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.displayName.localeCompare(b.displayName);
          break;
        case 'status':
          cmp =
            (statusOrder[a.courseProgress.status] ?? 99) -
            (statusOrder[b.courseProgress.status] ?? 99);
          break;
        case 'completion':
          cmp = a.courseProgress.completionPercentage - b.courseProgress.completionPercentage;
          break;
        case 'lastActivity': {
          const aTime = a.courseProgress.lastActivityAt?.toMillis?.() ?? 0;
          const bTime = b.courseProgress.lastActivityAt?.toMillis?.() ?? 0;
          cmp = aTime - bTime;
          break;
        }
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredStudents, sortKey, sortDirection]);

  // Paginated students
  const paginatedStudents = useMemo(() => {
    const start = page * rowsPerPage;
    return sortedStudents.slice(start, start + rowsPerPage);
  }, [sortedStudents, page, rowsPerPage]);

  // Aggregated stats
  const stats = useMemo(() => {
    const total = students.length;
    if (total === 0) {
      return { avgCompletion: 0, completed: 0, inProgress: 0, notStarted: 0, total: 0 };
    }
    let sumCompletion = 0;
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;

    for (const s of students) {
      sumCompletion += s.courseProgress.completionPercentage;
      switch (s.courseProgress.status) {
        case 'completed':
          completed++;
          break;
        case 'in_progress':
        case 'reviewing':
          inProgress++;
          break;
        case 'not_started':
        default:
          notStarted++;
          break;
      }
    }

    return {
      avgCompletion: Math.round(sumCompletion / total),
      completed,
      inProgress,
      notStarted,
      total,
    };
  }, [students]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection(key === 'completion' ? 'desc' : 'asc');
    }
  };

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleRowClick = (userId: string) => {
    navigate(`/users/${userId}/progress`);
  };

  // Loading state
  if (loading) {
    return (
      <Paper
        elevation={0}
        sx={{
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
          p: 6,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <CircularProgress size={40} sx={{ color: '#071A52' }} />
      </Paper>
    );
  }

  // Error state
  if (error) {
    return (
      <Paper
        elevation={0}
        sx={{
          borderRadius: '16px',
          border: '1px solid #E2E8F0',
          p: 3,
        }}
      >
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={handleRefresh}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      </Paper>
    );
  }

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: '16px',
        border: '1px solid #E2E8F0',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          px: 3,
          py: 2.5,
          borderBottom: '1px solid #E2E8F0',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <PeopleIcon sx={{ color: '#071A52', fontSize: 22 }} />
          <Typography variant="h6" sx={{ fontWeight: 700, color: '#071A52', fontSize: '1.0625rem' }}>
            Learner Progress
          </Typography>
          <Chip
            label={`${stats.total} student${stats.total !== 1 ? 's' : ''}`}
            size="small"
            sx={{
              height: 24,
              fontSize: '0.75rem',
              fontWeight: 700,
              backgroundColor: 'rgba(7, 26, 82, 0.08)',
              color: '#071A52',
            }}
          />
        </Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={<RefreshIcon sx={{ fontSize: 17 }} />}
          onClick={handleRefresh}
          sx={{
            borderColor: '#E2E8F0',
            color: '#071A52',
            fontWeight: 600,
            fontSize: '0.8125rem',
            borderRadius: '8px',
            backgroundColor: '#FFFFFF',
            '&:hover': { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
          }}
        >
          Refresh
        </Button>
      </Box>

      {/* Empty state */}
      {students.length === 0 ? (
        <Box sx={{ p: 3 }}>
          <Alert severity="info">No students enrolled in this course yet.</Alert>
        </Box>
      ) : (
        <>
          {/* Summary bar */}
          <Box
            sx={{
              display: 'flex',
              gap: 2,
              px: 3,
              py: 2,
              borderBottom: '1px solid #E2E8F0',
              flexWrap: 'wrap',
            }}
          >
            <Paper
              elevation={0}
              sx={{
                flex: 1,
                minWidth: 140,
                p: 2,
                borderRadius: '12px',
                backgroundColor: 'rgba(7, 26, 82, 0.03)',
                border: '1px solid #E2E8F0',
                textAlign: 'center',
              }}
            >
              <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>
                Avg. Completion
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#071A52', mt: 0.5 }}>
                {stats.avgCompletion}%
              </Typography>
            </Paper>
            <Paper
              elevation={0}
              sx={{
                flex: 1,
                minWidth: 140,
                p: 2,
                borderRadius: '12px',
                backgroundColor: 'rgba(0, 107, 95, 0.04)',
                border: '1px solid #E2E8F0',
                textAlign: 'center',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                <CheckCircleIcon sx={{ fontSize: 14, color: '#006B5F' }} />
                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>
                  Completed
                </Typography>
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#006B5F', mt: 0.5 }}>
                {stats.completed}
                <Typography component="span" variant="body2" sx={{ color: '#94A3B8', fontWeight: 600, ml: 0.5 }}>
                  / {stats.total}
                </Typography>
              </Typography>
            </Paper>
            <Paper
              elevation={0}
              sx={{
                flex: 1,
                minWidth: 140,
                p: 2,
                borderRadius: '12px',
                backgroundColor: 'rgba(21, 101, 192, 0.04)',
                border: '1px solid #E2E8F0',
                textAlign: 'center',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                <ScheduleIcon sx={{ fontSize: 14, color: '#1565C0' }} />
                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>
                  In Progress
                </Typography>
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#1565C0', mt: 0.5 }}>
                {stats.inProgress}
                <Typography component="span" variant="body2" sx={{ color: '#94A3B8', fontWeight: 600, ml: 0.5 }}>
                  / {stats.total}
                </Typography>
              </Typography>
            </Paper>
            <Paper
              elevation={0}
              sx={{
                flex: 1,
                minWidth: 140,
                p: 2,
                borderRadius: '12px',
                backgroundColor: 'rgba(0, 0, 0, 0.02)',
                border: '1px solid #E2E8F0',
                textAlign: 'center',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                <RadioButtonUncheckedIcon sx={{ fontSize: 14, color: '#757575' }} />
                <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600 }}>
                  Not Started
                </Typography>
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#757575', mt: 0.5 }}>
                {stats.notStarted}
                <Typography component="span" variant="body2" sx={{ color: '#94A3B8', fontWeight: 600, ml: 0.5 }}>
                  / {stats.total}
                </Typography>
              </Typography>
            </Paper>
          </Box>

          {/* Search filter */}
          <Box sx={{ px: 3, py: 2, borderBottom: '1px solid #E2E8F0' }}>
            <TextField
              size="small"
              placeholder="Search by student name or email…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(0);
              }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 20, color: '#94A3B8' }} />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{
                width: '100%',
                maxWidth: 400,
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                  backgroundColor: '#F8FAFC',
                  '& fieldset': { borderColor: '#E2E8F0' },
                  '&:hover fieldset': { borderColor: '#CBD5E1' },
                  '&.Mui-focused fieldset': { borderColor: '#071A52' },
                },
              }}
            />
          </Box>

          {/* Table */}
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: 'rgba(7, 26, 82, 0.03)' }}>
                  <TableCell sx={{ fontWeight: 700, color: '#071A52', fontSize: '0.8125rem' }}>
                    <TableSortLabel
                      active={sortKey === 'name'}
                      direction={sortKey === 'name' ? sortDirection : 'asc'}
                      onClick={() => handleSort('name')}
                    >
                      Student
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, color: '#071A52', fontSize: '0.8125rem' }}>
                    <TableSortLabel
                      active={sortKey === 'status'}
                      direction={sortKey === 'status' ? sortDirection : 'asc'}
                      onClick={() => handleSort('status')}
                    >
                      Status
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, color: '#071A52', fontSize: '0.8125rem', minWidth: 180 }}>
                    <TableSortLabel
                      active={sortKey === 'completion'}
                      direction={sortKey === 'completion' ? sortDirection : 'desc'}
                      onClick={() => handleSort('completion')}
                    >
                      Completion
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, color: '#071A52', fontSize: '0.8125rem' }}>
                    <TableSortLabel
                      active={sortKey === 'lastActivity'}
                      direction={sortKey === 'lastActivity' ? sortDirection : 'asc'}
                      onClick={() => handleSort('lastActivity')}
                    >
                      Last Activity
                    </TableSortLabel>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedStudents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 4, color: '#64748B' }}>
                      <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                        No students match your search.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedStudents.map((student) => {
                    const status = student.courseProgress.status;
                    const completion = student.courseProgress.completionPercentage;
                    const statusStyle = getStatusStyle(status);

                    return (
                      <TableRow
                        key={student.userId}
                        hover
                        onClick={() => handleRowClick(student.userId)}
                        sx={{
                          cursor: 'pointer',
                          '&:hover': { bgcolor: 'rgba(7, 26, 82, 0.02)' },
                        }}
                      >
                        {/* Student name + email */}
                        <TableCell>
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 700, color: '#071A52', lineHeight: 1.4 }}
                          >
                            {student.displayName || 'Unnamed Student'}
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#64748B' }}>
                            {student.email}
                          </Typography>
                        </TableCell>

                        {/* Status badge */}
                        <TableCell>
                          <Chip
                            label={getStatusLabel(status)}
                            size="small"
                            sx={{
                              height: 24,
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              color: statusStyle.color,
                              backgroundColor: statusStyle.bgcolor,
                            }}
                          />
                        </TableCell>

                        {/* Completion % with progress bar */}
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Box sx={{ flex: 1 }}>
                              <LinearProgress
                                variant="determinate"
                                value={completion}
                                sx={{
                                  height: 6,
                                  borderRadius: 3,
                                  backgroundColor: '#E2E8F0',
                                  '& .MuiLinearProgress-bar': {
                                    borderRadius: 3,
                                    backgroundColor:
                                      status === 'completed'
                                        ? '#006B5F'
                                        : status === 'not_started'
                                          ? '#BDBDBD'
                                          : '#1565C0',
                                  },
                                }}
                              />
                            </Box>
                            <Typography
                              variant="body2"
                              sx={{
                                fontWeight: 700,
                                color: '#071A52',
                                minWidth: 40,
                                textAlign: 'right',
                                fontSize: '0.8125rem',
                              }}
                            >
                              {completion}%
                            </Typography>
                          </Box>
                        </TableCell>

                        {/* Last activity */}
                        <TableCell>
                          <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.8125rem' }}>
                            {formatRelativeTime(student.courseProgress.lastActivityAt)}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination */}
          <TablePagination
            component="div"
            count={filteredStudents.length}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[10, 25, 50]}
            labelDisplayedRows={({ from, to, count }) =>
              `${from}–${to} of ${count} loaded student${count !== 1 ? 's' : ''}`
            }
            sx={{
              borderTop: '1px solid #E2E8F0',
              '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
                fontSize: '0.8125rem',
                color: '#64748B',
              },
            }}
          />
        </>
      )}
    </Paper>
  );
};

export default CourseLearnerProgressTab;
