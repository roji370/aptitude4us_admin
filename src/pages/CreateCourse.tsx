import React from 'react';
import { Box, Typography, Paper } from '@mui/material';

const CreateCourse: React.FC = () => {
  return (
    <Box sx={{ flexGrow: 1 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Create Course
      </Typography>
      <Paper sx={{ p: 3 }}>
        <Typography>Create course form will go here</Typography>
      </Paper>
    </Box>
  );
};

export default CreateCourse; 