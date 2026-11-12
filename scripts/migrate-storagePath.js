#!/usr/bin/env node

/**
 * Migration script: Backfill storagePath on content items from existing URLs.
 *
 * Usage:
 *   node scripts/migrate-storagePath.js                  # dry-run (default)
 *   node scripts/migrate-storagePath.js --dry-run        # explicit dry-run
 *   node scripts/migrate-storagePath.js --commit         # write changes
 *
 * Before running with --commit:
 *   1. Create a Firestore backup:
 *      gcloud firestore export gs://YOUR_BUCKET/backups/pre-storagePath-migration \
 *        --project=apt4us-afb04
 *   2. Review the --dry-run output carefully
 */

const admin = require('firebase-admin');

// ── Parse flags ──
const args = process.argv.slice(2);
const commitMode = args.includes('--commit');
const dryRun = !commitMode; // default is dry-run

// ── Initialize Admin SDK ──
admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();

// URL regex: extract path from Firebase Storage download URLs
// Matches /o/{encoded-path}? or /o/{encoded-path}$ (end of string)
const STORAGE_PATH_REGEX = /\/o\/([^?]+)/;

function extractStoragePath(url) {
  if (!url || typeof url !== 'string') return null;

  const match = url.match(STORAGE_PATH_REGEX);
  if (!match || !match[1]) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch (e) {
    return null;
  }
}

async function fileExistsInStorage(path) {
  try {
    const [exists] = await bucket.file(path).exists();
    return exists;
  } catch (e) {
    console.error(`  ⚠️  Error checking file existence for "${path}": ${e.message}`);
    return false;
  }
}

async function main() {
  // Print project ID and require confirmation
  const projectId = process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    admin.instanceId().app.options.projectId ||
    '(unknown)';

  console.log(`\n📦 Project: ${projectId}`);
  console.log(`📋 Mode: ${dryRun ? 'DRY RUN (no writes)' : 'COMMIT (will write changes)'}\n`);

  // Require backup confirmation only in commit mode
  if (commitMode) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const answer = await new Promise(resolve => {
      rl.question(
        '⚠️  This script modifies all module documents.\n' +
        'Before continuing, ensure you have a Firestore export:\n' +
        '  gcloud firestore export gs://YOUR_BUCKET/backups/pre-storagePath-migration \\\n' +
        '    --project=apt4us-afb04\n\n' +
        `Confirm you are writing to project "${projectId}". Type 'yes' to continue: `,
        resolve
      );
    });

    rl.close();

    if (answer.trim().toLowerCase() !== 'yes') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  // Fetch all module documents
  const modulesSnapshot = await db.collection('modules').get();
  console.log(`Found ${modulesSnapshot.size} module documents.\n`);

  const contentTypes = ['videos', 'notes', 'pdfs', 'images', 'audios'];
  let totalItems = 0;
  let updatedItems = 0;
  let skippedItems = 0;
  let errorItems = 0;
  let modulesModified = 0;

  for (const moduleDoc of modulesSnapshot.docs) {
    const moduleId = moduleDoc.id;
    const data = moduleDoc.data();
    const content = data.content || {};
    let moduleChanged = false;

    for (const contentType of contentTypes) {
      const items = content[contentType];
      if (!Array.isArray(items)) continue;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        totalItems++;

        // Skip items that already have storagePath
        if (item.storagePath) {
          continue;
        }

        // Skip items without a URL (e.g., text-based notes)
        if (!item.url) {
          continue;
        }

        // Skip non-Firebase-Storage URLs
        if (!item.url.includes('firebasestorage')) {
          console.log(`  ⏭️  [${moduleId}] ${contentType}[${i}] "${item.title}" — not a Firebase Storage URL, skipping`);
          skippedItems++;
          continue;
        }

        // Extract storage path from URL
        const extractedPath = extractStoragePath(item.url);

        if (!extractedPath) {
          console.warn(`  ⚠️  [${moduleId}] ${contentType}[${i}] "${item.title}" — could not extract path from URL`);
          errorItems++;
          continue;
        }

        // Verify file exists in Storage
        const exists = await fileExistsInStorage(extractedPath);
        if (!exists) {
          console.warn(`  ⚠️  [${moduleId}] ${contentType}[${i}] "${item.title}" — file NOT FOUND in Storage: ${extractedPath}`);
          errorItems++;
          continue;
        }

        // Set storagePath
        console.log(`  ✅ [${moduleId}] ${contentType}[${i}] "${item.title}"`);
        console.log(`     url: ${item.url.substring(0, 80)}...`);
        console.log(`     storagePath: ${extractedPath}`);

        // Collect migration results per item: { contentType, index, storagePath, originalUrl }
        // file.exists() was already checked above, outside the transaction.
        items[i] = { ...item, storagePath: extractedPath, _originalUrl: item.url };
        moduleChanged = true;
        updatedItems++;
      }
    }

    // Write the updated module document using a transaction to avoid
    // overwriting concurrent admin edits
    if (moduleChanged) {
      modulesModified++;
      if (!dryRun) {
        await db.runTransaction(async (tx) => {
          const freshDoc = await tx.get(moduleDoc.ref);
          if (!freshDoc.exists) {
            console.warn(`  ⚠️  Module ${moduleId} deleted during migration, skipping`);
            return;
          }
          const freshContent = freshDoc.data().content || {};
          let changed = false;

          for (const contentType of contentTypes) {
            const freshItems = freshContent[contentType];
            const migratedItems = content[contentType];
            if (!Array.isArray(freshItems) || !Array.isArray(migratedItems)) continue;

            for (const migrated of migratedItems) {
              if (!migrated.storagePath || !migrated._originalUrl) continue;

              // Find the matching item in the fresh doc by id
              const freshItem = freshItems.find(f => f.id === migrated.id);
              if (!freshItem) continue;

              // Only write storagePath if the item doesn't already have one
              // AND the url still matches what we extracted from. If an admin
              // replaced the video mid-run, the url changed and the old
              // storagePath would point to the wrong file.
              if (!freshItem.storagePath && freshItem.url === migrated._originalUrl) {
                freshItem.storagePath = migrated.storagePath;
                changed = true;
              }
            }
          }

          if (changed) {
            tx.update(moduleDoc.ref, { content: freshContent });
          }
        });
        console.log(`  💾 Written: module ${moduleId}\n`);
      } else {
        console.log(`  📝 Would write: module ${moduleId}\n`);
      }
    }
  }

  console.log('\n── Summary ──');
  console.log(`Total content items scanned: ${totalItems}`);
  console.log(`Items updated with storagePath: ${updatedItems}`);
  console.log(`Items skipped (non-Storage URL): ${skippedItems}`);
  console.log(`Items with errors (bad URL or missing file): ${errorItems}`);
  console.log(`Modules modified: ${modulesModified}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN — no changes written' : 'COMMIT — changes written'}`);
}

main().then(() => {
  console.log('\nDone.');
  process.exit(0);
}).catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
