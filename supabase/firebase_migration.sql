-- Run this AFTER the original schema.sql/seed have been run.
-- It switches user-owned tables from Supabase Auth UUIDs to Firebase Auth UIDs.
-- This intentionally resets only progress/reaction/profile tables because the project is new.

begin;

alter table public.questions add column if not exists qr_url text;
alter table public.questions add column if not exists volume text;
alter table public.questions add column if not exists display_id text;

drop view if exists public.question_reaction_counts;
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;
drop table if exists public.question_reactions cascade;
drop table if exists public.question_progress cascade;
drop table if exists public.profiles cascade;

create table public.profiles (
  id text primary key,
  display_name text,
  avatar_url text,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.question_progress (
  user_id text not null,
  question_id text not null references public.questions(id) on delete cascade,
  status text not null check (status in ('unsolved','solved','wrong','redo','important')),
  notes text,
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table public.question_reactions (
  user_id text not null,
  question_id text not null references public.questions(id) on delete cascade,
  reaction text not null check (reaction in ('like','dislike')),
  created_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

alter table public.profiles enable row level security;
alter table public.question_progress enable row level security;
alter table public.question_reactions enable row level security;

-- The Firebase JWT is verified by Supabase's Firebase third-party-auth integration.
-- We use the Firebase subject (sub) as the stable user ID.
drop policy if exists "firebase profiles own read" on public.profiles;
drop policy if exists "firebase profiles public read" on public.profiles;
drop policy if exists "firebase profiles own insert" on public.profiles;
drop policy if exists "firebase profiles own update" on public.profiles;
create policy "firebase profiles public read" on public.profiles for select to anon, authenticated
  using (true);
create policy "firebase profiles own insert" on public.profiles for insert to anon, authenticated
  with check ((auth.jwt()->>'sub') = id);
create policy "firebase profiles own update" on public.profiles for update to anon, authenticated
  using ((auth.jwt()->>'sub') = id) with check ((auth.jwt()->>'sub') = id);

drop policy if exists "firebase progress own all" on public.question_progress;
create policy "firebase progress own all" on public.question_progress for all to anon, authenticated
  using ((auth.jwt()->>'sub') = user_id)
  with check ((auth.jwt()->>'sub') = user_id);

drop policy if exists "firebase reactions own all" on public.question_reactions;
create policy "firebase reactions own all" on public.question_reactions for all to anon, authenticated
  using ((auth.jwt()->>'sub') = user_id)
  with check ((auth.jwt()->>'sub') = user_id);

-- Explicit grants are needed because Firebase JWTs initially use the anon role unless
-- you later add a custom role claim. RLS still restricts every write to the JWT subject.
grant select (id, subject, topic, source, tags, answer, qr_url, volume, display_id) on public.questions to anon, authenticated;
grant select, insert, update, delete on public.profiles to anon, authenticated;
grant select, insert, update, delete on public.question_progress to anon, authenticated;
grant select, insert, update, delete on public.question_reactions to anon, authenticated;

create or replace view public.question_reaction_counts as
select
  question_id,
  count(*) filter (where reaction = 'like')::int as likes,
  count(*) filter (where reaction = 'dislike')::int as dislikes
from public.question_reactions
group by question_id;

grant select on public.question_reaction_counts to anon, authenticated;

commit;
