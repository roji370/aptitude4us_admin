import { Timestamp } from 'firebase/firestore';

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  planName: string;
  startDate: Date | Timestamp;
  endDate: Date | Timestamp;
  examDate?: Date | Timestamp | null;
  /**
   * Denormalized effective end of access. Equals examDate (end-of-day)
   * when an exam date is set and falls before endDate; otherwise equals endDate.
   * This is the authoritative field for access checks, cron expiry, and
   * pre-expiry notifications. Always written by subscriptionService when
   * endDate or examDate changes.
   */
  effectiveEndDate?: Date | Timestamp;
  status: 'active' | 'expired' | 'cancelled';
  notificationsSent: {
    studentPreExpiry: boolean;
    adminPreExpiry: boolean;
  };
  price: number;
  createdAt: Date | Timestamp;
  updatedAt: Date | Timestamp;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  durationMonths: number | null;
  durationInDays: number | null;
  price: number;
  isActive: boolean;
  features: string[];
}

export interface SubscriptionNotification {
  id: string;
  userId: string;
  subscriptionId: string;
  title: string;
  message: string;
  type: 'subscription_expiry' | 'payment_reminder' | 'subscription_created';
  read: boolean;
  createdAt: Date | Timestamp;
  targetApp: 'admin' | 'student' | 'both';
} 