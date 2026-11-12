/**
 * Backfill custom claims for existing admin users.
 *
 * Run once before deploying the new Firestore rules that use
 * `request.auth.token.role == 'admin'` instead of the get()-based isAdmin().
 *
 * Usage:
 *   cd functions
 *   node src/backfillAdminClaims.js
 *
 * After running, each admin must sign out and sign back in
 * (or force a token refresh) for the claim to take effect.
 */

const admin = require("firebase-admin");

// Initialize with the project ID from .firebaserc.
// Credentials come from one of:
//   1. GOOGLE_APPLICATION_CREDENTIALS env var (service account key file)
//   2. `gcloud auth application-default login` (ADC)
//   3. Default service account on GCP
//
// If none work, download a service account key from the Firebase console:
//   Project Settings → Service accounts → Generate new private key
// Then run:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node src/backfillAdminClaims.js
admin.initializeApp({
  projectId: "apt4us-afb04",
});

const db = admin.firestore();

async function backfillAdminClaims() {
  const adminsSnap = await db
    .collection("users")
    .where("role", "==", "admin")
    .get();

  console.log(`Found ${adminsSnap.size} admin(s) in Firestore.`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of adminsSnap.docs) {
    const userId = doc.id;
    const email = doc.data().email || "(no email)";

    try {
      const user = await admin.auth().getUser(userId);
      const existing = user.customClaims || {};

      if (existing.role === "admin") {
        console.log(`  ✓ ${email} — already has role:admin claim, skipping`);
        skipped++;
        continue;
      }

      const merged = {...existing, role: "admin"};
      await admin.auth().setCustomUserClaims(userId, merged);
      console.log(`  ✓ ${email} — set role:admin claim`);
      updated++;
    } catch (err) {
      console.error(`  ✗ ${email} (${userId}) — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}, Failed: ${failed}`);
  console.log(
    "\n⚠️  Each admin must sign out and sign back in for the claim to take effect."
  );

  process.exit(0);
}

backfillAdminClaims().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

