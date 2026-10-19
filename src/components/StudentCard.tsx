import React, { useState } from 'react';
import {
  Card,
  CardContent,
  Avatar,
  Typography,
  Box,
  Chip,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
} from '@mui/material';
import {
  MoreVert as MoreIcon,
  School as SchoolIcon,
  Phone as PhoneIcon,
  Email as EmailIcon,
  CalendarToday as CalendarIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Cancel as CancelIcon,
  Chat as ChatIcon,
  Edit as EditIcon,
  Assignment as AssignIcon,
} from '@mui/icons-material';
import { StudentAccount } from '../types/student';
import {
  formatDate,
  formatDateRelative,
  getDaysUntilExam,
  getProfilePhoto,
  getProfileStatus,
  getSubscriptionColor,
} from '../services/studentService';
import ImageLightbox from './ImageLightbox';

interface StudentCardProps {
  student: StudentAccount;
  onViewDetails: () => void;
  onEdit: () => void;
  onAssignCourses?: () => void;
  onSendMessage?: () => void;
}

const StudentCard: React.FC<StudentCardProps> = ({
  student,
  onViewDetails,
  onEdit,
  onAssignCourses,
  onSendMessage,
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const open = Boolean(anchorEl);

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleAvatarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (student.photoUrl) {
      setLightboxOpen(true);
    }
  };

  const profileStatus = getProfileStatus(student);
  const daysUntilExam = getDaysUntilExam(student.examDate);
  const profilePhotoUrl = getProfilePhoto(student.photoUrl);

  const renderStatusPill = () => {
    switch (profileStatus) {
      case 'complete':
        return (
          <Chip
            icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10B981', ml: 1 }} />}
            label="Profile Complete"
            size="small"
            sx={{
              height: 22,
              fontSize: '0.6875rem',
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
            label="Incomplete Profile"
            size="small"
            sx={{
              height: 22,
              fontSize: '0.6875rem',
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
            label="Not Started"
            size="small"
            sx={{
              height: 22,
              fontSize: '0.6875rem',
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
    <Card
      sx={{
        borderRadius: 3.5,
        border: '1px solid #E2E8F0',
        backgroundColor: '#FFFFFF',
        boxShadow: '0 1px 3px rgba(7, 26, 82, 0.04)',
        transition: 'all 0.15s ease-in-out',
        cursor: 'pointer',
        '&:hover': {
          borderColor: '#071A52',
          boxShadow: '0 4px 16px rgba(7, 26, 82, 0.06)',
        },
      }}
      onClick={onViewDetails}
    >
      <CardContent sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
          {/* Profile Photo */}
          <Avatar
            src={profilePhotoUrl}
            alt={student.displayName}
            onClick={handleAvatarClick}
            sx={{
              width: 68,
              height: 68,
              borderRadius: 3,
              backgroundColor: 'rgba(7, 26, 82, 0.08)',
              color: '#071A52',
              fontSize: '1.25rem',
              fontWeight: 700,
              border: '2px solid #E2E8F0',
              cursor: student.photoUrl ? 'pointer' : 'default',
              transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
              '&:hover': student.photoUrl
                ? {
                    transform: 'scale(1.06)',
                    boxShadow: '0 4px 16px rgba(7, 26, 82, 0.2)',
                  }
                : {},
            }}
          >
            {student.displayName.charAt(0).toUpperCase()}
          </Avatar>

          {/* Student Details */}
          <Box sx={{ flexGrow: 1 }}>
            {/* Top Row: Name and Context Menu */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="h6" sx={{ fontWeight: 700, color: '#071A52', fontSize: '1rem', lineHeight: 1.2 }}>
                  {student.displayName}
                </Typography>
                {renderStatusPill()}
              </Box>

              <IconButton size="small" onClick={handleMenuClick} sx={{ color: '#94A3B8' }}>
                <MoreIcon fontSize="small" />
              </IconButton>
            </Box>

            {/* Contact Row */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, flexWrap: 'wrap', mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: '#64748B', fontSize: '0.8125rem' }}>
                <EmailIcon sx={{ fontSize: 16, color: '#94A3B8' }} />
                <span>{student.email}</span>
              </Box>
              {student.mobile && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: '#64748B', fontSize: '0.8125rem' }}>
                  <PhoneIcon sx={{ fontSize: 16, color: '#94A3B8' }} />
                  <span>{student.mobile}</span>
                </Box>
              )}
            </Box>

            {/* Meta Row: Dates & Counts */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', pt: 1, borderTop: '1px solid #F1F5F9' }}>
              {student.dateOfJoining && (
                <Box sx={{ color: '#64748B', fontSize: '0.75rem' }}>
                  <span style={{ color: '#94A3B8' }}>Admitted: </span>
                  <span style={{ fontWeight: 600, color: '#071A52' }}>{formatDateRelative(student.dateOfJoining)}</span>
                </Box>
              )}

              {student.examDate && (
                <Box sx={{ color: '#64748B', fontSize: '0.75rem' }}>
                  <span style={{ color: '#94A3B8' }}>Exam Date: </span>
                  <span
                    style={{
                      fontWeight: 700,
                      color: daysUntilExam !== null && daysUntilExam < 30 ? '#D92D20' : '#071A52',
                    }}
                  >
                    {formatDate(student.examDate)}
                    {daysUntilExam !== null && daysUntilExam >= 0 && (
                      <span style={{ marginLeft: 4, fontWeight: 500, color: daysUntilExam < 30 ? '#D92D20' : '#64748B' }}>
                        ({daysUntilExam}d left)
                      </span>
                    )}
                  </span>
                </Box>
              )}

              {student.subscriptionPeriod && (
                <Chip
                  label={student.subscriptionPeriod}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    backgroundColor: 'rgba(7, 26, 82, 0.08)',
                    color: '#071A52',
                  }}
                />
              )}

              <Chip
                icon={<SchoolIcon sx={{ fontSize: '13px !important', color: '#006B5F !important' }} />}
                label={`${student.assignedCourseIds.length} Curricul${student.assignedCourseIds.length === 1 ? 'um' : 'a'}`}
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  backgroundColor: '#F8FAFC',
                  color: '#071A52',
                  border: '1px solid #E2E8F0',
                }}
              />

              {/* Action Buttons Right-Aligned */}
              <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewDetails();
                  }}
                  sx={{
                    borderColor: '#E2E8F0',
                    color: '#071A52',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    height: 30,
                    px: 1.5,
                    borderRadius: '6px',
                    '&:hover': { borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
                  }}
                >
                  View File
                </Button>

                <Button
                  size="small"
                  variant="contained"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  sx={{
                    backgroundColor: '#071A52',
                    color: '#FFFFFF',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    height: 30,
                    px: 1.5,
                    borderRadius: '6px',
                    '&:hover': { backgroundColor: '#0C2570' },
                  }}
                >
                  Edit
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Action Menu */}
        <Menu
          anchorEl={anchorEl}
          open={open}
          onClose={handleMenuClose}
          onClick={(e) => e.stopPropagation()}
          slotProps={{
            paper: {
              elevation: 2,
              sx: {
                borderRadius: 2.5,
                border: '1px solid #E2E8F0',
                minWidth: 160,
                p: 0.5,
              },
            },
          }}
        >
          <MenuItem
            onClick={() => {
              handleMenuClose();
              onViewDetails();
            }}
            sx={{ fontSize: '0.8125rem', py: 0.75, borderRadius: 1.5 }}
          >
            View Candidate File
          </MenuItem>
          <MenuItem
            onClick={() => {
              handleMenuClose();
              onEdit();
            }}
            sx={{ fontSize: '0.8125rem', py: 0.75, borderRadius: 1.5 }}
          >
            <EditIcon sx={{ fontSize: 16, mr: 1, color: '#071A52' }} />
            Edit Profile
          </MenuItem>
          {onAssignCourses && (
            <MenuItem
              onClick={() => {
                handleMenuClose();
                onAssignCourses();
              }}
              sx={{ fontSize: '0.8125rem', py: 0.75, borderRadius: 1.5 }}
            >
              <AssignIcon sx={{ fontSize: 16, mr: 1, color: '#071A52' }} />
              Assign Curricula
            </MenuItem>
          )}
          {onSendMessage && (
            <MenuItem
              onClick={() => {
                handleMenuClose();
                onSendMessage();
              }}
              sx={{ fontSize: '0.8125rem', py: 0.75, borderRadius: 1.5 }}
            >
              <ChatIcon sx={{ fontSize: 16, mr: 1, color: '#006B5F' }} />
              Direct Message
            </MenuItem>
          )}
        </Menu>
      </CardContent>

      <ImageLightbox
        open={lightboxOpen}
        imageUrl={student.photoUrl || null}
        alt={`${student.displayName}'s profile picture`}
        onClose={() => setLightboxOpen(false)}
      />
    </Card>
  );
};

export default StudentCard;
