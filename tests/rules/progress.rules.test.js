/**
 * Firestore Security Rules Tests — Progress Tracking.
 *
 * Tests the claim-based rules for contentItems, resume, courseProgress,
 * streaks, and user-doc field restrictions.
 *
 * Setup:
 *   cd /path/to/project
 *   firebase emulators:exec --only firestore "npx jest tests/rules"
 *
 * NOTE: These tests require the Firestore emulator to be running.
 * Use firebase emulators:exec which handles startup/shutdown automatically.
 *
 * IMPORTANT: Do NOT seed a users/a1 doc for the admin. This forces the
 * admin-only rules to rely on claims (request.auth.token.role), not the
 * get()-based isAdmin() wildcard. If the wildcard is removed, these tests
 * still pass. If a rule accidentally depends on the wildcard, the test fails.
 */

const fs = require("fs");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-progress-test",
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
    },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
});

afterAll(async () => {
  await env.cleanup();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Student context (no custom claims). */
const student = (uid = "s1") => env.authenticatedContext(uid).firestore();

/** Admin context (claim only — NO users doc seeded). */
const adminDb = () =>
  env.authenticatedContext("a1", { role: "admin" }).firestore();

/** Unauthenticated context. */
const unauth = () => env.unauthenticatedContext().firestore();

/** Seed data bypassing security rules. */
const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));

const { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc } =
  require("firebase/firestore");
const { collectionGroup, query, where } = require("firebase/firestore");

// ── Users ────────────────────────────────────────────────────────────────────

describe("users collection", () => {
  test("student cannot self-create a user doc", async () => {
    await assertFails(
      setDoc(doc(student(), "users/s1"), {
        displayName: "Student",
        role: "student",
      })
    );
  });

  test("student cannot create doc with role: admin", async () => {
    await assertFails(
      setDoc(doc(student(), "users/s1"), { role: "admin" })
    );
  });

  test("student can update displayName", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), {
        displayName: "Old",
        role: "student",
        email: "s@test.com",
      })
    );
    await assertSucceeds(
      updateDoc(doc(student(), "users/s1"), { displayName: "New" })
    );
  });

  test("student can update timezone with valid string", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), { displayName: "A", role: "student" })
    );
    await assertSucceeds(
      updateDoc(doc(student(), "users/s1"), { timezone: "America/New_York" })
    );
  });

  test("student cannot update examReadiness", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), { displayName: "A", role: "student" })
    );
    await assertFails(
      updateDoc(doc(student(), "users/s1"), { examReadiness: 100 })
    );
  });

  test("student cannot update currentStreak", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), { displayName: "A", role: "student" })
    );
    await assertFails(
      updateDoc(doc(student(), "users/s1"), { currentStreak: 999 })
    );
  });

  test("student cannot update role", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), { displayName: "A", role: "student" })
    );
    await assertFails(
      updateDoc(doc(student(), "users/s1"), { role: "admin" })
    );
  });

  test("student cannot update assignedCourseIds", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), { displayName: "A", role: "student" })
    );
    await assertFails(
      updateDoc(doc(student(), "users/s1"), { assignedCourseIds: ["c1"] })
    );
  });

  test("student cannot update totalCoursesCompleted", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), { displayName: "A", role: "student" })
    );
    await assertFails(
      updateDoc(doc(student(), "users/s1"), { totalCoursesCompleted: 99 })
    );
  });

  test("student cannot read another student's doc", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s2"), { displayName: "B", role: "student" })
    );
    await assertFails(getDoc(doc(student("s1"), "users/s2")));
  });

  test("admin (claim-only) can read any user doc", async () => {
    await seed((db) =>
      setDoc(doc(db, "users/s1"), { displayName: "A", role: "student" })
    );
    await assertSucceeds(getDoc(doc(adminDb(), "users/s1")));
  });
});

// ── contentItems (server-only) ───────────────────────────────────────────────

describe("contentItems (server-only writes)", () => {
  test("student cannot write contentItem", async () => {
    await assertFails(
      setDoc(doc(student(), "progress/s1/contentItems/c1"), {
        userId: "s1",
        courseId: "x",
        moduleId: "m",
        status: "completed",
      })
    );
  });

  test("student can read own contentItem", async () => {
    await seed((db) =>
      setDoc(doc(db, "progress/s1/contentItems/c1"), {
        userId: "s1",
        courseId: "x",
        status: "in_progress",
      })
    );
    await assertSucceeds(
      getDoc(doc(student(), "progress/s1/contentItems/c1"))
    );
  });

  test("student cannot read another student's contentItem", async () => {
    await seed((db) =>
      setDoc(doc(db, "progress/s2/contentItems/c1"), {
        userId: "s2",
        courseId: "x",
      })
    );
    await assertFails(
      getDoc(doc(student("s1"), "progress/s2/contentItems/c1"))
    );
  });

  test("admin can write contentItem", async () => {
    await assertSucceeds(
      setDoc(doc(adminDb(), "progress/s1/contentItems/c1"), {
        userId: "s1",
        courseId: "x",
        status: "completed",
      })
    );
  });
});

// ── resume (client-writable, narrow allow-list) ──────────────────────────────

describe("resume subcollection", () => {
  const validResume = {
    userId: "s1",
    courseId: "course1",
    moduleId: "mod1",
    contentId: "c1",
    contentType: "video",
    currentPosition: 120,
    updatedAt: new Date(),
  };

  test("student can write valid resume doc", async () => {
    await assertSucceeds(
      setDoc(doc(student(), "progress/s1/resume/c1"), validResume)
    );
  });

  test("resume rejects extra fields (e.g. status)", async () => {
    await assertFails(
      setDoc(doc(student(), "progress/s1/resume/c1"), {
        ...validResume,
        status: "completed",
      })
    );
  });

  test("resume rejects negative currentPosition", async () => {
    await assertFails(
      setDoc(doc(student(), "progress/s1/resume/c1"), {
        ...validResume,
        currentPosition: -5,
      })
    );
  });

  test("resume rejects mismatched contentId", async () => {
    await assertFails(
      setDoc(doc(student(), "progress/s1/resume/c1"), {
        ...validResume,
        contentId: "wrong_id",
      })
    );
  });

  test("student cannot write another student's resume", async () => {
    await assertFails(
      setDoc(doc(student("s2"), "progress/s1/resume/c1"), {
        ...validResume,
        userId: "s1",
      })
    );
  });

  test("student cannot write resume with spoofed userId", async () => {
    await assertFails(
      setDoc(doc(student(), "progress/s1/resume/c1"), {
        ...validResume,
        userId: "someone_else",
      })
    );
  });
});

// ── courseProgress (server-only writes) ───────────────────────────────────────

describe("courseProgress", () => {
  beforeEach(async () => {
    await seed((db) =>
      setDoc(doc(db, "progress/s1/courseProgress/course1"), {
        courseId: "course1",
        weight: 1,
        completionPercentage: 50,
        status: "in_progress",
      })
    );
  });

  test("student can read own courseProgress", async () => {
    await assertSucceeds(
      getDoc(doc(student(), "progress/s1/courseProgress/course1"))
    );
  });

  test("student cannot write courseProgress", async () => {
    await assertFails(
      updateDoc(doc(student(), "progress/s1/courseProgress/course1"), {
        completionPercentage: 100,
      })
    );
  });

  test("student cannot write weight", async () => {
    await assertFails(
      updateDoc(doc(student(), "progress/s1/courseProgress/course1"), {
        weight: 999,
      })
    );
  });

  test("student cannot read another student's courseProgress", async () => {
    await assertFails(
      getDoc(doc(student("s2"), "progress/s1/courseProgress/course1"))
    );
  });

  test("admin (claim-only) can read courseProgress", async () => {
    await assertSucceeds(
      getDoc(doc(adminDb(), "progress/s1/courseProgress/course1"))
    );
  });

  test("admin can write weight", async () => {
    await assertSucceeds(
      updateDoc(doc(adminDb(), "progress/s1/courseProgress/course1"), {
        weight: 2,
      })
    );
  });

  test("admin can run collection-group query on courseProgress", async () => {
    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(adminDb(), "courseProgress"),
          where("courseId", "==", "course1")
        )
      )
    );
  });

  test("student cannot run collection-group query on courseProgress", async () => {
    await assertFails(
      getDocs(
        query(
          collectionGroup(student(), "courseProgress"),
          where("courseId", "==", "course1")
        )
      )
    );
  });
});

// ── Streaks ──────────────────────────────────────────────────────────────────

describe("streaks", () => {
  beforeEach(async () => {
    await seed((db) =>
      setDoc(doc(db, "streaks/s1"), { currentStreak: 5, userId: "s1" })
    );
  });

  test("student can read own streak", async () => {
    await assertSucceeds(getDoc(doc(student(), "streaks/s1")));
  });

  test("student cannot write streak", async () => {
    await assertFails(
      updateDoc(doc(student(), "streaks/s1"), { currentStreak: 999 })
    );
  });

  test("student cannot read another student's streak", async () => {
    await assertFails(getDoc(doc(student("s2"), "streaks/s1")));
  });

  test("admin can read streak", async () => {
    await assertSucceeds(getDoc(doc(adminDb(), "streaks/s1")));
  });
});

// ── appConfig/progressSettings ───────────────────────────────────────────────

describe("appConfig/progressSettings", () => {
  test("authenticated user can read", async () => {
    await seed((db) =>
      setDoc(doc(db, "appConfig/progressSettings"), {
        videoCompletionThreshold: 90,
      })
    );
    await assertSucceeds(
      getDoc(doc(student(), "appConfig/progressSettings"))
    );
  });

  test("student cannot write", async () => {
    await assertFails(
      setDoc(doc(student(), "appConfig/progressSettings"), {
        videoCompletionThreshold: 1,
      })
    );
  });

  test("admin can write", async () => {
    await assertSucceeds(
      setDoc(doc(adminDb(), "appConfig/progressSettings"), {
        videoCompletionThreshold: 85,
      })
    );
  });
});

