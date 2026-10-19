import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Box, 
  Typography, 
  Paper, 
  TextField, 
  Button, 
  CircularProgress, 
  Divider,
  Grid,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Alert,
  Snackbar,
  Avatar,
  IconButton,
  Skeleton,
  Card,
  CardContent,
  InputAdornment
} from '@mui/material';
import { 
  ArrowBack as ArrowBackIcon, 
  Person as PersonIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Email as EmailIcon,
  Badge as BadgeIcon,
  Phone as PhoneIcon,
  Info as InfoIcon
} from '@mui/icons-material';
import { getUserById } from '../services/userService';
import { updateUserProfile, updateUserRole, UserProfileUpdate } from '../services/authService';
import type { UserDetails } from '../services/userService';

const UserEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  // User data state
  const [user, setUser] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Form state
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'student'>('student');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [bio, setBio] = useState('');
  
  // UI state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Fetch user data when component mounts
  useEffect(() => {
    const fetchUserData = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
        const userData = await getUserById(id);
        
        if (userData) {
          setUser(userData);
          setDisplayName(userData.displayName || '');
          setEmail(userData.email || '');
          setRole(userData.role as 'admin' | 'student');
          setPhoneNumber(userData.phoneNumber || '');
          setBio(userData.bio || '');
        } else {
          setError('User not found');
        }
      } catch (error) {
        console.error('Error fetching user:', error);
        setError('Failed to load user data');
      } finally {
        setLoading(false);
      }
    };
    
    fetchUserData();
  }, [id]);

  const handleSave = async () => {
    if (!id || !user) return;
    
    try {
      setSaving(true);
      setError(null);
      
      // Create profile update object with only supported fields
      const profileUpdate = {
        displayName: displayName.trim() || undefined
      };
      
      // Update profile fields
      await updateUserProfile(id, profileUpdate);
      
      // Update role separately if it's changed
      if (role !== user.role) {
        await updateUserRole(id, role);
      }
      
      // Update local state
      setUser({
        ...user,
        displayName,
        role
      });
      
      setSuccess('User updated successfully');
      setIsDirty(false);
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccess(null);
      }, 3000);
    } catch (error) {
      console.error('Error updating user:', error);
      setError('Failed to update user');
    } finally {
      setSaving(false);
    }
  };

  const handleBackClick = () => {
    // Check if user has unsaved changes
    if (isDirty) {
      if (window.confirm('You have unsaved changes. Are you sure you want to leave?')) {
        navigate(`/users/${id}`);
      }
    } else {
      navigate(`/users/${id}`);
    }
  };

  // Mark form as dirty whenever a field changes
  useEffect(() => {
    if (!loading && user) {
      const isDirtyCheck = 
        displayName !== (user.displayName || '') ||
        role !== user.role ||
        phoneNumber !== (user.phoneNumber || '') ||
        bio !== (user.bio || '');
      
      setIsDirty(isDirtyCheck);
    }
  }, [displayName, role, phoneNumber, bio, loading, user]);

  // Get initials for avatar
  const getInitials = (name: string) => {
    if (!name) return '?';
    const names = name.split(' ');
    if (names.length === 1) return names[0].charAt(0).toUpperCase();
    return (names[0].charAt(0) + names[names.length - 1].charAt(0)).toUpperCase();
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <IconButton onClick={handleBackClick}>
            <ArrowBackIcon />
          </IconButton>
          <Skeleton variant="text" width={300} height={40} sx={{ ml: 1 }} />
        </Box>
        <Paper sx={{ p: 3 }}>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, sm: 4, md: 3, lg: 2 }} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Skeleton variant="circular" width={120} height={120} />
              <Skeleton variant="text" width={100} height={30} sx={{ mt: 2 }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 8, md: 9, lg: 10 }}>
              <Skeleton variant="text" width="100%" height={60} />
              <Skeleton variant="text" width="100%" height={60} sx={{ mt: 2 }} />
              <Skeleton variant="text" width="100%" height={60} sx={{ mt: 2 }} />
              <Skeleton variant="text" width="100%" height={60} sx={{ mt: 2 }} />
            </Grid>
          </Grid>
        </Paper>
      </Box>
    );
  }

  if (!user) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">User not found</Alert>
        <Button 
          variant="contained" 
          onClick={() => navigate('/users')}
          sx={{ mt: 2 }}
          startIcon={<ArrowBackIcon />}
        >
          Back to Users
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* Header */}
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        mb: 3, 
        flexDirection: { xs: 'column', sm: 'row' },
        justifyContent: { xs: 'center', sm: 'space-between' }
      }}>
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          mb: { xs: 2, sm: 0 },
          width: { xs: '100%', sm: 'auto' }
        }}>
          <IconButton 
            onClick={handleBackClick} 
            sx={{ 
              color: '#071A52',
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              mr: 1.5,
              '&:hover': {
                bgcolor: 'rgba(7, 26, 82, 0.04)',
                borderColor: '#CBD5E1'
              }
            }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Box>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 700, color: '#071A52' }}>
              Edit Candidate Profile
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
              Update access privileges and candidate credentials
            </Typography>
          </Box>
        </Box>
        
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            onClick={handleBackClick}
            startIcon={<CancelIcon />}
            disabled={saving}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              borderColor: '#E2E8F0',
              color: '#64748B',
              borderRadius: '8px'
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleSave}
            startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
            disabled={saving || !isDirty}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: '8px',
              px: 2.5
            }}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </Box>
      </Box>
      
      {/* Error/Success alerts */}
      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: '10px' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mb: 3, borderRadius: '10px' }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}
      
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
        {/* User avatar and basic info card */}
        <Box sx={{ width: { xs: '100%', md: '300px' }, flexShrink: 0 }}>
          <Card elevation={0} sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', bgcolor: '#FFFFFF' }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ 
                display: 'flex', 
                flexDirection: { xs: 'column', sm: 'row', md: 'column' }, 
                alignItems: { xs: 'center', sm: 'flex-start', md: 'center' },
                gap: 2
              }}>
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center'
                }}>
                  <Avatar 
                    sx={{ 
                      width: { xs: 80, sm: 90 }, 
                      height: { xs: 80, sm: 90 }, 
                      bgcolor: '#071A52',
                      color: '#FFFFFF',
                      fontSize: { xs: '1.8rem', sm: '2rem' },
                      fontWeight: 700,
                      mb: 1.5,
                      borderRadius: '20px'
                    }}
                  >
                    {getInitials(displayName)}
                  </Avatar>
                  
                  <Typography 
                    variant="h6" 
                    component="div" 
                    align="center"
                    sx={{ 
                      mb: 1,
                      fontWeight: 700,
                      color: '#071A52',
                      wordBreak: 'break-word',
                      fontSize: { xs: '1rem', sm: '1.125rem' }
                    }}
                  >
                    {displayName || 'No Name'}
                  </Typography>
                  
                  <Chip 
                    label={role === 'admin' ? 'Administrator' : 'Student'} 
                    size="small"
                    sx={{
                      bgcolor: role === 'admin' ? 'rgba(7, 26, 82, 0.08)' : 'rgba(0, 107, 95, 0.1)',
                      color: role === 'admin' ? '#071A52' : '#006B5F',
                      fontWeight: 700,
                      fontSize: '0.75rem',
                      borderRadius: '6px'
                    }}
                  />
                </Box>
                
                <Box sx={{ 
                  flexGrow: 1, 
                  width: '100%', 
                  mt: { xs: 2, sm: 0, md: 2 },
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  pt: 2,
                  borderTop: '1px solid #F1F5F9'
                }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    USER ID
                  </Typography>
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      wordBreak: 'break-all',
                      mb: 1.5,
                      color: '#071A52',
                      fontFamily: 'monospace',
                      fontSize: '0.8rem'
                    }}
                  >
                    {id}
                  </Typography>
                  
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    EMAIL ADDRESS
                  </Typography>
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      wordBreak: 'break-all',
                      color: '#071A52'
                    }}
                  >
                    {email || 'No email available'}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Box>
        
        {/* Main edit form */}
        <Box sx={{ flexGrow: 1 }}>
          <Paper elevation={0} sx={{ p: 3.5, borderRadius: '16px', border: '1px solid #E2E8F0', bgcolor: '#FFFFFF' }}>
            <Typography variant="h6" component="h2" sx={{ mb: 3, fontWeight: 700, color: '#071A52' }}>
              Candidate Information
            </Typography>
            
            <Grid container spacing={3}>
              <Grid size={{ xs: 12 }}>
                <TextField
                  label="Display Name"
                  fullWidth
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  slotProps={{ input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <PersonIcon />
                        </InputAdornment>
                      ),
                    } }}
                />
              </Grid>
              
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Email"
                  fullWidth
                  value={email}
                  disabled
                  slotProps={{ input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <EmailIcon />
                        </InputAdornment>
                      ),
                    } }}
                  helperText="Email cannot be changed"
                />
              </Grid>
              
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Phone Number"
                  fullWidth
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  slotProps={{ input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <PhoneIcon />
                        </InputAdornment>
                      ),
                    } }}
                />
              </Grid>
              
              <Grid size={{ xs: 12 }}>
                <FormControl component="fieldset">
                  <FormLabel component="legend">User Role</FormLabel>
                  <RadioGroup
                    row
                    name="role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'admin' | 'student')}
                  >
                    <FormControlLabel value="student" control={<Radio />} label="Student" />
                    <FormControlLabel value="admin" control={<Radio />} label="Administrator" />
                  </RadioGroup>
                </FormControl>
              </Grid>
              
              <Grid size={{ xs: 12 }}>
                <TextField
                  label="Bio"
                  fullWidth
                  multiline
                  rows={4}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Enter user bio or notes"
                  slotProps={{ input: {
                      startAdornment: (
                        <InputAdornment position="start" sx={{ alignSelf: 'flex-start', mt: 1 }}>
                          <InfoIcon />
                        </InputAdornment>
                      ),
                    } }}
                />
              </Grid>
            </Grid>
          </Paper>
        </Box>
      </Box>
    </Box>
  );
};

export default UserEdit;

// Helper components
const Chip = ({ label, color, size }: { label: string, color: 'primary' | 'secondary', size?: 'small' | 'medium' }) => {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1,
        py: 0.5,
        borderRadius: '16px',
        bgcolor: `${color}.main`,
        color: 'white',
        fontSize: size === 'small' ? '0.75rem' : '0.875rem',
      }}
    >
      <BadgeIcon sx={{ fontSize: 'inherit', mr: 0.5 }} />
      {label}
    </Box>
  );
}; 