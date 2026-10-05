# Notifications + Daily Study Email

The app now has two notification layers:

1. **In-app notifications**: the bell in the top bar shows status updates, daily streak activity, and unread notifications.
2. **Daily study email**: a daily email reports questions solved today and the current solved-question streak.

## 1. Run the database migration

Run these in Supabase SQL Editor, in order:

```text
supabase/firebase_migration.sql
supabase/notifications_migration.sql
supabase/questions_seed.sql
```

`questions_seed.sql` now contains the complete **3-volume bank (3,822 questions)** and the exact GateOverflow URLs decoded from the QR codes in the supplied PDFs.

## 2. Daily email provider

The email worker is:

```text
supabase/functions/daily-study-email/index.ts
```

It uses Resend. Configure these Supabase Edge Function secrets:

```text
RESEND_API_KEY=your_resend_api_key
RESEND_FROM_EMAIL=your_verified_sender@example.com
```

Deploy it with the Supabase CLI:

```bash
supabase functions deploy daily-study-email
```

Then schedule the function from the Supabase Dashboard's scheduled-functions/cron UI for **8:30 PM IST** each day.

If you prefer SQL scheduling, `supabase/daily-email-cron.sql` contains the cron template, but the URL/service-role settings must be supplied securely through Supabase secrets/Vault first.

## 3. What the email contains

The daily email includes:

- Questions solved today
- Current consecutive solved-question streak
- Progress toward the default daily goal of 10 questions
- A short reminder when today's goal is not complete

Users can enable/disable the daily email from the notification bell. The preference is stored per Firebase user.

## 4. Important security rule

Never put `RESEND_API_KEY` or a Supabase service-role key in the Vite `.env.local` file. They belong only in Supabase Edge Function secrets.


### Live in-app notifications
The `notifications_migration.sql` file also enables Supabase Realtime for the notifications table. The web app subscribes to the signed-in user's notification inserts, shows a top-level toast, and optionally plays a soft chime.
