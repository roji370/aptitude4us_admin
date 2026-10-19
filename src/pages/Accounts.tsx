import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Paper,
  Button,
  Chip,
} from '@mui/material';
import {
  PersonAdd as AddIcon,
  Refresh as RefreshIcon,
  HowToReg as AccountsIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { StudentAccount, StudentFilters, SortOption, StudentWithCourses } from '../types/student';
import { fetchAllStudents, fetchStudentDetails, getProfileStatus } from '../services/studentService';
import { getActiveCourses } from '../services/courseService';
import StudentCard from '../components/StudentCard';
import StudentDetailsModal from '../components/StudentDetailsModal';
import SearchAndFilterBar from '../components/SearchAndFilterBar';
import { toMillis } from '../utils/dateUtils';

const Accounts: React.FC = () => {
  const navigate = useNavigate();

  // State
  const [students, setStudents] = useState<StudentAccount[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentWithCourses | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [courses, setCourses] = useState<Array<{ id: string; title: string }>>([]);

  // Filters and sorting
  const [filters, setFilters] = useState<StudentFilters>({
    searchQuery: '',
    profileStatus: 'all',
    subscriptionPeriod: '',
    assignedCourse: '',
  });
  const [sortOption, setSortOption] = useState<SortOption>('name-asc');

  // Load students on mount
  useEffect(() => {
    loadStudents();
    loadCourses();
  }, []);

  const loadStudents = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAllStudents();
      setStudents(data);
    } catch (err) {
      console.error('Error loading students:', err);
      setError('Failed to load student accounts. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadCourses = async () => {
    try {
      const coursesData = await getActiveCourses();
      setCourses(coursesData.map((c) => ({ id: c.id, title: c.title })));
    } catch (err) {
      console.error('Error loading courses:', err);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadStudents();
    setRefreshing(false);
  };

  const handleViewDetails = async (student: StudentAccount) => {
    try {
      const details = await fetchStudentDetails(student.uid);
      setSelectedStudent(details);
      setDetailsOpen(true);
    } catch (err) {
      console.error('Error loading student details:', err);
      setError('Failed to load student details.');
    }
  };

  const handleEdit = (studentId: string) => {
    navigate(`/users/${studentId}/edit`);
  };

  const handleAssignCourses = (studentId: string) => {
    navigate(`/users/${studentId}`);
  };

  const handleSendMessage = (studentId: string) => {
    navigate(`/chat?user=${studentId}`);
  };

  // Filter and sort students
  const filteredAndSortedStudents = useMemo(() => {
    let result = [...students];

    // Apply search filter
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      result = result.filter(
        (student) =>
          student.displayName.toLowerCase().includes(query) ||
          student.email.toLowerCase().includes(query) ||
          (student.mobile && student.mobile.includes(query))
      );
    }

    // Apply profile status filter
    if (filters.profileStatus !== 'all') {
      result = result.filter((student) => getProfileStatus(student) === filters.profileStatus);
    }

    // Apply subscription filter
    if (filters.subscriptionPeriod) {
      result = result.filter((student) => student.subscriptionPeriod === filters.subscriptionPeriod);
    }

    // Apply course filter
    if (filters.assignedCourse) {
      result = result.filter((student) => student.assignedCourseIds.includes(filters.assignedCourse));
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortOption) {
        case 'name-asc':
          return a.displayName.localeCompare(b.displayName);
        case 'name-desc':
          return b.displayName.localeCompare(a.displayName);
        case 'joined-newest':
          if (!a.dateOfJoining) return 1;
          if (!b.dateOfJoining) return -1;
          return toMillis(b.dateOfJoining) - toMillis(a.dateOfJoining);
        case 'joined-oldest':
          if (!a.dateOfJoining) return 1;
          if (!b.dateOfJoining) return -1;
          return toMillis(a.dateOfJoining) - toMillis(b.dateOfJoining);
        case 'exam-upcoming':
          if (!a.examDate) return 1;
          if (!b.examDate) return -1;
          return toMillis(a.examDate) - toMillis(b.examDate);
        default:
          return 0;
      }
    });

    return result;
  }, [students, filters, sortOption]);

  // Calculate statistics
  const stats = useMemo(() => {
    const total = students.length;
    const complete = students.filter((s) => getProfileStatus(s) === 'complete').length;
    const incomplete = students.filter((s) => getProfileStatus(s) === 'incomplete').length;
    const notStarted = students.filter((s) => getProfileStatus(s) === 'not-started').length;

    return { total, complete, incomplete, notStarted };
  }, [students]);

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh',
        }}
      >
        <CircularProgress size={50} sx={{ color: '#071A52' }} />
      </Box>
    );
  }

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* Page Header */}
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
            <AccountsIcon sx={{ fontSize: 26, color: '#071A52' }} />
            <Typography variant="h4" component="h1" sx={{ fontWeight: 800, color: '#071A52', letterSpacing: '-0.02em' }}>
              Student Accounts
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: '#64748B', mt: 0.5 }}>
            Manage candidate profiles, RCSI curricula access, subscription validity, and exam dates.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={handleRefresh}
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
            onClick={() => navigate('/users/create')}
            startIcon={<AddIcon sx={{ fontSize: 18, color: '#A7FF83' }} />}
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
            Add Student
          </Button>
        </Box>
      </Box>

      {/* Statistics Strip */}
      <Box
        sx={{
          display: 'flex',
          gap: 1.5,
          flexWrap: 'wrap',
          alignItems: 'center',
          mb: 3,
        }}
      >
        <Chip
          label={`Total Candidates: ${stats.total}`}
          sx={{
            height: 28,
            fontWeight: 700,
            fontSize: '0.78125rem',
            backgroundColor: '#071A52',
            color: '#FFFFFF',
          }}
        />
        <Chip
          icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10B981', ml: 1 }} />}
          label={`Profile Complete: ${stats.complete}`}
          sx={{
            height: 28,
            fontWeight: 700,
            fontSize: '0.78125rem',
            backgroundColor: '#ECFDF5',
            color: '#065F46',
            border: '1px solid #A7F3D0',
          }}
        />
        <Chip
          icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#F59E0B', ml: 1 }} />}
          label={`Incomplete: ${stats.incomplete}`}
          sx={{
            height: 28,
            fontWeight: 700,
            fontSize: '0.78125rem',
            backgroundColor: '#FFFBEB',
            color: '#92400E',
            border: '1px solid #FDE68A',
          }}
        />
        <Chip
          icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#D92D20', ml: 1 }} />}
          label={`Not Started: ${stats.notStarted}`}
          sx={{
            height: 28,
            fontWeight: 700,
            fontSize: '0.78125rem',
            backgroundColor: '#FEF2F2',
            color: '#991B1B',
            border: '1px solid #FECDCA',
          }}
        />
        {filteredAndSortedStudents.length !== stats.total && (
          <Chip
            label={`Filtered: ${filteredAndSortedStudents.length}`}
            variant="outlined"
            sx={{
              height: 28,
              fontWeight: 600,
              fontSize: '0.78125rem',
              borderColor: '#CBD5E1',
              color: '#071A52',
            }}
          />
        )}
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Search and Filter */}
      <SearchAndFilterBar
        filters={filters}
        onFiltersChange={setFilters}
        sortOption={sortOption}
        onSortChange={setSortOption}
        courses={courses}
      />

      {/* Student List */}
      {filteredAndSortedStudents.length === 0 ? (
        <Paper
          sx={{
            p: 6,
            textAlign: 'center',
            borderRadius: 3.5,
            border: '1px solid #E2E8F0',
            backgroundColor: '#FFFFFF',
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 700, color: '#071A52', mb: 1 }}>
            No candidates found
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
            {filters.searchQuery ||
            filters.profileStatus !== 'all' ||
            filters.subscriptionPeriod ||
            filters.assignedCourse
              ? 'Try adjusting your search filters or clear queries.'
              : 'Get started by registering your first nursing candidate.'}
          </Typography>
          {students.length === 0 && (
            <Button
              variant="contained"
              startIcon={<AddIcon sx={{ color: '#A7FF83' }} />}
              onClick={() => navigate('/users/create')}
              sx={{ backgroundColor: '#071A52', color: '#FFFFFF', fontWeight: 600 }}
            >
              Add First Student
            </Button>
          )}
        </Paper>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {filteredAndSortedStudents.map((student) => (
            <StudentCard
              key={student.uid}
              student={student}
              onViewDetails={() => handleViewDetails(student)}
              onEdit={() => handleEdit(student.uid)}
              onAssignCourses={() => handleAssignCourses(student.uid)}
              onSendMessage={() => handleSendMessage(student.uid)}
            />
          ))}
        </Box>
      )}

      {/* Student Details Modal */}
      <StudentDetailsModal
        student={selectedStudent}
        open={detailsOpen}
        onClose={() => {
          setDetailsOpen(false);
          setSelectedStudent(null);
        }}
        onEdit={() => selectedStudent && handleEdit(selectedStudent.uid)}
        onAssignCourses={() => selectedStudent && handleAssignCourses(selectedStudent.uid)}
        onSendMessage={() => selectedStudent && handleSendMessage(selectedStudent.uid)}
      />
    </Box>
  );
};

export default Accounts;
