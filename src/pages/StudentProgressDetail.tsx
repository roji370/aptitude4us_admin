import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  Collapse,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  PlayCircle as VideoIcon,
  Description as PdfIcon,
  StickyNote2 as NoteIcon,
  Headphones as AudioIcon,
  Image as ImageIcon,
  Link as LinkIcon,
  CheckCircle as CompletedIcon,
  HourglassTop as InProgressIcon,
  RadioButtonUnchecked as NotStartedIcon,
  NewReleases as UpdatedIcon,
  ArrowBack as ArrowBackIcon,
  Refresh as RefreshIcon,
  AccessTime as AccessTimeIcon,
  LocalFireDepartment as StreakIcon,
} from '@mui/icons-material';
import {
  getStudentProgressReport,
  getModuleContentProgress,
  resyncStudentProgress,
} from '../services/progressService';
import type {
  StudentProgressReport,
  ModuleProgressSummary,
  ContentItemProgress,
  ModuleDisplayStatus,
  CourseStatus,
  ContentStatus,
} from '../types/progress';
import { Timestamp } from 'firebase/firestore';

// ─── Helper Functions ────────────────────────────────────────────────────────

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

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getContentTypeIcon(contentType: string, size = 16): React.ReactNode {
  switch (contentType) {
    case 'video':
      return <VideoIcon sx={{ fontSize: size, color: '#1565C0' }} />;
    case 'pdf':
      return <PdfIcon sx={{ fontSize: size, color: '#E65100' }} />;
    case 'note':
      return <NoteIcon sx={{ fontSize: size, color: '#006B5F' }} />;
    case 'audio':
      return <AudioIcon sx={{ fontSize: size, color: '#6A1B9A' }} />;
    case 'image':
      return <ImageIcon sx={{ fontSize: size, color: '#0277BD' }} />;
    case 'link':
      return <LinkIcon sx={{ fontSize: size, color: '#757575' }} />;
    default:
      return <PdfIcon sx={{ fontSize: size, color: '#757575' }} />;
  }
}

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

// ─── Content Item Row ────────────────────────────────────────────────────────

interface ContentItemRowProps {
  item: ContentItemProgress;
}

const ContentItemRow: React.FC<ContentItemRowProps> = ({ item }) => {
  const renderProgressDetail = () => {
    switch (item.contentType) {
      case 'video': {
        const vp = item.videoProgress;
        if (!vp) return <Typography variant="caption" color="text.secondary">Views: {item.viewCount}</Typography>;
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary">
              {Math.round(vp.percentageWatched)}% watched
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Position: {formatDuration(vp.currentPosition)} / {formatDuration(vp.totalDuration)}
            </Typography>
            <Box sx={{ width: 80 }}>
              <LinearProgress
                variant="determinate"
                value={Math.min(vp.percentageWatched, 100)}
                sx={{
                  height: 4,
                  borderRadius: 2,
                  bgcolor: 'rgba(7, 26, 82, 0.08)',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: getProgressColor(vp.percentageWatched),
                    borderRadius: 2,
                  },
                }}
              />
            </Box>
          </Box>
        );
      }
      case 'pdf': {
        const dp = item.documentProgress;
        if (!dp) return <Typography variant="caption" color="text.secondary">Views: {item.viewCount}</Typography>;
        return (
          <Typography variant="caption" color="text.secondary">
            Page {dp.currentPage}/{dp.totalPages} ({Math.round(dp.percentageRead)}% read)
          </Typography>
        );
      }
      default:
        return (
          <Typography variant="caption" color="text.secondary">
            Views: {item.viewCount}
          </Typography>
        );
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        py: 1,
        px: 1.5,
        borderBottom: '1px solid #F1F5F9',
        '&:last-child': { borderBottom: 'none' },
        bgcolor: 'rgba(0, 0, 0, 0.01)',
      }}
    >
      {getContentTypeIcon(item.contentType)}
      <Box sx={{ flex: 1, ml: 1.5, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 500, color: '#071A52' }} noWrap>
            {item.contentId}
          </Typography>
          <StatusBadge status={item.status} size="small" />
        </Box>
        <Box sx={{ mt: 0.25 }}>
          {renderProgressDetail()}
        </Box>
      </Box>
      {item.lastAccessedAt && (
        <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1, whiteSpace: 'nowrap' }}>
          {formatTimestamp(item.lastAccessedAt)}
        </Typography>
      )}
    </Box>
  );
};

// ─── Module Row with Expandable Content ──────────────────────────────────────

interface ModuleRowProps {
  userId: string;
  moduleId: string;
  progress: ModuleProgressSummary;
  displayStatus: ModuleDisplayStatus;
}

const ModuleRow: React.FC<ModuleRowProps> = ({ userId, moduleId, progress, displayStatus }) => {
  const [expanded, setExpanded] = useState(false);
  const [contentItems, setContentItems] = useState<ContentItemProgress[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const handleToggle = useCallback(async () => {
    const newExpanded = !expanded;
    setExpanded(newExpanded);

    if (newExpanded && !loaded) {
      try {
        setLoadingContent(true);
        setContentError(null);
        const items = await getModuleContentProgress(userId, moduleId);
        setContentItems(items);
        setLoaded(true);
      } catch (err) {
        console.error('Error loading content items:', err);
        setContentError('Failed to load content items.');
      } finally {
        setLoadingContent(false);
      }
    }
  }, [expanded, loaded, userId, moduleId]);

  return (
    <Box
      sx={{
        borderBottom: '1px solid #F1F5F9',
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      {/* Module summary row */}
      <Box
        onClick={handleToggle}
        sx={{
          display: 'flex',
          alignItems: 'center',
          py: 1.5,
          px: 1,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'rgba(7, 26, 82, 0.02)' },
          transition: 'background-color 0.15s',
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
        <Box sx={{ textAlign: 'right', ml: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box>
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
          <ExpandMoreIcon
            sx={{
              fontSize: 18,
              color: 'text.secondary',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          />
        </Box>
      </Box>

      {/* Expandable content items */}
      <Collapse in={expanded}>
        <Box sx={{ pl: 4, pr: 1, pb: 1 }}>
          {loadingContent && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={20} />
            </Box>
          )}
          {contentError && (
            <Alert severity="error" sx={{ my: 1 }}>
              {contentError}
            </Alert>
          )}
          {loaded && contentItems.length === 0 && !loadingContent && (
            <Typography variant="caption" color="text.secondary" sx={{ py: 1, display: 'block' }}>
              No content items tracked yet.
            </Typography>
          )}
          {contentItems.map((item) => (
            <ContentItemRow key={item.contentId} item={item} />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
};

// ─── Streak History Heatmap ──────────────────────────────────────────────────

interface StreakHeatmapProps {
  streakHistory: Array<{ date: string; minutesActive: number }>;
}

const StreakHeatmap: React.FC<StreakHeatmapProps> = ({ streakHistory }) => {
  // Take last 30 entries
  const last30 = streakHistory.slice(-30);

  return (
    <Paper
      elevation={0}
      sx={{ p: 3, borderRadius: '16px', border: '1px solid #E2E8F0', bgcolor: '#FFFFFF' }}
    >
      <Typography variant="h6" sx={{ fontWeight: 600, color: '#071A52', mb: 2, display: 'flex', alignItems: 'center' }}>
        <StreakIcon sx={{ mr: 1, color: '#E65100' }} />
        Streak History (Last 30 Days)
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {last30.map((entry) => {
          const isActive = entry.minutesActive > 0;
          const dateLabel = new Date(entry.date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          });
          return (
            <Tooltip
              key={entry.date}
              title={`${dateLabel}: ${entry.minutesActive} min active`}
            >
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: '4px',
                  bgcolor: isActive
                    ? entry.minutesActive >= 60
                      ? '#006B5F'
                      : entry.minutesActive >= 30
                        ? 'rgba(0, 107, 95, 0.6)'
                        : 'rgba(0, 107, 95, 0.3)'
                    : '#E2E8F0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'default',
                  transition: 'transform 0.1s',
                  '&:hover': { transform: 'scale(1.2)' },
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: '0.55rem',
                    color: isActive ? '#FFFFFF' : '#94A3B8',
                    fontWeight: 600,
                  }}
                >
                  {new Date(entry.date).getDate()}
                </Typography>
              </Box>
            </Tooltip>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
        <Typography variant="caption" color="text.secondary">Less</Typography>
        <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: '#E2E8F0' }} />
        <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: 'rgba(0, 107, 95, 0.3)' }} />
        <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: 'rgba(0, 107, 95, 0.6)' }} />
        <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: '#006B5F' }} />
        <Typography variant="caption" color="text.secondary">More</Typography>
      </Box>
    </Paper>
  );
};

// ─── Main Page Component ─────────────────────────────────────────────────────

const StudentProgressDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<StudentProgressReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const loadProgress = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getStudentProgressReport(id);
      if (!data) {
        setError('Student progress data not found.');
        return;
      }
      setReport(data);
    } catch (err) {
      console.error('Error loading progress report:', err);
      setError('Failed to load student progress data.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!id) return;
      try {
        setLoading(true);
        setError(null);
        const data = await getStudentProgressReport(id);
        if (!cancelled) {
          if (!data) {
            setError('Student progress data not found.');
          } else {
            setReport(data);
          }
        }
      } catch (err) {
        console.error('Error loading progress report:', err);
        if (!cancelled) setError('Failed to load student progress data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id]);

  const handleResync = async (courseId: string) => {
    if (!id) return;
    try {
      setSyncing(courseId);
      await resyncStudentProgress(id, courseId);
      await loadProgress();
    } catch (err) {
      console.error('Error resyncing:', err);
      setError('Failed to resync progress.');
    } finally {
      setSyncing(null);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────

  if (error && !report) {
    return (
      <Box sx={{ mt: 4 }}>
        <Alert severity="error">{error}</Alert>
        <Button
          sx={{ mt: 2 }}
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(`/users/${id}`)}
        >
          Back to User
        </Button>
      </Box>
    );
  }

  const coursesCompleted = report?.courses.filter((c) => c.status === 'completed').length ?? 0;
  const coursesTotal = report?.courses.length ?? 0;

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* Non-blocking error */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Header bar */}
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
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <IconButton
            onClick={() => navigate(`/users/${id}`)}
            sx={{
              mr: 1.5,
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              color: '#071A52',
              '&:hover': {
                bgcolor: 'rgba(7, 26, 82, 0.04)',
                borderColor: '#CBD5E1',
              },
            }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Box>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700, color: '#071A52' }}>
              Student Progress
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
              {report?.user.displayName || 'Unknown Student'} — {report?.user.email || ''}
            </Typography>
          </Box>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadProgress}
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            borderColor: '#E2E8F0',
            color: '#071A52',
            borderRadius: '8px',
            '&:hover': {
              borderColor: '#CBD5E1',
              bgcolor: 'rgba(7, 26, 82, 0.04)',
            },
          }}
        >
          Refresh
        </Button>
      </Box>

      {/* Summary Stats Row */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <SummaryCard
            value={`${report?.examReadiness ?? 0}%`}
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
                {report?.streak?.currentStreak ?? 0}
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
            value={`${coursesCompleted}/${coursesTotal}`}
            label="Courses Done"
            bgcolor="rgba(7, 26, 82, 0.04)"
            borderColor="rgba(7, 26, 82, 0.12)"
            valueColor="#071A52"
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <SummaryCard
            value={report?.totalContentCompleted ?? 0}
            label="Items Completed"
            bgcolor="rgba(7, 26, 82, 0.04)"
            borderColor="rgba(7, 26, 82, 0.12)"
            valueColor="#071A52"
          />
        </Grid>
      </Grid>

      {/* Last Activity */}
      {report?.lastActivityAt && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, color: 'text.secondary' }}>
          <AccessTimeIcon sx={{ fontSize: 16, mr: 0.5 }} />
          <Typography variant="body2">Last active: {formatTimestamp(report.lastActivityAt)}</Typography>
        </Box>
      )}

      <Divider sx={{ mb: 3 }} />

      {/* Per-Course Accordions */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#071A52', mb: 1.5 }}>
        Course Progress Breakdown
      </Typography>

      {report?.courses.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No course progress data available yet.
        </Alert>
      )}

      {report?.courses.map((course) => (
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
                <ModuleRow
                  key={moduleId}
                  userId={id!}
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

      {/* Streak History */}
      {report?.streak && report.streak.streakHistory && report.streak.streakHistory.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <StreakHeatmap streakHistory={report.streak.streakHistory} />
        </Box>
      )}
    </Box>
  );
};

export default StudentProgressDetail;
