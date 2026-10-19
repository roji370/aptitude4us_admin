import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  FormControlLabel,
  Switch,
  Stack,
  LinearProgress
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  VideoLibrary as VideoIcon,
  Article as NoteIcon,
  PictureAsPdf as PdfIcon,
  Image as ImageIcon,
  AudioFile as AudioIcon,
  CloudUpload as UploadIcon,
  Refresh as RefreshIcon,
  Edit as EditIcon,
  Link as LinkIcon
} from '@mui/icons-material';
import {
  getCourseById,
  getModuleById,
  updateModule,
  uploadContent,
  uploadContentWithProgress,
  createTextNote,
  deleteContent,
  permanentlyDeleteModule,
  updateContentOrder,
  clearOneTimeViewRecords,
  UploadProgressCallback,
  UploadCompletionCallback
} from '../services/courseService';
import type { Course, Module, ContentItem } from '../services/courseService';
import DragDropZone from '../components/DragDropZone';
import SortableContentList from '../components/SortableContentList';
import { useAuth } from '../context/AuthContext';
import { generateSafeId } from '../utils/idGenerator';

// Simple TabPanel component
const TabPanel = (props: { children?: React.ReactNode; index: number; value: number }) => {
  const { children, value, index } = props;

  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
};

const ModuleDetail: React.FC = () => {
  const { courseId, moduleId } = useParams<{ courseId: string; moduleId: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  // Basic state
  const [course, setCourse] = useState<Course | null>(null);
  const [module, setModule] = useState<Module | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const [statusMessage, setStatusMessage] = useState<{ text: string, type: 'success' | 'error' | 'info' } | null>(null);

  // Upload state
  const [uploadType, setUploadType] = useState<'video' | 'note' | 'pdf' | 'image' | 'audio' | 'link'>('video');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [openUploadDialog, setOpenUploadDialog] = useState(false);

  // Note-specific state
  const [noteText, setNoteText] = useState('');
  const [editingNote, setEditingNote] = useState<ContentItem | null>(null);
  const [editNoteText, setEditNoteText] = useState('');

  // Link-specific state
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  // One-Time View state
  const [isOneTimeView, setIsOneTimeView] = useState(false);

  // Delete content state
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [contentToDelete, setContentToDelete] = useState<{ type: 'video' | 'note' | 'pdf' | 'image' | 'audio' | 'link'; id: string } | null>(null);

  // Delete module state
  const [openDeleteModuleDialog, setOpenDeleteModuleDialog] = useState(false);
  const [deletingModule, setDeletingModule] = useState(false);

  // Clear status message after delay
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => {
        setStatusMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  // Main data fetching function - wrap in useCallback to prevent infinite loops
  const fetchData = useCallback(async (showLoading = true) => {
    if (!courseId || !moduleId) return;

    try {
      showLoading ? setLoading(true) : setRefreshing(true);
      setError(null);

      console.log('Fetching data for course:', courseId, 'module:', moduleId);

      // Fetch course and module in parallel
      const [courseData, moduleData] = await Promise.all([
        getCourseById(courseId),
        getModuleById(moduleId)
      ]);

      // Validate course
      if (!courseData) {
        throw new Error('Course not found');
      }

      // Validate module
      if (!moduleData) {
        throw new Error('Module not found');
      }

      // Validate module belongs to course
      if (moduleData.courseId !== courseId) {
        throw new Error('Module does not belong to this course');
      }

      console.log('Fetched module data:', moduleData);

      // Function to convert object with numeric keys to array and sort by order
      const normalizeContentArray = (contentObject: Record<string, unknown> | unknown[], contentType: string): ContentItem[] => {
        if (!contentObject) return [];

        let contentArray: ContentItem[] = [];

        if (Array.isArray(contentObject)) {
          contentArray = contentObject as ContentItem[];
        } else if (typeof contentObject === 'object') {
          // If it's an object with numeric keys (Firebase sometimes does this)
          contentArray = Object.values(contentObject) as ContentItem[];
        }

        // Sort by order field, fallback to array index if order is missing
        const sortedArray = contentArray.sort((a, b) => {
          const orderA = a.order ?? 0;
          const orderB = b.order ?? 0;
          return orderA - orderB;
        });

        console.log(`📋 Normalized ${contentType}:`, sortedArray.map(item => ({
          title: item.title,
          order: item.order
        })));

        return sortedArray;
      };

      // Normalize content structure
      const normalizedModule = {
        ...moduleData,
        content: {
          videos: normalizeContentArray(moduleData.content?.videos, 'videos'),
          notes: normalizeContentArray(moduleData.content?.notes, 'notes'),
          pdfs: normalizeContentArray(moduleData.content?.pdfs, 'pdfs'),
          images: normalizeContentArray(moduleData.content?.images, 'images'),
          audios: normalizeContentArray(moduleData.content?.audios, 'audios'),
          links: normalizeContentArray(moduleData.content?.links, 'links')
        }
      };

      console.log('Normalized module content:', normalizedModule.content);

      // Set state
      setCourse(courseData);
      setModule(normalizedModule);
      console.log('✅ Module and course state set successfully');
    } catch (err: unknown) {
      console.error('Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load module details');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [courseId, moduleId]);

  // Initial data load
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handler for tab changes
  const handleChangeTab = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  // Navigation handler
  const handleBackClick = () => {
    navigate(`/courses/${courseId}`);
  };

  // Refresh handler
  const handleRefresh = () => {
    fetchData(false);
    setStatusMessage({ text: 'Refreshing content...', type: 'info' });
  };


  // Upload handlers
  const handleOpenUploadDialog = (type: 'video' | 'note' | 'pdf' | 'image' | 'audio' | 'link') => {
    setUploadType(type);
    setUploadFile(null);
    setUploadFiles([]); // Reset upload files array
    setLinkName(''); // Reset link fields
    setLinkUrl('');
    setNoteText(''); // Reset note text
    setError(null); // Reset any errors
    setOpenUploadDialog(true);
  };

  const handleCloseUploadDialog = () => {
    setOpenUploadDialog(false);
    setError(null);
    // Reset upload state
    setUploadProgress(0);
    setUploadFile(null);
    setUploadFiles([]);
    setNoteText('');
    setLinkName('');
    setLinkUrl('');
    setIsOneTimeView(false);
    // Also close edit dialog if open
    handleCloseEditNote();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const files = Array.from(event.target.files);

      // Validate file types based on current uploadType
      const validFiles = files.filter(file => {
        switch (uploadType) {
          case 'video':
            return file.type.startsWith('video/');
          case 'pdf':
            return file.type === 'application/pdf';
          case 'image':
            return file.type.startsWith('image/');
          case 'audio':
            return file.type.startsWith('audio/') ||
              file.name.toLowerCase().endsWith('.mp3') ||
              file.name.toLowerCase().endsWith('.wav') ||
              file.name.toLowerCase().endsWith('.m4a') ||
              file.name.toLowerCase().endsWith('.aac') ||
              file.name.toLowerCase().endsWith('.ogg') ||
              file.name.toLowerCase().endsWith('.flac') ||
              file.name.toLowerCase().endsWith('.wma');
          case 'note':
            return true; // Notes can be any file type
          default:
            return false;
        }
      });

      if (validFiles.length > 0) {
        setUploadFiles(validFiles);
        // For backward compatibility, also set the first file as single upload
        setUploadFile(validFiles[0]);
      } else {
        console.warn(`No valid files found for ${uploadType}`);
      }
    }
  };

  const handleFileDrop = (files: File[]) => {
    if (files.length > 0) {
      // Validate file types based on current uploadType
      const validFiles = files.filter(file => {
        switch (uploadType) {
          case 'video':
            return file.type.startsWith('video/');
          case 'pdf':
            return file.type === 'application/pdf';
          case 'image':
            return file.type.startsWith('image/');
          case 'audio':
            return file.type.startsWith('audio/') ||
              file.name.toLowerCase().endsWith('.mp3') ||
              file.name.toLowerCase().endsWith('.wav') ||
              file.name.toLowerCase().endsWith('.m4a') ||
              file.name.toLowerCase().endsWith('.aac') ||
              file.name.toLowerCase().endsWith('.ogg') ||
              file.name.toLowerCase().endsWith('.flac') ||
              file.name.toLowerCase().endsWith('.wma');
          case 'note':
            return true; // Notes can be any file type
          default:
            return false;
        }
      });

      if (validFiles.length > 0) {
        setUploadFiles(validFiles);
        // For backward compatibility, also set the first file as single upload
        setUploadFile(validFiles[0]);
      } else {
        console.warn(`No valid files found for ${uploadType}`);
      }
    }
  };

  const handleUploadContent = async () => {
    if (!courseId || !moduleId) {
      console.error('❌ Upload validation failed: missing courseId or moduleId');
      setError('Invalid course or module.');
      return;
    }

    // Handle text-based notes differently
    if (uploadType === 'note') {
      if (!noteText.trim()) {
        setError('Please enter note text.');
        return;
      }

      // Auto-generate title from first line of text
      const firstLine = noteText.trim().split('\n')[0];
      const autoTitle = firstLine.length > 50 ? `${firstLine.substring(0, 50)}...` : firstLine || 'Note';

      setUploading(true);
      setError(null);

      try {
        console.log(`📝 Creating text note:`, autoTitle);

        const newContent = await createTextNote(
          moduleId,
          autoTitle,
          noteText.trim(),
          isOneTimeView
        );

        console.log('✅ Note created successfully:', newContent);

        // Refresh data from Firebase after successful creation
        await fetchData(false);

        // Reset form and close dialog
        setNoteText('');
        setIsOneTimeView(false);
        setOpenUploadDialog(false);

        setStatusMessage({ text: `📝 Note created successfully!`, type: 'success' });
      } catch (error: unknown) {
        console.error(`❌ Error creating note:`, error);
        setError(error instanceof Error ? error.message : `Failed to create note`);
      } finally {
        setUploading(false);
      }
      return;
    }

    // Handle link creation
    if (uploadType === 'link') {
      if (!module) {
        setError('Module data not available.');
        return;
      }

      if (!linkName.trim()) {
        setError('Please enter a link name.');
        return;
      }

      if (!linkUrl.trim()) {
        setError('Please enter a URL.');
        return;
      }

      // Basic URL validation
      try {
        const url = new URL(linkUrl);
        if (!url.protocol.startsWith('http')) {
          setError('Please enter a valid URL starting with http:// or https://');
          return;
        }
      } catch {
        setError('Please enter a valid URL.');
        return;
      }

      setUploading(true);
      setError(null);

      try {
        console.log(`🔗 Creating link:`, linkName, linkUrl);

        // Create link content item directly
        const linkItem: Omit<ContentItem, 'id' | 'createdAt'> = {
          title: linkName.trim(),
          url: linkUrl.trim(),
          type: 'link',
          isPublished: true, // Default to published
          isOneTimeView: isOneTimeView ?? false
        };

        // Add to module content
        const newLinkItem = {
          ...linkItem,
          id: generateSafeId(),
          createdAt: new Date()
        };

        const updatedContent = {
          ...module.content,
          links: [...(module.content?.links || []), newLinkItem]
        };

        await updateModule(moduleId, { content: updatedContent });

        console.log('✅ Link created successfully:', linkItem);

        // Refresh data from Firebase after successful creation
        await fetchData(false);

        // Reset form and close dialog
        setLinkName('');
        setLinkUrl('');
        setIsOneTimeView(false);
        setOpenUploadDialog(false);

        setStatusMessage({ text: `🔗 Link created successfully!`, type: 'success' });
      } catch (error: unknown) {
        console.error(`❌ Error creating link:`, error);
        setError(error instanceof Error ? error.message : `Failed to create link`);
      } finally {
        setUploading(false);
      }
      return;
    }

    // Handle file uploads for other content types  
    if (uploadFiles.length === 0) {
      console.error('❌ Upload validation failed: no files selected');
      setError('Please select at least one file to upload.');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError(null);

    let totalFiles = uploadFiles.length;
    let completedFiles = 0;
    let totalSize = uploadFiles.reduce((sum, file) => sum + file.size, 0);

    // Progress callback to update UI
    const onProgress: UploadProgressCallback = (fileName, progress) => {
      const overallProgress = ((completedFiles / totalFiles) * 100) + ((progress / totalFiles));
      setUploadProgress(Math.min(overallProgress, 100));
      console.log(`📈 Upload progress for ${fileName}: ${progress.toFixed(1)}% (Overall: ${overallProgress.toFixed(1)}%)`);
    };

    // Completion callback
    const onComplete: UploadCompletionCallback = (fileName, success, error) => {
      if (success) {
        console.log(`✅ Successfully uploaded: ${fileName}`);
        completedFiles++;
      } else {
        console.error(`❌ Failed to upload: ${fileName} - ${error}`);
      }
    };

    try {
      console.log(`🚀 Uploading ${totalFiles} ${uploadType} files with progress tracking`);

      // Upload all files
      const uploadPromises = uploadFiles.map(async (file) => {
        const autoTitle = file.name.split('.').slice(0, -1).join('.') || file.name;

        return uploadContentWithProgress(
          courseId,
          moduleId,
          file,
          uploadType,
          autoTitle,
          '', // No description
          onProgress,
          onComplete,
          isOneTimeView
        );
      });

      const results = await Promise.all(uploadPromises);

      console.log('✅ All uploads successful:', results);

      // Refresh data from Firebase after successful upload
      await fetchData(false);

      // Reset form and close dialog
      setUploadFile(null);
      setUploadFiles([]);
      setUploadProgress(0);
      setIsOneTimeView(false);
      setOpenUploadDialog(false);

      setStatusMessage({
        text: `🎉 ${totalFiles} ${uploadType} file${totalFiles > 1 ? 's' : ''} uploaded successfully! (${(totalSize / 1024 / 1024).toFixed(1)} MB total)`,
        type: 'success'
      });
    } catch (error: unknown) {
      console.error(`❌ Error uploading ${uploadType} files:`, error);
      setError(error instanceof Error ? error.message : `Failed to upload ${uploadType} files`);
      setUploadProgress(0);
    } finally {
      setUploading(false);
    }
  };

  // Delete content handlers
  const handleOpenDeleteDialog = (type: 'video' | 'note' | 'pdf' | 'image' | 'audio' | 'link', id: string) => {
    setContentToDelete({ type, id });
    setOpenDeleteDialog(true);
  };

  const handleCloseDeleteDialog = () => {
    setOpenDeleteDialog(false);
    setContentToDelete(null);
  };

  // Edit note functions
  const handleOpenEditNote = (note: ContentItem) => {
    setEditingNote(note);
    setEditNoteText(note.text || '');
  };

  const handleCloseEditNote = () => {
    setEditingNote(null);
    setEditNoteText('');
  };

  const handleSaveEditNote = async () => {
    if (!moduleId || !module || !editingNote || !editNoteText.trim()) return;

    try {
      setUploading(true);

      // Generate new title from first line of edited text
      const firstLine = editNoteText.trim().split('\n')[0];
      const newTitle = firstLine.length > 50 ? `${firstLine.substring(0, 50)}...` : firstLine || 'Note';

      // Find and update the note in the content array
      const updatedNotes = module.content?.notes?.map(note =>
        note.id === editingNote.id
          ? { ...note, title: newTitle, text: editNoteText.trim() }
          : note
      ) || [];

      const updatedContent = {
        ...module.content,
        notes: updatedNotes
      };

      // Update the module in Firestore
      await updateModule(moduleId, { content: updatedContent });

      // Refresh data
      await fetchData(false);

      handleCloseEditNote();
      setStatusMessage({ text: 'Note updated successfully!', type: 'success' });
    } catch (error) {
      console.error('Error updating note:', error);
      setError('Failed to update note');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteContent = async () => {
    if (!courseId || !moduleId || !contentToDelete || !module) {
      handleCloseDeleteDialog();
      return;
    }

    try {
      const contentType = contentToDelete.type;
      const contentTypeKey = `${contentType}s` as 'videos' | 'notes' | 'pdfs' | 'images' | 'audios' | 'links';

      // Find content to delete
      const contentArray = module.content[contentTypeKey];
      const contentItem = contentArray.find((item: ContentItem) => item?.id === contentToDelete.id);

      if (!contentItem) {
        console.error('Content item not found:', contentToDelete);
        handleCloseDeleteDialog();
        return;
      }

      console.log(`Deleting ${contentType}:`, contentItem);

      // Delete from storage only if content has a URL (file-based content)
      // Text-based notes and links don't need file deletion
      if (contentItem.url && contentType !== 'note' && contentType !== 'link') {
        await deleteContent(courseId, moduleId, contentType, contentItem.url);
      }

      // Remove the content item from the module's content array in Firestore
      const updatedContentArray = contentArray.filter((item: ContentItem) => item?.id !== contentToDelete.id);
      const updatedContent = {
        ...module.content,
        [contentTypeKey]: updatedContentArray
      };

      // Update the module in Firestore
      await updateModule(moduleId, { content: updatedContent });

      // After deletion, fetch fresh data to ensure UI is in sync
      handleCloseDeleteDialog();
      await fetchData(false);

      setStatusMessage({ text: `${contentType} deleted successfully`, type: 'success' });
    } catch (error: unknown) {
      console.error('Error deleting content:', error);
      setError(error instanceof Error ? error.message : 'Failed to delete content');
      handleCloseDeleteDialog();
    }
  };

  // Publish toggle handler
  const handleTogglePublish = async () => {
    if (!module || !moduleId) return;

    try {
      const newPublishState = !module.isPublished;

      await updateModule(moduleId, { isPublished: newPublishState });

      setModule({
        ...module,
        isPublished: newPublishState
      });

      setStatusMessage({
        text: newPublishState ? 'Module published' : 'Module unpublished',
        type: 'success'
      });
    } catch (error: unknown) {
      console.error('Error updating publish state:', error);
      setError(error instanceof Error ? error.message : 'Failed to update publish state');
    }
  };

  // Toggle publish status for individual content items
  const handleToggleContentPublish = async (
    contentType: 'videos' | 'notes' | 'pdfs' | 'images' | 'audios' | 'links',
    contentId: string,
    isPublished: boolean
  ) => {
    if (!moduleId || !module) return;

    try {
      // Find and update the content item in the appropriate array
      const updatedContentArray = module.content[contentType].map(item =>
        item.id === contentId ? { ...item, isPublished } : item
      );

      const updatedContent = {
        ...module.content,
        [contentType]: updatedContentArray
      };

      // Update the module in Firestore
      await updateModule(moduleId, { content: updatedContent });

      // Update local state
      setModule({
        ...module,
        content: updatedContent
      });

      // Find the item title for the status message
      const itemTitle = module.content[contentType].find(item => item.id === contentId)?.title || 'Content';

      setStatusMessage({
        text: isPublished ? `✅ "${itemTitle}" published` : `🔴 "${itemTitle}" unpublished`,
        type: 'success'
      });
    } catch (error: unknown) {
      console.error('Error updating content publish state:', error);
      setError(error instanceof Error ? error.message : 'Failed to update content publish state');
    }
  };

  // Toggle one-time view status for individual content items
  const handleToggleContentOneTimeView = async (
    contentType: 'videos' | 'notes' | 'pdfs' | 'images' | 'audios' | 'links',
    contentId: string,
    isOneTimeView: boolean
  ) => {
    if (!moduleId || !module) return;

    try {
      const updatedContentArray = module.content[contentType].map(item =>
        item.id === contentId ? { ...item, isOneTimeView } : item
      );

      const updatedContent = {
        ...module.content,
        [contentType]: updatedContentArray
      };

      await updateModule(moduleId, { content: updatedContent });

      // When disabling one-time view, clear all student view records so
      // re-enabling later gives everyone a fresh view instead of "expired".
      let clearedCount = 0;
      if (!isOneTimeView) {
        clearedCount = await clearOneTimeViewRecords(contentId);
      }

      setModule({
        ...module,
        content: updatedContent
      });

      // Find the item title for the status message
      const itemTitle = module.content[contentType].find(item => item.id === contentId)?.title || 'Content';

      const resetNote = !isOneTimeView && clearedCount > 0
        ? ` (${clearedCount} student view record${clearedCount === 1 ? '' : 's'} reset)`
        : '';
      setStatusMessage({
        text: isOneTimeView
          ? `🔒 One-Time View enabled for "${itemTitle}"`
          : `🔓 One-Time View disabled for "${itemTitle}"${resetNote}`,
        type: 'success'
      });
    } catch (error: unknown) {
      console.error('Error updating one-time view state:', error);
      setError(error instanceof Error ? error.message : 'Failed to update one-time view state');
    }
  };

  // Rename content item
  const handleContentRename = async (
    contentType: 'videos' | 'notes' | 'pdfs' | 'images' | 'audios' | 'links',
    contentId: string,
    newTitle: string
  ) => {
    if (!moduleId || !module) return;

    try {
      console.log(`✏️ Renaming ${contentType} item ${contentId} to "${newTitle}"`);

      // Find and update the content item in the appropriate array
      const updatedContentArray = module.content[contentType].map(item =>
        item.id === contentId ? { ...item, title: newTitle } : item
      );

      const updatedContent = {
        ...module.content,
        [contentType]: updatedContentArray
      };

      // Update the module in Firestore
      await updateModule(moduleId, { content: updatedContent });

      // Update local state
      setModule({
        ...module,
        content: updatedContent
      });

      setStatusMessage({
        text: `Content renamed to "${newTitle}"`,
        type: 'success'
      });

      console.log(`✅ Successfully renamed ${contentType} item`);
    } catch (error: unknown) {
      console.error('Error renaming content:', error);
      setError(error instanceof Error ? error.message : 'Failed to rename content');
      throw error; // Re-throw to let the component know it failed
    }
  };

  // Delete module handlers  
  const handleOpenDeleteModuleDialog = () => {
    setOpenDeleteModuleDialog(true);
  };

  const handleCloseDeleteModuleDialog = () => {
    setOpenDeleteModuleDialog(false);
  };

  const handleDeleteModule = async () => {
    if (!courseId || !moduleId) return;

    setDeletingModule(true);

    try {
      await permanentlyDeleteModule(courseId, moduleId);
      setStatusMessage({ text: 'Module deleted successfully', type: 'success' });

      // Return to course detail
      navigate(`/courses/${courseId}`);
    } catch (error: unknown) {
      console.error('Error deleting module:', error);
      setError(error instanceof Error ? error.message : 'Failed to delete module');
    } finally {
      setDeletingModule(false);
    }
  };

  // Handle content reordering
  const handleContentReorder = async (
    contentType: 'videos' | 'notes' | 'pdfs' | 'images' | 'audios' | 'links',
    reorderedItems: ContentItem[]
  ) => {
    if (!moduleId || !module) {
      console.log('❌ No moduleId or module found for reordering');
      return;
    }

    try {
      console.log(`🔄 Starting reorder for ${contentType}:`, {
        moduleId,
        totalItems: reorderedItems.length,
        reorderData: reorderedItems.map((item, index) => ({
          id: item.id,
          title: item.title,
          oldOrder: item.order,
          newOrder: index
        }))
      });

      // Create the updated items with new order
      const itemsWithNewOrder = reorderedItems.map((item, index) => ({
        ...item,
        order: index
      }));

      // Optimistically update the UI immediately
      const updatedModule = {
        ...module,
        content: {
          ...module.content,
          [contentType]: itemsWithNewOrder
        }
      };
      setModule(updatedModule);
      console.log(`🎨 UI updated optimistically for ${contentType}`);
      console.log(`📝 New ${contentType} order:`, itemsWithNewOrder.map(item => ({ id: item.id, title: item.title, order: item.order })));

      // Update content order in the backend
      console.log(`🔄 Calling updateContentOrder for ${contentType}...`);
      await updateContentOrder(moduleId, contentType, itemsWithNewOrder);
      console.log(`✅ Backend updated successfully for ${contentType}`);

      // Verify the update by refreshing from database after a short delay
      setTimeout(async () => {
        try {
          console.log(`🔍 Verifying ${contentType} order in database...`);
          const freshModuleData = await getModuleById(moduleId);
          if (freshModuleData && freshModuleData.content && freshModuleData.content[contentType]) {
            const dbContent = freshModuleData.content[contentType];
            console.log(`🔍 Database ${contentType} order:`, dbContent.map((item: any) => ({ id: item.id, title: item.title, order: item.order })));

            // Update the UI with fresh data to ensure consistency
            const normalizeContentArray = (contentObject: Record<string, unknown> | unknown[]): ContentItem[] => {
              if (!contentObject) return [];

              let contentArray: ContentItem[] = [];

              if (Array.isArray(contentObject)) {
                contentArray = contentObject as ContentItem[];
              } else if (typeof contentObject === 'object') {
                contentArray = Object.values(contentObject) as ContentItem[];
              }

              return contentArray.sort((a, b) => {
                const orderA = a.order ?? 0;
                const orderB = b.order ?? 0;
                return orderA - orderB;
              });
            };

            const updatedModuleFromDB = {
              ...freshModuleData,
              content: {
                videos: normalizeContentArray(freshModuleData.content?.videos || []),
                notes: normalizeContentArray(freshModuleData.content?.notes || []),
                pdfs: normalizeContentArray(freshModuleData.content?.pdfs || []),
                images: normalizeContentArray(freshModuleData.content?.images || []),
                audios: normalizeContentArray(freshModuleData.content?.audios || []),
                links: normalizeContentArray(freshModuleData.content?.links || [])
              }
            };

            setModule(updatedModuleFromDB);
            console.log(`🔄 Module state refreshed from database`);
          }
        } catch (verifyError) {
          console.warn('Warning: Could not verify content order:', verifyError);
        }

        setStatusMessage({
          text: `${contentType.charAt(0).toUpperCase() + contentType.slice(1)} reordered successfully!`,
          type: 'success'
        });
      }, 1000);

    } catch (error) {
      console.error('❌ Error reordering content:', error);
      setError(`Failed to reorder ${contentType}: ${error instanceof Error ? error.message : 'Unknown error'}`);

      // Refresh data to revert optimistic update on error
      console.log('🔄 Reverting to original order due to error...');
      await fetchData(false);
    }
  };

  // Loading state
  if (loading) {
    console.log('🔄 Rendering loading state');
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  // Error state
  if (error && !module) {
    console.log('❌ Rendering error state:', error);
    return (
      <Box sx={{ mt: 4 }}>
        <Alert severity="error">{error}</Alert>
        <Button
          sx={{ mt: 2 }}
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={handleBackClick}
        >
          Back to Course
        </Button>
      </Box>
    );
  }

  // Empty state - shouldn't normally happen but just in case
  if (!module || !course) {
    console.log('⚠️ Rendering empty state - module:', !!module, 'course:', !!course);
    return (
      <Box sx={{ mt: 4 }}>
        <Alert severity="warning">No module data available</Alert>
        <Button
          sx={{ mt: 2 }}
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={handleBackClick}
        >
          Back to Course
        </Button>
      </Box>
    );
  }

  // Get content arrays safely
  const videos = Array.isArray(module.content?.videos) ? module.content.videos : [];
  const notes = Array.isArray(module.content?.notes) ?
    module.content.notes.filter(note => note && (note.text?.trim() || note.url)) : [];
  const pdfs = Array.isArray(module.content?.pdfs) ? module.content.pdfs : [];
  const images = Array.isArray(module.content?.images) ? module.content.images : [];
  const audios = Array.isArray(module.content?.audios) ? module.content.audios : [];
  const links = Array.isArray(module.content?.links) ? module.content.links : [];

  console.log('🎯 Rendering main module content - module:', module.title, 'course:', course.title);

  return (
    <Box sx={{ flexGrow: 1 }}>
      {/* Status messages */}
      {statusMessage && (
        <Alert severity={statusMessage.type} sx={{ mb: 2 }}>
          {statusMessage.text}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Header with back button and module title */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Button
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={handleBackClick}
          sx={{ 
            mr: 2,
            textTransform: 'none',
            fontWeight: 600,
            borderColor: '#E2E8F0',
            color: '#071A52',
            borderRadius: '8px',
            '&:hover': {
              borderColor: '#CBD5E1',
              bgcolor: 'rgba(7, 26, 82, 0.04)'
            }
          }}
        >
          Back to Course
        </Button>
        <Typography variant="h4" component="h1" sx={{ flexGrow: 1, fontWeight: 700, color: '#071A52' }}>
          {module.title}
        </Typography>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <FormControlLabel
            control={
              <Switch
                checked={module.isPublished || false}
                onChange={handleTogglePublish}
                color="primary"
              />
            }
            label={module.isPublished ? "Published" : "Draft"}
          />
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={handleOpenDeleteModuleDialog}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: '8px'
            }}
          >
            Delete
          </Button>
        </Stack>
      </Box>

      {/* Module info */}
      <Paper elevation={0} sx={{ p: 3.5, mb: 4, borderRadius: '16px', border: '1px solid #E2E8F0', bgcolor: '#FFFFFF' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: '#071A52' }}>
            {course.title} • Module {module.order}
          </Typography>
          <Button
            startIcon={refreshing ? undefined : <RefreshIcon />}
            onClick={handleRefresh}
            disabled={refreshing}
            size="small"
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              color: '#071A52'
            }}
          >
            {refreshing ? <CircularProgress size={20} /> : 'Refresh'}
          </Button>
        </Box>
        <Typography variant="body1" sx={{ color: 'text.secondary' }}>
          {module.description || 'No description provided.'}
        </Typography>
      </Paper>

      {/* Content tabs */}
      <Paper elevation={0} sx={{ mb: 4, borderRadius: '16px', border: '1px solid #E2E8F0', bgcolor: '#FFFFFF', overflow: 'hidden' }}>
        <Box sx={{ borderBottom: 1, borderColor: '#E2E8F0', px: 2, pt: 1, bgcolor: '#FAFBFD' }}>
          <Tabs
            value={tabValue}
            onChange={handleChangeTab}
            aria-label="module content tabs"
            sx={{
              '& .MuiTab-root': {
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.875rem',
                minHeight: '48px',
                color: '#64748B',
                '&.Mui-selected': {
                  color: '#071A52'
                }
              },
              '& .MuiTabs-indicator': {
                backgroundColor: '#071A52',
                height: 3,
                borderRadius: '3px 3px 0 0'
              }
            }}
          >
            <Tab icon={<VideoIcon />} iconPosition="start" label="Videos" />
            <Tab icon={<NoteIcon />} iconPosition="start" label="Notes" />
            <Tab icon={<PdfIcon />} iconPosition="start" label="PDFs" />
            <Tab icon={<ImageIcon />} iconPosition="start" label="Images" />
            <Tab icon={<AudioIcon />} iconPosition="start" label="Audio" />
            <Tab icon={<LinkIcon />} iconPosition="start" label="Links" />
          </Tabs>
        </Box>

        {/* Videos Tab */}
        <TabPanel value={tabValue} index={0}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Videos</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={() => handleOpenUploadDialog('video')}
              >
                Add Video
              </Button>
            </Box>
          </Box>

          <SortableContentList
            items={videos}
            contentType="videos"
            onReorder={(reorderedItems) => handleContentReorder('videos', reorderedItems)}
            onDelete={(id) => handleOpenDeleteDialog('video', id)}
            onRename={(id, newTitle) => handleContentRename('videos', id, newTitle)}
            onTogglePublish={(id, isPublished) => handleToggleContentPublish('videos', id, isPublished)}
            onToggleOneTimeView={(id, isOneTimeView) => handleToggleContentOneTimeView('videos', id, isOneTimeView)}
            emptyMessage="No videos added yet"
            emptyIcon={<VideoIcon color="disabled" sx={{ fontSize: 48, mb: 2 }} />}
          />
        </TabPanel>

        {/* Notes Tab */}
        <TabPanel value={tabValue} index={1}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Notes</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={() => handleOpenUploadDialog('note')}
              >
                Add Note
              </Button>
            </Box>
          </Box>

          <SortableContentList
            items={notes}
            contentType="notes"
            onReorder={(reorderedItems) => handleContentReorder('notes', reorderedItems)}
            onDelete={(id) => handleOpenDeleteDialog('note', id)}
            onEdit={handleOpenEditNote}
            onRename={(id, newTitle) => handleContentRename('notes', id, newTitle)}
            onTogglePublish={(id, isPublished) => handleToggleContentPublish('notes', id, isPublished)}
            onToggleOneTimeView={(id, isOneTimeView) => handleToggleContentOneTimeView('notes', id, isOneTimeView)}
            emptyMessage="No notes added yet"
            emptyIcon={<NoteIcon color="disabled" sx={{ fontSize: 48, mb: 2 }} />}
          />
        </TabPanel>

        {/* PDFs Tab */}
        <TabPanel value={tabValue} index={2}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">PDFs</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={() => handleOpenUploadDialog('pdf')}
              >
                Add PDF
              </Button>
              <Button
                variant="outlined"
                color="secondary"
                startIcon={<RefreshIcon />}
                onClick={() => fetchData(false)}
                size="small"
              >
                Refresh
              </Button>
            </Box>
          </Box>

          <SortableContentList
            items={pdfs}
            contentType="pdfs"
            onReorder={(reorderedItems) => handleContentReorder('pdfs', reorderedItems)}
            onDelete={(id) => handleOpenDeleteDialog('pdf', id)}
            onRename={(id, newTitle) => handleContentRename('pdfs', id, newTitle)}
            onTogglePublish={(id, isPublished) => handleToggleContentPublish('pdfs', id, isPublished)}
            onToggleOneTimeView={(id, isOneTimeView) => handleToggleContentOneTimeView('pdfs', id, isOneTimeView)}
            emptyMessage="No PDFs added yet"
            emptyIcon={<PdfIcon color="disabled" sx={{ fontSize: 48, mb: 2 }} />}
          />
        </TabPanel>

        {/* Images Tab */}
        <TabPanel value={tabValue} index={3}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Images</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={() => handleOpenUploadDialog('image')}
              >
                Add Image
              </Button>
              <Button
                variant="outlined"
                color="secondary"
                startIcon={<RefreshIcon />}
                onClick={() => fetchData(false)}
                size="small"
              >
                Refresh
              </Button>
            </Box>
          </Box>

          <SortableContentList
            items={images}
            contentType="images"
            onReorder={(reorderedItems) => handleContentReorder('images', reorderedItems)}
            onDelete={(id) => handleOpenDeleteDialog('image', id)}
            onRename={(id, newTitle) => handleContentRename('images', id, newTitle)}
            onTogglePublish={(id, isPublished) => handleToggleContentPublish('images', id, isPublished)}
            onToggleOneTimeView={(id, isOneTimeView) => handleToggleContentOneTimeView('images', id, isOneTimeView)}
            emptyMessage="No images added yet"
            emptyIcon={<ImageIcon color="disabled" sx={{ fontSize: 48, mb: 2 }} />}
          />
        </TabPanel>

        {/* Audio Tab */}
        <TabPanel value={tabValue} index={4}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Audio</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={() => handleOpenUploadDialog('audio')}
              >
                Add Audio
              </Button>
              <Button
                variant="outlined"
                color="secondary"
                startIcon={<RefreshIcon />}
                onClick={() => fetchData(false)}
                size="small"
              >
                Refresh
              </Button>
            </Box>
          </Box>

          <SortableContentList
            items={audios}
            contentType="audios"
            onReorder={(reorderedItems) => handleContentReorder('audios', reorderedItems)}
            onDelete={(id) => handleOpenDeleteDialog('audio', id)}
            onRename={(id, newTitle) => handleContentRename('audios', id, newTitle)}
            onTogglePublish={(id, isPublished) => handleToggleContentPublish('audios', id, isPublished)}
            onToggleOneTimeView={(id, isOneTimeView) => handleToggleContentOneTimeView('audios', id, isOneTimeView)}
            emptyMessage="No Audio added yet"
            emptyIcon={<AudioIcon color="disabled" sx={{ fontSize: 48, mb: 2 }} />}
          />
        </TabPanel>

        {/* Links Tab */}
        <TabPanel value={tabValue} index={5}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Links</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={() => handleOpenUploadDialog('link')}
              >
                Add Link
              </Button>
              <Button
                variant="outlined"
                color="secondary"
                startIcon={<RefreshIcon />}
                onClick={() => fetchData(false)}
                size="small"
              >
                Refresh
              </Button>
            </Box>
          </Box>

          <SortableContentList
            items={links}
            contentType="links"
            onReorder={(reorderedItems) => handleContentReorder('links', reorderedItems)}
            onDelete={(id) => handleOpenDeleteDialog('link', id)}
            onRename={(id, newTitle) => handleContentRename('links', id, newTitle)}
            onTogglePublish={(id, isPublished) => handleToggleContentPublish('links', id, isPublished)}
            onToggleOneTimeView={(id, isOneTimeView) => handleToggleContentOneTimeView('links', id, isOneTimeView)}
            emptyMessage="No links added yet"
            emptyIcon={<LinkIcon color="disabled" sx={{ fontSize: 48, mb: 2 }} />}
          />
        </TabPanel>
      </Paper>

      {/* Upload Dialog */}
      <Dialog open={openUploadDialog} onClose={handleCloseUploadDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {uploadType === 'note' ? 'Create Note' :
            uploadType === 'link' ? 'Add Link' :
              `Upload ${uploadType === 'video' ? 'Video' : uploadType === 'pdf' ? 'PDF' : uploadType === 'image' ? 'Image' : 'Audio'}`}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {uploadType === 'note' ? (
            // Text input for notes
            <TextField
              margin="dense"
              id="noteText"
              label="Note Text"
              type="text"
              fullWidth
              variant="outlined"
              multiline
              rows={6}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Enter your note text here..."
              sx={{ mb: 2 }}
              required
            />
          ) : uploadType === 'link' ? (
            // Link input fields
            <Box>
              <TextField
                margin="dense"
                id="linkName"
                label="Link Name"
                type="text"
                fullWidth
                variant="outlined"
                value={linkName}
                onChange={(e) => setLinkName(e.target.value)}
                placeholder="Enter display name for the link..."
                sx={{ mb: 2 }}
                required
              />
              <TextField
                margin="dense"
                id="linkUrl"
                label="URL"
                type="url"
                fullWidth
                variant="outlined"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
                sx={{ mb: 2 }}
                required
              />
            </Box>
          ) : (
            // File upload for other content types
            <Box sx={{ mb: 2 }}>
              <DragDropZone
                onFilesDropped={handleFileDrop}
                acceptedTypes={
                  uploadType === 'video' ? 'video/*' :
                    uploadType === 'pdf' ? 'application/pdf' :
                      uploadType === 'image' ? 'image/*' :
                        uploadType === 'audio' ? 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.wma' :
                          'application/*'
                }
                title={`Drop ${uploadType === 'video' ? 'Video' : uploadType === 'pdf' ? 'PDF' : uploadType === 'image' ? 'Image' : 'Audio'} Files`}
                subtitle="Drag files here or click to browse"
                multiple={true}
              />

              <input
                accept={
                  uploadType === 'video' ? 'video/*' :
                    uploadType === 'pdf' ? 'application/pdf' :
                      uploadType === 'image' ? 'image/*' :
                        uploadType === 'audio' ? 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.wma' :
                          'application/*'
                }
                style={{ display: 'none' }}
                id="file-upload"
                type="file"
                multiple
                onChange={handleFileChange}
              />

              <label htmlFor="file-upload">
                <Button
                  variant="outlined"
                  component="span"
                  startIcon={<UploadIcon />}
                  fullWidth
                  sx={{ mt: 1 }}
                >
                  Or Click to Select Files
                </Button>
              </label>
            </Box>
          )}

          {uploadFiles.length > 0 && (
            <Box sx={{
              p: 2,
              mt: 2,
              mb: 2,
              border: '1px solid #e0e0e0',
              borderRadius: 1
            }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                Selected Files ({uploadFiles.length})
              </Typography>
              {uploadFiles.map((file, index) => (
                <Box key={index} sx={{
                  display: 'flex',
                  alignItems: 'center',
                  py: 0.5,
                  borderBottom: index < uploadFiles.length - 1 ? '1px solid #f0f0f0' : 'none'
                }}>
                  {uploadType === 'video' && <VideoIcon color="primary" sx={{ mr: 1, fontSize: 20 }} />}
                  {uploadType === 'note' && <NoteIcon color="primary" sx={{ mr: 1, fontSize: 20 }} />}
                  {uploadType === 'pdf' && <PdfIcon color="primary" sx={{ mr: 1, fontSize: 20 }} />}
                  {uploadType === 'image' && <ImageIcon color="primary" sx={{ mr: 1, fontSize: 20 }} />}
                  {uploadType === 'audio' && <AudioIcon color="primary" sx={{ mr: 1, fontSize: 20 }} />}
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="body2" noWrap>
                      {file.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    onClick={() => {
                      const newFiles = uploadFiles.filter((_, i) => i !== index);
                      setUploadFiles(newFiles);
                      if (newFiles.length > 0) {
                        setUploadFile(newFiles[0]);
                      } else {
                        setUploadFile(null);
                      }
                    }}
                    sx={{ ml: 1 }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}

          {/* One-Time View Toggle */}
          <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <FormControlLabel
              control={
                <Switch
                  checked={isOneTimeView}
                  onChange={(e) => setIsOneTimeView(e.target.checked)}
                  color="warning"
                  id="one-time-view-toggle"
                />
              }
              label="One-Time View"
            />
            <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5, mt: 0.25, display: "block" }}>
              Students will only be able to access this content once.
            </Typography>
          </Box>
        </DialogContent>
        {/* Upload Progress */}
        {uploading && uploadProgress > 0 && (
          <Box sx={{ px: 3, pb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="body2" color="primary" sx={{ fontWeight: 'medium' }}>
                📤 Uploading files...
              </Typography>
              <Typography variant="body2" color="primary" sx={{ fontWeight: 'bold' }}>
                {(typeof uploadProgress === 'number' ? uploadProgress : 0).toFixed(0)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={typeof uploadProgress === 'number' ? uploadProgress : 0}
              sx={{
                height: 8,
                borderRadius: 4,
                backgroundColor: 'grey.200',
                '& .MuiLinearProgress-bar': {
                  borderRadius: 4,
                }
              }}
              color="primary"
            />
          </Box>
        )}

        <DialogActions>
          <Button onClick={handleCloseUploadDialog} disabled={uploading}>
            Cancel
          </Button>
          <Button
            onClick={handleUploadContent}
            variant="contained"
            color="primary"
            disabled={uploading || (
              uploadType === 'note' ? !noteText.trim() :
                uploadType === 'link' ? (!linkName.trim() || !linkUrl.trim()) :
                  uploadFiles.length === 0
            )}
            startIcon={uploading ? <CircularProgress size={20} /> : null}
          >
            {uploading ?
              (uploadType === 'note' ? 'Creating...' :
                uploadType === 'link' ? 'Adding...' :
                  `Uploading... ${(typeof uploadProgress === 'number' ? uploadProgress : 0).toFixed(0)}%`) :
              (uploadType === 'note' ? 'Create Note' :
                uploadType === 'link' ? 'Add Link' :
                  'Upload')
            }
          </Button>

          {/* Helper text for disabled state */}
          {((uploadType === 'note' && !noteText.trim()) ||
            (uploadType === 'link' && (!linkName.trim() || !linkUrl.trim())) ||
            (uploadType !== 'note' && uploadType !== 'link' && uploadFiles.length === 0)) && !uploading && (
              <Typography variant="caption" color="error" sx={{ position: 'absolute', bottom: 8, left: 16 }}>
                {uploadType === 'note' ? '⚠️ Please enter note text' :
                  uploadType === 'link' ? '⚠️ Please enter both link name and URL' :
                    '⚠️ Please select at least one file'}
              </Typography>
            )}
        </DialogActions>
      </Dialog>

      {/* Delete Content Dialog */}
      <Dialog open={openDeleteDialog} onClose={handleCloseDeleteDialog}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this {contentToDelete?.type}? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDeleteDialog}>Cancel</Button>
          <Button onClick={handleDeleteContent} color="error">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Module Dialog */}
      <Dialog
        open={openDeleteModuleDialog}
        onClose={deletingModule ? undefined : handleCloseDeleteModuleDialog}
      >
        <DialogTitle>Delete Module</DialogTitle>
        <DialogContent>
          <DialogContentText>
            <strong>Warning: This action cannot be undone.</strong>
            <Box component="div" sx={{ mt: 2 }}>
              Deleting the module &quot;{module.title}&quot; will permanently remove:
              <ul>
                <li>All {videos.length} videos in this module</li>
                <li>All {notes.length} notes in this module</li>
                <li>All {pdfs.length} PDF files in this module</li>
                <li>All {images.length} images in this module</li>
                <li>All {audios.length} Audio files in this module</li>
                <li>All {links.length} links in this module</li>
              </ul>
            </Box>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCloseDeleteModuleDialog}
            disabled={deletingModule}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDeleteModule}
            color="error"
            disabled={deletingModule}
            startIcon={deletingModule ? <CircularProgress size={20} /> : <DeleteIcon />}
          >
            {deletingModule ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Note Dialog */}
      <Dialog open={!!editingNote} onClose={handleCloseEditNote} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Note</DialogTitle>
        <DialogContent>
          <TextField
            margin="dense"
            id="editNoteText"
            label="Note Text"
            type="text"
            fullWidth
            variant="outlined"
            multiline
            rows={6}
            value={editNoteText}
            onChange={(e) => setEditNoteText(e.target.value)}
            placeholder="Enter your note text here..."
            sx={{ mt: 2 }}
            autoFocus
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            The first line will be used as the note title automatically.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEditNote} disabled={uploading}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveEditNote}
            variant="contained"
            color="primary"
            disabled={uploading || !editNoteText.trim()}
            startIcon={uploading ? <CircularProgress size={20} /> : null}
          >
            {uploading ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ModuleDetail; 