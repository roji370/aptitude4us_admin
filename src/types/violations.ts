import { Timestamp } from 'firebase/firestore';

export interface ScreenshotViolation {
  id?: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  violations: {
    count: number;
    isBlocked: boolean;
    firstWarning?: Date | Timestamp;
    blockedAt?: Date | Timestamp;
    lastReset?: Date | Timestamp;
    resetHistory: ViolationReset[];
  };
  createdAt: Date | Timestamp;
  updatedAt: Date | Timestamp;
}

export interface ViolationReset {
  resetAt: Date | Timestamp;
  resetBy: string; // Admin user ID
  resetByEmail?: string; // Admin email for display
  reason: ViolationResetReason;
  notes?: string;
}

export type ViolationResetReason = 
  | 'false_positive'
  | 'support_request'
  | 'technical_issue'
  | 'admin_discretion'
  | 'other';

export interface ViolationResetRequest {
  reason: ViolationResetReason;
  notes?: string;
}

export type ViolationStatus = 'NONE' | 'WARNING' | 'BLOCKED';

export interface ViolationSummary {
  userId: string;
  userEmail: string;
  userName?: string;
  count: number;
  status: ViolationStatus;
  firstWarning?: Date;
  blockedAt?: Date;
  lastReset?: Date;
}

export const VIOLATION_RESET_REASONS: { value: ViolationResetReason; label: string }[] = [
  { value: 'false_positive', label: 'False Positive' },
  { value: 'support_request', label: 'Support Request' },
  { value: 'technical_issue', label: 'Technical Issue' },
  { value: 'admin_discretion', label: 'Admin Discretion' },
  { value: 'other', label: 'Other' },
];
