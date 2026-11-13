import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  CircularProgress,
  Alert,
  Chip,
  LinearProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
  IconButton,
  Divider,
  Grid,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  PlayCircle as VideoIcon,
  Description as PdfIcon,
  StickyNote2 as NoteIcon,
  Headphones as AudioIcon,
  CheckCircle as CompletedIcon,
  HourglassTop as InProgressIcon,
  RadioButtonUnchecked as NotStartedIcon,
  TrendingUp as ReadinessIcon,
  LocalFireDepartment as StreakIcon,
  Refresh as RefreshIcon,
  AccessTime as LastActiveIcon,
  NewReleases as UpdatedIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  getStudentProgressReport,
  resyncStudentProgress,
} from '../services/progressService';
import type {
  StudentProgressReport,
  ModuleProgressSummary,
  CourseStatus,
  ContentStatus,
  ModuleDisplayStatus,
} from '../types/progress';
import { Timestamp } from 'firebase/firestore';

interface StudentProgressSectionProps {
  userId: string;
  displayName?: string;
}

/**
 * Determine the display status for a module, including the derived "updated" state.
 * A module shows "Updated" when the admin changed content AFTER the student completed it.
 * We check completedAt (not status) because status may regress to in_progress
 * when new content is added — but the student DID finish the old content.
 */
function getModuleDisplayStatus(
  mp: ModuleProgressSummary,
  moduleUpdatedAt: Timestamp | undefined
): ModuleDisplayStatus {
  if (
    mp.completedAt &&
    moduleUpdatedAt &&
    moduleUpdatedAt.toMillis() > mp.completedAt.toMillis()
  ) {
    return 'updated';
  }
  return mp.status;
}

const StudentProgressSection: React.FC<StudentProgressSectionProps> = ({
  userId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  displayName,
}) => {
  const navigate = useNavigate();
  const [report, setReport] = useState<StudentProgressReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const loadProgress = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getStudentProgressReport(userId);
      setReport(data);
    } catch (err) {
      console.error('Error loading progress:', err);
      setError('Failed to load student progress data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getStudentProgressReport(userId);
        if (!cancelled) setReport(data);
      } catch (err) {
        console.error('Error loading progress:', err);
        if (!cancelled) setError('Failed to load student progress data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [userId]);

  const handleResync = async (courseId: string) => {
    try {
      setSyncing(courseId);
      await resyncStudentProgress(userId, courseId);
      await loadProgress();
    } catch (err) {
      console.error('Error resyncing:', err);
      setError('Failed to resync progress.');
    } finally {
      setSyncing(null);
    }
  };

  // ── Loading / Error / Empty states ──────────────────────────────────────

  if (loading) {
    return (
      <Paper elevation={0} sx={{ p: 3.5, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper elevation={0} sx={{ p: 3.5, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
        <Alert severity="error">{error}</Alert>
      </Paper>
    );
  }

  if (!report || report.courses.length === 0) {
    return (
      <Paper elevation={0} sx={{ p: 3.5, borderRadius: '16px', border: '1px solid #E2E8F0' }}>
        <Typography
          variant="h6"
          sx={{ fontWeight: 600, color: '#071A52', mb: 1, display: 'flex', alignItems: 'center' }}
        >
          <ReadinessIcon sx={{ mr: 1, color: '#006B5F' }} />
          Learning Progress
        </Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          No progress data available yet. Progress will appear once the student starts accessing
          course content.
        </Alert>
      </Paper>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────

  return (
    <Paper
      elevation={0}
      sx={{ p: 3.5, borderRadius: '16px', border: '1px solid #E2E8F0', bgcolor: '#FFFFFF' }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography
          variant="h6"
          sx={{ fontWeight: 600, color: '#071A52', display: 'flex', alignItems: 'center' }}
        >
          <ReadinessIcon sx={{ mr: 1, color: '#006B5F' }} />
          Learning Progress
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            size="small"
            endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
            onClick={() => navigate(`/users/${userId}/progress`)}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              color: '#006B5F',
              fontSize: '0.8125rem',
              '&:hover': { bgcolor: 'rgba(0, 107, 95, 0.06)' },
            }}
          >
            View Full Progress
          </Button>
          <Tooltip title="Refresh progress data">
            <IconButton onClick={loadProgress} size="small">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <SummaryCard
            value={`${report.examReadiness}%`}
            label="Exam Readiness"
            bgcolor="rgba(0, 107, 95, 0.06)"
            borderColor="rgba(0, 107, 95, 0.15)"
            valueColor="#006B5F"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <SummaryCard
            value={
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <StreakIcon sx={{ mr: 0.5, fontSize: '1.5rem' }} />
                {report.streak?.currentStreak ?? 0}
              </Box>
            }
            label="Day Streak"
            bgcolor="rgba(255, 152, 0, 0.06)"
            borderColor="rgba(255, 152, 0, 0.15)"
            valueColor="#E65100"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <SummaryCard
            value={`${report.courses.filter((c) => c.status === 'completed').length}/${report.courses.length}`}
            label="Courses Done"
            bgcolor="rgba(7, 26, 82, 0.04)"
            borderColor="rgba(7, 26, 82, 0.12)"
            valueColor="#071A52"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <SummaryCard
            value={report.totalContentCompleted}
            label="Items Completed"
            bgcolor="rgba(7, 26, 82, 0.04)"
            borderColor="rgba(7, 26, 82, 0.12)"
            valueColor="#071A52"
          />
        </Grid>
      </Grid>

      {/* Last Activity */}
      {report.lastActivityAt && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, color: 'text.secondary' }}>
          <LastActiveIcon sx={{ fontSize: 16, mr: 0.5 }} />
          <Typography variant="body2">Last active: {formatTimestamp(report.lastActivityAt)}</Typography>
        </Box>
      )}

      <Divider sx={{ mb: 2 }} />

      {/* Per-Course Progress */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#071A52', mb: 1.5 }}>
        Course Progress Breakdown
      </Typography>

      {report.courses.map((course) => (
        <Accordion
          key={course.courseId}
          elevation={0}
          sx={{
            border: '1px solid #E2E8F0',
            borderRadius: '12px !important',
            mb: 1.5,
            '&:before': { display: 'none' },
            '&.Mui-expanded': { mb: 1.5 },
          }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1.5 }}>
              {getStatusIcon(course.status)}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: 600, color: '#071A52' }}
                    noWrap
                  >
                    {course.courseTitle}
                  </Typography>
                  <StatusBadge status={course.status} />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LinearProgress
                    variant="determinate"
                    value={course.completionPercentage}
                    sx={{
                      flex: 1,
                      height: 6,
                      borderRadius: 3,
                      bgcolor: 'rgba(7, 26, 82, 0.08)',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: getProgressColor(course.completionPercentage),
                        borderRadius: 3,
                      },
                    }}
                  />
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 600, color: '#071A52', minWidth: 35 }}
                  >
                    {course.completionPercentage}%
                  </Typography>
                </Box>
              </Box>
              <Tooltip title="Resync progress from content items">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleResync(course.courseId);
                  }}
                  disabled={syncing === course.courseId}
                >
                  {syncing === course.courseId ? (
                    <CircularProgress size={16} />
                  ) : (
                    <RefreshIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </Box>
          </AccordionSummary>

          <AccordionDetails sx={{ px: 2, pt: 0 }}>
            {Object.entries(course.moduleProgress || {}).length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                No module progress data yet.
              </Typography>
            ) : (
              Object.entries(course.moduleProgress).map(([moduleId, mp]) => (
                <ModuleProgressRow
                  key={moduleId}
                  moduleId={moduleId}
                  progress={mp}
                  displayStatus={getModuleDisplayStatus(
                    mp,
                    course.moduleUpdatedAtMap?.[moduleId]
                  )}
                />
              ))
            )}
          </AccordionDetails>
        </Accordion>
      ))}
    </Paper>
  );
};

// ─── Sub-Components ──────────────────────────────────────────────────────────

interface SummaryCardProps {
  value: React.ReactNode;
  label: string;
  bgcolor: string;
  borderColor: string;
  valueColor: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ value, label, bgcolor, borderColor, valueColor }) => (
  <Box sx={{ p: 2, borderRadius: '12px', bgcolor, border: `1px solid ${borderColor}`, textAlign: 'center' }}>
    <Typography variant="h4" sx={{ fontWeight: 700, color: valueColor }}>
      {value}
    </Typography>
    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
      {label}
    </Typography>
  </Box>
);

interface ModuleProgressRowProps {
  moduleId: string;
  progress: ModuleProgressSummary;
  displayStatus: ModuleDisplayStatus;
}

const ModuleProgressRow: React.FC<ModuleProgressRowProps> = ({
  moduleId,
  progress,
  displayStatus,
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        py: 1.5,
        px: 1,
        borderBottom: '1px solid #F1F5F9',
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      {getStatusIcon(displayStatus, 18)}
      <Box sx={{ flex: 1, ml: 1.5, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 500, color: '#071A52' }} noWrap>
            {moduleId}
          </Typography>
          <StatusBadge status={displayStatus} size="small" />
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, mt: 0.5, flexWrap: 'wrap' }}>
          <ContentCounter
            icon={<VideoIcon sx={{ fontSize: 14 }} />}
            done={progress.videosWatched}
            total={progress.videosTotal}
            label="Videos"
          />
          <ContentCounter
            icon={<PdfIcon sx={{ fontSize: 14 }} />}
            done={progress.pdfsRead}
            total={progress.pdfsTotal}
            label="PDFs"
          />
          <ContentCounter
            icon={<NoteIcon sx={{ fontSize: 14 }} />}
            done={progress.notesRead}
            total={progress.notesTotal}
            label="Notes"
          />
          {progress.audiosTotal > 0 && (
            <ContentCounter
              icon={<AudioIcon sx={{ fontSize: 14 }} />}
              done={progress.audiosListened}
              total={progress.audiosTotal}
              label="Audio"
            />
          )}
        </Box>
      </Box>
      <Box sx={{ textAlign: 'right', ml: 1 }}>
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, color: getProgressColor(progress.completionPercentage) }}
        >
          {progress.completionPercentage}%
        </Typography>
        {progress.lastAccessedAt && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {formatTimestamp(progress.lastAccessedAt)}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

interface ContentCounterProps {
  icon: React.ReactNode;
  done: number;
  total: number;
  label: string;
}

const ContentCounter: React.FC<ContentCounterProps> = ({ icon, done, total, label }) => {
  if (total === 0) return null;
  return (
    <Tooltip title={`${done}/${total} ${label}`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
        {icon}
        <Typography
          variant="caption"
          sx={{
            color: done === total ? '#006B5F' : 'text.secondary',
            fontWeight: done === total ? 600 : 400,
          }}
        >
          {done}/{total}
        </Typography>
      </Box>
    </Tooltip>
  );
};

interface StatusBadgeProps {
  status: CourseStatus | ContentStatus | ModuleDisplayStatus;
  size?: 'small' | 'medium';
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'medium' }) => {
  const config: Record<string, { label: string; color: string; bgcolor: string }> = {
    completed: {
      label: 'Completed',
      color: '#006B5F',
      bgcolor: 'rgba(0, 107, 95, 0.1)',
    },
    in_progress: {
      label: 'In Progress',
      color: '#1565C0',
      bgcolor: 'rgba(21, 101, 192, 0.1)',
    },
    not_started: {
      label: 'Not Started',
      color: '#757575',
      bgcolor: 'rgba(0, 0, 0, 0.06)',
    },
    reviewing: {
      label: 'Reviewing',
      color: '#E65100',
      bgcolor: 'rgba(230, 81, 0, 0.1)',
    },
    updated: {
      label: 'Updated',
      color: '#6A1B9A',
      bgcolor: 'rgba(106, 27, 154, 0.1)',
    },
  };

  const c = config[status] || config.not_started;

  return (
    <Chip
      label={c.label}
      size="small"
      sx={{
        fontWeight: 600,
        fontSize: size === 'small' ? '0.65rem' : '0.7rem',
        color: c.color,
        bgcolor: c.bgcolor,
        borderRadius: '6px',
        height: size === 'small' ? 18 : 22,
      }}
    />
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStatusIcon(status: string, size = 22): React.ReactNode {
  switch (status) {
    case 'completed':
      return <CompletedIcon sx={{ fontSize: size, color: '#006B5F' }} />;
    case 'in_progress':
      return <InProgressIcon sx={{ fontSize: size, color: '#1565C0' }} />;
    case 'updated':
      return <UpdatedIcon sx={{ fontSize: size, color: '#6A1B9A' }} />;
    default:
      return <NotStartedIcon sx={{ fontSize: size, color: '#BDBDBD' }} />;
  }
}

function getProgressColor(pct: number): string {
  if (pct >= 100) return '#006B5F';
  if (pct >= 60) return '#1565C0';
  if (pct >= 30) return '#E65100';
  return '#757575';
}

function formatTimestamp(ts: Timestamp | null): string {
  if (!ts) return '';
  try {
    const date = ts.toDate();
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours === 0) {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        return diffMins <= 1 ? 'Just now' : `${diffMins}m ago`;
      }
      return `${diffHours}h ago`;
    }
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return '';
  }
}

export default StudentProgressSection;
