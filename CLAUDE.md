# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev                        # Start dev server at localhost:5174

# Build
npm run build                      # Generate firebase config then vite build
npm run build:typecheck            # Same but with tsc type-checking first

# Lint
npm run lint                       # ESLint across all source files

# Firebase functions (run from functions/ directory)
cd functions && npm run lint       # Lint Cloud Functions before deploy
firebase deploy --only functions   # Deploy Cloud Functions
firebase deploy --only firestore:rules  # Deploy Firestore security rules
```

### Environment setup

Copy `.env.example` to `.env` and fill in all `VITE_FIREBASE_*` variables. The build script (`scripts/generate-firebase-config.cjs`) reads these and writes `public/firebase-config.js`, which the service worker uses for FCM — this file must not be committed.

## Architecture

### Frontend (React + Vite)

**Stack:** React 19, TypeScript, MUI v9, React Router v7, Firebase SDK v12, Vite v8.

The app is a single-page admin dashboard deployed to Netlify. All pages are lazy-loaded via `React.lazy`.

```
src/
  App.tsx              — Router setup; wraps everything in ThemeProvider + AuthProvider
  firebase/config.ts   — Single Firebase app init; exports auth, db, storage, functions, messaging
  context/
    AuthContext.tsx    — Auth state: currentUser, isAdmin, assignedCourseIds, customClaims
  pages/               — One file per route, lazy-loaded
  components/
    layout/MainLayout  — App shell with sidebar nav
    ProtectedRoute     — Role/course-access guard (checks JWT claims first, Firestore fallback)
    NotificationHandler — Foreground FCM message listener + snackbar display
    SubscriptionService — Background polling component (admin-only); checks expiring subscriptions
  services/            — All Firestore/Firebase logic lives here, never directly in pages/components
  styles/theme.ts      — MUI theme customization
  utils/
    idGenerator.ts     — Structured ID generation (see ID conventions below)
```

### Auth & roles

Auth is **manual login only** — `onIdTokenChanged` fires but does NOT auto-login on page load. Login sets state via `setUserAfterLogin`. Two roles exist: `admin` and `student`. Role is stored in Firebase custom JWT claims (`customClaims.role`), with a fallback to the Firestore `users` doc. Course-level access is similarly stored in claims as `assignedCourseIds`.

### Services layer

All Firestore reads/writes are in `src/services/`. Key services:

| File | Responsibility |
|------|---------------|
| `authService.ts` | Sign-in, sign-out, emergency logout |
| `courseService.ts` | Course CRUD, access checks |
| `subscriptionService.ts` | Subscription CRUD, expiry logic |
| `fcmService.ts` | FCM token registration, messaging init |
| `notificationService.ts` | In-app notification reads/writes |
| `violationService.ts` | Screenshot violation records |
| `messageService.ts` | Admin chat messages |
| `studentService.ts` | Student/account management |

### Cloud Functions (`functions/src/`)

Node.js v2 Firebase Functions (CommonJS). Entry point is `functions/src/index.js`.

| Module | Purpose |
|--------|---------|
| `notifications.js` | FCM send helpers |
| `contentUpdates.js` | Course/module/content update push notifications |
| `subscriptions.js` | Scheduled expiry checks (`scheduledSubscriptionCheck` runs daily) |
| `violations.js` | Screenshot violation recording + reset acknowledgement |
| `index.js` | Wires everything; adds `cleanupStaleTokens` (daily), `subscribeToTopic`, `unsubscribeFromTopic`, `fixAdminMessages` |

### Firestore collections

Key collections: `users`, `courses`, `modules`, `content`, `messages`, `user_tokens`, `notifications`, `subscriptions`, `violations`.

### ID conventions

All entity IDs follow structured formats defined in `docs/NAMING_CONVENTIONS.md` and generated via `src/utils/idGenerator.ts`:

- **Course IDs:** `PREFIX-MMDD-XXXX` (e.g. `MATH-0615-Xy3j`)
- **Module IDs:** `MOD-PREFIX-XXXXXXXX` (e.g. `MOD-MATH-aB45cD7e`)
- **Content IDs:** `{type}-{safeId}-{timestamp}` (e.g. `pdf-Xy3jQm-1623789456`)

Always use `generateStructuredCourseId` / `generateSafeId` from `idGenerator.ts` — never craft IDs by hand.

### Build & chunking

Vite splits the bundle into named chunks per library family (mui, mui-icons, firebase-auth, firebase-firestore, firebase-storage, firebase-messaging, firebase-core, react, react-dom, react-router). The `@` alias resolves to `src/`.

### FCM / notifications

The service worker at `public/firebase-messaging-sw.js` handles background push messages. `public/firebase-config.js` is generated at build time and loaded by the service worker. `NotificationHandler` handles foreground messages. Token cleanup runs via the `cleanupStaleTokens` scheduled Cloud Function (marks tokens inactive after 60 days).
