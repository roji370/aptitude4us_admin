import React, { useState, useCallback } from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { CloudUpload as CloudUploadIcon } from '@mui/icons-material';

interface DragDropZoneProps {
  onFilesDropped: (files: File[]) => void;
  acceptedTypes?: string;
  multiple?: boolean;
  children?: React.ReactNode;
  disabled?: boolean;
  title?: string;
  subtitle?: string;
  className?: string;
}

const DragDropZone: React.FC<DragDropZoneProps> = ({
  onFilesDropped,
  acceptedTypes,
  multiple = true,
  children,
  disabled = false,
  title,
  subtitle,
  className
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);

  const validateFileType = (file: File): boolean => {
    if (!acceptedTypes) return true;
    
    const accepted = acceptedTypes.split(',').map(type => type.trim());
    
    // Check MIME type
    if (accepted.some(type => {
      if (type.includes('*')) {
        return file.type.startsWith(type.replace('*', ''));
      }
      return file.type === type;
    })) {
      return true;
    }
    
    // Check file extension
    const fileExt = `.${file.name.split('.').pop()?.toLowerCase()}`;
    return accepted.some(type => type.startsWith('.') && type.toLowerCase() === fileExt);
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (disabled) return;
    
    setDragCounter(prev => prev + 1);
    
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragOver(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDragCounter(prev => {
      const newCount = prev - 1;
      if (newCount === 0) {
        setIsDragOver(false);
      }
      return newCount;
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (disabled) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    
    e.dataTransfer.dropEffect = 'copy';
  }, [disabled]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsDragOver(false);
    setDragCounter(0);
    
    if (disabled) return;
    
    const files = Array.from(e.dataTransfer.files);
    
    if (files.length === 0) return;
    
    // Filter files by accepted types
    const validFiles = acceptedTypes 
      ? files.filter(validateFileType)
      : files;
    
    if (validFiles.length === 0) {
      console.warn('No valid files found for the specified file types');
      return;
    }
    
    // Limit to single file if multiple is false
    const filesToProcess = multiple ? validFiles : [validFiles[0]];
    
    onFilesDropped(filesToProcess);
  }, [disabled, acceptedTypes, multiple, onFilesDropped]);

  return (
    <Paper
      className={className}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      sx={{
        border: isDragOver 
          ? '2px dashed #071A52' 
          : disabled 
            ? '2px dashed #e2e8f0'
            : '2px dashed #cbd5e1',
        borderRadius: 2,
        p: 3,
        textAlign: 'center',
        backgroundColor: isDragOver 
          ? 'rgba(7, 26, 82, 0.04)' 
          : disabled 
            ? '#f8fafc'
            : 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s ease-in-out',
        position: 'relative',
        minHeight: '120px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        '&:hover': disabled ? {} : {
          borderColor: '#071A52',
          backgroundColor: 'rgba(7, 26, 82, 0.02)',
        }
      }}
    >
      {children || (
        <Box>
          <CloudUploadIcon 
            sx={{ 
              fontSize: 48, 
              color: isDragOver ? 'primary.main' : disabled ? 'text.disabled' : 'text.secondary',
              mb: 1
            }} 
          />
          <Typography 
            variant="h6" 
            sx={{ 
              color: isDragOver ? 'primary.main' : disabled ? 'text.disabled' : 'text.primary',
              mb: 0.5
            }}
          >
            {title || (isDragOver ? 'Drop files here' : 'Drag & Drop Files')}
          </Typography>
          <Typography 
            variant="body2" 
            sx={{ 
              color: disabled ? 'text.disabled' : 'text.secondary'
            }}
          >
            {subtitle || 'Or click to browse files'}
          </Typography>
          {acceptedTypes && (
            <Typography 
              variant="caption" 
              sx={{ 
                color: 'text.secondary',
                mt: 1,
                display: 'block'
              }}
            >
              Accepted: {acceptedTypes.replace(/application\/[^,]+/g, '').replace(/,/g, ', ')}
            </Typography>
          )}
        </Box>
      )}
      
      {isDragOver && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(25, 118, 210, 0.1)',
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1
          }}
        >
          <Typography variant="h6" color="primary">
            Drop files here!
          </Typography>
        </Box>
      )}
    </Paper>
  );
};

export default DragDropZone;
