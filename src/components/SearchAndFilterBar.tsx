import React from 'react';
import {
  Box,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Paper,
  Grid,
  InputAdornment,
  SelectChangeEvent,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { StudentFilters, SortOption } from '../types/student';

interface SearchAndFilterBarProps {
  filters: StudentFilters;
  onFiltersChange: (filters: StudentFilters) => void;
  sortOption: SortOption;
  onSortChange: (sort: SortOption) => void;
  courses?: Array<{ id: string; title: string }>;
}

const SearchAndFilterBar: React.FC<SearchAndFilterBarProps> = ({
  filters,
  onFiltersChange,
  sortOption,
  onSortChange,
  courses = [],
}) => {
  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFiltersChange({
      ...filters,
      searchQuery: event.target.value,
    });
  };

  const handleProfileStatusChange = (event: SelectChangeEvent) => {
    onFiltersChange({
      ...filters,
      profileStatus: event.target.value as StudentFilters['profileStatus'],
    });
  };

  const handleSubscriptionChange = (event: SelectChangeEvent) => {
    onFiltersChange({
      ...filters,
      subscriptionPeriod: event.target.value,
    });
  };

  const handleCourseChange = (event: SelectChangeEvent) => {
    onFiltersChange({
      ...filters,
      assignedCourse: event.target.value,
    });
  };

  const handleSortChange = (event: SelectChangeEvent) => {
    onSortChange(event.target.value as SortOption);
  };

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2.5,
        mb: 3,
        borderRadius: 3.5,
        border: '1px solid #E2E8F0',
        backgroundColor: '#FFFFFF',
        boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
      }}
    >
      <Grid container spacing={2} sx={{ alignItems: 'center' }}>
        {/* Search */}
        <Grid size={{ xs: 12, md: 4 }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Search candidates by name, email, or mobile..."
            value={filters.searchQuery}
            onChange={handleSearchChange}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: '#94A3B8', fontSize: 19 }} />
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
        </Grid>

        {/* Profile Status Filter */}
        <Grid size={{ xs: 12, sm: 6, md: 2 }}>
          <FormControl fullWidth size="small">
            <InputLabel sx={{ fontSize: '0.8125rem' }}>Profile Status</InputLabel>
            <Select
              value={filters.profileStatus}
              label="Profile Status"
              onChange={handleProfileStatusChange}
              sx={{ borderRadius: 2, fontSize: '0.84375rem', backgroundColor: '#F8FAFC' }}
            >
              <MenuItem value="all">All Statuses</MenuItem>
              <MenuItem value="complete">Complete</MenuItem>
              <MenuItem value="incomplete">Incomplete</MenuItem>
              <MenuItem value="not-started">Not Started</MenuItem>
            </Select>
          </FormControl>
        </Grid>

        {/* Subscription Filter */}
        <Grid size={{ xs: 12, sm: 6, md: 2 }}>
          <FormControl fullWidth size="small">
            <InputLabel sx={{ fontSize: '0.8125rem' }}>Duration</InputLabel>
            <Select
              value={filters.subscriptionPeriod}
              label="Duration"
              onChange={handleSubscriptionChange}
              sx={{ borderRadius: 2, fontSize: '0.84375rem', backgroundColor: '#F8FAFC' }}
            >
              <MenuItem value="">All Durations</MenuItem>
              <MenuItem value="1 Month">1 Month</MenuItem>
              <MenuItem value="3 Months">3 Months</MenuItem>
              <MenuItem value="6 Months">6 Months</MenuItem>
              <MenuItem value="1 Year">1 Year</MenuItem>
              <MenuItem value="2 Years">2 Years</MenuItem>
            </Select>
          </FormControl>
        </Grid>

        {/* Course Filter */}
        <Grid size={{ xs: 12, sm: 6, md: 2 }}>
          <FormControl fullWidth size="small">
            <InputLabel sx={{ fontSize: '0.8125rem' }}>Curriculum</InputLabel>
            <Select
              value={filters.assignedCourse}
              label="Curriculum"
              onChange={handleCourseChange}
              sx={{ borderRadius: 2, fontSize: '0.84375rem', backgroundColor: '#F8FAFC' }}
            >
              <MenuItem value="">All Curricula</MenuItem>
              {courses.map((course) => (
                <MenuItem key={course.id} value={course.id}>
                  {course.title}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        {/* Sort */}
        <Grid size={{ xs: 12, sm: 6, md: 2 }}>
          <FormControl fullWidth size="small">
            <InputLabel sx={{ fontSize: '0.8125rem' }}>Sort By</InputLabel>
            <Select
              value={sortOption}
              label="Sort By"
              onChange={handleSortChange}
              sx={{ borderRadius: 2, fontSize: '0.84375rem', backgroundColor: '#F8FAFC' }}
            >
              <MenuItem value="name-asc">Name (A-Z)</MenuItem>
              <MenuItem value="name-desc">Name (Z-A)</MenuItem>
              <MenuItem value="joined-newest">Admitted (Newest)</MenuItem>
              <MenuItem value="joined-oldest">Admitted (Oldest)</MenuItem>
              <MenuItem value="exam-upcoming">Exam (Upcoming)</MenuItem>
            </Select>
          </FormControl>
        </Grid>
      </Grid>
    </Paper>
  );
};

export default SearchAndFilterBar;
