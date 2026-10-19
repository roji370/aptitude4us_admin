const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Get environment variables
const {
  VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID
} = process.env;

// Create the config content
const configContent = `// This file is auto-generated - DO NOT EDIT
const firebaseConfig = {
  apiKey: "${VITE_FIREBASE_API_KEY}",
  authDomain: "${VITE_FIREBASE_AUTH_DOMAIN}",
  projectId: "${VITE_FIREBASE_PROJECT_ID}",
  storageBucket: "${VITE_FIREBASE_STORAGE_BUCKET}",
  messagingSenderId: "${VITE_FIREBASE_MESSAGING_SENDER_ID}",
  appId: "${VITE_FIREBASE_APP_ID}"
};
`;

// Write to public directory
const outputPath = path.resolve(__dirname, '../public/firebase-config.js');
fs.writeFileSync(outputPath, configContent);

console.log('Firebase config file generated at', outputPath); 