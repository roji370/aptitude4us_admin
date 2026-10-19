import React, { useEffect, useCallback, useRef } from 'react';
import {
    Dialog,
    IconButton,
    Box,
    Zoom,
} from '@mui/material';
import {
    Close as CloseIcon,
    ZoomIn as ZoomInIcon,
    ZoomOut as ZoomOutIcon,
} from '@mui/icons-material';

interface ImageLightboxProps {
    open: boolean;
    imageUrl: string | null;
    alt: string;
    onClose: () => void;
}

const ImageLightbox: React.FC<ImageLightboxProps> = ({
    open,
    imageUrl,
    alt,
    onClose,
}) => {
    const [scale, setScale] = React.useState(1);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const previousActiveElementRef = useRef<HTMLElement | null>(null);

    // Store the previously focused element when opening
    useEffect(() => {
        if (open) {
            previousActiveElementRef.current = document.activeElement as HTMLElement;
        }
    }, [open]);

    // Return focus to the original element when closing
    const handleClose = useCallback(() => {
        onClose();
        // Return focus after a short delay to ensure the dialog is closed
        setTimeout(() => {
            if (previousActiveElementRef.current) {
                previousActiveElementRef.current.focus();
            }
        }, 100);
    }, [onClose]);

    // Handle Escape key
    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && open) {
                handleClose();
            }
        };

        if (open) {
            document.addEventListener('keydown', handleEscape);
            // Focus the close button when opened for keyboard accessibility
            setTimeout(() => {
                closeButtonRef.current?.focus();
            }, 100);
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
        };
    }, [open, handleClose]);

    // Reset scale when opening/closing
    useEffect(() => {
        if (open) {
            setScale(1);
        }
    }, [open]);

    const handleZoomIn = (e: React.MouseEvent) => {
        e.stopPropagation();
        setScale((prev) => Math.min(prev + 0.25, 3));
    };

    const handleZoomOut = (e: React.MouseEvent) => {
        e.stopPropagation();
        setScale((prev) => Math.max(prev - 0.25, 0.5));
    };

    const handleBackdropClick = () => {
        handleClose();
    };

    if (!imageUrl) return null;

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth={false}
            fullScreen
            slots={{ transition: Zoom }}
            slotProps={{ paper: {
                sx: {
                    bgcolor: 'rgba(0, 0, 0, 0.95)',
                    boxShadow: 'none',
                    overflow: 'hidden',
                },
            } }}
            transitionDuration={300}
            aria-labelledby="image-lightbox-title"
            aria-describedby="image-lightbox-description"
        >
            {/* Close Button */}
            <IconButton
                ref={closeButtonRef}
                onClick={handleClose}
                aria-label="Close fullscreen image"
                sx={{
                    position: 'fixed',
                    top: 16,
                    right: 16,
                    color: 'white',
                    bgcolor: 'rgba(0, 0, 0, 0.5)',
                    zIndex: 1,
                    '&:hover': {
                        bgcolor: 'rgba(0, 0, 0, 0.7)',
                    },
                }}
            >
                <CloseIcon />
            </IconButton>

            {/* Zoom Controls */}
            <Box
                sx={{
                    position: 'fixed',
                    bottom: 16,
                    right: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    zIndex: 1,
                }}
            >
                <IconButton
                    onClick={handleZoomIn}
                    disabled={scale >= 3}
                    aria-label="Zoom in"
                    sx={{
                        color: 'white',
                        bgcolor: 'rgba(0, 0, 0, 0.5)',
                        '&:hover': {
                            bgcolor: 'rgba(0, 0, 0, 0.7)',
                        },
                        '&.Mui-disabled': {
                            color: 'rgba(255, 255, 255, 0.3)',
                            bgcolor: 'rgba(0, 0, 0, 0.3)',
                        },
                    }}
                >
                    <ZoomInIcon />
                </IconButton>
                <IconButton
                    onClick={handleZoomOut}
                    disabled={scale <= 0.5}
                    aria-label="Zoom out"
                    sx={{
                        color: 'white',
                        bgcolor: 'rgba(0, 0, 0, 0.5)',
                        '&:hover': {
                            bgcolor: 'rgba(0, 0, 0, 0.7)',
                        },
                        '&.Mui-disabled': {
                            color: 'rgba(255, 255, 255, 0.3)',
                            bgcolor: 'rgba(0, 0, 0, 0.3)',
                        },
                    }}
                >
                    <ZoomOutIcon />
                </IconButton>
            </Box>

            {/* Image Container */}
            <Box
                onClick={handleBackdropClick}
                sx={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    padding: 3,
                    cursor: 'zoom-out',
                }}
                role="button"
                tabIndex={0}
                aria-label="Click to close fullscreen view"
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        handleClose();
                    }
                }}
            >
                <Box
                    component="img"
                    src={imageUrl}
                    alt={alt}
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    sx={{
                        maxWidth: '100%',
                        maxHeight: '100%',
                        objectFit: 'contain',
                        transform: `scale(${scale})`,
                        transition: 'transform 0.2s ease-in-out',
                        cursor: scale > 1 ? 'zoom-out' : 'default',
                        userSelect: 'none',
                        borderRadius: 1,
                    }}
                    draggable={false}
                    loading="eager"
                    id="image-lightbox-title"
                />
            </Box>

            {/* Hidden description for screen readers */}
            <span id="image-lightbox-description" style={{ display: 'none' }}>
                Fullscreen view of {alt}. Press Escape or click outside to close. Use zoom buttons to adjust size.
            </span>
        </Dialog>
    );
};

export default ImageLightbox;

