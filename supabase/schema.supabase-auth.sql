-- GATE PYQ Command Center
-- Run this once in Supabase SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id text primary key,
  subject text not null,
  topic text not null,
  source text,
  tags text,
  answer text
);

create table if not exists public.question_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  status text not null check (status in ('unsolved','solved','wrong','redo','important')),
  notes text,
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table if not exists public.question_reactions (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  reaction text not null check (reaction in ('like','dislike')),
  created_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

alter table public.profiles enable row level security;
alter table public.questions enable row level security;
alter table public.question_progress enable row level security;
alter table public.question_reactions enable row level security;

drop policy if exists "profiles own read" on public.profiles;
drop policy if exists "profiles own insert" on public.profiles;
drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own read" on public.profiles for select using (auth.uid() = id);
create policy "profiles own insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles own update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "questions public read" on public.questions;
create policy "questions public read" on public.questions for select using (true);

drop policy if exists "progress own all" on public.question_progress;
create policy "progress own all" on public.question_progress for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "reactions own all" on public.question_reactions;
create policy "reactions own all" on public.question_reactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- New users automatically get a profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Optional: after importing questions.json into the questions table,
-- progress and reactions will be fully relational. The frontend also keeps
-- a local cache so the UI remains usable while offline.

-- Global reaction counts without exposing other users' reaction rows.
create or replace view public.question_reaction_counts as
select
  question_id,
  count(*) filter (where reaction = 'like')::int as likes,
  count(*) filter (where reaction = 'dislike')::int as dislikes
from public.question_reactions
group by question_id;

grant select on public.question_reaction_counts to anon, authenticated;
