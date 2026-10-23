// One-off script to fix admin user's custom claims
// Run: node scripts/fix-admin-claims.js
const admin = require('firebase-admin');

// Initialize with default credentials (uses GOOGLE_APPLICATION_CREDENTIALS or gcloud auth)
const app = admin.initializeApp({
  projectId: 'apt4us-afb04'
});

async function fixAdminClaims() {
  try {
    // List all users and find admins from Firestore
    const db = admin.firestore();
    const adminsSnapshot = await db.collection('users').where('role', '==', 'admin').get();
    
    if (adminsSnapshot.empty) {
      console.log('No admin users found in Firestore!');
      process.exit(1);
    }

    console.log(`Found ${adminsSnapshot.size} admin user(s) in Firestore\n`);

    for (const doc of adminsSnapshot.docs) {
      const userId = doc.id;
      const userData = doc.data();
      
      console.log(`Processing admin: ${userData.email || userData.displayName} (${userId})`);
      
      // Get current auth user and their claims
      const userRecord = await admin.auth().getUser(userId);
      const currentClaims = userRecord.customClaims || {};
      
      console.log(`  Current claims: ${JSON.stringify(currentClaims)}`);
      
      // Merge role: admin into existing claims
      const mergedClaims = {
        ...currentClaims,
        role: 'admin'
      };
      
      // Also add assignedCourseIds from Firestore if not in claims
      if (userData.assignedCourseIds && !currentClaims.assignedCourseIds) {
        mergedClaims.assignedCourseIds = userData.assignedCourseIds;
      }
      
      console.log(`  Setting claims: ${JSON.stringify(mergedClaims)}`);
      
      await admin.auth().setCustomUserClaims(userId, mergedClaims);
      console.log(`  ✅ Claims updated for ${userData.email}\n`);
    }

    console.log('Done! Admin users must log out and log back in for changes to take effect.');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

fixAdminClaims();
