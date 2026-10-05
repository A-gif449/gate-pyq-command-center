# GATE PYQ Command Center 2.0 upgrade

## Included
- Question-level PDF segmentation: each question now renders only its own content, including clean multi-page questions.
- Higher-resolution responsive PDF crop rendering.
- Animated orbiting neon beam around the home hero card, with reduced-motion support.
- Question of the Day.
- Intelligent revision queue based on wrong/redo/important and aging solved questions.
- Deep subject/topic analytics.
- Confidence tracking: Guess / Unsure / Confident.
- Synced confidence table support.
- Study goals with local user-scoped cache and optional cloud sync.
- Leaderboard/profile/achievement surfaces retained and expanded.
- Shareable progress snapshot.
- Stronger token-based search matching.
- Existing Firebase + Supabase auth, reactions, comments, notifications and virtualization preserved.

## Supabase step
Run this after the existing migrations:

`supabase/future_features_migration.sql`

It creates the `question_confidence` and `study_goals` tables with Firebase-subject RLS.

## Important
The source PDFs are unchanged. Only the question segmentation metadata in `src/data/questions.json` and `public/questions.json` was corrected so the UI can isolate one PYQ at a time.

## Stability fix
- Added the precomputed question indexes required by search, topic analytics, subject analytics, and smart weak-topic notifications. This prevents the app shell from crashing during the first render when those maps are referenced.

## Smart Revision + Notification reliability patch
- Preserved the existing 2.0 premium UI and question workspace.
- Added prioritized revision scoring: wrong > redo > important > low-confidence > aging solved questions.
- Added weak-topic detection, revision backlog, aging-solved reminders, important-question reminders, and confidence review nudges.
- Added one consolidated `supabase/smart_revision_notifications_migration.sql` migration for the notification/confidence/goal tables and realtime publication.
- Goal persistence now treats an existing local target as authoritative when it has no timestamp yet, migrates it to the cloud, and otherwise resolves local/cloud values by update time.
- Notification audio now uses one reusable AudioContext, unlocks on normal user interaction, supports a Settings test button, and deduplicates sound playback for realtime + local inserts.
- The browser still cannot play audio before the first user interaction because of browser autoplay policy; the Settings test button confirms the audio channel is unlocked.
