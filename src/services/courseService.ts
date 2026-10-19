import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  DocumentSnapshot,
  writeBatch,
  setDoc
} from 'firebase/firestore';
import type { SnapshotOptions } from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
  uploadBytesResumable
} from 'firebase/storage';
import { db, storage } from '../firebase/config';
import { generateSafeId, generateStructuredCourseId } from '../utils/idGenerator';
import { getUserSubscriptions, getEffectiveEndDate } from './subscriptionService';
import { updateUserAssignedCourses, setUserCustomClaims } from './authService';

// Progress callback types for upload operations
export type UploadProgressCallback = (fileName: string, progress: number) => void;
export type UploadCompletionCallback = (fileName: string, success: boolean, error?: string) => void;

// Types
export interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  thumbnailUrl: string;
  isActive: boolean; // Legacy field, kept for backward compatibility
  isPublished: boolean; // New field for consistent naming with modules
  isPinned?: boolean; // New field for pinning courses
  createdAt: Date;
  updatedAt: Date;
}

export interface Module {
  id: string;
  courseId: string;
  title: string;
  description: string;
  order: number;
  content: {
    videos: ContentItem[];
    notes: ContentItem[];
    pdfs: ContentItem[];
    images: ContentItem[];
    audios: ContentItem[];
    links: ContentItem[];
  };
  isPublished: boolean;
  prerequisites: string[]; // Module IDs
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentItem {
  id: string;
  title: string;
  description?: string;
  url?: string; // Optional for text-based notes
  text?: string; // For text-based notes
  type: 'video' | 'note' | 'pdf' | 'image' | 'audio' | 'link';
  order?: number; // For drag-and-drop ordering
  isPublished?: boolean; // Published state for individual content items
  isOneTimeView?: boolean; // If true, students can only view this content once
  createdAt: Date;
}

// Firestore converter for Course
const courseConverter = {
  toFirestore: (course: Omit<Course, 'id'>) => {
    return {
      title: course.title,
      description: course.description,
      category: course.category,
      thumbnailUrl: course.thumbnailUrl,
      isActive: course.isActive,
      isPublished: course.isPublished,
      isPinned: course.isPinned || false,
      createdAt: Timestamp.fromDate(course.createdAt),
      updatedAt: Timestamp.fromDate(course.updatedAt)
    };
  },
  fromFirestore: (snapshot: DocumentSnapshot, options: SnapshotOptions) => {
    const data = snapshot.data(options);
    if (!data) return {} as Course;

    return {
      id: snapshot.id,
      title: data.title,
      description: data.description,
      category: data.category,
      thumbnailUrl: data.thumbnailUrl,
      isActive: data.isActive !== undefined ? data.isActive : true, // Backward compatibility
      isPublished: data.isPublished !== undefined ? data.isPublished : data.isActive !== undefined ? data.isActive : true, // Use isPublished if available, fallback to isActive, default to true
      isPinned: data.isPinned || false,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate()
    } as Course;
  }
};

// Firestore converter for Module
const moduleConverter = {
  toFirestore: (module: Omit<Module, 'id'>) => {
    console.log('Converting module to Firestore format:', module);

    // Create a properly structured content object with arrays
    let content = module.content || { videos: [], notes: [], pdfs: [], images: [], audios: [], links: [] };

    // Ensure each content array exists
    content = {
      videos: content.videos || [],
      notes: content.notes || [],
      pdfs: content.pdfs || [],
      images: content.images || [],
      audios: content.audios || [],
      links: content.links || []
    };

    return {
      courseId: module.courseId,
      title: module.title,
      description: module.description,
      order: module.order,
      content: content,
      isPublished: module.isPublished,
      prerequisites: module.prerequisites,
      createdAt: Timestamp.fromDate(module.createdAt),
      updatedAt: Timestamp.fromDate(module.updatedAt)
    };
  },
  fromFirestore: (snapshot: DocumentSnapshot, options: SnapshotOptions) => {
    const data = snapshot.data(options);
    if (!data) return {} as Module;

    console.log('Converting Firestore data to module:', data);

    // Ensure content structure exists and each array is initialized
    let content = data.content || { videos: [], notes: [], pdfs: [], images: [], audios: [], links: [] };

    content = {
      videos: content.videos || [],
      notes: content.notes || [],
      pdfs: content.pdfs || [],
      images: content.images || [],
      audios: content.audios || [],
      links: content.links || []
    };

    const result = {
      id: snapshot.id,
      courseId: data.courseId,
      title: data.title,
      description: data.description,
      order: data.order,
      content: content,
      isPublished: data.isPublished,
      prerequisites: data.prerequisites,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate()
    } as Module;

    console.log('Converted module object:', result);
    return result;
  }
};

// Course functions
export const getCourses = async (): Promise<Course[]> => {
  try {
    const coursesRef = collection(db, 'courses').withConverter(courseConverter);
    const q = query(coursesRef, orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => doc.data() as Course);
  } catch (error) {
    console.error('Error getting courses:', error);
    throw error;
  }
};

export const getActiveCourses = async (): Promise<Course[]> => {
  try {
    const coursesRef = collection(db, 'courses').withConverter(courseConverter);
    const q = query(coursesRef, where('isActive', '==', true), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => doc.data() as Course);
  } catch (error) {
    console.error('Error getting active courses:', error);
    throw error;
  }
};

// Get published courses for students
export const getPublishedCourses = async (): Promise<Course[]> => {
  try {
    const coursesRef = collection(db, 'courses').withConverter(courseConverter);
    const q = query(coursesRef, where('isPublished', '==', true), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => doc.data() as Course);
  } catch (error) {
    console.error('Error getting published courses:', error);
    throw error;
  }
};

export const getCourseById = async (id: string): Promise<Course | null> => {
  try {
    const courseRef = doc(db, 'courses', id).withConverter(courseConverter);
    const courseSnap = await getDoc(courseRef);

    if (courseSnap.exists()) {
      return courseSnap.data() as Course;
    }

    return null;
  } catch (error) {
    console.error('Error getting course by ID:', error);
    throw error;
  }
};

export const createCourse = async (courseData: Omit<Course, 'id' | 'createdAt' | 'updatedAt'>): Promise<Course> => {
  try {
    const course = {
      ...courseData,
      // Ensure both fields are set for new courses
      isActive: courseData.isActive !== undefined ? courseData.isActive : true,
      isPublished: courseData.isPublished !== undefined ? courseData.isPublished : courseData.isActive !== undefined ? courseData.isActive : true,
      isPinned: courseData.isPinned || false, // Default to unpinned for new courses
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Generate a custom ID for the course based on category
    const courseId = generateStructuredCourseId(courseData.category);

    // Use setDoc with the custom ID instead of addDoc
    const courseRef = doc(db, 'courses', courseId).withConverter(courseConverter);
    await setDoc(courseRef, course);

    return {
      id: courseId,
      ...course
    };
  } catch (error) {
    console.error('Error creating course:', error);
    throw error;
  }
};

export const updateCourse = async (id: string, courseData: Partial<Omit<Course, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void> => {
  try {
    const courseRef = doc(db, 'courses', id);

    // Ensure both fields are updated when one is changed
    const updateData: any = {
      ...courseData,
      updatedAt: new Date()
    };

    // Sync isActive and isPublished fields
    if (courseData.isActive !== undefined && courseData.isPublished === undefined) {
      updateData.isPublished = courseData.isActive;
    } else if (courseData.isPublished !== undefined && courseData.isActive === undefined) {
      updateData.isActive = courseData.isPublished;
    }

    await updateDoc(courseRef, updateData);
  } catch (error) {
    console.error('Error updating course:', error);
    throw error;
  }
};

// Toggle course pin status
export const toggleCoursePinStatus = async (courseId: string): Promise<boolean> => {
  try {
    // Get current course data
    const course = await getCourseById(courseId);
    if (!course) {
      throw new Error('Course not found');
    }

    const newPinnedStatus = !course.isPinned;

    // Update the course with new pinned status
    await updateCourse(courseId, { isPinned: newPinnedStatus });

    console.log(`Course ${courseId} pin status toggled to: ${newPinnedStatus}`);
    return newPinnedStatus;
  } catch (error) {
    console.error('Error toggling course pin status:', error);
    throw error;
  }
};

export const deleteCourse = async (id: string): Promise<void> => {
  try {
    // Soft delete - set both isActive and isPublished to false
    const courseRef = doc(db, 'courses', id);

    await updateDoc(courseRef, {
      isActive: false,
      isPublished: false,
      updatedAt: new Date()
    });
  } catch (error) {
    console.error('Error deleting course:', error);
    throw error;
  }
};

// Upload course thumbnail
export const uploadCourseThumbnail = async (courseId: string, file: File): Promise<string> => {
  try {
    // Create a safe filename with timestamp and a safe ID
    const timestamp = Date.now();
    const fileExtension = file.name.split('.').pop() || '';
    const safeId = generateSafeId(6);
    const safeFileName = `thumbnail_${courseId}_${safeId}_${timestamp}.${fileExtension}`;

    // Use the path structure that matches the security rules: /courses/thumbnails/{filename}
    const storageRef = ref(storage, `courses/thumbnails/${safeFileName}`);

    console.log(`Uploading thumbnail to courses/thumbnails/${safeFileName}`);
    await uploadBytes(storageRef, file);

    const downloadURL = await getDownloadURL(storageRef);
    console.log('Successfully uploaded thumbnail, URL:', downloadURL);
    return downloadURL;
  } catch (error) {
    console.error('Error uploading thumbnail:', error);
    throw error;
  }
};

// Module functions
export const getModulesByCourseId = async (courseId: string): Promise<Module[]> => {
  try {
    const modulesRef = collection(db, 'modules').withConverter(moduleConverter);
    const q = query(modulesRef, where('courseId', '==', courseId), orderBy('order', 'asc'));
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => doc.data() as Module);
  } catch (error) {
    console.error('Error getting modules:', error);
    throw error;
  }
};

// Get only published modules for a specific course (for students)
export const getPublishedModulesByCourseId = async (courseId: string): Promise<Module[]> => {
  try {
    const modulesRef = collection(db, 'modules').withConverter(moduleConverter);
    const q = query(
      modulesRef,
      where('courseId', '==', courseId),
      where('isPublished', '==', true),
      orderBy('order', 'asc')
    );
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => doc.data() as Module);
  } catch (error) {
    console.error('Error getting published modules:', error);
    throw error;
  }
};

export const getModuleById = async (id: string): Promise<Module | null> => {
  try {
    const moduleRef = doc(db, 'modules', id).withConverter(moduleConverter);
    const moduleSnap = await getDoc(moduleRef);

    if (moduleSnap.exists()) {
      return moduleSnap.data() as Module;
    }

    return null;
  } catch (error) {
    console.error('Error getting module by ID:', error);
    throw error;
  }
};

export const createModule = async (moduleData: Omit<Module, 'id' | 'createdAt' | 'updatedAt'>): Promise<Module> => {
  try {
    const module = {
      ...moduleData,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Generate a safe module ID
    const moduleId = `MOD-${moduleData.courseId.split('-')[0]}-${generateSafeId(8)}`;

    // Use setDoc with the custom ID
    const moduleRef = doc(db, 'modules', moduleId).withConverter(moduleConverter);
    await setDoc(moduleRef, module);

    // 🔥 IMPORTANT: Update the course document to trigger content update notifications
    // This will trigger the notifyCourseUpdate Cloud Function which detects module additions
    const courseRef = doc(db, 'courses', moduleData.courseId);
    await updateDoc(courseRef, {
      updatedAt: new Date()
    });

    console.log(`✅ Module ${moduleId} created and course ${moduleData.courseId} updated for notification trigger`);

    return {
      id: moduleId,
      ...module
    };
  } catch (error) {
    console.error('Error creating module:', error);
    throw error;
  }
};

export const updateModule = async (id: string, moduleData: Partial<Omit<Module, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void> => {
  try {
    const moduleRef = doc(db, 'modules', id);

    console.log('Updating module with data:', moduleData);

    // Special handling for content to ensure arrays exist
    if (moduleData.content) {
      moduleData.content = {
        videos: moduleData.content.videos || [],
        notes: moduleData.content.notes || [],
        pdfs: moduleData.content.pdfs || [],
        images: moduleData.content.images || [],
        audios: moduleData.content.audios || [],
        links: moduleData.content.links || []
      };

      console.log('Normalized content structure:', moduleData.content);
    }

    await updateDoc(moduleRef, {
      ...moduleData,
      updatedAt: new Date()
    });

    console.log('Module updated successfully:', id);
  } catch (error) {
    console.error('Error updating module:', error);
    throw error;
  }
};

export const deleteModule = async (id: string): Promise<void> => {
  try {
    // Get module data first to know which course it belongs to
    const moduleRef = doc(db, 'modules', id);
    const moduleSnap = await getDoc(moduleRef);

    if (!moduleSnap.exists()) {
      throw new Error('Module not found');
    }

    const moduleData = moduleSnap.data();
    const courseId = moduleData.courseId;

    // Delete the module
    await deleteDoc(moduleRef);

    // 🔥 IMPORTANT: Update the course document to trigger content update notifications
    // This will trigger the notifyCourseUpdate Cloud Function which detects module deletions
    if (courseId) {
      const courseRef = doc(db, 'courses', courseId);
      await updateDoc(courseRef, {
        updatedAt: new Date()
      });

      console.log(`✅ Module ${id} deleted and course ${courseId} updated for notification trigger`);
    }
  } catch (error) {
    console.error('Error deleting module:', error);
    throw error;
  }
};

// Content functions

// Create text-based note
export const createTextNote = async (moduleId: string, title: string, text: string, isOneTimeView = false): Promise<ContentItem> => {
  try {
    console.log(`Creating text note for module ${moduleId}`);

    // Get current module data
    const moduleRef = doc(db, 'modules', moduleId);
    const moduleSnap = await getDoc(moduleRef);

    if (!moduleSnap.exists()) {
      throw new Error('Module not found');
    }

    const moduleData = moduleSnap.data();

    // Create the note content item
    const contentItem: ContentItem = {
      id: generateSafeId(),
      title,
      description: '',
      text,
      type: 'note',
      order: moduleData.content?.notes?.length || 0, // Set order to end of list
      isPublished: true, // Default to published
      isOneTimeView: isOneTimeView ?? false,
      createdAt: new Date()
    };

    // Initialize content structure
    const content = {
      videos: Array.isArray(moduleData.content?.videos) ? [...moduleData.content.videos] : [],
      notes: Array.isArray(moduleData.content?.notes) ? [...moduleData.content.notes] : [],
      pdfs: Array.isArray(moduleData.content?.pdfs) ? [...moduleData.content.pdfs] : [],
      images: Array.isArray(moduleData.content?.images) ? [...moduleData.content.images] : [],
      audios: Array.isArray(moduleData.content?.audios) ? [...moduleData.content.audios] : [],
      links: Array.isArray(moduleData.content?.links) ? [...moduleData.content.links] : []
    };

    // Add the new note
    content.notes = [...content.notes, contentItem];

    // Convert any non-serializable objects in the content item
    // Only include fields that are not undefined to avoid Firestore errors
    // Helper: normalize a single ContentItem for Firestore (preserves all fields)
    const normalizeItem = (item: ContentItem, index: number): any => {
      const normalized: any = {
        id: item.id,
        title: item.title,
        description: item.description || '',
        type: item.type,
        order: item.order ?? index,
        isPublished: item.isPublished ?? true,
        isOneTimeView: item.isOneTimeView ?? false,
        createdAt: item.createdAt instanceof Date ? Timestamp.fromDate(item.createdAt) : item.createdAt
      };
      if (item.url !== undefined) normalized.url = item.url;
      if (item.text !== undefined) normalized.text = item.text;
      return normalized;
    };

    const normalizedContent = {
      videos: content.videos.map(normalizeItem),
      notes: content.notes.map(normalizeItem),
      pdfs: content.pdfs.map(normalizeItem),
      images: content.images.map(normalizeItem),
      audios: content.audios.map(normalizeItem)
    };

    // Update the module document
    console.log(`Updating module ${moduleId} with normalized content:`, normalizedContent);

    await updateDoc(moduleRef, {
      content: normalizedContent,
      updatedAt: Timestamp.fromDate(new Date())
    });

    console.log(`✅ Successfully created text note for module ${moduleId}`);
    return contentItem;
  } catch (error) {
    console.error(`Error creating text note:`, error);
    throw error;
  }
};

export const uploadContent = async (courseId: string, moduleId: string, file: File, type: 'video' | 'note' | 'pdf' | 'image' | 'audio', title: string, description?: string): Promise<ContentItem> => {
  try {
    console.log(`Starting upload of ${type} for module ${moduleId} in course ${courseId}`);
    console.log(`File details:`, { name: file.name, type: file.type, size: file.size });

    // Create a safe filename with timestamp and sanitized title
    const timestamp = Date.now();
    const fileExtension = file.name.split('.').pop() || '';

    // Generate a safe ID for the file to avoid problematic characters
    const safeId = generateSafeId(6);

    // Create a standardized filename format with safe characters
    const safeFileName = `${type}_${timestamp}_${safeId}_${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${fileExtension}`;

    // Use the path structure that matches the security rules and stores files in module folders
    const storageRef = ref(storage, `courses/${courseId}/modules/${moduleId}/${type}s/${safeFileName}`);

    // Upload the file
    console.log(`Uploading ${type} to courses/${courseId}/modules/${moduleId}/${type}s/${safeFileName}`);
    await uploadBytes(storageRef, file);

    // Get the download URL
    const downloadURL = await getDownloadURL(storageRef);
    console.log(`Successfully uploaded ${type}, URL:`, downloadURL);

    // Generate a safe content ID
    const contentId = `${type}-${safeId}-${timestamp}`;

    // Get the current module to determine order
    const moduleRef = doc(db, 'modules', moduleId).withConverter(moduleConverter);
    const moduleSnap = await getDoc(moduleRef);

    if (!moduleSnap.exists()) {
      throw new Error('Module not found');
    }

    const moduleData = moduleSnap.data();

    // Make sure we have a proper content structure
    const content = {
      videos: Array.isArray(moduleData.content?.videos) ? moduleData.content.videos : [],
      notes: Array.isArray(moduleData.content?.notes) ? moduleData.content.notes : [],
      pdfs: Array.isArray(moduleData.content?.pdfs) ? moduleData.content.pdfs : [],
      images: Array.isArray(moduleData.content?.images) ? moduleData.content.images : [],
      audios: Array.isArray(moduleData.content?.audios) ? moduleData.content.audios : [],
      links: Array.isArray(moduleData.content?.links) ? moduleData.content.links : []
    };

    // Get the current count for the content type to set order
    const contentTypeKey = `${type}s` as 'videos' | 'notes' | 'pdfs' | 'images' | 'audios' | 'links';
    const currentCount = content[contentTypeKey].length;

    const contentItem: ContentItem = {
      id: contentId, // More descriptive ID format
      title,
      description: description || '',
      url: downloadURL,
      type,
      order: currentCount, // Set order to end of current list
      isPublished: true, // Default to published
      createdAt: new Date()
    };

    console.log(`Created content item:`, contentItem);

    // Add the new content item to the appropriate array
    content[contentTypeKey] = [...content[contentTypeKey], contentItem];

    // Convert any non-serializable objects in the content item
    // Only include fields that are not undefined to avoid Firestore errors
    // Helper: normalize a single ContentItem for Firestore (preserves all fields)
    const normalizeItem = (item: ContentItem, index: number): any => {
      const normalized: any = {
        id: item.id,
        title: item.title,
        description: item.description || '',
        type: item.type,
        order: item.order ?? index,
        isPublished: item.isPublished ?? true,
        isOneTimeView: item.isOneTimeView ?? false,
        createdAt: item.createdAt instanceof Date ? Timestamp.fromDate(item.createdAt) : item.createdAt
      };
      if (item.url !== undefined) normalized.url = item.url;
      if (item.text !== undefined) normalized.text = item.text;
      return normalized;
    };

    const normalizedContent = {
      videos: content.videos.map(normalizeItem),
      notes: content.notes.map(normalizeItem),
      pdfs: content.pdfs.map(normalizeItem),
      images: content.images.map(normalizeItem),
      audios: content.audios.map(normalizeItem)
    };

    // Update the module document directly without the converter
    const moduleDocRef = doc(db, 'modules', moduleId);
    console.log(`Updating module ${moduleId} with normalized content:`, normalizedContent);

    await updateDoc(moduleDocRef, {
      content: normalizedContent,
      updatedAt: Timestamp.fromDate(new Date())
    });

    return contentItem;
  } catch (error) {
    console.error(`Error uploading ${type}:`, error);

    // Check for specific Firebase storage errors
    const err = error as { code?: string; message?: string };
    if (err.code === 'storage/unauthorized') {
      throw new Error(`Permission denied: You don't have permission to upload to this location. Please check your authentication and storage rules.`);
    } else if (err.code === 'storage/canceled') {
      throw new Error('Upload was canceled');
    } else if (err.code === 'storage/unknown') {
      throw new Error(`Unknown error occurred during upload. Please try again. Details: ${err.message}`);
    }

    throw error;
  }
};

export const deleteContent = async (courseId: string, moduleId: string, type: 'video' | 'note' | 'pdf' | 'image' | 'audio', fileUrl: string): Promise<void> => {
  try {
    // Skip file deletion for text-based content (notes without URLs)
    if (!fileUrl || fileUrl.trim() === '') {
      console.log(`Skipping file deletion for ${type} - no URL provided (likely text-based content)`);
      return;
    }

    // Extract the filename from the full URL
    // The URL format is typically like: https://firebasestorage.googleapis.com/v0/b/course-c18bb.firebasestorage.app/o/courses%2F{courseId}%2Fmodules%2F{moduleId}%2F{type}s%2F{filename}?alt=media&token=...

    // First, get the path part from the URL (after /o/ and before ?)
    const pathRegex = /\/o\/([^?]+)/;
    const pathMatch = fileUrl.match(pathRegex);

    if (!pathMatch || !pathMatch[1]) {
      throw new Error('Invalid file URL format');
    }

    // Decode the URL-encoded path
    const decodedPath = decodeURIComponent(pathMatch[1]);

    // Create a reference directly to the file
    const storageRef = ref(storage, decodedPath);

    console.log(`Deleting file at path: ${decodedPath}`);
    await deleteObject(storageRef);
    console.log('File successfully deleted');
  } catch (error) {
    console.error(`Error deleting ${type}:`, error);

    // Check if the error is because the file doesn't exist
    const err = error as { code?: string; message?: string };
    if (err.code === 'storage/object-not-found') {
      console.warn(`File already deleted or doesn't exist: ${type} at path`);
      // Don't throw error for files that don't exist - this is not a critical failure
      return;
    }

    // Re-throw other errors as they might be critical
    throw error;
  }
};

// Get assigned courses for a student
export const getAssignedCourses = async (userId: string): Promise<Course[]> => {
  try {
    // Get the user document to retrieve assigned course IDs
    const userDoc = await getDoc(doc(db, 'users', userId));

    if (!userDoc.exists()) {
      return [];
    }

    const userData = userDoc.data();
    const assignedCourseIds = userData.assignedCourseIds || [];

    // If no assigned courses, return empty array
    if (assignedCourseIds.length === 0) {
      return [];
    }

    // Get all assigned courses
    const courses: Course[] = [];

    for (const courseId of assignedCourseIds) {
      const courseRef = doc(db, 'courses', courseId).withConverter(courseConverter);
      const courseSnap = await getDoc(courseRef);

      if (courseSnap.exists() && courseSnap.data().isPublished) {
        courses.push(courseSnap.data() as Course);
      }
    }

    return courses;
  } catch (error) {
    console.error('Error getting assigned courses:', error);
    throw error;
  }
};

// Check if a user has an active subscription
export const checkUserActiveSubscription = async (userId: string): Promise<boolean> => {
  try {
    const subscriptions = await getUserSubscriptions(userId);

    // Check if user has at least one active subscription. We compare against
    // the effective end date so that an exam date set before the regular
    // endDate correctly cuts off access.
    const now = new Date();
    const hasActiveSubscription = subscriptions.some(subscription => {
      return subscription.status === 'active' &&
        getEffectiveEndDate(subscription) > now;
    });

    return hasActiveSubscription;
  } catch (error) {
    console.error('Error checking user active subscription:', error);
    return false;
  }
};

// Check if a user has access to a specific course
export const hasAccessToCourse = async (userId: string, courseId: string): Promise<boolean> => {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));

    if (!userDoc.exists()) {
      return false;
    }

    const userData = userDoc.data();

    // All users (students and admins) must be assigned the course
    const assignedCourseIds = userData.assignedCourseIds || [];
    const isAssignedToCourse = assignedCourseIds.includes(courseId);

    if (!isAssignedToCourse) {
      return false;
    }

    // All users must have an active subscription
    const hasActiveSubscription = await checkUserActiveSubscription(userId);

    return hasActiveSubscription;
  } catch (error) {
    console.error('Error checking course access:', error);
    return false;
  }
};

// Bulk assign course to multiple users - OPTIMIZED VERSION with notifications
export const bulkAssignCourse = async (
  courseId: string,
  userIds: string[],
  options: {
    sendNotifications?: boolean;
    adminId?: string;
  } = {}
): Promise<{
  successCount: number;
  failCount: number;
  failedUsers: Array<{ userId: string; reason: string }>;
  notificationResult?: any;
}> => {
  try {
    let successCount = 0;
    let failCount = 0;
    const failedUsers: Array<{ userId: string; reason: string }> = [];

    console.log(`Starting optimized bulk assignment of course ${courseId} to ${userIds.length} users`);

    // Step 1: Batch fetch all user documents
    console.log('Fetching user documents...');
    const userDocs = new Map();
    const userFetchPromises = userIds.map(async (userId) => {
      try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (userDoc.exists()) {
          userDocs.set(userId, userDoc.data());
        }
      } catch (error) {
        console.warn(`Failed to fetch user ${userId}:`, error);
      }
    });

    await Promise.all(userFetchPromises);
    console.log(`Fetched ${userDocs.size} user documents out of ${userIds.length}`);

    // Step 2: Batch check subscriptions
    console.log('Checking subscriptions...');
    const subscriptionStatuses = new Map();
    const subscriptionPromises = Array.from(userDocs.keys()).map(async (userId) => {
      try {
        const hasActiveSubscription = await checkUserActiveSubscription(userId);
        subscriptionStatuses.set(userId, hasActiveSubscription);
      } catch (error) {
        subscriptionStatuses.set(userId, false);
        console.warn(`Failed to check subscription for user ${userId}:`, error);
      }
    });

    await Promise.all(subscriptionPromises);
    console.log(`Checked subscriptions for ${subscriptionStatuses.size} users`);

    // Step 3: Prepare batch updates
    const batch = writeBatch(db);
    const validUpdates: string[] = [];

    for (const userId of userIds) {
      try {
        // Check if user exists
        if (!userDocs.has(userId)) {
          failCount++;
          failedUsers.push({
            userId,
            reason: 'User not found'
          });
          continue;
        }

        // Check subscription status
        if (!subscriptionStatuses.get(userId)) {
          failCount++;
          failedUsers.push({
            userId,
            reason: 'No active subscription'
          });
          continue;
        }

        const userData = userDocs.get(userId);
        const currentAssignedCourses = userData.assignedCourseIds || [];

        // Skip if course is already assigned
        if (currentAssignedCourses.includes(courseId)) {
          successCount++; // Count as success since desired state is achieved
          console.log(`Course already assigned to user ${userId}`);
          continue;
        }

        // Prepare batch update
        const updatedCourseIds = [...currentAssignedCourses, courseId];
        const userRef = doc(db, 'users', userId);

        batch.update(userRef, {
          assignedCourseIds: updatedCourseIds,
          updatedAt: new Date()
        });

        validUpdates.push(userId);

      } catch (error) {
        failCount++;
        failedUsers.push({
          userId,
          reason: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Step 4: Execute batch update
    if (validUpdates.length > 0) {
      console.log(`Executing batch update for ${validUpdates.length} users...`);
      await batch.commit();
      successCount += validUpdates.length;
      console.log(`Batch update completed for ${validUpdates.length} users`);

      // Step 5: Update custom claims in parallel (non-blocking)
      console.log('Updating custom claims...');
      const claimsPromises = validUpdates.map(async (userId) => {
        try {
          const userData = userDocs.get(userId);
          const updatedCourseIds = [...(userData.assignedCourseIds || []), courseId];

          // Update user's assigned course IDs
          await setUserCustomClaims(userId, { assignedCourseIds: updatedCourseIds });
        } catch (error) {
          console.warn(`Failed to update custom claims for user ${userId}:`, error);
        }
      });

      // Don't wait for custom claims - they can complete in background
      Promise.all(claimsPromises).then(() => {
        console.log('Custom claims updates completed');
      }).catch((error) => {
        console.warn('Some custom claims updates failed:', error);
      });
    }

    console.log(`Optimized bulk assignment completed: ${successCount} successful, ${failCount} failed`);

    // Step 6: Send notifications for newly assigned users (if requested)
    let notificationResult = null;
    if (options.sendNotifications && validUpdates.length > 0 && options.adminId) {
      try {
        console.log(`Sending notifications for ${validUpdates.length} newly assigned users...`);

        // Import notification service dynamically to avoid circular dependencies
        const { sendCourseAssignmentNotifications } = await import('./courseAssignmentNotificationService');

        // Send notifications for the newly assigned users
        notificationResult = await sendCourseAssignmentNotifications(
          courseId,
          validUpdates, // Only users who were actually assigned (not those who already had it)
          validUpdates  // These are all newly assigned
        );

        console.log('Bulk notification result:', notificationResult);
      } catch (notificationError) {
        console.error('Failed to send bulk notifications:', notificationError);
        // Don't fail the entire operation if notifications fail
        notificationResult = {
          success: false,
          error: notificationError instanceof Error ? notificationError.message : 'Unknown notification error'
        };
      }
    }

    return {
      successCount,
      failCount,
      failedUsers,
      notificationResult
    };

  } catch (error) {
    console.error('Error in optimized bulk course assignment:', error);
    throw error;
  }
};

// Get modules for a specific course that a user has access to
export const getAccessibleModulesByCourseId = async (userId: string, courseId: string): Promise<Module[]> => {
  try {
    // First check if user has access to this course
    const hasAccess = await hasAccessToCourse(userId, courseId);

    if (!hasAccess) {
      return [];
    }

    // All users (students and admins) see only published modules
    return await getPublishedModulesByCourseId(courseId);
  } catch (error) {
    console.error('Error getting accessible modules:', error);
    throw error;
  }
};

// Get module statistics for a course
export interface ModuleStats {
  total: number;
  published: number;
  draft: number;
}

export const getModuleStatsByCourseId = async (courseId: string): Promise<ModuleStats> => {
  try {
    const modules = await getModulesByCourseId(courseId);

    const stats: ModuleStats = {
      total: modules.length,
      published: modules.filter(module => module.isPublished).length,
      draft: modules.filter(module => !module.isPublished).length
    };

    return stats;
  } catch (error) {
    console.error('Error getting module stats:', error);
    return { total: 0, published: 0, draft: 0 };
  }
};

// Get module statistics for multiple courses (for better performance when loading course list)
export const getModuleStatsForCourses = async (courseIds: string[]): Promise<Record<string, ModuleStats>> => {
  try {
    const statsPromises = courseIds.map(async (courseId) => {
      const stats = await getModuleStatsByCourseId(courseId);
      return { courseId, stats };
    });

    const results = await Promise.all(statsPromises);

    const statsMap: Record<string, ModuleStats> = {};
    results.forEach(({ courseId, stats }) => {
      statsMap[courseId] = stats;
    });

    return statsMap;
  } catch (error) {
    console.error('Error getting module stats for courses:', error);
    return {};
  }
};

// Enhanced delete functions

/**
 * Permanently deletes a module and all its content
 * @param courseId The ID of the parent course
 * @param moduleId The ID of the module to delete
 * @returns Promise that resolves when deletion is complete
 */
export const permanentlyDeleteModule = async (courseId: string, moduleId: string): Promise<void> => {
  try {
    // Step 1: Get the module to access its content
    const module = await getModuleById(moduleId);

    if (!module) {
      throw new Error('Module not found');
    }

    // Step 2: Delete all content files from storage
    const moduleStorageRef = ref(storage, `courses/${courseId}/modules/${moduleId}`);

    try {
      // Delete content using URL-based approach first (for backward compatibility)
      if (module.content?.videos) {
        for (const item of module.content.videos) {
          try {
            await deleteContent(courseId, moduleId, 'video', item.url || '');
          } catch (error) {
            console.warn(`Failed to delete video using URL: ${item.title}`, error);
          }
        }
      }

      if (module.content?.notes) {
        for (const item of module.content.notes) {
          // Only try to delete files for notes that have URLs (old file-based notes)
          if (item.url) {
            try {
              await deleteContent(courseId, moduleId, 'note', item.url);
            } catch (error) {
              console.warn(`Failed to delete note using URL: ${item.title}`, error);
            }
          } else {
            console.log(`Skipping file deletion for text-based note: ${item.title}`);
          }
        }
      }

      if (module.content?.pdfs) {
        for (const item of module.content.pdfs) {
          try {
            await deleteContent(courseId, moduleId, 'pdf', item.url || '');
          } catch (error) {
            console.warn(`Failed to delete PDF using URL: ${item.title}`, error);
          }
        }
      }

      if (module.content?.images) {
        for (const item of module.content.images) {
          try {
            await deleteContent(courseId, moduleId, 'image', item.url || '');
          } catch (error) {
            console.warn(`Failed to delete image using URL: ${item.title}`, error);
          }
        }
      }

      if (module.content?.audios) {
        for (const item of module.content.audios) {
          try {
            await deleteContent(courseId, moduleId, 'audio', item.url || '');
          } catch (error) {
            console.warn(`Failed to delete audio file using URL: ${item.title}`, error);
          }
        }
      }

      // Direct folder deletion backup approach
      // This recursively deletes the entire module folder which contains all content
      try {
        // Firebase Storage doesn't have a native 'deleteFolder' function,
        // but we can use list and delete operations to simulate this
        const videosFolderRef = ref(storage, `courses/${courseId}/modules/${moduleId}/videos`);
        const notesFolderRef = ref(storage, `courses/${courseId}/modules/${moduleId}/notes`);
        const pdfsFolderRef = ref(storage, `courses/${courseId}/modules/${moduleId}/pdfs`);
        const imagesFolderRef = ref(storage, `courses/${courseId}/modules/${moduleId}/images`);
        const audiosFolderRef = ref(storage, `courses/${courseId}/modules/${moduleId}/audios`);

        const deleteFilesInFolder = async (folderRef: any) => {
          try {
            // List all files in the folder
            const { items } = await listAll(folderRef);

            // Delete each file in the folder
            const deletePromises = items.map(item => deleteObject(item));
            await Promise.all(deletePromises);

            console.log(`Deleted all files in ${folderRef.fullPath}`);
          } catch (error) {
            console.warn(`Error deleting files in folder ${folderRef.fullPath}:`, error);
          }
        };

        // Delete content in each type folder
        await deleteFilesInFolder(videosFolderRef);
        await deleteFilesInFolder(notesFolderRef);
        await deleteFilesInFolder(pdfsFolderRef);
        await deleteFilesInFolder(imagesFolderRef);
        await deleteFilesInFolder(audiosFolderRef);

      } catch (folderError) {
        console.warn('Error during folder deletion approach:', folderError);
      }
    } catch (contentError) {
      console.warn('Error deleting content files:', contentError);
      // Continue with module deletion even if content deletion fails
    }

    // Step 3: Delete the module from Firestore
    await deleteDoc(doc(db, 'modules', moduleId));
    console.log(`Module ${moduleId} deleted successfully`);

    return;
  } catch (error) {
    console.error('Error permanently deleting module:', error);
    throw error;
  }
};

/**
 * Permanently deletes a course and all its modules and content
 * @param courseId The ID of the course to delete
 * @returns Promise that resolves when deletion is complete
 */
export const permanentlyDeleteCourse = async (courseId: string): Promise<void> => {
  try {
    // Step 1: Get all modules for this course
    const modules = await getModulesByCourseId(courseId);

    // Step 2: Delete each module and its content
    for (const module of modules) {
      try {
        await permanentlyDeleteModule(courseId, module.id);
      } catch (error) {
        console.warn(`Failed to delete module ${module.id}`, error);
        // Continue with other module deletions even if one fails
      }
    }

    // Step 3: Delete course thumbnail
    const course = await getCourseById(courseId);
    if (course?.thumbnailUrl) {
      try {
        // Extract path from URL and delete
        const pathRegex = /\/o\/([^?]+)/;
        const pathMatch = course.thumbnailUrl.match(pathRegex);

        if (pathMatch && pathMatch[1]) {
          const decodedPath = decodeURIComponent(pathMatch[1]);
          const thumbnailRef = ref(storage, decodedPath);
          await deleteObject(thumbnailRef);
          console.log('Course thumbnail deleted');
        }
      } catch (thumbnailError) {
        console.warn('Failed to delete course thumbnail:', thumbnailError);
      }

      // Backup approach - delete all thumbnails related to this course
      try {
        const thumbnailsRef = ref(storage, `courses/thumbnails`);
        const { items } = await listAll(thumbnailsRef);

        // Look for thumbnails containing the courseId in their name/path and delete them
        for (const item of items) {
          if (item.name.includes(courseId)) {
            await deleteObject(item);
            console.log(`Deleted thumbnail: ${item.name}`);
          }
        }
      } catch (error) {
        console.warn('Error during backup thumbnail deletion:', error);
      }
    }

    // Step 4: Delete all course content from storage using a direct approach
    try {
      const courseFolderRef = ref(storage, `courses/${courseId}`);
      const deleteFolder = async (folderRef: any) => {
        try {
          const result = await listAll(folderRef);

          // Delete all files in this folder
          const fileDeletePromises = result.items.map(fileRef => {
            return deleteObject(fileRef)
              .then(() => console.log(`Deleted file: ${fileRef.fullPath}`))
              .catch(error => console.warn(`Error deleting file ${fileRef.fullPath}:`, error));
          });

          // Recursively delete subfolders
          const folderDeletePromises = result.prefixes.map(subFolderRef =>
            deleteFolder(subFolderRef)
          );

          // Wait for all deletions to complete
          await Promise.all([...fileDeletePromises, ...folderDeletePromises]);
          console.log(`Deleted folder contents: ${folderRef.fullPath}`);
        } catch (error) {
          console.warn(`Error deleting folder ${folderRef.fullPath}:`, error);
        }
      };

      await deleteFolder(courseFolderRef);
    } catch (storageDeletionError) {
      console.warn('Error during course storage deletion:', storageDeletionError);
    }

    // Step 5: Delete the course document from Firestore
    await deleteDoc(doc(db, 'courses', courseId));

    // Step 6: Delete any course assignments
    try {
      // Find all user documents that reference this course
      const usersRef = collection(db, 'users');
      const usersWithCourse = await getDocs(
        query(usersRef, where('assignedCourseIds', 'array-contains', courseId))
      );

      // Remove the course from each user's assigned courses
      const batch = writeBatch(db);

      usersWithCourse.forEach((userDoc) => {
        const userData = userDoc.data();
        const updatedCourseIds = (userData.assignedCourseIds || [])
          .filter((id: string) => id !== courseId);

        batch.update(userDoc.ref, { assignedCourseIds: updatedCourseIds });
      });

      await batch.commit();
    } catch (assignmentError) {
      console.warn('Error removing course assignments:', assignmentError);
      // Continue even if assignment cleanup fails
    }

    console.log(`Course ${courseId} and all its content deleted successfully`);
    return;
  } catch (error) {
    console.error('Error permanently deleting course:', error);
    throw error;
  }
};

// Upload content with progress tracking
export const uploadContentWithProgress = async (
  courseId: string,
  moduleId: string,
  file: File,
  type: 'video' | 'note' | 'pdf' | 'image' | 'audio',
  title: string,
  description?: string,
  onProgress?: UploadProgressCallback,
  onComplete?: UploadCompletionCallback,
  isOneTimeView = false
): Promise<ContentItem> => {
  try {
    console.log(`Starting optimized upload of ${type} for module ${moduleId} in course ${courseId}`);

    // Create a safe filename with timestamp and sanitized title
    const timestamp = Date.now();
    const fileExtension = file.name.split('.').pop() || '';
    const safeId = generateSafeId(6);
    const safeFileName = `${type}_${timestamp}_${safeId}_${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${fileExtension}`;

    // Use the path structure that matches the security rules
    const storageRef = ref(storage, `courses/${courseId}/modules/${moduleId}/${type}s/${safeFileName}`);

    // Upload the file with progress tracking
    const uploadTask = uploadBytesResumable(storageRef, file);

    return new Promise<ContentItem>((resolve, reject) => {
      uploadTask.on('state_changed',
        (snapshot) => {
          // Progress tracking
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          onProgress?.(file.name, progress);
        },
        (error) => {
          // Handle upload errors
          console.error(`Error uploading ${type}:`, error);
          onComplete?.(file.name, false, error.message);
          reject(error);
        },
        async () => {
          try {
            // Upload completed successfully
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            console.log(`Successfully uploaded ${type}, URL:`, downloadURL);

            // Generate content item
            const contentId = `${type}-${safeId}-${timestamp}`;

            // Get module data to determine order
            const moduleRef = doc(db, 'modules', moduleId).withConverter(moduleConverter);
            const moduleSnap = await getDoc(moduleRef);

            if (!moduleSnap.exists()) {
              throw new Error('Module not found');
            }

            const moduleData = moduleSnap.data();
            const contentTypeKey = `${type}s` as 'videos' | 'notes' | 'pdfs' | 'images' | 'audios' | 'links';
            const currentCount = Array.isArray(moduleData.content?.[contentTypeKey]) ?
              moduleData.content[contentTypeKey].length : 0;

            const contentItem: ContentItem = {
              id: contentId,
              title,
              description: description || '',
              url: downloadURL,
              type,
              order: currentCount, // Set order to end of current list
              isPublished: true, // Default to published
              isOneTimeView: isOneTimeView ?? false,
              createdAt: new Date()
            };

            // Save the content item to the module (same as uploadContent function)
            console.log(`Saving content item to module ${moduleId}:`, contentItem);

            // Make sure we have a proper content structure
            const content = {
              videos: Array.isArray(moduleData.content?.videos) ? moduleData.content.videos : [],
              notes: Array.isArray(moduleData.content?.notes) ? moduleData.content.notes : [],
              pdfs: Array.isArray(moduleData.content?.pdfs) ? moduleData.content.pdfs : [],
              images: Array.isArray(moduleData.content?.images) ? moduleData.content.images : [],
              audios: Array.isArray(moduleData.content?.audios) ? moduleData.content.audios : [],
              links: Array.isArray(moduleData.content?.links) ? moduleData.content.links : []
            };

            // Add the new content item to the appropriate array
            content[contentTypeKey] = [...content[contentTypeKey], contentItem];

            // Convert any non-serializable objects in the content item
            // Only include fields that are not undefined to avoid Firestore errors
            // Helper: normalize a single ContentItem for Firestore (preserves all fields)
            const normalizeItem = (item: ContentItem, index: number): any => {
              const normalized: any = {
                id: item.id,
                title: item.title,
                description: item.description || '',
                type: item.type,
                order: item.order ?? index,
                isPublished: item.isPublished ?? true,
                isOneTimeView: item.isOneTimeView ?? false,
                createdAt: item.createdAt instanceof Date ? Timestamp.fromDate(item.createdAt) : item.createdAt
              };
              if (item.url !== undefined) normalized.url = item.url;
              if (item.text !== undefined) normalized.text = item.text;
              return normalized;
            };

            const normalizedContent = {
              videos: content.videos.map(normalizeItem),
              notes: content.notes.map(normalizeItem),
              pdfs: content.pdfs.map(normalizeItem),
              images: content.images.map(normalizeItem),
              audios: content.audios.map(normalizeItem),
              links: content.links.map(normalizeItem)
            };

            // Update the module document
            const moduleDocRef = doc(db, 'modules', moduleId);
            console.log(`Updating module ${moduleId} with normalized content:`, normalizedContent);

            await updateDoc(moduleDocRef, {
              content: normalizedContent,
              updatedAt: Timestamp.fromDate(new Date())
            });

            console.log(`✅ Successfully saved ${type} to module ${moduleId}`);

            onComplete?.(file.name, true);
            resolve(contentItem);
          } catch (error) {
            console.error(`Error in upload completion:`, error);
            onComplete?.(file.name, false, (error as Error).message);
            reject(error);
          }
        }
      );
    });
  } catch (error) {
    console.error(`Error in uploadContentWithProgress:`, error);
    onComplete?.(file.name, false, (error as Error).message);
    throw error;
  }
};

// Upload multiple content items with progress tracking
export const uploadMultipleContentWithProgress = async (
  courseId: string,
  moduleId: string,
  files: Array<{ file: File; type: 'video' | 'note' | 'pdf' | 'image' | 'audio'; title: string; description?: string }>,
  onProgress?: UploadProgressCallback,
  onComplete?: UploadCompletionCallback
): Promise<{ success: ContentItem[]; failed: Array<{ file: File; error: string }> }> => {
  console.log(`🚀 Starting parallel upload of ${files.length} files...`);

  const results = await Promise.allSettled(
    files.map(async ({ file, type, title, description }) => {
      try {
        const contentItem = await uploadContentWithProgress(
          courseId,
          moduleId,
          file,
          type,
          title,
          description,
          onProgress,
          onComplete
        );
        return { success: contentItem, file };
      } catch (error) {
        return {
          failed: {
            file,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        };
      }
    })
  );

  const success: ContentItem[] = [];
  const failed: Array<{ file: File; error: string }> = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if ('success' in result.value && result.value.success) {
        success.push(result.value.success);
      } else if ('failed' in result.value && result.value.failed) {
        failed.push(result.value.failed);
      }
    } else {
      failed.push({
        file: files[index].file,
        error: result.reason?.message || 'Upload failed'
      });
    }
  });

  console.log(`📊 Upload results: ${success.length} successful, ${failed.length} failed`);
  return { success, failed };
};

// Batch update module content
export const batchUpdateModuleContent = async (
  moduleId: string,
  contentItems: ContentItem[]
): Promise<void> => {
  try {
    console.log(`💾 Batch updating module ${moduleId} with ${contentItems.length} content items`);

    // Get current module data
    const moduleRef = doc(db, 'modules', moduleId);
    const moduleSnap = await getDoc(moduleRef);

    if (!moduleSnap.exists()) {
      throw new Error('Module not found');
    }

    const moduleData = moduleSnap.data();

    // Initialize content structure
    const content = {
      videos: Array.isArray(moduleData.content?.videos) ? [...moduleData.content.videos] : [],
      notes: Array.isArray(moduleData.content?.notes) ? [...moduleData.content.notes] : [],
      pdfs: Array.isArray(moduleData.content?.pdfs) ? [...moduleData.content.pdfs] : [],
      images: Array.isArray(moduleData.content?.images) ? [...moduleData.content.images] : [],
      audios: Array.isArray(moduleData.content?.audios) ? [...moduleData.content.audios] : [],
      links: Array.isArray(moduleData.content?.links) ? [...moduleData.content.links] : []
    };

    // Add new content items to appropriate arrays
    contentItems.forEach(item => {
      const contentTypeKey = `${item.type}s` as 'videos' | 'notes' | 'pdfs' | 'images' | 'audios' | 'links';
      content[contentTypeKey].push({
        id: item.id,
        title: item.title,
        description: item.description || '',
        url: item.url,
        type: item.type,
        createdAt: Timestamp.fromDate(item.createdAt)
      });
    });

    // Update the module with all new content at once
    await updateDoc(moduleRef, {
      content: content,
      updatedAt: Timestamp.fromDate(new Date())
    });

    console.log(`✅ Successfully batch updated module ${moduleId}`);
  } catch (error) {
    console.error('Error in batch update:', error);
    throw error;
  }
};

// Update content order for drag-and-drop functionality
export const updateContentOrder = async (
  moduleId: string,
  contentType: 'videos' | 'notes' | 'pdfs' | 'images' | 'audios' | 'links',
  reorderedItems: ContentItem[]
): Promise<void> => {
  try {
    console.log(`🔄 updateContentOrder: Starting update for ${contentType} in module ${moduleId}`);
    console.log(`📋 Received ${reorderedItems.length} items to reorder:`, reorderedItems.map((item, index) => ({
      id: item.id,
      title: item.title,
      order: item.order,
      newPosition: index
    })));

    // Get current module data
    const moduleRef = doc(db, 'modules', moduleId);
    const moduleSnap = await getDoc(moduleRef);

    if (!moduleSnap.exists()) {
      throw new Error('Module not found');
    }

    const moduleData = moduleSnap.data();
    console.log(`📖 Current module data for ${contentType}:`, moduleData.content?.[contentType]?.map((item: any) => ({ id: item.id, title: item.title, order: item.order })));

    // Initialize content structure with current data
    const content = {
      videos: Array.isArray(moduleData.content?.videos) ? [...moduleData.content.videos] : [],
      notes: Array.isArray(moduleData.content?.notes) ? [...moduleData.content.notes] : [],
      pdfs: Array.isArray(moduleData.content?.pdfs) ? [...moduleData.content.pdfs] : [],
      images: Array.isArray(moduleData.content?.images) ? [...moduleData.content.images] : [],
      audios: Array.isArray(moduleData.content?.audios) ? [...moduleData.content.audios] : [],
      links: Array.isArray(moduleData.content?.links) ? [...moduleData.content.links] : []
    };

    // Update the specific content type with new order and order numbers
    content[contentType] = reorderedItems.map((item, index) => {
      const updatedItem: any = {
        id: item.id,
        title: item.title,
        description: item.description || '',
        type: item.type,
        order: index, // Set order based on position in array
        createdAt: item.createdAt instanceof Date ? Timestamp.fromDate(item.createdAt) : item.createdAt
      };

      // Conditionally add url and text fields if they exist
      if (item.url) {
        updatedItem.url = item.url;
      }
      if (item.text) {
        updatedItem.text = item.text;
      }

      // Preserve per-item flags so reorder does not reset Draft/Published or One-Time/Multi-View state
      if (typeof item.isPublished === 'boolean') {
        updatedItem.isPublished = item.isPublished;
      }
      if (typeof item.isOneTimeView === 'boolean') {
        updatedItem.isOneTimeView = item.isOneTimeView;
      }

      console.log(`📝 Content item ${index} (${item.title}):`, updatedItem);
      return updatedItem;
    });

    console.log(`💾 Final ${contentType} content before database update:`, content[contentType].map((item: any) => ({ id: item.id, title: item.title, order: item.order })));

    // Update the module document
    await updateDoc(moduleRef, {
      content: content,
      updatedAt: Timestamp.fromDate(new Date())
    });

    console.log(`✅ Successfully updated ${contentType} order for module ${moduleId}`);

    // Verify the update was successful by reading it back
    const updatedModuleSnap = await getDoc(moduleRef);
    if (updatedModuleSnap.exists()) {
      const updatedData = updatedModuleSnap.data();
      console.log(`🔍 Verification - Updated ${contentType} in database:`, updatedData.content?.[contentType]?.map((item: any) => ({ id: item.id, title: item.title, order: item.order })));
    }
  } catch (error) {
    console.error('Error updating content order:', error);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// One-Time View reset
// ---------------------------------------------------------------------------

/**
 * Deletes all `user_content_views` documents whose `contentId` matches the
 * given value.  This is called when an admin disables one-time view for a
 * content item so that re-enabling it later gives every student a fresh view.
 *
 * Uses a batched write (max 500 docs per batch) to stay within Firestore
 * limits.  The Firestore security rules already allow admin delete on this
 * collection.
 */
export const clearOneTimeViewRecords = async (contentId: string): Promise<number> => {
  try {
    console.log(`🗑️ Clearing one-time view records for contentId: ${contentId}`);

    const viewsRef = collection(db, 'user_content_views');
    const q = query(viewsRef, where('contentId', '==', contentId));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      console.log(`ℹ️ No one-time view records found for contentId: ${contentId}`);
      return 0;
    }

    // Firestore batch limit is 500; process in chunks if needed
    const BATCH_SIZE = 500;
    const docs = snapshot.docs;
    let deletedCount = 0;

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      const chunk = docs.slice(i, i + BATCH_SIZE);
      chunk.forEach((docSnap) => batch.delete(docSnap.ref));
      await batch.commit();
      deletedCount += chunk.length;
    }

    console.log(`✅ Cleared ${deletedCount} one-time view record(s) for contentId: ${contentId}`);
    return deletedCount;
  } catch (error) {
    console.error(`❌ Error clearing one-time view records for ${contentId}:`, error);
    // Don't throw — this is a best-effort cleanup; the toggle itself should still succeed.
    return 0;
  }
}; 