import React, { useState } from 'react';
import {
  Box,
  Container,
  Paper,
  Typography,
  TextField,
  Button,
  Alert,
  InputAdornment,
  IconButton,
  CircularProgress,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Email,
  Lock,
  School as SchoolIcon,
  Shield as ShieldIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { signInWithEmail, isAdmin } from '../services/authService';
import { useAuth } from '../context/AuthContext';
import { styled } from '@mui/material/styles';
import { logUserLogin } from '../services/userService';

const LoginContainer = styled(Box)(() => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  backgroundColor: '#F8FAFC',
  padding: '24px',
}));

const LoginCard = styled(Paper)(() => ({
  padding: '40px 36px',
  width: '100%',
  maxWidth: 440,
  borderRadius: 20,
  border: '1px solid #E2E8F0',
  boxShadow: '0 20px 25px -5px rgba(7, 26, 82, 0.08), 0 8px 10px -6px rgba(7, 26, 82, 0.04)',
  backgroundColor: '#FFFFFF',
}));

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setUserAfterLogin } = useAuth();

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    setError(null);
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    setError(null);
  };

  const toggleShowPassword = () => {
    setShowPassword(!showPassword);
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!email || !password) {
        setError('Please enter your institutional email and password');
        setLoading(false);
        return;
      }

      const user = await signInWithEmail(email, password);

      if (user && (await isAdmin(user.uid))) {
        setUserAfterLogin(user);

        try {
          const deviceInfo = `${navigator.userAgent}`;
          await logUserLogin(user.uid, 'Web Admin Console', deviceInfo);
        } catch (logErr) {
          console.warn('Login logging non-fatal:', logErr);
        }

        navigate('/dashboard');
      } else {
        setError('Access denied: Administrator privileges required.');
      }
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'Invalid credentials. Please verify and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LoginContainer>
      <LoginCard>
        {/* Brand Header */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3.5 }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: 3,
              backgroundColor: '#071A52',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#A7FF83',
              boxShadow: '0 8px 16px rgba(7, 26, 82, 0.15)',
              mb: 2,
            }}
          >
            <SchoolIcon sx={{ fontSize: 32 }} />
          </Box>

          <Typography
            variant="h5"
            sx={{
              fontWeight: 800,
              color: '#071A52',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
            }}
          >
            Aptitude 4 Us
          </Typography>

          <Typography
            variant="caption"
            sx={{
              color: '#64748B',
              fontWeight: 700,
              fontSize: '0.6875rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              mt: 0.5,
            }}
          >
            Academy Portal • Admin Console
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleEmailLogin} noValidate>
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: '#071A52', mb: 0.75, display: 'block', textTransform: 'uppercase', fontSize: '0.6875rem' }}>
              Institutional Email
            </Typography>
            <TextField
              fullWidth
              required
              id="email"
              placeholder="e.g. admin@aptitude4us.com"
              value={email}
              onChange={handleEmailChange}
              size="small"
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Email sx={{ color: '#94A3B8', fontSize: 18 }} />
                    </InputAdornment>
                  ),
                  sx: { borderRadius: 2, backgroundColor: '#F8FAFC', fontSize: '0.84375rem' },
                },
              }}
            />
          </Box>

          <Box sx={{ mb: 3 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: '#071A52', mb: 0.75, display: 'block', textTransform: 'uppercase', fontSize: '0.6875rem' }}>
              Password
            </Typography>
            <TextField
              fullWidth
              required
              id="password"
              placeholder="••••••••••••"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={handlePasswordChange}
              size="small"
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Lock sx={{ color: '#94A3B8', fontSize: 18 }} />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton aria-label="toggle password" onClick={toggleShowPassword} edge="end" size="small">
                        {showPassword ? <VisibilityOff sx={{ fontSize: 18 }} /> : <Visibility sx={{ fontSize: 18 }} />}
                      </IconButton>
                    </InputAdornment>
                  ),
                  sx: { borderRadius: 2, backgroundColor: '#F8FAFC', fontSize: '0.84375rem' },
                },
              }}
            />
          </Box>

          <Button
            type="submit"
            fullWidth
            variant="contained"
            disabled={loading}
            sx={{
              py: 1.25,
              backgroundColor: '#071A52',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: '0.875rem',
              borderRadius: 2,
              '&:hover': { backgroundColor: '#0C2570' },
            }}
          >
            {loading ? <CircularProgress size={20} sx={{ color: '#FFFFFF' }} /> : 'Authenticate as Administrator'}
          </Button>
        </form>

        {/* Security Footer */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.75,
            mt: 3.5,
            pt: 2.5,
            borderTop: '1px solid #F1F5F9',
            color: '#64748B',
            fontSize: '0.6875rem',
          }}
        >
          <ShieldIcon sx={{ fontSize: 15, color: '#006B5F' }} />
          <span>RCSI Exam Portal • Proctor Security v2.4.0</span>
        </Box>
      </LoginCard>
    </LoginContainer>
  );
};

export default Login;