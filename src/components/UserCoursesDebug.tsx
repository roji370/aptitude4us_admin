import React, { useEffect, useState } from 'react';
import { Box, Typography, CircularProgress, List, ListItem, ListItemText } from '@mui/material';
import { getUserById } from '../services/userService';
import { getCourseById } from '../services/courseService';
import type { Course } from '../services/courseService';
import NotificationStatusIndicator from './NotificationStatusIndicator';

interface UserCoursesDebugProps {
  userId: string;
  refreshKey?: number;
}

const UserCoursesDebug: React.FC<UserCoursesDebugProps> = ({ userId, refreshKey = 0 }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);

  useEffect(() => {
    const fetchUserAndCourses = async () => {
      try {
        // Get user and their assigned course IDs
        const user = await getUserById(userId);
        
        if (!user) {
          setError('User not found');
          setLoading(false);
          return;
        }
        
        const courseIds = user.assignedCourseIds || [];
        
        // Fetch each course
        const coursePromises = courseIds.map(id => getCourseById(id));
        const coursesData = await Promise.all(coursePromises);
        
        // Filter out null values (in case a course doesn't exist)
        const validCourses = coursesData.filter(course => course !== null) as Course[];
        // Sort courses alphabetically by title
        const sortedCourses = validCourses.sort((a, b) => a.title.localeCompare(b.title));
        setCourses(sortedCourses);
      } catch (err) {
        console.error('Error loading courses:', err);
        setError('Failed to load courses');
      } finally {
        setLoading(false);
      }
    };
    
    setLoading(true);
    fetchUserAndCourses();
  }, [userId, refreshKey]);
  
  if (loading) {
    return <CircularProgress size={24} />;
  }
  
  if (error) {
    return <Typography color="error">{error}</Typography>;
  }
  
  return (
    <Box sx={{ mt: 2 }}>
      {courses.length > 0 ? (
        <List dense>
          {courses.map(course => (
            <ListItem key={course.id}>
              <ListItemText primary={course.title} />
              <Box sx={{ ml: 2 }}>
                <NotificationStatusIndicator
                  courseId={course.id}
                  userId={userId}
                  variant="compact"
                />
              </Box>
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography variant="body2">No courses assigned</Typography>
      )}
    </Box>
  );
};

export default UserCoursesDebug; 