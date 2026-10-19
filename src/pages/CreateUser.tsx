import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Box, 
  Typography, 
  Paper, 
  Button, 
  TextField, 
  FormControl, 
  InputLabel, 
  Select,
  MenuItem,
  CircularProgress,
  Alert,
  SelectChangeEvent,
  IconButton,
  InputAdornment
} from '@mui/material';
import { 
  ArrowBack as ArrowBackIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon 
} from '@mui/icons-material';
import { createUser } from '../services/authService';

const CreateUser: React.FC = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    displayName: '',
    role: 'student'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleRoleChange = (e: SelectChangeEvent) => {
    setFormData((prev) => ({
      ...prev,
      role: e.target.value as 'admin' | 'student'
    }));
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  // Helper function to get user-friendly error message
  const getErrorMessage = (error: Error): string => {
    const message = error.message.toLowerCase();
    
    // Handle specific Firebase Auth errors
    if (message.includes('auth/email-already-in-use') || message.includes('already-in-use')) {
      return `The email address "${formData.email}" is already in use. Please use a different email.`;
    }
    
    if (message.includes('auth/weak-password')) {
      return 'The password is too weak. Please use a stronger password (at least 6 characters).';
    }
    
    if (message.includes('auth/invalid-email')) {
      return 'The email address is not valid. Please enter a valid email.';
    }
    
    if (message.includes('auth/operation-not-allowed')) {
      return 'Account creation is currently disabled. Please contact the administrator.';
    }
    
    // Return the original message if no specific handling
    return error.message;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      // Validate form data
      if (!formData.email || !formData.password || !formData.displayName) {
        throw new Error('All fields are required');
      }
      
      // Create user
      await createUser(
        formData.email,
        formData.password,
        formData.role as 'admin' | 'student',
        formData.displayName
      );
      
      setSuccess(true);
      
      // Reset form
      setFormData({
        email: '',
        password: '',
        displayName: '',
        role: 'student'
      });
      
      // Redirect after 2 seconds
      setTimeout(() => {
        navigate('/users', { 
          state: { success: 'User created successfully!' }
        });
      }, 2000);
    } catch (err) {
      console.error('Error creating user:', err);
      if (err instanceof Error) {
        setError(getErrorMessage(err));
      } else {
        setError('An error occurred while creating the user.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    // If user was successfully created, pass success state
    if (success) {
      navigate('/users', { 
        state: { success: 'User created successfully!' }
      });
    } else {
      navigate('/users');
    }
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* Header with back button */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Button 
          variant="outlined" 
          startIcon={<ArrowBackIcon />}
          onClick={handleBack}
          sx={{ mr: 2 }}
        >
          Back to Users
        </Button>
        <Typography variant="h4" component="h1" sx={{ flexGrow: 1 }}>
          Create New User
        </Typography>
      </Box>

      {/* Success message */}
      {success && (
        <Alert severity="success" sx={{ mb: 3 }}>
          User created successfully! Redirecting to users list...
        </Alert>
      )}

      {/* Error message */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Create user form */}
      <Paper sx={{ p: 3 }}>
        <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <TextField
            required
            fullWidth
            id="displayName"
            name="displayName"
            label="Full Name"
            value={formData.displayName}
            onChange={handleInputChange}
            disabled={loading}
          />
          
          <TextField
            required
            fullWidth
            id="email"
            name="email"
            label="Email Address"
            type="email"
            value={formData.email}
            onChange={handleInputChange}
            disabled={loading}
          />
          
          <TextField
            required
            fullWidth
            id="password"
            name="password"
            label="Password"
            type={showPassword ? "text" : "password"}
            value={formData.password}
            onChange={handleInputChange}
            disabled={loading}
            helperText="Minimum 6 characters"
            slotProps={{ input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="toggle password visibility"
                      onClick={togglePasswordVisibility}
                      edge="end"
                    >
                      {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              } }}
          />
          
          <FormControl fullWidth>
            <InputLabel id="role-label">Role</InputLabel>
            <Select
              labelId="role-label"
              id="role"
              name="role"
              value={formData.role}
              label="Role"
              onChange={handleRoleChange}
              disabled={loading}
            >
              <MenuItem value="student">Student</MenuItem>
              <MenuItem value="admin">Admin</MenuItem>
            </Select>
          </FormControl>
          
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={loading}
              sx={{ minWidth: 120 }}
            >
              {loading ? <CircularProgress size={24} /> : 'Create User'}
            </Button>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
};

export default CreateUser; 