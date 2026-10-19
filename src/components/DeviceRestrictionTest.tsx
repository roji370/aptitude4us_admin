import React, { useState } from 'react';
import {
  Box,
  Button,
  Typography,
  Paper,
  Alert,
  TextField,
  Stack
} from '@mui/material';
import { generateDeviceFingerprint, getDeviceDisplayInfo } from '../utils/deviceFingerprint';
import { toggleDeviceRestriction, validateUserDevice, registerUserDevice } from '../services/deviceRestrictionService';

/**
 * Test component for device restriction functionality
 * This is for development/testing purposes only
 */
const DeviceRestrictionTest: React.FC = () => {
  const [deviceId, setDeviceId] = useState<string>('');
  const [deviceInfo, setDeviceInfo] = useState<string>('');
  const [testUserId, setTestUserId] = useState<string>('');
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const handleGenerateDeviceId = () => {
    const id = generateDeviceFingerprint();
    const info = getDeviceDisplayInfo();
    setDeviceId(id);
    setDeviceInfo(info);
    setResult(`Generated Device ID: ${id}\nDevice Info: ${info}`);
  };

  const handleTestToggle = async () => {
    if (!testUserId) {
      setResult('Please enter a test user ID');
      return;
    }

    setLoading(true);
    try {
      await toggleDeviceRestriction(testUserId, true);
      setResult('Device restriction enabled successfully');
    } catch (error) {
      setResult(`Error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTestValidation = async () => {
    if (!testUserId) {
      setResult('Please enter a test user ID');
      return;
    }

    setLoading(true);
    try {
      const validation = await validateUserDevice(testUserId);
      setResult(`Validation result: ${JSON.stringify(validation, null, 2)}`);
    } catch (error) {
      setResult(`Error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTestRegistration = async () => {
    if (!testUserId) {
      setResult('Please enter a test user ID');
      return;
    }

    setLoading(true);
    try {
      const registeredId = await registerUserDevice(testUserId);
      setResult(`Device registered successfully: ${registeredId}`);
    } catch (error) {
      setResult(`Error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 800 }}>
      <Typography variant="h4" gutterBottom>
        Device Restriction Test Panel
      </Typography>
      
      <Alert severity="warning" sx={{ mb: 3 }}>
        This is a development/testing component. Remove before production deployment.
      </Alert>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Device Fingerprinting
        </Typography>
        
        <Stack spacing={2}>
          <Button 
            variant="contained" 
            onClick={handleGenerateDeviceId}
            disabled={loading}
          >
            Generate Device Fingerprint
          </Button>
          
          {deviceId && (
            <Box>
              <Typography variant="subtitle2">Device ID:</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {deviceId}
              </Typography>
              <Typography variant="subtitle2" sx={{ mt: 1 }}>Device Info:</Typography>
              <Typography variant="body2">
                {deviceInfo}
              </Typography>
            </Box>
          )}
        </Stack>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Device Restriction Testing
        </Typography>
        
        <Stack spacing={2}>
          <TextField
            label="Test User ID"
            value={testUserId}
            onChange={(e) => setTestUserId(e.target.value)}
            placeholder="Enter a user UID for testing"
            fullWidth
          />
          
          <Stack direction="row" spacing={2}>
            <Button 
              variant="outlined" 
              onClick={handleTestToggle}
              disabled={loading || !testUserId}
            >
              Enable Restriction
            </Button>
            
            <Button 
              variant="outlined" 
              onClick={handleTestValidation}
              disabled={loading || !testUserId}
            >
              Test Validation
            </Button>
            
            <Button 
              variant="outlined" 
              onClick={handleTestRegistration}
              disabled={loading || !testUserId}
            >
              Register Device
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {result && (
        <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
          <Typography variant="h6" gutterBottom>
            Result:
          </Typography>
          <Typography 
            variant="body2" 
            component="pre" 
            sx={{ 
              fontFamily: 'monospace', 
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {result}
          </Typography>
        </Paper>
      )}
    </Box>
  );
};

export default DeviceRestrictionTest;
