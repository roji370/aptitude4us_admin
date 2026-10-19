import React, { useState } from 'react';
import {
  Box,
  Card,
  CardMedia,
  CardContent,
  Typography,
  IconButton,
  Chip,
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  Grid
} from '@mui/material';
import {
  Download as DownloadIcon,
  PlayArrow as PlayIcon,
  Fullscreen as FullscreenIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import { MessageAttachment } from '../services/messageService';
import { formatFileSize, getFileIcon } from '../services/attachmentService';

interface MessageAttachmentDisplayProps {
  attachments: MessageAttachment[];
  compact?: boolean;
}

const MessageAttachmentDisplay: React.FC<MessageAttachmentDisplayProps> = ({
  attachments,
  compact = false
}) => {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<MessageAttachment | null>(null);

  const handlePreview = (attachment: MessageAttachment) => {
    if (attachment.type === 'image' || attachment.type === 'video') {
      setSelectedAttachment(attachment);
      setPreviewOpen(true);
    } else {
      // For documents and audio, just download
      handleDownload(attachment);
    }
  };

  const handleDownload = (attachment: MessageAttachment) => {
    const link = document.createElement('a');
    link.href = attachment.url;
    link.download = attachment.name || 'download';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClosePreview = () => {
    setPreviewOpen(false);
    setSelectedAttachment(null);
  };

  const renderAttachment = (attachment: MessageAttachment, index: number) => {
    switch (attachment.type) {
      case 'image':
        return (
          <Card 
            key={attachment.id} 
            sx={{ 
              maxWidth: compact ? 200 : 300, 
              cursor: 'pointer',
              '&:hover': { opacity: 0.8 }
            }}
            onClick={() => handlePreview(attachment)}
          >
            <Box
              sx={{
                width: '100%',
                height: compact ? 120 : 200,
                backgroundColor: '#f5f5f5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                position: 'relative'
              }}
            >
              <CardMedia
                component="img"
                loading="lazy"
                image={attachment.thumbnailUrl || attachment.url || '/placeholder-image.png'}
                alt={attachment.name || 'Unknown File'}
                sx={{ 
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  position: 'absolute',
                  top: 0,
                  left: 0
                }}
                onLoad={(e) => {
                  // Ensure the image stays within the fixed container
                  const img = e.target as HTMLImageElement;
                  img.style.opacity = '1';
                }}
                onError={(e) => {
                  // Show fallback text in the fixed-height container
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const container = target.parentElement;
                  if (container) {
                    container.innerHTML = `
                      <div style="display: flex; align-items: center; justify-content: center; color: #666; font-size: 14px;">
                        🖼️ Image unavailable
                      </div>
                    `;
                  }
                }}
                style={{ opacity: 0 }}
              />
            </Box>
            <CardContent sx={{ p: 1 }}>
              <Typography variant="caption" noWrap>
                {attachment.name || 'Unknown File'}
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {formatFileSize(attachment.size)}
                </Typography>
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDownload(attachment); }}>
                  <DownloadIcon fontSize="small" />
                </IconButton>
              </Box>
            </CardContent>
          </Card>
        );

      case 'video':
        return (
          <Card 
            key={attachment.id} 
            sx={{ 
              maxWidth: compact ? 200 : 300,
              cursor: 'pointer',
              position: 'relative',
              '&:hover': { opacity: 0.8 }
            }}
            onClick={() => handlePreview(attachment)}
          >
            <Box sx={{ position: 'relative' }}>
              <CardMedia
                component="video"
                height={compact ? 120 : 200}
                src={attachment.url}
                sx={{ objectFit: 'cover' }}
              />
              <IconButton
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  color: 'white',
                  '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' }
                }}
              >
                <PlayIcon />
              </IconButton>
            </Box>
            <CardContent sx={{ p: 1 }}>
              <Typography variant="caption" noWrap>
                {attachment.name || 'Unknown File'}
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {formatFileSize(attachment.size)}
                </Typography>
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDownload(attachment); }}>
                  <DownloadIcon fontSize="small" />
                </IconButton>
              </Box>
            </CardContent>
          </Card>
        );

      case 'audio':
        return (
          <Card key={attachment.id} sx={{ maxWidth: compact ? 200 : 300 }}>
            <CardContent sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6" sx={{ mr: 1 }}>
                  🎵
                </Typography>
                <Typography variant="body2" noWrap sx={{ flexGrow: 1 }}>
                  {attachment.name || 'Unknown File'}
                </Typography>
              </Box>
              <audio controls style={{ width: '100%', marginBottom: 8 }}>
                <source src={attachment.url || ''} type={attachment.mimeType || 'audio/mpeg'} />
                <track kind="captions" />
                Your browser does not support the audio element.
              </audio>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary">
                  {formatFileSize(attachment.size)}
                </Typography>
                <IconButton size="small" onClick={() => handleDownload(attachment)}>
                  <DownloadIcon fontSize="small" />
                </IconButton>
              </Box>
            </CardContent>
          </Card>
        );

      case 'document':
      default:
        return (
          <Card 
            key={attachment.id} 
            sx={{ 
              maxWidth: compact ? 200 : 300,
              cursor: 'pointer',
              '&:hover': { backgroundColor: 'action.hover' }
            }}
            onClick={() => handleDownload(attachment)}
          >
            <CardContent sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6" sx={{ mr: 1 }}>
                  {getFileIcon(attachment.mimeType)}
                </Typography>
                <Typography variant="body2" noWrap sx={{ flexGrow: 1 }}>
                  {attachment.name || 'Unknown File'}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Chip 
                  label={attachment.mimeType.split('/')[1].toUpperCase()} 
                  size="small" 
                  variant="outlined"
                />
                <Typography variant="caption" color="text.secondary">
                  {formatFileSize(attachment.size)}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        );
    }
  };

  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Grid container spacing={1}>
        {attachments.map((attachment, index) => (
          <Grid key={attachment.id}>
            {renderAttachment(attachment, index)}
          </Grid>
        ))}
      </Grid>

      {/* Preview Dialog */}
      <Dialog
        open={previewOpen}
        onClose={handleClosePreview}
        maxWidth="lg"
        fullWidth
        sx={{ '& .MuiDialog-paper': { backgroundColor: 'black' } }}
      >
        <DialogActions sx={{ p: 1, justifyContent: 'space-between' }}>
          <Typography variant="h6" color="white">
            {selectedAttachment?.name}
          </Typography>
          <Box>
            <IconButton 
              color="primary" 
              onClick={() => selectedAttachment && handleDownload(selectedAttachment)}
            >
              <DownloadIcon />
            </IconButton>
            <IconButton color="primary" onClick={handleClosePreview}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogActions>
        <DialogContent sx={{ p: 0, textAlign: 'center' }}>
          {selectedAttachment?.type === 'image' && (
            <Box
              component="img"
              src={selectedAttachment.url}
              alt={selectedAttachment.name}
              sx={{
                maxWidth: '100%',
                maxHeight: '80vh',
                objectFit: 'contain'
              }}
            />
          )}
          {selectedAttachment?.type === 'video' && (
            <Box
              component="video"
              src={selectedAttachment.url}
              controls
              sx={{
                maxWidth: '100%',
                maxHeight: '80vh',
                objectFit: 'contain'
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default MessageAttachmentDisplay;
