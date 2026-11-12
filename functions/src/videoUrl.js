const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { Storage } = require('@google-cloud/storage');

const storage = new Storage();

/**
 * Callable Cloud Function: getVideoUrl
 *
 * Verifies authentication, course assignment, active subscription,
 * module ownership, and published state, then returns a V4 signed URL
 * for the requested video.
 *
 * IAM prerequisites (run once after first deploy):
 *
 *   1. Enable the IAM Credentials API:
 *      gcloud services enable iamcredentials.googleapis.com --project=apt4us-afb04
 *
 *   2. Identify the service account used by this function:
 *      gcloud functions describe getVideoUrl --gen2 --region us-central1 \
 *        --project=apt4us-afb04 --format='value(serviceConfig.serviceAccountEmail)'
 *
 *   3. Grant Token Creator on the SA itself (not project-wide):
 *      SA="THE-SA-EMAIL-FROM-STEP-2"
 *      gcloud iam service-accounts add-iam-policy-binding "$SA" \
 *        --member="serviceAccount:$SA" \
 *        --role="roles/iam.serviceAccountTokenCreator" \
 *        --project=apt4us-afb04
 *
 * Firestore composite index required for subscription query (step 5):
 *   Collection: subscriptions
 *   Fields: userId (Ascending), status (Ascending), effectiveEndDate (Ascending)
 *   If missing, the first call fails with FAILED_PRECONDITION and a console
 *   link to create the index.
 */
exports.getVideoUrl = onCall({
  cpu: 0.5,
  memory: '256MiB',
}, async (request) => {
  // Step 1: Verify auth
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const uid = request.auth.uid;
  const claims = request.auth.token;

  // Step 2: Validate params
  const { courseId, moduleId, contentId } = request.data;
  if (!courseId || !moduleId || !contentId) {
    throw new HttpsError(
      'invalid-argument',
      'courseId, moduleId, and contentId are required.'
    );
  }

  // Step 3: Determine admin status
  let isAdmin = claims.role === 'admin';
  if (!isAdmin) {
    try {
      const userDoc = await admin.firestore()
        .collection('users').doc(uid).get();
      if (userDoc.exists && userDoc.data().role === 'admin') {
        isAdmin = true;
      }
    } catch (e) {
      console.warn(`Could not check admin role in Firestore: ${e.message}`);
    }
  }

  // Step 4: Check course assignment (skip for admin)
  if (!isAdmin) {
    let isAssigned = false;

    // Check custom claims first (zero Firestore reads)
    if (Array.isArray(claims.assignedCourseIds) &&
        claims.assignedCourseIds.includes(courseId)) {
      isAssigned = true;
    }

    // Fallback: check Firestore user doc
    if (!isAssigned) {
      try {
        const userDoc = await admin.firestore()
          .collection('users').doc(uid).get();
        if (userDoc.exists) {
          const assignedIds = userDoc.data().assignedCourseIds || [];
          if (Array.isArray(assignedIds) && assignedIds.includes(courseId)) {
            isAssigned = true;
          }
        }
      } catch (e) {
        console.error(`Error checking course assignment: ${e.message}`);
      }
    }

    if (!isAssigned) {
      throw new HttpsError('permission-denied', 'not-assigned');
    }
  }

  // Step 5: Check active subscription (skip for admin)
  if (!isAdmin) {
    const now = new Date();
    const subSnapshot = await admin.firestore()
      .collection('subscriptions')
      .where('userId', '==', uid)
      .where('status', '==', 'active')
      .where('effectiveEndDate', '>', now)
      .limit(1)
      .get();

    if (subSnapshot.empty) {
      throw new HttpsError('permission-denied', 'no-subscription');
    }
  }

  // Step 6: Load module
  const moduleDoc = await admin.firestore()
    .collection('modules').doc(moduleId).get();

  if (!moduleDoc.exists) {
    throw new HttpsError('not-found', 'module-not-found');
  }

  const moduleData = moduleDoc.data();

  // Step 7: Verify module belongs to course
  if (moduleData.courseId !== courseId) {
    throw new HttpsError('permission-denied', 'module-course-mismatch');
  }

  // Step 8: Verify module is published (skip for admin)
  if (!isAdmin && moduleData.isPublished !== true) {
    throw new HttpsError('permission-denied', 'module-not-published');
  }

  // Step 9: Find content item by contentId in content.videos[]
  const videos = moduleData.content?.videos || [];
  const contentItem = videos.find(v => v.id === contentId);

  if (!contentItem) {
    throw new HttpsError('not-found', 'content-not-found');
  }

  // Step 10: Verify content item is published (skip for admin)
  // Treat null/undefined isPublished as published for backward compatibility
  if (!isAdmin && contentItem.isPublished === false) {
    throw new HttpsError('permission-denied', 'content-not-published');
  }

  // Step 11: Read storagePath
  const storagePath = contentItem.storagePath;
  if (!storagePath) {
    throw new HttpsError('not-found', 'no-storage-path');
  }

  // Step 12: Guard — storagePath must belong to the requested course
  if (!storagePath.startsWith(`courses/${courseId}/`)) {
    throw new HttpsError('permission-denied', 'path-course-mismatch');
  }

  // Step 13: Generate V4 signed URL (4 hour expiry)
  try {
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);

    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 4 * 60 * 60 * 1000, // 4 hours
    });

    console.log(`Signed URL generated for ${storagePath} by user ${uid}`);
    return { url: signedUrl };
  } catch (e) {
    console.error(`Error generating signed URL for ${storagePath}: ${e.message}`);
    throw new HttpsError(
      'internal',
      'Failed to generate video URL. Please try again.'
    );
  }
});
