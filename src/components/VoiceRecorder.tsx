import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Box,
  IconButton,
  Typography,
  LinearProgress,
  Button,
  Paper,
  Slider
} from '@mui/material';
import {
  Mic as MicIcon,
  MicOff as MicOffIcon,
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  Stop as StopIcon,
  Delete as DeleteIcon,
  Send as SendIcon
} from '@mui/icons-material';

interface VoiceRecorderProps {
  onVoiceMessage: (audioBlob: Blob, duration: number) => void;
  disabled?: boolean;
}

interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  audioBlob: Blob | null;
  audioUrl: string | null;
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onVoiceMessage, disabled = false }) => {
  const [recordingState, setRecordingState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    duration: 0,
    audioBlob: null,
    audioUrl: null
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [showPlayback, setShowPlayback] = useState(false);
  const [showRecordingUI, setShowRecordingUI] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  // Clear error function
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Check browser compatibility on mount
  useEffect(() => {
    if (!window.isSecureContext) {
      setError('Voice recording requires a secure connection (HTTPS). Please access this page over HTTPS.');
    } else if (!window.MediaRecorder) {
      setError('Voice recording is not supported in this browser. Please use a modern browser like Chrome, Firefox, or Edge.');
    } else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Microphone access is not supported in this browser. Please use a modern browser.');
    }
  }, []);

  // Request microphone permission and initialize
  const initializeRecorder = useCallback(async () => {
    try {
      // Check if we're in a secure context
      if (!window.isSecureContext) {
        setError('Voice recording requires a secure connection (HTTPS). Please access this page over HTTPS.');
        return false;
      }

      // Check if MediaRecorder is supported
      if (!window.MediaRecorder) {
        setError('Voice recording is not supported in this browser. Please use a modern browser like Chrome, Firefox, or Edge.');
        return false;
      }

      // Check if getUserMedia is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError('Microphone access is not supported in this browser. Please use a modern browser.');
        return false;
      }

      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });

      // Check if MediaRecorder supports the stream
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        console.warn('audio/webm not supported, trying audio/mp4');
        if (!MediaRecorder.isTypeSupported('audio/mp4')) {
          console.warn('audio/mp4 not supported, using default');
        }
      }

      // Create MediaRecorder with proper mime type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
        ? 'audio/webm' 
        : MediaRecorder.isTypeSupported('audio/mp4') 
        ? 'audio/mp4' 
        : '';

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { 
          type: mimeType || 'audio/webm' 
        });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        setRecordingState(prev => ({
          ...prev,
          audioBlob,
          audioUrl,
          isRecording: false
        }));
        
        setShowPlayback(true);
        audioChunksRef.current = [];
      };

      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        setRecordingState(prev => ({
          ...prev,
          isRecording: false
        }));
        setShowRecordingUI(false);
      };

      setError(null); // Clear any previous errors
      return true;
    } catch (error) {
      console.error('Error accessing microphone:', error);
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          setError('Microphone permission denied. Please allow microphone access and try again.');
        } else if (error.name === 'NotFoundError') {
          setError('No microphone found. Please connect a microphone and try again.');
        } else if (error.name === 'NotSupportedError') {
          setError('Voice recording is not supported in this browser. Please use a modern browser.');
        } else {
          setError('Failed to access microphone. Please check your microphone and try again.');
        }
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
      return false;
    }
  }, []);

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      if (!mediaRecorderRef.current) {
        const success = await initializeRecorder();
        if (!success) {
          console.error('Failed to initialize recorder');
          return;
        }
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
        audioChunksRef.current = [];
        
        // Start recording with error handling
        try {
          mediaRecorderRef.current.start(100); // Collect data every 100ms
        } catch (startError) {
          console.error('Error starting MediaRecorder:', startError);
          // Try to reinitialize and start again
          const success = await initializeRecorder();
          if (success && mediaRecorderRef.current) {
            try {
              mediaRecorderRef.current.start(100);
            } catch (retryError) {
              console.error('Error starting MediaRecorder after retry:', retryError);
              return;
            }
          } else {
            return;
          }
        }
        
        startTimeRef.current = Date.now();
        
        setRecordingState(prev => ({
          ...prev,
          isRecording: true,
          isPaused: false,
          duration: 0
        }));

        // Show recording UI
        setShowRecordingUI(true);
        setShowPlayback(false);

        // Start timer
        intervalRef.current = setInterval(() => {
          setRecordingState(prev => ({
            ...prev,
            duration: Math.floor((Date.now() - startTimeRef.current) / 1000)
          }));
        }, 100);
      }
    } catch (error) {
      console.error('Error in startRecording:', error);
      setError('Failed to start recording. Please try again.');
      setRecordingState(prev => ({
        ...prev,
        isRecording: false
      }));
      setShowRecordingUI(false);
    }
  }, [initializeRecorder]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      // Hide recording UI
      setShowRecordingUI(false);
    }
  }, []);

  // Cancel recording
  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    setRecordingState({
      isRecording: false,
      isPaused: false,
      duration: 0,
      audioBlob: null,
      audioUrl: null
    });
    setShowPlayback(false);
    setShowRecordingUI(false);
    setPlaybackPosition(0);
    setIsPlaying(false);
    setError(null);
  }, []);

  // Play/pause audio
  const togglePlayback = useCallback(() => {
    if (!audioRef.current || !recordingState.audioUrl) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying, recordingState.audioUrl]);

  // Handle audio playback events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setPlaybackPosition(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setPlaybackPosition(0);
    };

    const handleLoadedMetadata = () => {
      // Audio is ready to play
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [recordingState.audioUrl]);

  // Send voice message
  const sendVoiceMessage = useCallback(() => {
    if (recordingState.audioBlob) {
      onVoiceMessage(recordingState.audioBlob, recordingState.duration);
      
      // Reset state
      setRecordingState({
        isRecording: false,
        isPaused: false,
        duration: 0,
        audioBlob: null,
        audioUrl: null
      });
      setShowPlayback(false);
      setShowRecordingUI(false);
      setPlaybackPosition(0);
      setIsPlaying(false);
    }
  }, [recordingState.audioBlob, recordingState.duration, onVoiceMessage]);

  // Delete recording
  const deleteRecording = useCallback(() => {
    if (recordingState.audioUrl) {
      URL.revokeObjectURL(recordingState.audioUrl);
    }
    
    setRecordingState({
      isRecording: false,
      isPaused: false,
      duration: 0,
      audioBlob: null,
      audioUrl: null
    });
    setShowPlayback(false);
    setShowRecordingUI(false);
    setPlaybackPosition(0);
    setIsPlaying(false);
    setError(null);
  }, [recordingState.audioUrl]);

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (recordingState.audioUrl) {
        URL.revokeObjectURL(recordingState.audioUrl);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [recordingState.audioUrl]);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {/* Microphone Button - only show when not recording or in playback */}
      {!showRecordingUI && !showPlayback && !error && (
        <IconButton
          onClick={startRecording}
          disabled={disabled}
          sx={{
            color: '#071A52',
            backgroundColor: 'transparent',
            '&:hover': {
              backgroundColor: 'rgba(7, 26, 82, 0.08)'
            },
            transition: 'all 0.2s ease'
          }}
        >
          <MicIcon />
        </IconButton>
      )}

      {/* Error Display */}
      {error && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 200 }}>
          <Typography 
            variant="caption" 
            sx={{ 
              color: '#f44336', 
              fontSize: '0.7rem',
              flex: 1
            }}
          >
            {error}
          </Typography>
          <Button
            size="small"
            onClick={clearError}
            sx={{ 
              minWidth: 'auto', 
              px: 1, 
              color: '#071A52',
              fontSize: '0.7rem'
            }}
          >
            Retry
          </Button>
        </Box>
      )}

      {/* Recording State UI */}
      {showRecordingUI && recordingState.isRecording && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 200 }}>
          <IconButton
            onClick={stopRecording}
            sx={{
              color: '#f44336',
              backgroundColor: 'rgba(244, 67, 54, 0.1)',
              '&:hover': {
                backgroundColor: 'rgba(244, 67, 54, 0.2)'
              },
              transition: 'all 0.2s ease'
            }}
          >
            <StopIcon />
          </IconButton>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: '#f44336',
                animation: 'pulse 1s infinite'
              }}
            />
            <Typography variant="caption" sx={{ color: '#f44336', fontWeight: 500 }}>
              Recording... {formatDuration(recordingState.duration)}
            </Typography>
          </Box>
          
          <Button
            size="small"
            onClick={cancelRecording}
            sx={{ 
              minWidth: 'auto', 
              px: 1, 
              color: '#f44336',
              fontSize: '0.7rem'
            }}
          >
            Cancel
          </Button>
        </Box>
      )}

      {/* Playback Controls */}
      {showPlayback && recordingState.audioUrl && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            minWidth: 200,
            maxWidth: 300,
            p: 1,
            backgroundColor: '#f8fafc',
            borderRadius: 2,
            border: '1px solid #e2e8f0'
          }}
        >
          <IconButton
            size="small"
            onClick={togglePlayback}
            sx={{ 
              color: '#071A52',
              backgroundColor: 'rgba(7, 26, 82, 0.08)',
              '&:hover': {
                backgroundColor: 'rgba(7, 26, 82, 0.16)'
              }
            }}
          >
            {isPlaying ? <PauseIcon fontSize="small" /> : <PlayIcon fontSize="small" />}
          </IconButton>
          
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Slider
              size="small"
              value={playbackPosition}
              max={recordingState.duration}
              onChange={(_, value) => {
                if (audioRef.current) {
                  audioRef.current.currentTime = value as number;
                  setPlaybackPosition(value as number);
                }
              }}
              sx={{
                color: '#071A52',
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
                  opacity: 0.2
                }
              }}
            />
            <Typography variant="caption" sx={{ color: '#666', fontSize: '0.7rem' }}>
              {formatDuration(Math.floor(playbackPosition))} / {formatDuration(recordingState.duration)}
            </Typography>
          </Box>

          <IconButton
            size="small"
            onClick={deleteRecording}
            sx={{ 
              color: '#f44336',
              '&:hover': {
                backgroundColor: 'rgba(244, 67, 54, 0.1)'
              }
            }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>

          <IconButton
            size="small"
            onClick={sendVoiceMessage}
            sx={{ 
              color: '#071A52',
              backgroundColor: 'rgba(7, 26, 82, 0.08)',
              '&:hover': {
                backgroundColor: 'rgba(7, 26, 82, 0.16)'
              }
            }}
          >
            <SendIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {/* Hidden audio element for playback */}
      {recordingState.audioUrl && (
        <audio
          ref={audioRef}
          src={recordingState.audioUrl}
          preload="metadata"
        />
      )}

      {/* CSS for pulse animation */}
      <style>
        {`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
        `}
      </style>
    </Box>
  );
};

export default VoiceRecorder;
