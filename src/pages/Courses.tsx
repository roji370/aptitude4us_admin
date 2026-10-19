import React, { useState, useEffect } from 'react';
import {
  Typography,
  Paper,
  Box,
  Card,
  CardContent,
  CardActions,
  Button,
  IconButton,
  TextField,
  InputAdornment,
  CircularProgress,
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
} from '@mui/material';
import {
  Search as SearchIcon,
  Add as AddIcon,
  Edit as EditIcon,
  PushPin as PinIcon,
  PushPinOutlined as PinOutlinedIcon,
  AutoStories as CoursesIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { Link, useNavigate } from 'react-router-dom';
import {
  getCourses,
  createCourse,
  getAssignedCourses,
  getModuleStatsForCourses,
  toggleCoursePinStatus,
} from '../services/courseService';
import type { Course, ModuleStats } from '../services/courseService';
import { useAuth } from '../context/AuthContext';
import { validateId } from '../utils/idGenerator';

const Courses: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [moduleStats, setModuleStats] = useState<Record<string, ModuleStats>>({});
  const [loading, setLoading] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [openDialog, setOpenDialog] = useState(false);
  const [newCourse, setNewCourse] = useState({
    title: '',
    description: '',
    category: 'General',
    isActive: true,
    isPublished: true,
  });
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { currentUser, isAdmin } = useAuth();
  const [idValidationWarning, setIdValidationWarning] = useState<string | null>(null);

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        let coursesData: Course[] = [];

        if (isAdmin) {
          coursesData = await getCourses();
        } else if (currentUser) {
          coursesData = await getAssignedCourses(currentUser.uid);
        }

        setCourses(coursesData);

        if (coursesData.length > 0) {
          setLoadingStats(true);
          const courseIds = coursesData.map((course) => course.id);
          const stats = await getModuleStatsForCourses(courseIds);
          setModuleStats(stats);
          setLoadingStats(false);
        }
      } catch (error) {
        console.error('Error fetching courses:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCourses();
  }, [currentUser, isAdmin]);

  const filteredCourses = courses
    .filter(
      (course) =>
        course.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        course.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        course.category.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return a.title.localeCompare(b.title);
    });

  const handleOpenDialog = () => {
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setNewCourse({
      title: '',
      description: '',
      category: 'General',
      isActive: true,
      isPublished: true,
    });
    setIdValidationWarning(null);
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | SelectChangeEvent
  ) => {
    const { name, value } = e.target;
    setNewCourse((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleCreateCourse = async () => {
    if (!newCourse.title.trim()) return;

    setCreating(true);
    try {
      const courseId = await createCourse(newCourse);
      const validation = validateId(courseId, 'course');
      if (!validation.isValid) {
        setIdValidationWarning(validation.error || 'Course ID contains unusual characters.');
      }
      handleCloseDialog();
      const updatedCourses = await getCourses();
      setCourses(updatedCourses);
      navigate(`/courses/${courseId}`);
    } catch (error) {
      console.error('Error creating course:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleTogglePin = async (courseId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const updatedCourse = await toggleCoursePinStatus(courseId);
      setCourses((prevCourses) =>
        prevCourses.map((c) => (c.id === courseId ? { ...c, isPinned: updatedCourse.isPinned } : c))
      );
    } catch (error) {
      console.error('Error toggling pin status:', error);
    }
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* Top Header */}
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
            <CoursesIcon sx={{ fontSize: 26, color: '#071A52' }} />
            <Typography variant="h4" component="h1" sx={{ fontWeight: 800, color: '#071A52', letterSpacing: '-0.02em' }}>
              {isAdmin ? 'Examination Curricula' : 'Assigned Curricula'}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: '#64748B', mt: 0.5 }}>
            Manage RCSI preparation tracks, modules, clinical guidelines, and test simulations.
          </Typography>
        </Box>

        {isAdmin && (
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon sx={{ color: '#A7FF83', fontSize: 18 }} />}
            onClick={handleOpenDialog}
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
            New Curriculum
          </Button>
        )}
      </Box>

      {/* Search Toolbar */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 3.5,
          borderRadius: 3.5,
          border: '1px solid #E2E8F0',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
        }}
      >
        <TextField
          fullWidth
          size="small"
          placeholder="Search curricula by title, category, or syllabus description..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: '#94A3B8', fontSize: 20 }} />
                </InputAdornment>
              ),
              sx: {
                borderRadius: 2,
                fontSize: '0.84375rem',
                backgroundColor: '#F8FAFC',
              },
            },
          }}
        />
      </Paper>

      {/* Courses Cards Grid */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={40} sx={{ color: '#071A52' }} />
        </Box>
      ) : filteredCourses.length === 0 ? (
        <Paper
          elevation={0}
          sx={{
            p: 6,
            textAlign: 'center',
            borderRadius: 3.5,
            border: '1px solid #E2E8F0',
            backgroundColor: '#FFFFFF',
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 700, color: '#071A52', mb: 1 }}>
            {isAdmin ? 'No curricula match your search' : 'No curricula assigned yet'}
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
            {searchTerm
              ? 'Try modifying your search term or clear the filter.'
              : isAdmin
              ? 'Click "New Curriculum" to publish your first examination course.'
              : 'Contact an administrator to request access to preparation tracks.'}
          </Typography>
          {isAdmin && !searchTerm && (
            <Button
              variant="contained"
              startIcon={<AddIcon sx={{ color: '#A7FF83' }} />}
              onClick={handleOpenDialog}
              sx={{ backgroundColor: '#071A52', color: '#FFFFFF', fontWeight: 600 }}
            >
              Create First Curriculum
            </Button>
          )}
        </Paper>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              md: 'repeat(2, 1fr)',
              lg: 'repeat(3, 1fr)',
            },
            gap: 3,
          }}
        >
          {filteredCourses.map((course) => {
            const stats = moduleStats[course.id];
            return (
              <Card
                key={course.id}
                onClick={() => navigate(`/courses/${course.id}`)}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  borderRadius: 3.5,
                  border: '1px solid',
                  borderColor: course.isPinned ? '#071A52' : '#E2E8F0',
                  backgroundColor: '#FFFFFF',
                  boxShadow: course.isPinned
                    ? '0 4px 16px rgba(7, 26, 82, 0.08)'
                    : '0 1px 3px rgba(7, 26, 82, 0.04)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease-in-out',
                  position: 'relative',
                  overflow: 'hidden',
                  '&:hover': {
                    borderColor: '#071A52',
                    boxShadow: '0 6px 20px rgba(7, 26, 82, 0.08)',
                    transform: 'translateY(-2px)',
                  },
                }}
              >
                {/* Active Indicator Top Stripe */}
                {course.isPinned && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 3,
                      backgroundColor: '#A7FF83',
                    }}
                  />
                )}

                <CardContent sx={{ p: 2.75, flexGrow: 1 }}>
                  {/* Top Category & Pin Row */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                    <Chip
                      label={course.category}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.65625rem',
                        fontWeight: 700,
                        backgroundColor: 'rgba(7, 26, 82, 0.08)',
                        color: '#071A52',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    />

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Tooltip title={course.isPinned ? 'Unpin curriculum' : 'Pin curriculum'} arrow>
                        <IconButton
                          size="small"
                          onClick={(e) => handleTogglePin(course.id, e)}
                          sx={{
                            color: course.isPinned ? '#071A52' : '#94A3B8',
                            p: 0.5,
                            '&:hover': { color: '#071A52', backgroundColor: '#F1F5F9' },
                          }}
                        >
                          {course.isPinned ? <PinIcon fontSize="small" /> : <PinOutlinedIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>

                      {isAdmin && (
                        <Chip
                          label={course.isActive ? 'Active' : 'Archived'}
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            backgroundColor: course.isActive ? '#ECFDF5' : '#F1F5F9',
                            color: course.isActive ? '#065F46' : '#64748B',
                            border: course.isActive ? '1px solid #A7F3D0' : '1px solid #E2E8F0',
                          }}
                        />
                      )}
                    </Box>
                  </Box>

                  {/* Title & Description */}
                  <Typography
                    variant="h6"
                    sx={{
                      fontWeight: 700,
                      color: '#071A52',
                      fontSize: '1rem',
                      lineHeight: 1.3,
                      mb: 1,
                    }}
                  >
                    {course.title}
                  </Typography>

                  <Typography
                    variant="body2"
                    sx={{
                      color: '#64748B',
                      fontSize: '0.8125rem',
                      lineHeight: 1.45,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      mb: 2,
                    }}
                  >
                    {course.description || 'No detailed syllabus synopsis provided.'}
                  </Typography>

                  {/* Module Statistics Strip */}
                  <Box
                    sx={{
                      p: 1.5,
                      borderRadius: 2.5,
                      backgroundColor: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 1,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CoursesIcon sx={{ fontSize: 16, color: '#006B5F' }} />
                      <Typography variant="body2" sx={{ fontWeight: 700, color: '#071A52', fontSize: '0.78125rem' }}>
                        {stats ? `${stats.total} Modules` : 'Curriculum Modules'}
                      </Typography>
                    </Box>

                    {stats && stats.total > 0 && (
                      <Box sx={{ display: 'flex', gap: 0.75 }}>
                        <Chip
                          label={`${stats.published} Live`}
                          size="small"
                          sx={{
                            height: 18,
                            fontSize: '0.625rem',
                            fontWeight: 700,
                            backgroundColor: '#ECFDF5',
                            color: '#065F46',
                          }}
                        />
                        {stats.draft > 0 && (
                          <Chip
                            label={`${stats.draft} Draft`}
                            size="small"
                            sx={{
                              height: 18,
                              fontSize: '0.625rem',
                              fontWeight: 700,
                              backgroundColor: '#FFFBEB',
                              color: '#92400E',
                            }}
                          />
                        )}
                      </Box>
                    )}
                  </Box>
                </CardContent>

                <CardActions sx={{ px: 2.75, pb: 2.5, pt: 0, justifyContent: 'space-between' }}>
                  <Button
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/courses/${course.id}`);
                    }}
                    sx={{
                      color: '#071A52',
                      fontWeight: 600,
                      fontSize: '0.75rem',
                      p: 0,
                      '&:hover': { color: '#006B5F', backgroundColor: 'transparent' },
                    }}
                  >
                    Manage Syllabus →
                  </Button>

                  {isAdmin && (
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/courses/${course.id}/edit`);
                      }}
                      sx={{
                        color: '#64748B',
                        border: '1px solid #E2E8F0',
                        borderRadius: 2,
                        p: 0.5,
                        '&:hover': { color: '#071A52', borderColor: '#CBD5E1' },
                      }}
                    >
                      <EditIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  )}
                </CardActions>
              </Card>
            );
          })}
        </Box>
      )}

      {/* Create Course Dialog */}
      <Dialog
        open={openDialog}
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: {
            elevation: 3,
            sx: {
              borderRadius: 3.5,
              border: '1px solid #E2E8F0',
              overflow: 'hidden',
            },
          },
        }}
      >
        <DialogTitle sx={{ px: 3, py: 2, backgroundColor: '#071A52', color: '#FFFFFF' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 700, color: '#FFFFFF', fontSize: '1.0625rem' }}>
              Create New Curriculum
            </Typography>
            <IconButton onClick={handleCloseDialog} size="small" sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ p: 3, backgroundColor: '#FFFFFF' }}>
          <DialogContentText sx={{ mb: 2.5, color: '#64748B', fontSize: '0.84375rem' }}>
            Configure examination modules and clinical content categories.
          </DialogContentText>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              name="title"
              label="Curriculum Title"
              fullWidth
              required
              value={newCourse.title}
              onChange={handleInputChange}
              placeholder="e.g. RCSI Aptitude Comprehensive Prep"
              size="small"
            />

            <FormControl fullWidth size="small">
              <InputLabel>Curriculum Category</InputLabel>
              <Select
                name="category"
                value={newCourse.category}
                label="Curriculum Category"
                onChange={handleInputChange}
              >
                <MenuItem value="General">General Examination</MenuItem>
                <MenuItem value="RCSI Prep">RCSI Prep</MenuItem>
                <MenuItem value="OSCE Skills">OSCE Clinical Skills</MenuItem>
                <MenuItem value="Irish Healthcare">Irish Healthcare & Ethics</MenuItem>
                <MenuItem value="Nursing Ethics">Nursing Ethics</MenuItem>
                <MenuItem value="Past Questions">Past Examination Questions</MenuItem>
              </Select>
            </FormControl>

            <TextField
              name="description"
              label="Curriculum Description"
              fullWidth
              multiline
              rows={3}
              value={newCourse.description}
              onChange={handleInputChange}
              placeholder="Brief description of the examination curriculum and targets..."
              size="small"
            />
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, backgroundColor: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
          <Button
            onClick={handleCloseDialog}
            sx={{ color: '#64748B', fontWeight: 600, fontSize: '0.8125rem' }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateCourse}
            variant="contained"
            disabled={creating || !newCourse.title.trim()}
            sx={{
              backgroundColor: '#071A52',
              color: '#FFFFFF',
              fontWeight: 600,
              fontSize: '0.8125rem',
              borderRadius: '8px',
              px: 2.5,
              '&:hover': { backgroundColor: '#0C2570' },
            }}
          >
            {creating ? <CircularProgress size={18} sx={{ color: '#FFFFFF' }} /> : 'Publish Curriculum'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Courses;