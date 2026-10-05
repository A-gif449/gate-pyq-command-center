-- Email OTP persistence for the Vercel /api/email-otp server function.
-- The browser never reads or writes these rows directly.
begin;

create table if not exists public.email_otp_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null check (purpose in ('login','signup')),
  code_hash text not null,
  salt text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 5),
  consumed boolean not null default false,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.email_otp_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null check (purpose in ('login','signup')),
  created_at timestamptz not null default now()
);

create index if not exists email_otp_codes_lookup_idx on public.email_otp_codes(email, purpose, created_at desc);
create index if not exists email_otp_requests_rate_idx on public.email_otp_requests(email, created_at desc);

alter table public.email_otp_codes enable row level security;
alter table public.email_otp_requests enable row level security;
-- No client policies or grants. Only the server-side Supabase service role may access these tables.
revoke all on public.email_otp_codes from anon, authenticated;
revoke all on public.email_otp_requests from anon, authenticated;


commit;
