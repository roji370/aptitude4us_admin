import { Timestamp } from 'firebase/firestore';

export interface StudentAccount {
    uid: string;
    displayName: string;
    email: string;
    role: 'student';
    assignedCourseIds: string[];
    profileCompleted?: boolean;
    photoUrl?: string;
    dateOfJoining?: Date | Timestamp;
    examDate?: Date | Timestamp;
    mobile?: string;
    subscriptionPeriod?: '1 Month' | '3 Months' | '6 Months' | '1 Year' | '2 Years';
    createdAt?: Date;
    updatedAt?: Date;
    lastLogin?: Date;
}

export interface StudentWithCourses extends StudentAccount {
    courses?: Array<{
        id: string;
        title: string;
        category?: string;
    }>;
}

export type ProfileStatus = 'complete' | 'incomplete' | 'not-started';

export interface StudentFilters {
    searchQuery: string;
    profileStatus: ProfileStatus | 'all';
    subscriptionPeriod: string;
    assignedCourse: string;
}

export type SortOption =
    | 'name-asc'
    | 'name-desc'
    | 'joined-newest'
    | 'joined-oldest'
    | 'exam-upcoming';

