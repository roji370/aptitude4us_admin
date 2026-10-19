import React, { useState, useEffect } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { CircularProgress, Box, Alert, Typography, Button } from '@mui/material';
import { hasAccessToCourse } from '../services/courseService';
import { LockOutlined as LockIcon } from '@mui/icons-material';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'admin' | 'student';
  checkCourseAccess?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  children, 
  requiredRole,
  checkCourseAccess = false
}) => {
  const { currentUser, loading, isAdmin, customClaims } = useAuth();
  const location = useLocation();
  const params = useParams();
  const [accessChecking, setAccessChecking] = useState(false);
  const [hasAccess, setHasAccess] = useState(true);

  useEffect(() => {
    const checkAccess = async () => {
      if (!currentUser || !checkCourseAccess) return;
      
      // Extract courseId from path parameters
      const courseId = params.id;
      
      if (!courseId) return;
      
      // If using custom claims, check if the course is in the claims
      if (customClaims && customClaims.assignedCourseIds) {
        const assignedCourses = customClaims.assignedCourseIds as string[];
        if (assignedCourses.includes(courseId)) {
          setHasAccess(true);
          return;
        }
      }
      
      // Fallback to database check if claims don't have course access information
      try {
        setAccessChecking(true);
        const access = await hasAccessToCourse(currentUser.uid, courseId);
        setHasAccess(access);
      } catch (error) {
        console.error('Error checking course access:', error);
        setHasAccess(false);
      } finally {
        setAccessChecking(false);
      }
    };
    
    checkAccess();
  }, [currentUser, checkCourseAccess, params.id, customClaims]);

  if (loading || accessChecking) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  // Not logged in - redirect to login
  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Role check using claims first, then fallback to user object
  if (requiredRole) {
    // Check claims first
    if (customClaims && customClaims.role) {
      // Admin via claims can access any route
      if (customClaims.role === 'admin') {
        return <>{children}</>;
      }
      
      // If roles don't match and user is not admin via claims
      if (customClaims.role !== requiredRole) {
        return (
          <Box sx={{ p: 3 }}>
            <Alert severity="error" icon={<LockIcon />}>
              You don't have permission to access this page.
            </Alert>
            <Typography variant="body1" sx={{ mt: 2 }}>
              This page requires {requiredRole} privileges.
            </Typography>
            <Button variant="contained" sx={{ mt: 2 }} href="/">
              Go to Dashboard
            </Button>
          </Box>
        );
      }
    } else {
      // Fallback to user object if claims are not available
      if (currentUser.role !== requiredRole) {
        // Admin can access any route
        if (currentUser.role === 'admin') {
          return <>{children}</>;
        }
        
        return (
          <Box sx={{ p: 3 }}>
            <Alert severity="error" icon={<LockIcon />}>
              You don't have permission to access this page.
            </Alert>
            <Typography variant="body1" sx={{ mt: 2 }}>
              This page requires {requiredRole} privileges.
            </Typography>
            <Button variant="contained" sx={{ mt: 2 }} href="/">
              Go to Dashboard
            </Button>
          </Box>
        );
      }
    }
  }

  // Course access check
  if (checkCourseAccess && !hasAccess && !isAdmin) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" icon={<LockIcon />}>
          You don't have access to this course.
        </Alert>
        <Typography variant="body1" sx={{ mt: 2 }}>
          Please contact an administrator to gain access to this course.
        </Typography>
        <Button variant="contained" sx={{ mt: 2 }} href="/courses">
          Back to Courses
        </Button>
      </Box>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute; 