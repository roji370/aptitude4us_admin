// Error handling utilities for notification system

export interface NotificationError {
  code: string;
  message: string;
  details?: any;
  timestamp: Date;
  retryable: boolean;
}

export class NotificationSystemError extends Error {
  public code: string;
  public details?: any;
  public retryable: boolean;
  public timestamp: Date;

  constructor(code: string, message: string, details?: any, retryable = false) {
    super(message);
    this.name = 'NotificationSystemError';
    this.code = code;
    this.details = details;
    this.retryable = retryable;
    this.timestamp = new Date();
  }
}

// Error codes for notification system
export const NOTIFICATION_ERROR_CODES = {
  // Authentication errors
  UNAUTHORIZED: 'NOTIFICATION_UNAUTHORIZED',
  PERMISSION_DENIED: 'NOTIFICATION_PERMISSION_DENIED',
  
  // Data validation errors
  INVALID_COURSE_ID: 'NOTIFICATION_INVALID_COURSE_ID',
  INVALID_USER_ID: 'NOTIFICATION_INVALID_USER_ID',
  INVALID_ADMIN_ID: 'NOTIFICATION_INVALID_ADMIN_ID',
  MISSING_REQUIRED_DATA: 'NOTIFICATION_MISSING_REQUIRED_DATA',
  
  // Firebase/Network errors
  FIREBASE_ERROR: 'NOTIFICATION_FIREBASE_ERROR',
  NETWORK_ERROR: 'NOTIFICATION_NETWORK_ERROR',
  FUNCTION_TIMEOUT: 'NOTIFICATION_FUNCTION_TIMEOUT',
  
  // FCM/Push notification errors
  FCM_TOKEN_INVALID: 'NOTIFICATION_FCM_TOKEN_INVALID',
  FCM_SEND_FAILED: 'NOTIFICATION_FCM_SEND_FAILED',
  NO_DEVICES_REGISTERED: 'NOTIFICATION_NO_DEVICES_REGISTERED',
  
  // Quota/Rate limiting
  RATE_LIMITED: 'NOTIFICATION_RATE_LIMITED',
  QUOTA_EXCEEDED: 'NOTIFICATION_QUOTA_EXCEEDED',
  
  // Internal errors
  UNKNOWN_ERROR: 'NOTIFICATION_UNKNOWN_ERROR',
  SYSTEM_UNAVAILABLE: 'NOTIFICATION_SYSTEM_UNAVAILABLE'
} as const;

// Map Firebase error codes to our error codes
const FIREBASE_ERROR_MAP: Record<string, { code: string; retryable: boolean }> = {
  'permission-denied': { 
    code: NOTIFICATION_ERROR_CODES.PERMISSION_DENIED, 
    retryable: false 
  },
  'unauthenticated': { 
    code: NOTIFICATION_ERROR_CODES.UNAUTHORIZED, 
    retryable: false 
  },
  'not-found': { 
    code: NOTIFICATION_ERROR_CODES.INVALID_COURSE_ID, 
    retryable: false 
  },
  'invalid-argument': { 
    code: NOTIFICATION_ERROR_CODES.MISSING_REQUIRED_DATA, 
    retryable: false 
  },
  'deadline-exceeded': { 
    code: NOTIFICATION_ERROR_CODES.FUNCTION_TIMEOUT, 
    retryable: true 
  },
  'unavailable': { 
    code: NOTIFICATION_ERROR_CODES.SYSTEM_UNAVAILABLE, 
    retryable: true 
  },
  'resource-exhausted': { 
    code: NOTIFICATION_ERROR_CODES.QUOTA_EXCEEDED, 
    retryable: true 
  },
  'aborted': { 
    code: NOTIFICATION_ERROR_CODES.RATE_LIMITED, 
    retryable: true 
  }
};

// Parse and standardize errors from different sources
export const parseNotificationError = (error: any): NotificationError => {
  const timestamp = new Date();
  
  // Handle our custom NotificationSystemError
  if (error instanceof NotificationSystemError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      timestamp: error.timestamp,
      retryable: error.retryable
    };
  }
  
  // Handle Firebase errors
  if (error?.code && typeof error.code === 'string') {
    const firebaseMapping = FIREBASE_ERROR_MAP[error.code];
    if (firebaseMapping) {
      return {
        code: firebaseMapping.code,
        message: error.message || `Firebase error: ${error.code}`,
        details: { originalCode: error.code, ...error.details },
        timestamp,
        retryable: firebaseMapping.retryable
      };
    }
  }
  
  // Handle network errors
  if (error?.name === 'NetworkError' || error?.message?.includes('network')) {
    return {
      code: NOTIFICATION_ERROR_CODES.NETWORK_ERROR,
      message: 'Network error occurred while sending notification',
      details: { originalError: error.message },
      timestamp,
      retryable: true
    };
  }
  
  // Handle timeout errors
  if (error?.name === 'TimeoutError' || error?.message?.includes('timeout')) {
    return {
      code: NOTIFICATION_ERROR_CODES.FUNCTION_TIMEOUT,
      message: 'Notification request timed out',
      details: { originalError: error.message },
      timestamp,
      retryable: true
    };
  }
  
  // Default to unknown error
  return {
    code: NOTIFICATION_ERROR_CODES.UNKNOWN_ERROR,
    message: error?.message || 'An unknown error occurred',
    details: { 
      originalError: error,
      errorType: typeof error,
      errorName: error?.name
    },
    timestamp,
    retryable: false
  };
};

// Create user-friendly error messages
export const getUserFriendlyErrorMessage = (error: NotificationError): string => {
  switch (error.code) {
    case NOTIFICATION_ERROR_CODES.UNAUTHORIZED:
      return 'You are not authorized to send notifications. Please log in again.';
    
    case NOTIFICATION_ERROR_CODES.PERMISSION_DENIED:
      return 'You do not have permission to send notifications to these users.';
    
    case NOTIFICATION_ERROR_CODES.INVALID_COURSE_ID:
      return 'The specified course was not found.';
    
    case NOTIFICATION_ERROR_CODES.INVALID_USER_ID:
      return 'One or more user IDs are invalid.';
    
    case NOTIFICATION_ERROR_CODES.MISSING_REQUIRED_DATA:
      return 'Required information is missing. Please check your input and try again.';
    
    case NOTIFICATION_ERROR_CODES.FIREBASE_ERROR:
      return 'A server error occurred. Please try again later.';
    
    case NOTIFICATION_ERROR_CODES.NETWORK_ERROR:
      return 'Network connection error. Please check your internet connection and try again.';
    
    case NOTIFICATION_ERROR_CODES.FUNCTION_TIMEOUT:
      return 'The notification request timed out. Please try again.';
    
    case NOTIFICATION_ERROR_CODES.FCM_TOKEN_INVALID:
      return 'Some user devices could not be reached. Notifications were sent to available devices.';
    
    case NOTIFICATION_ERROR_CODES.FCM_SEND_FAILED:
      return 'Failed to send push notifications, but in-app notifications were saved.';
    
    case NOTIFICATION_ERROR_CODES.NO_DEVICES_REGISTERED:
      return 'No devices are registered for these users. Notifications will be delivered when they next open the app.';
    
    case NOTIFICATION_ERROR_CODES.RATE_LIMITED:
      return 'Too many notification requests. Please wait a moment and try again.';
    
    case NOTIFICATION_ERROR_CODES.QUOTA_EXCEEDED:
      return 'Notification quota exceeded. Please try again later.';
    
    case NOTIFICATION_ERROR_CODES.SYSTEM_UNAVAILABLE:
      return 'Notification system is temporarily unavailable. Please try again later.';
    
    default:
      return 'An unexpected error occurred while sending notifications. Please try again.';
  }
};

// Log errors with appropriate level based on severity
export const logNotificationError = (error: NotificationError, context?: any) => {
  const logData = {
    code: error.code,
    message: error.message,
    timestamp: error.timestamp,
    retryable: error.retryable,
    context,
    details: error.details
  };
  
  // Determine log level based on error type
  if (error.retryable) {
    console.warn('[Notification Warning]', logData);
  } else if (error.code === NOTIFICATION_ERROR_CODES.UNAUTHORIZED || 
             error.code === NOTIFICATION_ERROR_CODES.PERMISSION_DENIED) {
    console.error('[Notification Security Error]', logData);
  } else {
    console.error('[Notification Error]', logData);
  }
};

// Retry logic for retryable errors
export const shouldRetry = (error: NotificationError, attemptCount: number, maxRetries = 3): boolean => {
  return error.retryable && attemptCount < maxRetries;
};

// Calculate backoff delay for retries
export const getRetryDelay = (attemptCount: number): number => {
  // Exponential backoff: 1s, 2s, 4s, 8s...
  return Math.min(1000 * Math.pow(2, attemptCount), 10000);
};

// Validate notification input data
export const validateNotificationInput = (
  courseId: string,
  userIds: string[]
): void => {
  if (!courseId || typeof courseId !== 'string' || courseId.trim() === '') {
    throw new NotificationSystemError(
      NOTIFICATION_ERROR_CODES.INVALID_COURSE_ID,
      'Course ID is required and must be a non-empty string'
    );
  }
  
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new NotificationSystemError(
      NOTIFICATION_ERROR_CODES.INVALID_USER_ID,
      'User IDs must be provided as a non-empty array'
    );
  }
  
  // Validate each user ID
  for (const userId of userIds) {
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      throw new NotificationSystemError(
        NOTIFICATION_ERROR_CODES.INVALID_USER_ID,
        `Invalid user ID: ${userId}`
      );
    }
  }
};

// Validate consolidated notification input data (multiple courses)
export const validateConsolidatedNotificationInput = (
  courseIds: string[],
  userIds: string[],
  adminId: string
): void => {
  if (!Array.isArray(courseIds) || courseIds.length === 0) {
    throw new NotificationSystemError(
      NOTIFICATION_ERROR_CODES.INVALID_COURSE_ID,
      'Course IDs must be provided as a non-empty array'
    );
  }
  
  // Validate each course ID
  for (const courseId of courseIds) {
    if (!courseId || typeof courseId !== 'string' || courseId.trim() === '') {
      throw new NotificationSystemError(
        NOTIFICATION_ERROR_CODES.INVALID_COURSE_ID,
        'All course IDs must be non-empty strings'
      );
    }
  }
  
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new NotificationSystemError(
      NOTIFICATION_ERROR_CODES.INVALID_USER_ID,
      'User IDs must be provided as a non-empty array'
    );
  }
  
  // Validate each user ID
  for (const userId of userIds) {
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      throw new NotificationSystemError(
        NOTIFICATION_ERROR_CODES.INVALID_USER_ID,
        'All user IDs must be non-empty strings'
      );
    }
  }
  
  if (!adminId || typeof adminId !== 'string' || adminId.trim() === '') {
    throw new NotificationSystemError(
      NOTIFICATION_ERROR_CODES.INVALID_ADMIN_ID,
      'Admin ID is required and must be a non-empty string'
    );
  }
};
