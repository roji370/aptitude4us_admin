import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Box, 
  Typography, 
  Paper, 
  TextField, 
  Button, 
  FormControlLabel,
  Switch,
  CircularProgress,
  Alert,
  Grid,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Breadcrumbs,
  SelectChangeEvent
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Save as SaveIcon
} from '@mui/icons-material';
import { getCourseById, updateCourse, uploadCourseThumbnail } from '../services/courseService';
import type { Course } from '../services/courseService';

const EditCourse: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'General',
    isActive: true,
    isPublished: true
  });

  // Available categories
  const categories = ['General', 'Programming', 'Design', 'Business', 'Marketing', 'Other'];

  useEffect(() => {
    const fetchCourse = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
        const courseData = await getCourseById(id);
        
        if (!courseData) {
          setError('Course not found');
          setLoading(false);
          return;
        }
        
        setCourse(courseData);
        setFormData({
          title: courseData.title,
          description: courseData.description,
          category: courseData.category,
          isActive: courseData.isActive,
          isPublished: courseData.isPublished
        });
        
        if (courseData.thumbnailUrl) {
          setThumbnailPreview(courseData.thumbnailUrl);
        }
      } catch (error) {
        console.error('Error fetching course details:', error);
        setError('Failed to load course details');
      } finally {
        setLoading(false);
      }
    };
    
    fetchCourse();
  }, [id]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSwitchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    
    setFormData(prev => ({
      ...prev,
      [name]: checked
    }));
  };

  const handleCategoryChange = (e: SelectChangeEvent) => {
    setFormData({
      ...formData,
      category: e.target.value
    });
  };

  const handleThumbnailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setThumbnailFile(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onload = () => {
        setThumbnailPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleBackClick = () => {
    navigate(`/courses/${id}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    
    if (!formData.title || !formData.description) {
      setError('Title and description are required');
      return;
    }
    
    setSaving(true);
    setError(null);
    setSuccess(null);
    
    try {
      // Update course data
      await updateCourse(id, {
        title: formData.title,
        description: formData.description,
        category: formData.category,
        isActive: formData.isActive
      });
      
      // Upload thumbnail if provided
      if (thumbnailFile) {
        await uploadCourseThumbnail(id, thumbnailFile);
      }
      
      setSuccess('Course updated successfully');
      
      // Fetch updated course
      const updatedCourse = await getCourseById(id);
      if (updatedCourse) {
        setCourse(updatedCourse);
      }
    } catch (error) {
      console.error('Error updating course:', error);
      setError('Failed to update course');
    } finally {
      setSaving(false);
    }
  };
  
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <CircularProgress />
      </Box>
    );
  }
  
  if (!course) {
    return (
      <Box sx={{ flexGrow: 1 }}>
        <Alert severity="error">Course not found</Alert>
        <Button 
          startIcon={<ArrowBackIcon />} 
          onClick={() => navigate('/courses')}
          sx={{ mt: 2 }}
        >
          Back to Courses
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ flexGrow: 1 }}>
      <Box sx={{ mb: 4 }}>
        <Breadcrumbs aria-label="breadcrumb">
          <Button 
            color="inherit"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/courses')}
          >
            Courses
          </Button>
          <Button 
            color="inherit"
            onClick={() => navigate(`/courses/${id}`)}
          >
            {course.title}
          </Button>
          <Typography color="text.primary">Edit</Typography>
        </Breadcrumbs>
      </Box>

      <Typography variant="h4" component="h1" gutterBottom>
        Edit Course
      </Typography>
      
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mb: 3 }}>
          {success}
        </Alert>
      )}
      
      <Paper sx={{ p: 3 }}>
        <form onSubmit={handleSubmit}>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                required
                id="title"
                name="title"
                label="Course Title"
                value={formData.title}
                onChange={handleInputChange}
              />
            </Grid>
            
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth>
                <InputLabel id="category-label">Category</InputLabel>
                <Select
                  labelId="category-label"
                  id="category"
                  name="category"
                  value={formData.category}
                  label="Category"
                  onChange={handleCategoryChange}
                >
                  {categories.map((category) => (
                    <MenuItem key={category} value={category}>
                      {category}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.isActive}
                    onChange={handleSwitchChange}
                    name="isActive"
                    color="primary"
                  />
                }
                label="Active Course"
              />
            </Grid>
            
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.isPublished}
                    onChange={handleSwitchChange}
                    name="isPublished"
                    color="success"
                  />
                }
                label="Published (Visible to Students)"
              />
            </Grid>
            
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                required
                id="description"
                name="description"
                label="Course Description"
                multiline
                rows={4}
                value={formData.description}
                onChange={handleInputChange}
              />
            </Grid>
            
            <Grid size={{ xs: 12 }}>
              <Typography variant="subtitle1" gutterBottom>
                Course Thumbnail
              </Typography>
              
              {thumbnailPreview && (
                <Box sx={{ mb: 2, maxWidth: '300px' }}>
                  <img 
                    src={thumbnailPreview} 
                    alt="Thumbnail preview" 
                    style={{ width: '100%', borderRadius: '4px' }}
                  />
                </Box>
              )}
              
              <Button
                variant="outlined"
                component="label"
              >
                Upload Thumbnail
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleThumbnailChange}
                />
              </Button>
            </Grid>
            
            <Grid size={{ xs: 12 }} sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
              <Button
                variant="outlined"
                startIcon={<ArrowBackIcon />}
                onClick={handleBackClick}
              >
                Cancel
              </Button>
              
              <Button
                type="submit"
                variant="contained"
                color="primary"
                startIcon={<SaveIcon />}
                disabled={saving}
              >
                {saving ? <CircularProgress size={24} /> : 'Save Changes'}
              </Button>
            </Grid>
          </Grid>
        </form>
      </Paper>
    </Box>
  );
};

export default EditCourse; 