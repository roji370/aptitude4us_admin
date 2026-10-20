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
  Button,
  TextField,
  InputAdornment,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  Alert,
  Switch,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
  Avatar,
} from '@mui/material';
import {
  Search as SearchIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Visibility as ViewIcon,
  Security as SecurityIcon,
  DevicesOther as DevicesIcon,
  Group as UsersIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { Link, useLocation } from 'react-router-dom';
import { getUsers } from '../services/userService';
import { toggleDeviceRestriction, resetUserDevice, bulkToggleDeviceRestriction } from '../services/deviceRestrictionService';
import type { UserDetails } from '../services/userService';

interface LocationState {
  success?: string;
}

const Users: React.FC = () => {
  const [users, setUsers] = useState<UserDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceRestrictionDialog, setDeviceRestrictionDialog] = useState<{
    open: boolean;
    user: UserDetails | null;
    action: 'toggle' | 'reset' | null;
  }>({ open: false, user: null, action: null });
  const location = useLocation();

  const refetchUsers = async () => {
    try {
      setLoading(true);
      const usersData = await getUsers();
      setUsers(usersData);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError('Failed to load users. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const state = location.state as LocationState;
    if (state?.success) {
      setSuccess(state.success);
      window.history.replaceState({}, document.title);
      refetchUsers();
      setTimeout(() => {
        setSuccess(null);
      }, 5000);
    }
  }, [location]);

  useEffect(() => {
    refetchUsers();
  }, []);

  const filteredUsers = users.filter(
    (user) =>
      user.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return 'Never';
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return 'Never';
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d);
  };

  const handleDeviceRestrictionToggle = (user: UserDetails) => {
    setDeviceRestrictionDialog({
      open: true,
      user,
      action: 'toggle',
    });
  };

  const handleResetDevice = (user: UserDetails) => {
    setDeviceRestrictionDialog({
      open: true,
      user,
      action: 'reset',
    });
  };

  const handleDialogClose = () => {
    setDeviceRestrictionDialog({ open: false, user: null, action: null });
  };

  const handleDialogConfirm = async () => {
    if (!deviceRestrictionDialog.user || !deviceRestrictionDialog.action) return;

    try {
      if (deviceRestrictionDialog.action === 'toggle') {
        const currentStatus = deviceRestrictionDialog.user.deviceRestriction?.enabled || false;
        await toggleDeviceRestriction(deviceRestrictionDialog.user.uid, !currentStatus);
        setSuccess(
          `Device restriction ${!currentStatus ? 'enabled' : 'disabled'} for ${
            deviceRestrictionDialog.user.displayName || deviceRestrictionDialog.user.email
          }`
        );
      } else if (deviceRestrictionDialog.action === 'reset') {
        await resetUserDevice(deviceRestrictionDialog.user.uid);
        setSuccess(
          `Device registration reset for ${
            deviceRestrictionDialog.user.displayName || deviceRestrictionDialog.user.email
          }`
        );
      }
      await refetchUsers();
    } catch (err) {
      console.error('Error updating device restriction:', err);
      setError('Failed to update device restriction. Please try again.');
    } finally {
      handleDialogClose();
    }
  };

  const handleBulkToggleDeviceRestriction = async (enabled: boolean) => {
    try {
      setBulkLoading(true);
      const result = await bulkToggleDeviceRestriction(enabled);
      if (result.failed > 0) {
        setError(
          `Device restrictions ${enabled ? 'enabled' : 'disabled'} for ${result.success} users. Failed for ${result.failed} users.`
        );
      } else {
        setSuccess(
          `Successfully ${enabled ? 'enabled' : 'disabled'} device restrictions for all ${result.success} users.`
        );
      }
      await refetchUsers();
    } catch (err) {
      console.error('Error bulk toggling device restrictions:', err);
      setError(`Failed to ${enabled ? 'enable' : 'disable'} device restrictions.`);
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* Notifications */}
      {success && (
        <Alert severity="success" sx={{ mb: 2.5, borderRadius: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

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
            <UsersIcon sx={{ fontSize: 26, color: '#071A52' }} />
            <Typography variant="h4" component="h1" sx={{ fontWeight: 800, color: '#071A52', letterSpacing: '-0.02em' }}>
              User Management
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: '#64748B', mt: 0.5 }}>
            Audit authentication credentials, roles, course assignments, and DRM device bindings.
          </Typography>
        </Box>

        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon sx={{ color: '#A7FF83', fontSize: 18 }} />}
          component={Link}
          to="/users/create"
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
          Add User
        </Button>
      </Box>

      {/* Search Bar & Bulk Controls Row */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, mb: 3 }}>
        {/* Search */}
        <Paper
          elevation={0}
          sx={{
            p: 1.5,
            flex: 1,
            borderRadius: 3.5,
            border: '1px solid #E2E8F0',
            backgroundColor: '#FFFFFF',
            boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
          }}
        >
          <TextField
            fullWidth
            size="small"
            placeholder="Search users by name, email, or role..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: '#94A3B8', fontSize: 20 }} />
                  </InputAdornment>
                ),
                sx: { borderRadius: 2.4, fontSize: '0.84375rem', backgroundColor: '#F8FAFC' },
              },
            }}
          />
        </Paper>

        {/* Bulk DRM Controls */}
        <Paper
          elevation={0}
          sx={{
            p: 1.5,
            px: 2.5,
            borderRadius: 3.5,
            border: '1px solid #E2E8F0',
            backgroundColor: '#FFFFFF',
            boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            flexWrap: 'wrap',
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600, color: '#071A52', fontSize: '0.78125rem' }}>
            DRM Restriction:
          </Typography>
          <Button
            variant="contained"
            size="small"
            startIcon={bulkLoading ? <CircularProgress size={14} color="inherit" /> : <SecurityIcon sx={{ fontSize: 16 }} />}
            onClick={() => handleBulkToggleDeviceRestriction(true)}
            disabled={bulkLoading || loading || users.length === 0}
            sx={{
              backgroundColor: '#006B5F',
              color: '#FFFFFF',
              fontSize: '0.75rem',
              fontWeight: 600,
              height: 32,
              borderRadius: '6px',
              '&:hover': { backgroundColor: '#005047' },
            }}
          >
            All ON
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={bulkLoading ? <CircularProgress size={14} color="inherit" /> : <DevicesIcon sx={{ fontSize: 16 }} />}
            onClick={() => handleBulkToggleDeviceRestriction(false)}
            disabled={bulkLoading || loading || users.length === 0}
            sx={{
              borderColor: '#FCA5A5',
              color: '#DC2626',
              fontSize: '0.75rem',
              fontWeight: 600,
              height: 32,
              borderRadius: '6px',
              '&:hover': { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },
            }}
          >
            All OFF
          </Button>
        </Paper>
      </Box>

      {/* Users Table */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={40} sx={{ color: '#071A52' }} />
        </Box>
      ) : filteredUsers.length === 0 ? (
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
            No users found
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748B' }}>
            {searchTerm ? 'Try a different search query.' : 'Click "Add User" to register a faculty member or candidate.'}
          </Typography>
        </Paper>
      ) : (
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
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>User</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Last Active</TableCell>
                  <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Assigned Curricula</TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>DRM Binding</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredUsers
                  .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                  .map((user) => (
                    <TableRow
                      key={user.uid}
                      sx={{
                        transition: 'background-color 0.15s ease-in-out',
                        '&:hover': { backgroundColor: '#F8FAFC' },
                      }}
                    >
                      {/* Name & Email with Avatar */}
                      <TableCell sx={{ py: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Avatar
                            sx={{
                              width: 32,
                              height: 32,
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              backgroundColor: user.role === 'admin' ? '#071A52' : 'rgba(7, 26, 82, 0.08)',
                              color: user.role === 'admin' ? '#A7FF83' : '#071A52',
                              border: '1px solid #E2E8F0',
                            }}
                          >
                            {(user.displayName || user.email).charAt(0).toUpperCase()}
                          </Avatar>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: '#071A52', lineHeight: 1.2 }}>
                              {user.displayName || 'Unknown Name'}
                            </Typography>
                            <Typography variant="caption" sx={{ color: '#64748B', fontSize: '0.71875rem' }}>
                              {user.email}
                            </Typography>
                          </Box>
                        </Box>
                      </TableCell>

                      {/* Role */}
                      <TableCell sx={{ py: 1.5 }}>
                        <Chip
                          label={user.role}
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            backgroundColor:
                              user.role === 'admin'
                                ? '#071A52'
                                : user.role === 'student'
                                ? '#ECFDF5'
                                : '#F1F5F9',
                            color:
                              user.role === 'admin'
                                ? '#FFFFFF'
                                : user.role === 'student'
                                ? '#065F46'
                                : '#071A52',
                            textTransform: 'capitalize',
                          }}
                        />
                      </TableCell>

                      {/* Last Login */}
                      <TableCell sx={{ py: 1.5, color: '#64748B', fontSize: '0.78125rem', display: { xs: 'none', md: 'table-cell' } }}>
                        {formatDate(user.lastLogin)}
                      </TableCell>

                      {/* Assigned Courses */}
                      <TableCell sx={{ py: 1.5, display: { xs: 'none', lg: 'table-cell' } }}>
                        <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.8125rem', color: '#151C27' }}>
                          {user.assignedCourseIds?.length || 0} Curricula
                        </Typography>
                      </TableCell>

                      {/* Device Restriction Switch */}
                      <TableCell sx={{ py: 1.5, display: { xs: 'none', md: 'table-cell' } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={user.deviceRestriction?.enabled || false}
                                onChange={() => handleDeviceRestrictionToggle(user)}
                                size="small"
                                sx={{
                                  '& .MuiSwitch-switchBase.Mui-checked': {
                                    color: '#006B5F',
                                  },
                                  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                                    backgroundColor: '#006B5F',
                                  },
                                }}
                              />
                            }
                            label=""
                            sx={{ m: 0 }}
                          />
                          {user.deviceRestriction?.enabled && (
                            <Tooltip
                              title={
                                user.deviceRestriction.registeredDeviceId
                                  ? `Device bound on ${formatDate(user.deviceRestriction.registeredAt)}. Click to reset.`
                                  : 'Active — awaiting candidate first login'
                              }
                            >
                              <IconButton
                                size="small"
                                onClick={() => handleResetDevice(user)}
                                sx={{
                                  p: 0.5,
                                  color: user.deviceRestriction.registeredDeviceId ? '#006B5F' : '#F59E0B',
                                }}
                              >
                                {user.deviceRestriction.registeredDeviceId ? (
                                  <SecurityIcon sx={{ fontSize: 16 }} />
                                ) : (
                                  <DevicesIcon sx={{ fontSize: 16 }} />
                                )}
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>

                      {/* Actions */}
                      <TableCell align="right" sx={{ py: 1.5 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                          <Tooltip title="View Candidate File">
                            <IconButton
                              component={Link}
                              to={`/users/${user.uid}`}
                              size="small"
                              sx={{
                                color: '#64748B',
                                '&:hover': { color: '#071A52', backgroundColor: '#F1F5F9' },
                              }}
                            >
                              <ViewIcon sx={{ fontSize: 17 }} />
                            </IconButton>
                          </Tooltip>

                          <Tooltip title="Edit Profile">
                            <IconButton
                              component={Link}
                              to={`/users/${user.uid}/edit`}
                              size="small"
                              sx={{
                                color: '#64748B',
                                '&:hover': { color: '#071A52', backgroundColor: '#F1F5F9' },
                              }}
                            >
                              <EditIcon sx={{ fontSize: 17 }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            rowsPerPageOptions={[10, 25, 50]}
            component="div"
            count={filteredUsers.length}
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
      )}

      {/* Device Restriction Confirmation Dialog */}
      <Dialog
        open={deviceRestrictionDialog.open}
        onClose={handleDialogClose}
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
            <Typography variant="h6" sx={{ fontWeight: 700, color: '#FFFFFF', fontSize: '1rem' }}>
              {deviceRestrictionDialog.action === 'toggle'
                ? 'Toggle DRM Device Restriction'
                : 'Reset DRM Device Binding'}
            </Typography>
            <IconButton onClick={handleDialogClose} size="small" sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ p: 3, backgroundColor: '#FFFFFF' }}>
          <DialogContentText sx={{ color: '#151C27', fontSize: '0.875rem' }}>
            {deviceRestrictionDialog.action === 'toggle' ? (
              <>
                Configure DRM device binding for{' '}
                <strong>{deviceRestrictionDialog.user?.displayName || deviceRestrictionDialog.user?.email}</strong>.
                <br /><br />
                Enabling this will restrict all examination materials to the candidate's first authenticated device.
              </>
            ) : (
              <>
                Reset registered hardware ID for{' '}
                <strong>{deviceRestrictionDialog.user?.displayName || deviceRestrictionDialog.user?.email}</strong>?
                <br /><br />
                The candidate will be prompted to bind a new device on their next sign-in.
              </>
            )}
          </DialogContentText>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, backgroundColor: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
          <Button onClick={handleDialogClose} sx={{ color: '#64748B', fontWeight: 600 }}>
            Cancel
          </Button>
          <Button
            onClick={handleDialogConfirm}
            variant="contained"
            sx={{
              backgroundColor: '#071A52',
              color: '#FFFFFF',
              fontWeight: 600,
              borderRadius: '8px',
              '&:hover': { backgroundColor: '#0C2570' },
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Users;