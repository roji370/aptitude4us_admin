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
  TablePagination,
  Chip,
  Button,
  IconButton,
  TextField,
  InputAdornment,
  Alert,
  CircularProgress,
  Tooltip,
  Avatar,
} from '@mui/material';
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Warning as WarningIcon,
  Block as BlockIcon,
  CheckCircle as CheckCircleIcon,
  RestartAlt as ResetIcon,
  Shield as ShieldIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import { ViolationSummary, ViolationStatus } from '../types/violations';
import { getAllViolations, getViolationStats, listenToViolations } from '../services/violationService';

interface ViolationsDashboardProps {
  onViewUser: (userId: string) => void;
  onResetUser: (userId: string) => void;
}

const ViolationsDashboard: React.FC<ViolationsDashboardProps> = ({
  onViewUser,
  onResetUser,
}) => {
  const [violations, setViolations] = useState<ViolationSummary[]>([]);
  const [filteredViolations, setFilteredViolations] = useState<ViolationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    warnings: 0,
    blocked: 0,
    recentResets: 0,
  });

  const fetchViolationsOnce = async () => {
    try {
      setRefreshing(true);
      setError(null);

      const [violationsData, statsData] = await Promise.all([
        getAllViolations(),
        getViolationStats(),
      ]);

      setViolations(violationsData);
      setFilteredViolations(violationsData);
      setStats(statsData);
    } catch (err) {
      console.error('Error fetching violations:', err);
      setError('Failed to load violations. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleViolationsUpdate = (violationsData: ViolationSummary[]) => {
    setViolations(violationsData);
    setFilteredViolations(violationsData);
    setLoading(false);
    setRefreshing(false);

    const statsCalculated = {
      total: violationsData.length,
      warnings: violationsData.filter((v) => v.status === 'WARNING').length,
      blocked: violationsData.filter((v) => v.status === 'BLOCKED').length,
      recentResets: violationsData.filter((v) => {
        if (!v.lastReset) return false;
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        return v.lastReset > sevenDaysAgo;
      }).length,
    };
    setStats(statsCalculated);
  };

  useEffect(() => {
    const unsubscribe = listenToViolations(
      handleViolationsUpdate,
      (err) => {
        console.error('Real-time listener error:', err);
        setError('Real-time updates failed. Falling back to manual refresh.');
        fetchViolationsOnce();
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredViolations(violations);
    } else {
      const term = searchTerm.toLowerCase();
      const filtered = violations.filter(
        (v) =>
          v.userEmail.toLowerCase().includes(term) ||
          (v.userName && v.userName.toLowerCase().includes(term))
      );
      setFilteredViolations(filtered);
    }
    setPage(0);
  }, [searchTerm, violations]);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const getStatusChip = (status: ViolationStatus) => {
    switch (status) {
      case 'BLOCKED':
        return (
          <Chip
            icon={<BlockIcon sx={{ fontSize: '13px !important', color: '#991B1B !important' }} />}
            label="Access Blocked"
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
      case 'WARNING':
        return (
          <Chip
            icon={<WarningIcon sx={{ fontSize: '13px !important', color: '#92400E !important' }} />}
            label="Warning Issued"
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
      case 'CLEAR':
        return (
          <Chip
            icon={<CheckCircleIcon sx={{ fontSize: '13px !important', color: '#065F46 !important' }} />}
            label="Clear"
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
      default:
        return null;
    }
  };

  const formatDate = (date: Date | null) => {
    if (!date) return '—';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
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
            <ShieldIcon sx={{ fontSize: 26, color: '#071A52' }} />
            <Typography variant="h4" component="h1" sx={{ fontWeight: 800, color: '#071A52', letterSpacing: '-0.02em' }}>
              DRM & Piracy Protection
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: '#64748B', mt: 0.5 }}>
            Real-time audit of unauthorized screenshot captures and candidate suspension protocols.
          </Typography>
        </Box>

        <Button
          variant="outlined"
          size="small"
          onClick={fetchViolationsOnce}
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
          Manual Refresh
        </Button>
      </Box>

      {/* 4 KPI Cards */}
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
        {/* Total Users with Violations */}
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
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Flagged Candidates
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 800, color: '#071A52', fontSize: '1.75rem', mt: 0.5 }}>
            {stats.total}
          </Typography>
        </Paper>

        {/* Warnings */}
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
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Active Warnings
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 800, color: '#92400E', fontSize: '1.75rem', mt: 0.5 }}>
            {stats.warnings}
          </Typography>
        </Paper>

        {/* Blocked Users */}
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
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Suspended Access
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 800, color: '#991B1B', fontSize: '1.75rem', mt: 0.5 }}>
            {stats.blocked}
          </Typography>
        </Paper>

        {/* Recent Resets */}
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
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Pardoned (Last 7d)
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 800, color: '#065F46', fontSize: '1.75rem', mt: 0.5 }}>
            {stats.recentResets}
          </Typography>
        </Paper>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Search Toolbar */}
      <Paper
        elevation={0}
        sx={{
          p: 1.5,
          mb: 3,
          borderRadius: 3.5,
          border: '1px solid #E2E8F0',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
          maxWidth: 420,
        }}
      >
        <TextField
          fullWidth
          size="small"
          placeholder="Search by candidate email or name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: '#94A3B8', fontSize: 19 }} />
                </InputAdornment>
              ),
              sx: { borderRadius: 2, fontSize: '0.84375rem', backgroundColor: '#F8FAFC' },
            },
          }}
        />
      </Paper>

      {/* Table */}
      <Paper
        elevation={0}
        sx={{
          borderRadius: 3.5,
          border: '1px solid #E2E8F0',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
          overflow: 'hidden',
        }}
      >
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Candidate</TableCell>
                <TableCell align="center">Strikes</TableCell>
                <TableCell align="center">DRM Status</TableCell>
                <TableCell align="center">First Flag</TableCell>
                <TableCell align="center">Suspended At</TableCell>
                <TableCell align="center">Last Reset</TableCell>
                <TableCell align="right">Resolution</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredViolations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: '#64748B' }}>
                    {searchTerm ? 'No violation records match your query.' : 'No active DRM violations recorded.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredViolations
                  .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                  .map((v) => (
                    <TableRow key={v.userId} sx={{ '&:hover': { backgroundColor: '#F8FAFC' } }}>
                      <TableCell sx={{ py: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Avatar
                            sx={{
                              width: 32,
                              height: 32,
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              backgroundColor: v.status === 'BLOCKED' ? '#FEE2E2' : 'rgba(7, 26, 82, 0.08)',
                              color: v.status === 'BLOCKED' ? '#D92D20' : '#071A52',
                              border: '1px solid #E2E8F0',
                            }}
                          >
                            {(v.userName || v.userEmail).charAt(0).toUpperCase()}
                          </Avatar>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#071A52', lineHeight: 1.2 }}>
                              {v.userName || 'Unknown Candidate'}
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#64748B', fontSize: '0.71875rem' }}>
                              {v.userEmail}
                            </Typography>
                          </Box>
                        </Box>
                      </TableCell>

                      <TableCell align="center" sx={{ py: 1.5 }}>
                        <Chip
                          label={`${v.violationCount} Attempts`}
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            backgroundColor: v.violationCount > 1 ? '#FEF2F2' : '#FFFBEB',
                            color: v.violationCount > 1 ? '#991B1B' : '#92400E',
                          }}
                        />
                      </TableCell>

                      <TableCell align="center" sx={{ py: 1.5 }}>
                        {getStatusChip(v.status)}
                      </TableCell>

                      <TableCell align="center" sx={{ py: 1.5, color: '#64748B', fontSize: '0.78125rem' }}>
                        {formatDate(v.firstViolation)}
                      </TableCell>

                      <TableCell align="center" sx={{ py: 1.5, color: '#64748B', fontSize: '0.78125rem' }}>
                        {formatDate(v.blockedAt)}
                      </TableCell>

                      <TableCell align="center" sx={{ py: 1.5, color: '#64748B', fontSize: '0.78125rem' }}>
                        {formatDate(v.lastReset)}
                      </TableCell>

                      <TableCell align="right" sx={{ py: 1.5 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                          <Tooltip title="View Incident Dossier">
                            <IconButton
                              size="small"
                              onClick={() => onViewUser(v.userId)}
                              sx={{ color: '#64748B', '&:hover': { color: '#071A52' } }}
                            >
                              <ViewIcon sx={{ fontSize: 17 }} />
                            </IconButton>
                          </Tooltip>

                          <Tooltip title="Reset & Re-instate Access">
                            <IconButton
                              size="small"
                              onClick={() => onResetUser(v.userId)}
                              sx={{ color: '#006B5F', '&:hover': { color: '#004D40' } }}
                            >
                              <ResetIcon sx={{ fontSize: 17 }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          rowsPerPageOptions={[10, 25, 50]}
          component="div"
          count={filteredViolations.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          sx={{
            borderTop: '1px solid #F1F5F9',
            color: '#64748B',
            '& .MuiTablePagination-select': { fontSize: '0.8125rem' },
          }}
        />
      </Paper>
    </Box>
  );
};

export default ViolationsDashboard;
