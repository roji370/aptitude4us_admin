import { 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject,
  getMetadata
} from 'firebase/storage';
import { storage } from '../firebase/config';
import { MessageAttachment } from './messageService';

// File type validation
export const ALLOWED_FILE_TYPES = {
  image: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  video: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/webm'],
  document: [
    'application/pdf', 
    'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv'
  ],
  audio: ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a']
};

// File size limits (in bytes)
export const FILE_SIZE_LIMITS = {
  image: 10 * 1024 * 1024, // 10MB
  video: 100 * 1024 * 1024, // 100MB
  document: 25 * 1024 * 1024, // 25MB
  audio: 50 * 1024 * 1024 // 50MB
};

// Get file type category from MIME type
export const getFileTypeCategory = (mimeType: string): 'image' | 'video' | 'document' | 'audio' | null => {
  for (const [category, types] of Object.entries(ALLOWED_FILE_TYPES)) {
    if (types.includes(mimeType)) {
      return category as 'image' | 'video' | 'document' | 'audio';
    }
  }
  return null;
};

// Validate file
export const validateFile = (file: File): { valid: boolean; error?: string } => {
  const fileType = getFileTypeCategory(file.type);
  
  if (!fileType) {
    return { 
      valid: false, 
      error: `File type "${file.type}" is not supported. Please upload images, videos, documents, or audio files.` 
    };
  }
  
  const sizeLimit = FILE_SIZE_LIMITS[fileType];
  if (file.size > sizeLimit) {
    const limitMB = Math.round(sizeLimit / (1024 * 1024));
    return { 
      valid: false, 
      error: `File size exceeds ${limitMB}MB limit for ${fileType} files.` 
    };
  }
  
  return { valid: true };
};

// Upload progress callback type
export type UploadProgressCallback = (progress: number) => void;

// Upload attachment to Firebase Storage
export const uploadAttachment = async (
  file: File,
  senderId: string,
  onProgress?: UploadProgressCallback
): Promise<MessageAttachment> => {
  try {
    // Validate file first
    const validation = validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    
    const fileType = getFileTypeCategory(file.type)!;
    const timestamp = Date.now();
    const fileName = `${timestamp}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = `attachments/chat/${senderId}/${fileName}`;
    
    // Create storage reference
    const storageRef = ref(storage, filePath);
    
    // Upload file
    const uploadTask = uploadBytes(storageRef, file);
    
    // Note: Firebase v9+ doesn't have on() method for upload tasks like v8
    // For now, we'll upload without progress tracking
    // In a production app, you might want to use the uploadBytesResumable method
    
    const snapshot = await uploadTask;
    const downloadURL = await getDownloadURL(snapshot.ref);
    
    // Create attachment object
    const attachment: MessageAttachment = {
      id: fileName,
      name: file.name,
      type: fileType,
      url: downloadURL,
      size: file.size,
      mimeType: file.type
    };
    
    // Generate thumbnail for images (basic implementation)
    if (fileType === 'image') {
      attachment.thumbnailUrl = downloadURL; // Use same URL for now
    }
    
    return attachment;
  } catch (error) {
    console.error('Error uploading attachment:', error);
    throw new Error(`Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// Upload multiple attachments
export const uploadMultipleAttachments = async (
  files: File[],
  senderId: string,
  onProgress?: (fileIndex: number, progress: number) => void
): Promise<MessageAttachment[]> => {
  const attachments: MessageAttachment[] = [];
  
  for (let i = 0; i < files.length; i++) {
    try {
      const attachment = await uploadAttachment(
        files[i], 
        senderId, 
        onProgress ? (progress) => onProgress(i, progress) : undefined
      );
      attachments.push(attachment);
    } catch (error) {
      console.error(`Error uploading file ${files[i].name}:`, error);
      throw error;
    }
  }
  
  return attachments;
};

// Delete attachment from storage
export const deleteAttachment = async (attachmentUrl: string): Promise<void> => {
  try {
    // Extract the storage path from the download URL
    const storageRef = ref(storage, attachmentUrl);
    await deleteObject(storageRef);
  } catch (error) {
    console.error('Error deleting attachment:', error);
    throw error;
  }
};

// Get file size in human readable format
export const formatFileSize = (bytes: number | undefined | null): string => {
  if (!bytes || typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) {
    return 'Unknown size';
  }
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Get file icon based on type
export const getFileIcon = (mimeType: string): string => {
  const fileType = getFileTypeCategory(mimeType);
  
  switch (fileType) {
    case 'image':
      return '🖼️';
    case 'video':
      return '🎥';
    case 'audio':
      return '🎵';
    case 'document':
      if (mimeType.includes('pdf')) return '📄';
      if (mimeType.includes('word')) return '📝';
      if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📊';
      if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📽️';
      return '📎';
    default:
      return '📎';
  }
};
