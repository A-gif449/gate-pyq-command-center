# GATE PYQ Command Center

A polished React + TypeScript + Vite study workspace for the supplied GATE PYQ volumes.

## Stack

- React 19 + TypeScript + Vite
- Tailwind CSS + shadcn-style UI primitives
- Lucide icons
- Motion for transitions and micro-interactions
- TanStack Query for async/cache orchestration
- TanStack Virtual for the question list
- Recharts for study analytics
- Sonner for feedback/toasts
- cmdk for Ctrl/Cmd+K command search
- Vaul for the mobile navigation drawer
- React Hook Form + Zod for profile/forms
- React Dropzone + browser-image-compression for local profile photos
- react-fast-marquee for the top-solvers strip
- date-fns + use-debounce for activity and search UX
- Firebase Authentication (Google + email/password)
- Supabase PostgreSQL for questions, progress, reactions and notifications
- Supabase Firebase Third-Party Auth so Firebase ID tokens are verified by Supabase RLS
- PDF.js for lazy question rendering

## UX highlights

- Soft lavender SaaS-style light theme and focused dark theme
- Responsive desktop/mobile navigation
- Home, Questions, Dashboard, Leaderboard, Profile, Notifications and Settings
- Virtualized question list with lazy PDF crops and next-question warming
- Exact GateOverflow link stored with each question's source metadata
- One reaction per user per question, with optimistic UI and durable Supabase state
- Personal statuses: solved, wrong, redo, important and not attempted
- Cloud-backed progress plus a user-scoped local cache so refreshes do not wipe the visible study state while cloud data is loading
- Dashboard with coverage, accuracy, streak and subject performance
- Public aggregate leaderboard view
- Ctrl/Cmd+K command palette
- Local-only compressed profile photo
- Graceful error boundary instead of a full-page crash
- Question-level PDF segmentation so each viewer shows only one PYQ, including multi-page questions
- Responsive high-resolution question rendering with original aspect ratio preserved
- Animated orbiting neon beam around the home hero card, with reduced-motion support
- Question of the Day, revision queue, confidence tracking, goal tracking and achievement milestones
- Deep topic analytics, confidence map, shareable progress snapshot and stronger search token matching
- Security/performance foundation with RLS migration, confidence/goal tables, caching, virtualization and lazy rendering

## Run locally

Node 20+ is recommended.

```bash
npm install
npm run dev
```

The project intentionally keeps the generated `package-lock.json` from the previous build. Running `npm install` will reconcile it with the enhanced dependency set in `package.json`.

## Environment

Copy `.env.example` to `.env.local` and fill the Firebase web configuration and Supabase public key.

Never place a Firebase Admin/service-account key or Supabase secret/service-role key in browser code.

## Supabase migrations

Run these in the Supabase SQL editor in order where applicable:

1. The existing schema/question seed migrations.
2. `supabase/firebase_migration.sql` for Firebase-owned user state.
3. `supabase/reaction_sync_migration.sql` for the transaction-safe reaction RPC.
4. `supabase/notifications_migration.sql` for notifications/preferences.
5. `supabase/leaderboard_migration.sql` for the public aggregate leaderboard.
6. `supabase/comments_migration.sql` for question discussions.
7. `supabase/profile_comments_upgrade.sql` for public profile avatars/verification badges and owner-only comment editing/deletion.
8. `supabase/reliability_upgrade_migration.sql` to repair reaction syncing and profile/comment policies on an existing database.
9. `supabase/future_features_migration.sql` for confidence tracking and synced study goals.

The leaderboard view exposes only display name and aggregate study metrics. It does not expose Firebase UIDs.

## Important persistence note

Firebase is the identity provider. Supabase is the durable source of truth for authenticated study data. The browser's localStorage is only used for UI preferences and a user-scoped cache of already-synced progress/reactions, plus the local-only profile photo.

This means refreshing the page should no longer reset the visible solved/wrong/redo/important state while Firebase/Supabase reconnects.

## Reaction authentication note

Supabase Third-Party Auth must be configured for the Firebase project. Firebase ID tokens used with the Supabase Data API should carry the `role: authenticated` custom claim. The client already passes the current Firebase ID token through the Supabase `accessToken` callback.

For an existing Firebase project, assign the claim once with the Firebase Admin SDK. Never put the Admin SDK credentials in Vite/browser code.

```bash
npm install firebase-admin
# configure GOOGLE_APPLICATION_CREDENTIALS to point to your Firebase Admin service-account JSON
npm run set:firebase-role
```

After the claim is assigned, sign out and sign back in so Firebase issues a fresh ID token. Supabase's current Firebase third-party-auth guidance requires the `role: authenticated` claim for authenticated Data API access.

## Question discussions

Run `supabase/comments_migration.sql` in Supabase SQL Editor to enable the compact discussion section under each question.

## Authentication upgrade
The current build supports Google sign-in, email/password, Firebase password-reset email, and 6-digit email OTP login/signup. Email OTP is delivered by the Vercel `/api/email-otp` server function through Resend and stores only hashed OTP material in Supabase. Run `supabase/auth_otp_migration.sql` before enabling OTP. Configure the server-only Firebase Admin, Supabase service-role, and Resend environment variables in Vercel; never expose those values through `VITE_*` variables.
