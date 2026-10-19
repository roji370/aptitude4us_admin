// Seed script for content views
const { initializeApp } = require('firebase/app');
const { 
  getFirestore, 
  collection, 
  addDoc, 
  Timestamp 
} = require('firebase/firestore');
require('dotenv').config();

// Firebase config
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Sample data
const sampleUsers = [
  'user1',
  'user2',
  'user3',
  'user4',
  'user5'
];

const sampleCourses = [
  'course1',
  'course2',
  'course3'
];

const sampleModules = [
  'module1',
  'module2',
  'module3',
  'module4',
  'module5'
];

const contentTypes = ['video', 'note', 'pdf', 'module'];

// Generate random content views
const generateRandomContentViews = (count) => {
  const contentViews = [];
  
  for (let i = 0; i < count; i++) {
    const userId = sampleUsers[Math.floor(Math.random() * sampleUsers.length)];
    const courseId = sampleCourses[Math.floor(Math.random() * sampleCourses.length)];
    const moduleId = sampleModules[Math.floor(Math.random() * sampleModules.length)];
    const contentType = contentTypes[Math.floor(Math.random() * contentTypes.length)];
    const contentId = `content-${Math.floor(Math.random() * 100)}`;
    
    // Random date within the last 30 days
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(Math.random() * 30));
    
    contentViews.push({
      userId,
      contentId,
      contentType,
      courseId,
      moduleId,
      timestamp: Timestamp.fromDate(date),
      duration: contentType === 'video' ? Math.floor(Math.random() * 600) : undefined,
      progress: contentType === 'video' ? Math.floor(Math.random() * 100) : undefined,
      deviceInfo: {
        platform: ['web', 'android', 'ios'][Math.floor(Math.random() * 3)],
        browser: ['chrome', 'firefox', 'safari'][Math.floor(Math.random() * 3)],
        deviceType: ['desktop', 'mobile', 'tablet'][Math.floor(Math.random() * 3)]
      }
    });
  }
  
  return contentViews;
};

// Seed the database
const seedContentViews = async () => {
  try {
    console.log('Generating content views...');
    const contentViews = generateRandomContentViews(100);
    
    console.log('Seeding content views to Firestore...');
    const contentViewsRef = collection(db, 'contentViews');
    
    for (const view of contentViews) {
      await addDoc(contentViewsRef, view);
    }
    
    console.log('Successfully seeded 100 content views!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding content views:', error);
    process.exit(1);
  }
};

// Run the seeding
seedContentViews();