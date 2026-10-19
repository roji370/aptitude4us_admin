import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Avatar,
  Typography,
  Box,
  Chip,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Stack,
  Paper,
} from '@mui/material';
import {
  Close as CloseIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  CalendarToday as CalendarIcon,
  School as SchoolIcon,
  Edit as EditIcon,
  Chat as MessageIcon,
  Badge as BadgeIcon,
} from '@mui/icons-material';
import { StudentWithCourses } from '../types/student';
import {
  formatDate,
  getDaysUntilExam,
  getProfilePhoto,
  getProfileStatus,
  getSubscriptionColor,
} from '../services/studentService';
import ImageLightbox from './ImageLightbox';

interface StudentDetailsModalProps {
  student: StudentWithCourses | null;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAssignCourses?: () => void;
  onSendMessage?: () => void;
}

const StudentDetailsModal: React.FC<StudentDetailsModalProps> = ({
  student,
  open,
  onClose,
  onEdit,
  onAssignCourses,
  onSendMessage,
}) => {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (!student) return null;

  const profileStatus = getProfileStatus(student);
  const daysUntilExam = getDaysUntilExam(student.examDate);
  const profilePhotoUrl = getProfilePhoto(student.photoUrl);

  const handleAvatarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (student.photoUrl) {
      setLightboxOpen(true);
    }
  };

  const renderStatusPill = () => {
    switch (profileStatus) {
      case 'complete':
        return (
          <Chip
            icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10B981', ml: 1 }} />}
            label="Profile Complete"
            size="small"
            sx={{
              height: 24,
              fontSize: '0.75rem',
              fontWeight: 700,
              backgroundColor: '#ECFDF5',
              color: '#065F46',
              border: '1px solid #A7F3D0',
            }}
          />
        );
      case 'incomplete':
        return (
          <Chip
            icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#F59E0B', ml: 1 }} />}
            label="Profile Incomplete"
            size="small"
            sx={{
              height: 24,
              fontSize: '0.75rem',
              fontWeight: 700,
              backgroundColor: '#FFFBEB',
              color: '#92400E',
              border: '1px solid #FDE68A',
            }}
          />
        );
      case 'not-started':
        return (
          <Chip
            icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#D92D20', ml: 1 }} />}
            label="Profile Not Started"
            size="small"
            sx={{
              height: 24,
              fontSize: '0.75rem',
              fontWeight: 700,
              backgroundColor: '#FEF2F2',
              color: '#991B1B',
              border: '1px solid #FECDCA',
            }}
          />
        );
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      scroll="paper"
      slotProps={{
        paper: {
          elevation: 3,
          sx: {
            borderRadius: 4,
            border: '1px solid #E2E8F0',
            overflow: 'hidden',
          },
        },
      }}
    >
      <DialogTitle sx={{ px: 3, py: 2.25, backgroundColor: '#071A52', color: '#FFFFFF' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <BadgeIcon sx={{ color: '#A7FF83', fontSize: 22 }} />
            <Typography variant="h6" sx={{ color: '#FFFFFF', fontWeight: 700, fontSize: '1.0625rem' }}>
              Candidate File & Dossier
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small" sx={{ color: 'rgba(255, 255, 255, 0.8)', '&:hover': { color: '#FFFFFF' } }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 3.5, backgroundColor: '#FFFFFF' }}>
        {/* Profile Header */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3.5 }}>
          <Avatar
            src={profilePhotoUrl}
            alt={student.displayName}
            onClick={handleAvatarClick}
            sx={{
              width: 100,
              height: 100,
              borderRadius: 3.5,
              mb: 2,
              border: '3px solid #E2E8F0',
              backgroundColor: 'rgba(7, 26, 82, 0.08)',
              color: '#071A52',
              fontSize: '2rem',
              fontWeight: 700,
              cursor: student.photoUrl ? 'pointer' : 'default',
              transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
              '&:hover': student.photoUrl
                ? {
                    transform: 'scale(1.05)',
                    boxShadow: '0 4px 20px rgba(7, 26, 82, 0.2)',
                  }
                : {},
            }}
          >
            {student.displayName.charAt(0).toUpperCase()}
          </Avatar>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#071A52', mb: 0.5 }}>
            {student.displayName}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
            {renderStatusPill()}
            {student.subscriptionPeriod && (
              <Chip
                label={student.subscriptionPeriod}
                size="small"
                sx={{
                  height: 24,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  backgroundColor: 'rgba(7, 26, 82, 0.08)',
                  color: '#071A52',
                }}
              />
            )}
          </Box>
          <Typography variant="caption" sx={{ color: '#94A3B8', fontFamily: 'monospace', fontSize: '0.71875rem' }}>
            UID: {student.uid}
          </Typography>
        </Box>

        <Divider sx={{ mb: 3, borderColor: '#F1F5F9' }} />

        {/* Contact Information */}
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            mb: 2.5,
            borderRadius: 3,
            backgroundColor: '#F8FAFC',
            border: '1px solid #E2E8F0',
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, color: '#071A52', mb: 1.5 }}
          >
            <EmailIcon sx={{ fontSize: 18, color: '#071A52' }} /> Contact Credentials
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>
                Email Address
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, color: '#071A52' }}>
                {student.email}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>
                Mobile Contact
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, color: '#071A52' }}>
                {student.mobile || 'Not registered'}
              </Typography>
            </Grid>
          </Grid>
        </Paper>

        {/* Academy Information */}
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            mb: 2.5,
            borderRadius: 3,
            backgroundColor: '#F8FAFC',
            border: '1px solid #E2E8F0',
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, color: '#071A52', mb: 1.5 }}
          >
            <CalendarIcon sx={{ fontSize: 18, color: '#071A52' }} /> Academic Timeline
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>
                Date of Joining
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, color: '#071A52' }}>
                {student.dateOfJoining ? formatDate(student.dateOfJoining) : 'Not recorded'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="caption" sx={{ color: '#64748B', display: 'block' }}>
                Examination Target
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 700,
                  color: daysUntilExam !== null && daysUntilExam < 30 ? '#D92D20' : '#071A52',
                }}
              >
                {student.examDate ? formatDate(student.examDate) : 'Not scheduled'}
                {daysUntilExam !== null && daysUntilExam >= 0 && (
                  <Chip
                    label={`${daysUntilExam} days remaining`}
                    size="small"
                    sx={{
                      ml: 1,
                      height: 20,
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      backgroundColor: daysUntilExam < 30 ? '#FEF2F2' : '#EFF6FF',
                      color: daysUntilExam < 30 ? '#991B1B' : '#1E40AF',
                      border: daysUntilExam < 30 ? '1px solid #FECDCA' : '1px solid #BFDBFE',
                    }}
                  />
                )}
              </Typography>
            </Grid>
          </Grid>
        </Paper>

        {/* Assigned Courses */}
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            borderRadius: 3,
            backgroundColor: '#F8FAFC',
            border: '1px solid #E2E8F0',
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, color: '#071A52', mb: 1.5 }}
          >
            <SchoolIcon sx={{ fontSize: 18, color: '#071A52' }} /> Assigned Curricula ({student.assignedCourseIds.length})
          </Typography>
          {student.courses && student.courses.length > 0 ? (
            <List dense sx={{ p: 0 }}>
              {student.courses.map((course) => (
                <ListItem
                  key={course.id}
                  sx={{
                    px: 1.5,
                    py: 1,
                    mb: 0.75,
                    borderRadius: 2,
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                  }}
                >
                  <ListItemText
                    primary={
                      <Typography variant="body2" sx={{ fontWeight: 600, color: '#071A52' }}>
                        {course.title}
                      </Typography>
                    }
                    secondary={
                      <Typography variant="caption" sx={{ color: '#64748B' }}>
                        {course.category}
                      </Typography>
                    }
                  />
                </ListItem>
              ))}
            </List>
          ) : (
            <Typography variant="body2" sx={{ color: '#64748B', fontStyle: 'italic' }}>
              {student.assignedCourseIds.length > 0 ? 'Loading curricula data...' : 'No curricula assigned.'}
            </Typography>
          )}
        </Paper>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, backgroundColor: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
        <Stack direction="row" spacing={1.5} sx={{ width: '100%', justifyContent: 'space-between' }}>
          <Box>
            {onSendMessage && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<MessageIcon sx={{ fontSize: 17 }} />}
                onClick={() => {
                  onSendMessage();
                  onClose();
                }}
                sx={{
                  borderColor: '#E2E8F0',
                  color: '#071A52',
                  fontWeight: 600,
                  fontSize: '0.8125rem',
                  borderRadius: '8px',
                  backgroundColor: '#FFFFFF',
                  '&:hover': { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
                }}
              >
                Direct Message
              </Button>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {onAssignCourses && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<SchoolIcon sx={{ fontSize: 17 }} />}
                onClick={() => {
                  onAssignCourses();
                  onClose();
                }}
                sx={{
                  borderColor: '#E2E8F0',
                  color: '#071A52',
                  fontWeight: 600,
                  fontSize: '0.8125rem',
                  borderRadius: '8px',
                  backgroundColor: '#FFFFFF',
                  '&:hover': { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
                }}
              >
                Assign Curricula
              </Button>
            )}
            <Button
              variant="contained"
              size="small"
              startIcon={<EditIcon sx={{ fontSize: 17 }} />}
              onClick={() => {
                onEdit();
                onClose();
              }}
              sx={{
                backgroundColor: '#071A52',
                color: '#FFFFFF',
                fontWeight: 600,
                fontSize: '0.8125rem',
                borderRadius: '8px',
                px: 2,
                '&:hover': { backgroundColor: '#0C2570' },
              }}
            >
              Edit Profile
            </Button>
          </Box>
        </Stack>
      </DialogActions>

      <ImageLightbox
        open={lightboxOpen}
        imageUrl={student.photoUrl || null}
        alt={`${student.displayName}'s profile picture`}
        onClose={() => setLightboxOpen(false)}
      />
    </Dialog>
  );
};

export default StudentDetailsModal;
