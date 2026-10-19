import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  Avatar, 
  Grid, 
  TextField, 
  Button, 
  Divider, 
  CircularProgress,
  Alert,
  Snackbar,
  Card,
  CardContent,
  Chip
} from '@mui/material';
import { 
  Person as PersonIcon, 
  Email as EmailIcon, 
  Badge as BadgeIcon,
  Save as SaveIcon,
  CloudUpload as CloudUploadIcon
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { getUserById } from '../services/userService';
import { updateUserProfile } from '../services/authService';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase/config';

const Profile: React.FC = () => {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<{
    displayName: string;
    email: string;
    role: string;
    lastLogin: Date;
    phoneNumber?: string;
    bio?: string;
    photoURL?: string;
  }>({
    displayName: '',
    email: '',
    role: '',
    lastLogin: new Date(),
    phoneNumber: '',
    bio: '',
    photoURL: ''
  });
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!currentUser) return;
      
      try {
        setLoading(true);
        const userDetails = await getUserById(currentUser.uid);
        
        if (userDetails) {
          setUserProfile({
            displayName: userDetails.displayName || '',
            email: userDetails.email || '',
            role: userDetails.role,
            lastLogin: userDetails.lastLogin || new Date()
          });
        }
      } catch (error) {
        console.error('Error fetching user profile:', error);
        setError('Failed to load profile data');
      } finally {
        setLoading(false);
      }
    };
    
    fetchUserProfile();
  }, [currentUser]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setUserProfile(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !currentUser) return;
    
    const file = e.target.files[0];
    
    // Validate file type
    if (!file.type.match('image.*')) {
      setError('Please select an image file');
      return;
    }
    
    try {
      setUploadingImage(true);
      
      // Create a reference to the storage location
      const storageRef = ref(storage, `profile_images/${currentUser.uid}_${Date.now()}`);
      
      // Upload the file
      await uploadBytes(storageRef, file);
      
      // Get download URL
      const downloadURL = await getDownloadURL(storageRef);
      
      // Update profile data with new photo URL
      setUserProfile(prev => ({
        ...prev,
        photoURL: downloadURL
      }));
      
      setSuccess('Profile image uploaded successfully');
    } catch (err) {
      console.error('Error uploading profile image:', err);
      setError('Failed to upload profile image');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentUser) {
      setError('User not authenticated');
      return;
    }
    
    try {
      setSaving(true);
      
      await updateUserProfile(currentUser.uid, {
        displayName: userProfile.displayName,
        phoneNumber: userProfile.phoneNumber,
        bio: userProfile.bio,
        photoURL: userProfile.photoURL
      });
      
      setSuccess('Profile updated successfully');
    } catch (err) {
      console.error('Error updating profile:', err);
      setError('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleCloseSnackbar = () => {
    setSuccess(null);
    setError(null);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ flexGrow: 1 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700, color: '#071A52', mb: 0.5 }}>
          Administrator Profile
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
          Manage your account credentials, avatar, and portal profile
        </Typography>
      </Box>
      
      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: '10px' }}>
          {error}
        </Alert>
      )}
      
      <Grid container spacing={3}>
        {/* Profile Overview Card */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card elevation={0} sx={{ border: '1px solid #E2E8F0', borderRadius: '16px', bgcolor: '#FFFFFF' }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 3.5 }}>
              <Box sx={{ position: 'relative', mb: 3 }}>
                <Avatar
                  src={userProfile.photoURL}
                  alt={userProfile.displayName}
                  sx={{ 
                    width: 120, 
                    height: 120, 
                    mb: 2,
                    bgcolor: '#071A52',
                    color: '#FFFFFF',
                    border: '3px solid #E2E8F0'
                  }}
                >
                  {!userProfile.photoURL && <PersonIcon sx={{ fontSize: 60 }} />}
                </Avatar>
                <input
                  accept="image/*"
                  style={{ display: 'none' }}
                  id="profile-image-upload"
                  type="file"
                  onChange={handleImageUpload}
                />
                <label htmlFor="profile-image-upload">
                  <Button
                    component="span"
                    variant="contained"
                    color="primary"
                    size="small"
                    startIcon={<CloudUploadIcon />}
                    disabled={uploadingImage}
                    sx={{
                      position: 'absolute',
                      bottom: 8,
                      right: -10,
                      textTransform: 'none',
                      fontWeight: 600,
                      borderRadius: '8px',
                      boxShadow: '0 2px 6px rgba(7, 26, 82, 0.2)'
                    }}
                  >
                    {uploadingImage ? 'Uploading...' : 'Change'}
                  </Button>
                </label>
              </Box>
              
              <Typography variant="h5" gutterBottom sx={{ fontWeight: 700, color: '#071A52' }}>
                {userProfile.displayName || 'Administrator'}
              </Typography>
              
              <Chip
                icon={<BadgeIcon />}
                label={userProfile.role === 'admin' ? 'Administrator' : 'Student'}
                size="small"
                sx={{
                  bgcolor: userProfile.role === 'admin' ? 'rgba(7, 26, 82, 0.08)' : 'rgba(0, 107, 95, 0.1)',
                  color: userProfile.role === 'admin' ? '#071A52' : '#006B5F',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  borderRadius: '6px',
                  mb: 2
                }}
              />
              
              <Box sx={{ width: '100%', mt: 2, pt: 2, borderTop: '1px solid #F1F5F9' }}>
                <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  <EmailIcon sx={{ mr: 1, fontSize: 18, color: '#071A52' }} />
                  {userProfile.email}
                </Typography>
                
                <Typography variant="body2" color="text.secondary">
                  <strong>Last login:</strong> {formatDate(userProfile.lastLogin)}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        
        {/* Profile Edit Form */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper elevation={0} sx={{ p: 3.5, borderRadius: '16px', border: '1px solid #E2E8F0', bgcolor: '#FFFFFF' }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 700, color: '#071A52' }}>
              Edit Profile Information
            </Typography>
            <Divider sx={{ mb: 3, borderColor: '#F1F5F9' }} />
            
            <Box component="form" onSubmit={handleSubmit} noValidate>
              <Grid container spacing={3}>
                <Grid size={{ xs: 12 }}>
                  <TextField
                    fullWidth
                    label="Display Name"
                    name="displayName"
                    value={userProfile.displayName}
                    onChange={handleChange}
                    variant="outlined"
                  />
                </Grid>
                
                <Grid size={{ xs: 12 }}>
                  <TextField
                    fullWidth
                    label="Email"
                    name="email"
                    value={userProfile.email}
                    variant="outlined"
                    disabled
                    helperText="Email cannot be changed"
                  />
                </Grid>
                
                <Grid size={{ xs: 12 }}>
                  <TextField
                    fullWidth
                    label="Phone Number"
                    name="phoneNumber"
                    value={userProfile.phoneNumber}
                    onChange={handleChange}
                    variant="outlined"
                  />
                </Grid>
                
                <Grid size={{ xs: 12 }}>
                  <TextField
                    fullWidth
                    label="Bio"
                    name="bio"
                    value={userProfile.bio}
                    onChange={handleChange}
                    variant="outlined"
                    multiline
                    rows={4}
                    placeholder="Tell us about yourself"
                  />
                </Grid>
                
                <Grid size={{ xs: 12 }}>
                  <Button
                    type="submit"
                    variant="contained"
                    color="primary"
                    startIcon={<SaveIcon />}
                    disabled={saving}
                    sx={{
                      mt: 1,
                      textTransform: 'none',
                      fontWeight: 600,
                      borderRadius: '8px',
                      px: 3
                    }}
                  >
                    {saving ? 'Saving...' : 'Save Profile Changes'}
                  </Button>
                </Grid>
              </Grid>
            </Box>
          </Paper>
        </Grid>
      </Grid>
      
      <Snackbar 
        open={!!success} 
        autoHideDuration={6000} 
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={handleCloseSnackbar} severity="success" sx={{ width: '100%' }}>
          {success}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Profile; 