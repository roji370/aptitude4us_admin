import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Box,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  IconButton,
  Button,
  Paper,
  Typography,
  Tooltip,
  Switch,
  FormControlLabel,
  Chip,
  TextField,
  CircularProgress,
} from '@mui/material';
import {
  DragIndicator as DragIndicatorIcon,
  Delete as DeleteIcon,
  VideoLibrary as VideoIcon,
  Article as NoteIcon,
  PictureAsPdf as PdfIcon,
  Image as ImageIcon,
  AudioFile as AudioIcon,
  Edit as EditIcon,
  Link as LinkIcon,
  Check as CheckIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import type { ContentItem } from '../services/courseService';

interface SortableContentListProps {
  items: ContentItem[];
  contentType: 'videos' | 'notes' | 'pdfs' | 'images' | 'audios' | 'links';
  onReorder: (reorderedItems: ContentItem[]) => void;
  onDelete: (id: string) => void;
  onEdit?: (item: ContentItem) => void;
  onRename?: (id: string, newTitle: string) => Promise<void>;
  onTogglePublish?: (id: string, isPublished: boolean) => void;
  onToggleOneTimeView?: (id: string, isOneTimeView: boolean) => void;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
}

interface SortableItemProps {
  item: ContentItem;
  onDelete: (id: string) => void;
  onEdit?: (item: ContentItem) => void;
  onRename?: (id: string, newTitle: string) => Promise<void>;
  onTogglePublish?: (id: string, isPublished: boolean) => void;
  onToggleOneTimeView?: (id: string, isOneTimeView: boolean) => void;
}

const getContentIcon = (type: ContentItem['type']) => {
  const getIcon = () => {
    switch (type) {
      case 'video':
        return <VideoIcon fontSize="small" sx={{ color: '#071A52' }} />;
      case 'note':
        return <NoteIcon fontSize="small" sx={{ color: '#006B5F' }} />;
      case 'pdf':
        return <PdfIcon fontSize="small" sx={{ color: '#E11D48' }} />;
      case 'image':
        return <ImageIcon fontSize="small" sx={{ color: '#8B5CF6' }} />;
      case 'audio':
        return <AudioIcon fontSize="small" sx={{ color: '#0284C7' }} />;
      case 'link':
        return <LinkIcon fontSize="small" sx={{ color: '#0D9488' }} />;
      default:
        return <NoteIcon fontSize="small" sx={{ color: '#071A52' }} />;
    }
  };

  return (
    <Box
      sx={{
        width: 36,
        height: 36,
        borderRadius: '8px',
        backgroundColor: 'rgba(7, 26, 82, 0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        mr: 1
      }}
    >
      {getIcon()}
    </Box>
  );
};

const SortableItem: React.FC<SortableItemProps> = ({ item, onDelete, onEdit, onRename, onTogglePublish, onToggleOneTimeView }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(item.title || '');
  const [isSaving, setIsSaving] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditedTitle(item.title || '');
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(false);
    setEditedTitle(item.title || '');
  };

  const handleSaveEdit = async (e: React.MouseEvent) => {
    e.stopPropagation();

    const trimmedTitle = editedTitle.trim();
    if (!trimmedTitle) {
      return; // Don't save empty titles
    }

    if (trimmedTitle === item.title) {
      setIsEditing(false);
      return; // No changes
    }

    if (onRename) {
      setIsSaving(true);
      try {
        await onRename(item.id, trimmedTitle);
        setIsEditing(false);
      } catch (error) {
        console.error('Error renaming content:', error);
        // Keep in edit mode on error
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveEdit(e as unknown as React.MouseEvent);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsEditing(false);
      setEditedTitle(item.title || '');
    }
  };

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      component={Paper}
      elevation={0}
      sx={{
        mb: 1.5,
        p: 2,
        borderRadius: '12px',
        border: '1px solid #E2E8F0',
        cursor: isDragging ? 'grabbing' : 'grab',
        backgroundColor: isDragging ? 'rgba(7, 26, 82, 0.04)' : '#FFFFFF',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        '&:hover': {
          borderColor: '#CBD5E1',
          boxShadow: '0 4px 12px rgba(7, 26, 82, 0.05)',
        },
      }}
      {...attributes}
      {...listeners}
    >
      <ListItemIcon
        sx={{
          cursor: 'grab',
          '&:hover': {
            color: 'primary.main',
          },
        }}
      >
        <Tooltip title="Drag to reorder">
          <DragIndicatorIcon />
        </Tooltip>
      </ListItemIcon>

      <ListItemIcon>
        {getContentIcon(item.type)}
      </ListItemIcon>

      <ListItemText
        primary={
          isEditing ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }} onClick={(e) => e.stopPropagation()}>
              <TextField
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                size="small"
                fullWidth
                autoFocus
                disabled={isSaving}
                placeholder="Enter content name..."
                onClick={(e) => e.stopPropagation()}
                sx={{ flexGrow: 1 }}
              />
              <Tooltip title="Save (Enter)">
                <span>
                  <IconButton
                    size="small"
                    onClick={handleSaveEdit}
                    disabled={isSaving || !editedTitle.trim()}
                    color="success"
                  >
                    {isSaving ? <CircularProgress size={20} /> : <CheckIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Cancel (Esc)">
                <IconButton
                  size="small"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  color="error"
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          ) : item.type === 'link' && item.url ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button
                component="a"
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                variant="text"
                sx={{
                  color: 'primary.main',
                  textDecoration: 'underline',
                  textTransform: 'none',
                  justifyContent: 'flex-start',
                  p: 0,
                  minWidth: 'auto',
                  '&:hover': {
                    backgroundColor: 'transparent',
                    textDecoration: 'underline',
                  },
                }}
              >
                {item.title || 'Untitled Link'}
              </Button>
              {onRename && (
                <Tooltip title="Rename">
                  <IconButton
                    size="small"
                    onClick={handleStartEdit}
                    sx={{ ml: 0.5, opacity: 0.6, '&:hover': { opacity: 1 } }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          ) : item.type === 'note' && item.text && item.text.trim() &&
            (!item.title || item.title === 'Untitled Note' || item.text.startsWith(item.title.replace('...', ''))) ? (
            <Typography
              variant="body1"
              sx={{
                p: 1,
                backgroundColor: 'grey.50',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'grey.200',
                whiteSpace: 'pre-wrap',
                maxHeight: '100px',
                overflow: 'auto',
              }}
            >
              {item.text && item.text.length > 200 ? `${item.text.substring(0, 200)}...` : item.text}
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body1">
                {item.title || 'Untitled Item'}
              </Typography>
              {onRename && (
                <Tooltip title="Rename">
                  <IconButton
                    size="small"
                    onClick={handleStartEdit}
                    sx={{ ml: 0.5, opacity: 0.6, '&:hover': { opacity: 1 } }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )
        }
        secondary={
          item.type === 'note' && item.text && item.title &&
            item.title !== 'Untitled Note' &&
            !item.text.startsWith(item.title.replace('...', '')) ? item.title : undefined
        }
      />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {/* Published Status Toggle */}
        {onTogglePublish && (
          <Tooltip title={item.isPublished ? "Published (visible to students)" : "Draft (hidden from students)"}>
            <FormControlLabel
              control={
                <Switch
                  checked={item.isPublished ?? true}
                  onChange={(e) => {
                    e.stopPropagation();
                    onTogglePublish(item.id, e.target.checked);
                  }}
                  size="small"
                  color="success"
                />
              }
              label={
                <Chip
                  label={item.isPublished ?? true ? "Published" : "Draft"}
                  size="small"
                  color={item.isPublished ?? true ? "success" : "default"}
                  sx={{ ml: 0.5 }}
                />
              }
              sx={{ mr: 1 }}
              onClick={(e) => e.stopPropagation()}
            />
          </Tooltip>
        )}

        {/* One-Time View Toggle */}
        {onToggleOneTimeView ? (
          <Tooltip title={item.isOneTimeView ? "One-Time View enabled (students can only view once)" : "One-Time View disabled (students can view multiple times)"}>
            <FormControlLabel
              control={
                <Switch
                  checked={item.isOneTimeView ?? false}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleOneTimeView(item.id, e.target.checked);
                  }}
                  size="small"
                  color="warning"
                />
              }
              label={
                <Chip
                  label={item.isOneTimeView ? "One-Time" : "Multi-View"}
                  size="small"
                  color={item.isOneTimeView ? "warning" : "default"}
                  sx={{ ml: 0.5 }}
                />
              }
              sx={{ mr: 1 }}
              onClick={(e) => e.stopPropagation()}
            />
          </Tooltip>
        ) : item.isOneTimeView ? (
          <Tooltip title="Students can only view this content once">
            <Chip label="One-Time" size="small" color="warning" sx={{ mr: 1 }} />
          </Tooltip>
        ) : null}

        {item.type === 'note' && item.text && onEdit && (
          <Tooltip title="Edit note">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(item);
              }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        {item.url && (
          <Button
            variant="outlined"
            size="small"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            View
          </Button>
        )}

        <Tooltip title="Delete">
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item.id);
            }}
            color="error"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </ListItem>
  );
};

const SortableContentList: React.FC<SortableContentListProps> = ({
  items,
  contentType,
  onReorder,
  onDelete,
  onEdit,
  onRename,
  onTogglePublish,
  onToggleOneTimeView,
  emptyMessage = 'No items added yet',
  emptyIcon,
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Reduced distance for more responsive dragging
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Items should already be sorted by the parent component
  const sortedItems = items;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    console.log('🎯 Drag end event:', { activeId: active.id, overId: over?.id });

    if (active.id !== over?.id && over?.id) {
      const oldIndex = sortedItems.findIndex((item) => item.id === active.id);
      const newIndex = sortedItems.findIndex((item) => item.id === over?.id);

      console.log('📍 Drag indices:', { oldIndex, newIndex });

      if (oldIndex !== -1 && newIndex !== -1) {
        const reorderedItems = arrayMove(sortedItems, oldIndex, newIndex);
        console.log('🔄 Calling onReorder with:', reorderedItems.map(item => ({ id: item.id, title: item.title })));
        onReorder(reorderedItems);
      }
    }
  };

  if (sortedItems.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        {emptyIcon}
        <Typography variant="body1" color="text.secondary">
          {emptyMessage}
        </Typography>
      </Box>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={sortedItems.map(item => item.id)} strategy={verticalListSortingStrategy}>
        <List>
          {sortedItems.map((item) => (
            <SortableItem
              key={item.id}
              item={item}
              onDelete={onDelete}
              onEdit={onEdit}
              onRename={onRename}
              onTogglePublish={onTogglePublish}
              onToggleOneTimeView={onToggleOneTimeView}
            />
          ))}
        </List>
      </SortableContext>
    </DndContext>
  );
};

export default SortableContentList;
