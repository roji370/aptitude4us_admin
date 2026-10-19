import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  IconButton,
  Typography,
  Slider,
  Paper
} from '@mui/material';
import {
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  VolumeUp as VolumeIcon
} from '@mui/icons-material';

interface VoiceMessageDisplayProps {
  audioUrl: string;
  duration: number;
  isCurrentUser: boolean;
  timestamp: Date;
  compact?: boolean;
}

const VoiceMessageDisplay: React.FC<VoiceMessageDisplayProps> = ({
  audioUrl,
  duration,
  isCurrentUser,
  timestamp,
  compact = false
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Toggle play/pause
  const togglePlayback = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  // Handle audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleLoadedMetadata = () => {
      setIsLoaded(true);
    };

    const handleCanPlay = () => {
      setIsLoaded(true);
    };

    const handleError = () => {
      console.error('Error loading voice message audio');
      setIsLoaded(false);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('error', handleError);
    };
  }, [audioUrl]);

  // Handle slider change
  const handleSliderChange = (event: Event, newValue: number | number[]) => {
    if (audioRef.current) {
      audioRef.current.currentTime = newValue as number;
      setCurrentTime(newValue as number);
    }
  };

  if (compact) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
        <IconButton
          size="small"
          onClick={togglePlayback}
          disabled={!isLoaded}
          sx={{
            color: isCurrentUser ? '#ffffff' : '#071A52',
            backgroundColor: isCurrentUser ? 'rgba(255, 255, 255, 0.2)' : 'rgba(7, 26, 82, 0.08)',
            '&:hover': {
              backgroundColor: isCurrentUser ? 'rgba(255, 255, 255, 0.3)' : 'rgba(7, 26, 82, 0.16)'
            }
          }}
        >
          {isPlaying ? <PauseIcon fontSize="small" /> : <PlayIcon fontSize="small" />}
        </IconButton>
        
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Slider
            size="small"
            value={currentTime}
            max={duration}
            onChange={handleSliderChange}
            disabled={!isLoaded}
            sx={{
              color: isCurrentUser ? '#ffffff' : '#071A52',
              height: 3,
              '& .MuiSlider-thumb': {
                width: 10,
                height: 10
              },
              '& .MuiSlider-track': {
                height: 3
              },
              '& .MuiSlider-rail': {
                height: 3,
                opacity: isCurrentUser ? 0.3 : 0.2
              }
            }}
          />
        </Box>

        <Typography
          variant="caption"
          sx={{
            color: isCurrentUser ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.6)',
            fontSize: '0.7rem',
            minWidth: '35px',
            textAlign: 'right'
          }}
        >
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </Typography>

        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
        />
      </Box>
    );
  }

  return (
    <Paper
      elevation={1}
      sx={{
        p: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        minWidth: 200,
        maxWidth: 300,
        backgroundColor: isCurrentUser ? 'rgba(255, 255, 255, 0.1)' : '#f8fafc',
        borderRadius: 2,
        border: isCurrentUser ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid #e2e8f0'
      }}
    >
      <IconButton
        onClick={togglePlayback}
        disabled={!isLoaded}
        sx={{
          color: isCurrentUser ? '#ffffff' : '#071A52',
          backgroundColor: isCurrentUser ? 'rgba(255, 255, 255, 0.2)' : 'rgba(7, 26, 82, 0.08)',
          '&:hover': {
            backgroundColor: isCurrentUser ? 'rgba(255, 255, 255, 0.3)' : 'rgba(7, 26, 82, 0.16)'
          },
          '&:disabled': {
            color: isCurrentUser ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.3)'
          }
        }}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </IconButton>

      <VolumeIcon
        sx={{
          color: isCurrentUser ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.5)',
          fontSize: '1.2rem'
        }}
      />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Slider
          value={currentTime}
          max={duration}
          onChange={handleSliderChange}
          disabled={!isLoaded}
          sx={{
            color: isCurrentUser ? '#ffffff' : '#071A52',
            height: 4,
            '& .MuiSlider-thumb': {
              width: 12,
              height: 12
            },
            '& .MuiSlider-track': {
              height: 4
            },
            '& .MuiSlider-rail': {
              height: 4,
              opacity: isCurrentUser ? 0.3 : 0.2
            }
          }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
          <Typography
            variant="caption"
            sx={{
              color: isCurrentUser ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.6)',
              fontSize: '0.7rem'
            }}
          >
            {formatDuration(currentTime)}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: isCurrentUser ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.6)',
              fontSize: '0.7rem'
            }}
          >
            {formatDuration(duration)}
          </Typography>
        </Box>
      </Box>

      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
      />
    </Paper>
  );
};

export default VoiceMessageDisplay;
