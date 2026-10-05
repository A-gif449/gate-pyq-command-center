-- Run after firebase_migration.sql.
-- Adds persistent in-app notifications + daily study email preferences.

begin;

alter table public.questions add column if not exists volume text;
alter table public.questions add column if not exists display_id text;
grant select (id, subject, topic, source, tags, answer, qr_url, volume, display_id) on public.questions to anon, authenticated;

create table if not exists public.notification_preferences (
  user_id text primary key,
  email text,
  daily_email_enabled boolean not null default true,
  daily_goal integer not null default 10 check (daily_goal between 1 and 100),
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  type text not null default 'system',
  title text not null,
  body text not null,
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create unique index if not exists notifications_user_dedupe_key
  on public.notifications(user_id, dedupe_key)
  where dedupe_key is not null;
create index if not exists notifications_user_created_at
  on public.notifications(user_id, created_at desc);

alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "firebase notification prefs own all" on public.notification_preferences;
create policy "firebase notification prefs own all" on public.notification_preferences
for all to anon, authenticated
using ((auth.jwt()->>'sub') = user_id)
with check ((auth.jwt()->>'sub') = user_id);

drop policy if exists "firebase notifications own all" on public.notifications;
create policy "firebase notifications own all" on public.notifications
for all to anon, authenticated
using ((auth.jwt()->>'sub') = user_id)
with check ((auth.jwt()->>'sub') = user_id);

grant select, insert, update, delete on public.notification_preferences to anon, authenticated;
grant select, insert, update, delete on public.notifications to anon, authenticated;

-- Keep updated_at fresh whenever preferences change.
create or replace function public.touch_notification_preferences_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notification_preferences_updated_at on public.notification_preferences;
create trigger notification_preferences_updated_at
before update on public.notification_preferences
for each row execute procedure public.touch_notification_preferences_updated_at();

commit;

-- Enable live notification inserts for the browser bell/toast.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when undefined_object then
  -- Older/self-hosted Supabase installations may not have the realtime publication.
  null;
end $$;
