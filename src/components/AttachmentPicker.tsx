import React, { useRef, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Typography,
  LinearProgress,
  Chip,
  Alert,
  Paper
} from '@mui/material';
import {
  AttachFile as AttachIcon,
  Image as ImageIcon,
  VideoLibrary as VideoIcon,
  Description as DocumentIcon,
  AudioFile as AudioIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import { MessageAttachment } from '../services/messageService';
import { 
  uploadMultipleAttachments, 
  validateFile, 
  formatFileSize, 
  getFileIcon,
  ALLOWED_FILE_TYPES 
} from '../services/attachmentService';

interface AttachmentPickerProps {
  onAttachmentsSelected: (attachments: MessageAttachment[]) => void;
  senderId: string;
  disabled?: boolean;
  maxFiles?: number;
}

const AttachmentPicker: React.FC<AttachmentPickerProps> = ({
  onAttachmentsSelected,
  senderId,
  disabled = false,
  maxFiles = 5
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // File input refs for different types
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const allFilesInputRef = useRef<HTMLInputElement>(null);

  const handleMenuOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const createAcceptString = (types: string[]) => types.join(',');

  const handleFileSelect = (inputRef: React.RefObject<HTMLInputElement | null>) => {
    inputRef.current?.click();
    handleMenuClose();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    // Validate each file
    const validFiles: File[] = [];
    const errors: string[] = [];

    for (const file of files) {
      const validation = validateFile(file);
      if (validation.valid) {
        validFiles.push(file);
      } else {
        errors.push(`${file.name}: ${validation.error}`);
      }
    }

    // Check max files limit
    if (selectedFiles.length + validFiles.length > maxFiles) {
      errors.push(`Cannot select more than ${maxFiles} files`);
      setError(errors.join('\n'));
      return;
    }

    if (errors.length > 0) {
      setError(errors.join('\n'));
    } else {
      setError(null);
    }

    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
    }

    // Reset input
    event.target.value = '';
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setError(null);
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    setUploadProgress(new Array(selectedFiles.length).fill(0));
    setError(null);

    try {
      const attachments = await uploadMultipleAttachments(
        selectedFiles,
        senderId,
        (fileIndex, progress) => {
          setUploadProgress(prev => {
            const newProgress = [...prev];
            newProgress[fileIndex] = progress;
            return newProgress;
          });
        }
      );

      onAttachmentsSelected(attachments);
      setSelectedFiles([]);
      setUploadProgress([]);
    } catch (error) {
      console.error('Error uploading attachments:', error);
      setError(error instanceof Error ? error.message : 'Failed to upload files');
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    setSelectedFiles([]);
    setUploadProgress([]);
    setError(null);
  };

  return (
    <Box>
      {/* Attachment button */}
      <IconButton
        onClick={handleMenuOpen}
        disabled={disabled || uploading}
        size="small"
        sx={{ mx: 0.3 }}
      >
        <AttachIcon fontSize="small" />
      </IconButton>

      {/* File type selection menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
      >
        <MenuItem onClick={() => handleFileSelect(imageInputRef)}>
          <ImageIcon sx={{ mr: 1 }} />
          Images
        </MenuItem>
        <MenuItem onClick={() => handleFileSelect(videoInputRef)}>
          <VideoIcon sx={{ mr: 1 }} />
          Videos
        </MenuItem>
        <MenuItem onClick={() => handleFileSelect(documentInputRef)}>
          <DocumentIcon sx={{ mr: 1 }} />
          Documents
        </MenuItem>
        <MenuItem onClick={() => handleFileSelect(audioInputRef)}>
          <AudioIcon sx={{ mr: 1 }} />
          Audio
        </MenuItem>
        <MenuItem onClick={() => handleFileSelect(allFilesInputRef)}>
          <AttachIcon sx={{ mr: 1 }} />
          All Files
        </MenuItem>
      </Menu>

      {/* Hidden file inputs */}
      <input
        type="file"
        ref={imageInputRef}
        style={{ display: 'none' }}
        accept={createAcceptString(ALLOWED_FILE_TYPES.image)}
        multiple
        onChange={handleFileChange}
        aria-label="Select image files"
      />
      <input
        type="file"
        ref={videoInputRef}
        style={{ display: 'none' }}
        accept={createAcceptString(ALLOWED_FILE_TYPES.video)}
        multiple
        onChange={handleFileChange}
        aria-label="Select video files"
      />
      <input
        type="file"
        ref={documentInputRef}
        style={{ display: 'none' }}
        accept={createAcceptString(ALLOWED_FILE_TYPES.document)}
        multiple
        onChange={handleFileChange}
        aria-label="Select document files"
      />
      <input
        type="file"
        ref={audioInputRef}
        style={{ display: 'none' }}
        accept={createAcceptString(ALLOWED_FILE_TYPES.audio)}
        multiple
        onChange={handleFileChange}
        aria-label="Select audio files"
      />
      <input
        type="file"
        ref={allFilesInputRef}
        style={{ display: 'none' }}
        accept={[
          ...ALLOWED_FILE_TYPES.image,
          ...ALLOWED_FILE_TYPES.video,
          ...ALLOWED_FILE_TYPES.document,
          ...ALLOWED_FILE_TYPES.audio
        ].join(',')}
        multiple
        onChange={handleFileChange}
        aria-label="Select any supported file type"
      />

      {/* Selected files preview */}
      {selectedFiles.length > 0 && (
        <Paper 
          elevation={1} 
          sx={{ 
            p: 2, 
            mt: 1, 
            maxWidth: 400,
            maxHeight: 200,
            overflow: 'auto'
          }}
        >
          <Typography variant="subtitle2" gutterBottom>
            Selected Files ({selectedFiles.length}/{maxFiles})
          </Typography>
          
          {selectedFiles.map((file, index) => (
            <Box key={index} sx={{ mb: 1 }}>
              <Chip
                label={`${getFileIcon(file.type)} ${file.name} (${formatFileSize(file.size)})`}
                onDelete={() => handleRemoveFile(index)}
                deleteIcon={<CloseIcon />}
                variant="outlined"
                size="small"
                sx={{ maxWidth: '100%' }}
              />
              
              {uploading && uploadProgress[index] !== undefined && (
                <LinearProgress 
                  variant="determinate" 
                  value={uploadProgress[index]} 
                  sx={{ mt: 0.5, height: 2 }}
                />
              )}
            </Box>
          ))}

          <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
            <Button
              variant="contained"
              size="small"
              onClick={handleUpload}
              disabled={uploading || selectedFiles.length === 0}
            >
              {uploading ? 'Uploading...' : 'Upload & Send'}
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={handleCancel}
              disabled={uploading}
            >
              Cancel
            </Button>
          </Box>
        </Paper>
      )}

      {/* Error display */}
      {error && (
        <Alert severity="error" sx={{ mt: 1, maxWidth: 400 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
};

export default AttachmentPicker;
