import {
    collection,
    query,
    where,
    getDocs,
    getDoc,
    doc,
    Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { StudentAccount, StudentWithCourses, ProfileStatus } from '../types/student';

/**
 * Fetch all students from Firestore
 */
export const fetchAllStudents = async (): Promise<StudentAccount[]> => {
    try {
        // Query without orderBy to avoid requiring a composite index
        const q = query(
            collection(db, 'users'),
            where('role', '==', 'student')
        );

        const snapshot = await getDocs(q);

        const students = snapshot.docs.map(doc => {
            const data = doc.data();

            // Debug: Log all fields for first student to help identify field names
            if (snapshot.docs.indexOf(doc) === 0) {
                console.log('Sample student data fields:', Object.keys(data));
                console.log('Sample student data:', data);
            }

            // Helper function to get date from multiple possible field names
            const getDateField = (field1: string, field2?: string) => {
                const value = data[field1] || (field2 ? data[field2] : undefined);
                if (!value) return undefined;
                return value instanceof Timestamp ? value.toDate() : value;
            };

            return {
                uid: doc.id,
                displayName: data.displayName || data.display_name || '',
                email: data.email || '',
                role: 'student',
                assignedCourseIds: data.assignedCourseIds || data.assigned_course_ids || [],
                profileCompleted: data.profileCompleted || data.profile_completed || false,
                photoUrl: data.photoUrl || data.photo_url || data.profilePhotoUrl || '',
                dateOfJoining: getDateField('dateOfJoining', 'date_of_joining'),
                examDate: getDateField('examDate', 'exam_date'),
                mobile: data.mobile || data.phone || data.phoneNumber || '',
                subscriptionPeriod: data.subscriptionPeriod || data.subscription_period || undefined,
                createdAt: getDateField('createdAt', 'created_at'),
                updatedAt: getDateField('updatedAt', 'updated_at'),
                lastLogin: getDateField('lastLogin', 'last_login'),
            } as StudentAccount;
        });

        // Sort by displayName in memory (avoids needing Firestore index)
        return students.sort((a, b) => a.displayName.localeCompare(b.displayName));
    } catch (error) {
        console.error('Error fetching students:', error);
        throw error;
    }
};

/**
 * Fetch single student with course details
 */
export const fetchStudentDetails = async (userId: string): Promise<StudentWithCourses> => {
    try {
        const userDocRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userDocRef);

        if (!userDoc.exists()) {
            throw new Error('Student not found');
        }

        const userData = userDoc.data();
        const courseIds = userData.assignedCourseIds || userData.assigned_course_ids || [];

        // Helper function to get date from multiple possible field names
        const getDateField = (field1: string, field2?: string) => {
            const value = userData[field1] || (field2 ? userData[field2] : undefined);
            if (!value) return undefined;
            return value instanceof Timestamp ? value.toDate() : value;
        };

        // Fetch course details
        const courses = await Promise.all(
            courseIds.map(async (courseId: string) => {
                const courseDocRef = doc(db, 'courses', courseId);
                const courseDoc = await getDoc(courseDocRef);
                if (courseDoc.exists()) {
                    const courseData = courseDoc.data();
                    return {
                        id: courseDoc.id,
                        title: courseData.title || '',
                        category: courseData.category || '',
                    };
                }
                return null;
            })
        );

        return {
            uid: userDoc.id,
            displayName: userData.displayName || userData.display_name || '',
            email: userData.email || '',
            role: 'student',
            assignedCourseIds: courseIds,
            profileCompleted: userData.profileCompleted || userData.profile_completed || false,
            photoUrl: userData.photoUrl || userData.photo_url || userData.profilePhotoUrl || '',
            dateOfJoining: getDateField('dateOfJoining', 'date_of_joining'),
            examDate: getDateField('examDate', 'exam_date'),
            mobile: userData.mobile || userData.phone || userData.phoneNumber || '',
            subscriptionPeriod: userData.subscriptionPeriod || userData.subscription_period || undefined,
            createdAt: getDateField('createdAt', 'created_at'),
            updatedAt: getDateField('updatedAt', 'updated_at'),
            lastLogin: getDateField('lastLogin', 'last_login'),
            courses: courses.filter(c => c !== null) as Array<{
                id: string;
                title: string;
                category?: string;
            }>,
        };
    } catch (error) {
        console.error('Error fetching student details:', error);
        throw error;
    }
};

/**
 * Get profile completion status
 */
export const getProfileStatus = (student: StudentAccount): ProfileStatus => {
    if (!student.profileCompleted) {
        // Check if any profile fields are filled
        const hasProfileData = !!(
            student.photoUrl ||
            student.dateOfJoining ||
            student.examDate ||
            student.mobile ||
            student.subscriptionPeriod
        );

        return hasProfileData ? 'incomplete' : 'not-started';
    }
    return 'complete';
};

/**
 * Format date for display
 */
export const formatDate = (date: Date | Timestamp | undefined): string => {
    if (!date) return 'Not set';

    try {
        let dateObj: Date;

        if (date instanceof Timestamp) {
            dateObj = date.toDate();
        } else if (date instanceof Date) {
            dateObj = date;
        } else {
            return 'Not set';
        }

        // Validate the date
        if (!dateObj || !(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
            return 'Not set';
        }

        return dateObj.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    } catch (error) {
        console.error('Error formatting date:', error);
        return 'Not set';
    }
};

/**
 * Format date with relative time
 */
export const formatDateRelative = (date: Date | Timestamp | undefined): string => {
    if (!date) return 'Not set';

    try {
        let dateObj: Date;

        if (date instanceof Timestamp) {
            dateObj = date.toDate();
        } else if (date instanceof Date) {
            dateObj = date;
        } else {
            return 'Not set';
        }

        // Validate the date
        if (!dateObj || !(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
            return 'Not set';
        }

        const now = new Date();
        const diffMs = now.getTime() - dateObj.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays < 30) {
            if (diffDays === 0) return 'Today';
            if (diffDays === 1) return 'Yesterday';
            return `${diffDays} days ago`;
        } else if (diffDays < 60) {
            return '1 month ago';
        } else if (diffDays < 365) {
            return `${Math.floor(diffDays / 30)} months ago`;
        }

        return formatDate(date);
    } catch (error) {
        console.error('Error formatting relative date:', error);
        return 'Not set';
    }
};

/**
 * Get days remaining until exam
 */
export const getDaysUntilExam = (examDate: Date | Timestamp | undefined): number | null => {
    if (!examDate) return null;

    try {
        let dateObj: Date;

        if (examDate instanceof Timestamp) {
            dateObj = examDate.toDate();
        } else if (examDate instanceof Date) {
            dateObj = examDate;
        } else {
            // If it's neither, return null
            return null;
        }

        // Additional validation to ensure we have a valid date
        if (!dateObj || !(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
            return null;
        }

        const now = new Date();
        const diffMs = dateObj.getTime() - now.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        return diffDays;
    } catch (error) {
        console.error('Error calculating days until exam:', error);
        return null;
    }
};

/**
 * Get profile photo URL or placeholder
 */
export const getProfilePhoto = (photoUrl: string | undefined): string => {
    if (photoUrl && photoUrl.trim() !== '') {
        return photoUrl;
    }
    return '/vite.svg'; // Placeholder - update with actual default avatar
};

/**
 * Get subscription period color
 */
export const getSubscriptionColor = (
    period: string | undefined
): 'warning' | 'info' | 'success' | 'default' => {
    if (!period) return 'default';

    if (period === '1 Month' || period === '3 Months') {
        return 'warning';
    } else if (period === '6 Months') {
        return 'info';
    } else if (period === '1 Year' || period === '2 Years') {
        return 'success';
    }

    return 'default';
};

