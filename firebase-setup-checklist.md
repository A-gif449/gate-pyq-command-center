# Firebase + Supabase setup checklist

- [ ] Firebase Web App registered
- [ ] Firebase Email/Password enabled
- [ ] Firebase Google provider enabled
- [ ] Firebase Authorized Domains includes localhost
- [ ] Firebase Project ID copied into Supabase Authentication > Third-Party Auth > Firebase
- [ ] `.env.local` has all `VITE_FIREBASE_*` values
- [ ] `.env.local` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- [ ] `supabase/firebase_migration.sql` run once
- [ ] `npm install`
- [ ] `npm run dev`

## Email OTP authentication
The app now supports 6-digit email OTP login/signup and Firebase password reset.

For the Vercel `/api/email-otp` function, add these as **server-only** Vercel Environment Variables:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (store the service-account private key; never commit it)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

Run `supabase/auth_otp_migration.sql` once in the Supabase SQL editor before using email OTP.
The browser only uses the Firebase web config and Supabase anon key. Never expose the service-role key, Firebase private key, or Resend key through `VITE_*` variables.
