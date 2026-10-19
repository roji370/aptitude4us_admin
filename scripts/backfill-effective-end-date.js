/**
 * One-shot backfill: write `effectiveEndDate` on every existing subscription
 * document so that the Cloud Functions cron and any range queries against
 * `effectiveEndDate` pick them up.
 *
 *   effectiveEndDate = examDate (end-of-day) if examDate < endDate
 *                    else endDate
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *     node scripts/backfill-effective-end-date.js [--dry-run] [--force]
 *
 * Flags:
 *   --dry-run  Print what would change without writing.
 *   --force    Overwrite effectiveEndDate even if it already exists. Without
 *              this flag, documents that already have the field are skipped.
 *
 * Safe to run multiple times; idempotent without --force.
 */

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();

const endOfDay = (d) => {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
};

const computeEffectiveEndDate = (endDate, examDate) => {
  if (!examDate) return endDate;
  const examEod = endOfDay(examDate);
  return examEod < endDate ? examEod : endDate;
};

const run = async () => {
  console.log(`Starting effectiveEndDate backfill (dryRun=${DRY_RUN}, force=${FORCE})`);

  const snapshot = await db.collection('subscriptions').get();
  console.log(`Fetched ${snapshot.size} subscription documents`);

  let updated = 0;
  let skippedExisting = 0;
  let skippedNoEndDate = 0;
  let errored = 0;

  // Firestore batch limit is 500 ops.
  const BATCH_SIZE = 400;
  let batch = db.batch();
  let opsInBatch = 0;

  const flush = async () => {
    if (opsInBatch === 0) return;
    if (!DRY_RUN) await batch.commit();
    batch = db.batch();
    opsInBatch = 0;
  };

  for (const doc of snapshot.docs) {
    try {
      const data = doc.data();

      if (!FORCE && data.effectiveEndDate) {
        skippedExisting++;
        continue;
      }

      if (!data.endDate || typeof data.endDate.toDate !== 'function') {
        console.warn(`[skip] ${doc.id}: missing or invalid endDate`);
        skippedNoEndDate++;
        continue;
      }

      const endDate = data.endDate.toDate();
      const examDate =
        data.examDate && typeof data.examDate.toDate === 'function'
          ? data.examDate.toDate()
          : null;

      const effective = computeEffectiveEndDate(endDate, examDate);

      console.log(
        `[update] ${doc.id} endDate=${endDate.toISOString()} examDate=${
          examDate ? examDate.toISOString() : 'none'
        } -> effectiveEndDate=${effective.toISOString()}`
      );

      batch.update(doc.ref, {
        effectiveEndDate: admin.firestore.Timestamp.fromDate(effective)
      });
      opsInBatch++;
      updated++;

      if (opsInBatch >= BATCH_SIZE) {
        await flush();
      }
    } catch (err) {
      errored++;
      console.error(`[error] ${doc.id}:`, err);
    }
  }

  await flush();

  console.log('---');
  console.log(`Updated:          ${updated}`);
  console.log(`Skipped (exists): ${skippedExisting}`);
  console.log(`Skipped (no end): ${skippedNoEndDate}`);
  console.log(`Errored:          ${errored}`);
  console.log(DRY_RUN ? '(dry run, no writes performed)' : 'Backfill complete.');
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
