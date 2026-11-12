/**
 * Deploy preparation script:
 *   1. Seeds appConfig/progressSettings
 *   2. Backfills `duration` on all video content items in modules
 *
 * Usage:
 *   cd functions
 *   GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json node src/seedAndBackfill.js
 */

const admin = require("firebase-admin");
const https = require("https");
const http = require("http");
const { URL } = require("url");

admin.initializeApp({ projectId: "apt4us-afb04" });
const db = admin.firestore();

// ---------------------------------------------------------------------------
// 1. Seed appConfig/progressSettings
// ---------------------------------------------------------------------------

async function seedProgressSettings() {
  const ref = db.doc("appConfig/progressSettings");
  const snap = await ref.get();

  if (snap.exists) {
    console.log("✓ appConfig/progressSettings already exists:", snap.data());
    return;
  }

  await ref.set({ videoCompletionThreshold: 90 });
  console.log("✓ Created appConfig/progressSettings: { videoCompletionThreshold: 90 }");
}

// ---------------------------------------------------------------------------
// 2. Get video duration by downloading and parsing MP4 moov atom
// ---------------------------------------------------------------------------

/**
 * Fetch bytes from a URL. Follows redirects.
 */
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;

    client.get(url, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * Parse MP4 duration from a buffer by finding the mvhd box inside moov.
 * Returns duration in seconds, or null if not found.
 */
function parseMp4Duration(buf) {
  let offset = 0;
  while (offset < buf.length - 8) {
    const size = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);

    if (size < 8) break; // invalid box

    if (type === "moov" || type === "trak" || type === "mdia") {
      // Container box — recurse into children
      offset += 8;
      continue;
    }

    if (type === "mvhd") {
      // Movie header box — contains timescale and duration
      const version = buf.readUInt8(offset + 8);
      let timescale, duration;

      if (version === 0) {
        // Version 0: 4-byte fields
        timescale = buf.readUInt32BE(offset + 20);
        duration = buf.readUInt32BE(offset + 24);
      } else {
        // Version 1: 8-byte fields
        timescale = buf.readUInt32BE(offset + 28);
        // Duration is 8 bytes, but we only read the lower 4 (enough for most videos)
        const hi = buf.readUInt32BE(offset + 32);
        const lo = buf.readUInt32BE(offset + 36);
        duration = hi * 0x100000000 + lo;
      }

      if (timescale > 0) {
        return Math.round(duration / timescale);
      }
      return null;
    }

    offset += size;
  }
  return null;
}

/**
 * Get duration of an MP4 video from its URL.
 * Downloads the full file (necessary when moov is at the end).
 */
async function getVideoDuration(url) {
  try {
    console.log("    Downloading video to probe duration...");
    const buf = await fetchUrl(url);
    console.log(`    Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
    const duration = parseMp4Duration(buf);
    return duration;
  } catch (err) {
    console.error(`    Failed to probe: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. Backfill duration on all videos
// ---------------------------------------------------------------------------

async function backfillVideoDurations() {
  const snap = await db.collection("modules").get();
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const videos = data.content?.videos || [];
    if (videos.length === 0) continue;

    let needsUpdate = false;
    const updatedVideos = [];

    for (const video of videos) {
      if (video.duration && video.duration > 0) {
        console.log(`  ✓ ${video.title} — already has duration: ${video.duration}s`);
        updatedVideos.push(video);
        skipped++;
        continue;
      }

      if (!video.url) {
        console.log(`  ✗ ${video.title} — no URL, skipping`);
        updatedVideos.push(video);
        failed++;
        continue;
      }

      console.log(`  ⏳ ${video.title} — probing duration...`);
      const duration = await getVideoDuration(video.url);

      if (duration && duration > 0) {
        console.log(`  ✓ ${video.title} — duration: ${duration}s`);
        updatedVideos.push({ ...video, duration });
        needsUpdate = true;
        updated++;
      } else {
        console.log(`  ✗ ${video.title} — could not determine duration`);
        updatedVideos.push(video);
        failed++;
      }
    }

    if (needsUpdate) {
      // Update the module's content.videos array with durations
      const content = { ...data.content, videos: updatedVideos };
      await db.collection("modules").doc(doc.id).update({ content });
      console.log(`  → Updated module ${doc.id}`);
    }
  }

  console.log(`\nDuration backfill done. Updated: ${updated}, Skipped: ${skipped}, Failed: ${failed}`);

  if (failed > 0) {
    console.log(
      "\n⚠️  Some videos could not be probed. Set their duration manually:\n" +
      "   In Firestore, find the module → content.videos[i].duration (in seconds).\n" +
      "   Or install ffprobe: brew install ffmpeg"
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Step 1: Seed appConfig/progressSettings ===\n");
  await seedProgressSettings();

  console.log("\n=== Step 2: Backfill video durations ===\n");
  await backfillVideoDurations();

  console.log("\n✅ All done. Next step: firebase deploy --only functions");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

