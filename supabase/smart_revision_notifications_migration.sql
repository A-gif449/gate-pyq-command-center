-- GATE PYQ Command Center: one-time smart revision + notifications activation.
-- Run AFTER firebase_migration.sql and the questions seed/base schema.
-- Safe to run repeatedly. It does not delete progress or notifications.

begin;

create table if not exists public.question_confidence (
  user_id text not null,
  question_id text not null references public.questions(id) on delete cascade,
  confidence text not null check (confidence in ('guess','unsure','confident')),
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table if not exists public.study_goals (
  user_id text primary key,
  goal_type text not null default 'AIR < 1000',
  goal_value integer not null default 1000 check (goal_value >= 0),
  updated_at timestamptz not null default now()
);

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

create index if not exists question_confidence_user_updated_idx
  on public.question_confidence(user_id, updated_at desc);
create index if not exists notifications_user_created_at
  on public.notifications(user_id, created_at desc);
create unique index if not exists notifications_user_dedupe_key
  on public.notifications(user_id, dedupe_key) where dedupe_key is not null;

alter table public.question_confidence enable row level security;
alter table public.study_goals enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "firebase confidence own all" on public.question_confidence;
create policy "firebase confidence own all" on public.question_confidence
  for all to anon, authenticated
  using ((auth.jwt()->>'sub') = user_id)
  with check ((auth.jwt()->>'sub') = user_id);

drop policy if exists "firebase goals own all" on public.study_goals;
create policy "firebase goals own all" on public.study_goals
  for all to anon, authenticated
  using ((auth.jwt()->>'sub') = user_id)
  with check ((auth.jwt()->>'sub') = user_id);

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

grant select, insert, update, delete on public.question_confidence to anon, authenticated;
grant select, insert, update, delete on public.study_goals to anon, authenticated;
grant select, insert, update, delete on public.notification_preferences to anon, authenticated;
grant select, insert, update, delete on public.notifications to anon, authenticated;

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

-- Allow the browser to receive new smart notifications immediately.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
commit;
