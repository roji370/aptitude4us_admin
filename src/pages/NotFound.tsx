import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';

const NotFound: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Box
     
     
     
     
     
     
     sx={{ display: "flex", minHeight: "70vh", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <Typography variant="h1" component="h1" gutterBottom>
        404
      </Typography>
      <Typography variant="h4" component="h2" gutterBottom>
        Page Not Found
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
        The page you are looking for doesn't exist or has been moved.
      </Typography>
      <Button
        variant="contained"
        color="primary"
        onClick={() => navigate('/dashboard')}
        sx={{ mt: 2 }}
      >
        Go to Dashboard
      </Button>
    </Box>
  );
};

export default NotFound; 