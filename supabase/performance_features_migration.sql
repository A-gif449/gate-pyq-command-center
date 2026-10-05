-- GATE PYQ Command Center: consolidated performance/features migration.
-- Safe to run on an existing database. It is additive and does not delete user progress.
-- Run after the base Firebase/question schema exists.
begin;

-- Profile presentation / verification.
alter table if exists public.profiles add column if not exists verified boolean not null default false;

-- User confidence.
create table if not exists public.question_confidence (
  user_id text not null,
  question_id text not null references public.questions(id) on delete cascade,
  confidence text not null check (confidence in ('guess','unsure','confident')),
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index if not exists question_confidence_user_updated_idx on public.question_confidence(user_id, updated_at desc);
alter table public.question_confidence enable row level security;
drop policy if exists "firebase confidence own all" on public.question_confidence;
create policy "firebase confidence own all" on public.question_confidence for all to anon, authenticated
using ((auth.jwt()->>'sub') = user_id) with check ((auth.jwt()->>'sub') = user_id);
grant select, insert, update, delete on public.question_confidence to anon, authenticated;

-- Study goals.
create table if not exists public.study_goals (
  user_id text primary key,
  goal_type text not null default 'AIR < 1000',
  goal_value integer not null default 1000 check (goal_value >= 0),
  updated_at timestamptz not null default now()
);
alter table public.study_goals enable row level security;
drop policy if exists "firebase goals own all" on public.study_goals;
create policy "firebase goals own all" on public.study_goals for all to anon, authenticated
using ((auth.jwt()->>'sub') = user_id) with check ((auth.jwt()->>'sub') = user_id);
grant select, insert, update, delete on public.study_goals to anon, authenticated;

-- Public profile presentation fields used by comments/leaderboard.
alter table if exists public.profiles enable row level security;
drop policy if exists "firebase profiles public read" on public.profiles;
create policy "firebase profiles public read" on public.profiles for select to anon, authenticated using (true);
grant select (id, display_name, avatar_url, verified) on public.profiles to anon, authenticated;

-- Public aggregate leaderboard. No Firebase UID is exposed by the view.
drop view if exists public.leaderboard_public;
create view public.leaderboard_public as
with base as (
  select
    p.id,
    coalesce(nullif(trim(p.display_name), ''), 'GATE learner') as display_name,
    count(*) filter (where qp.status = 'solved')::int as solved_count,
    count(*) filter (where qp.status in ('solved','wrong'))::int as accuracy_base
  from public.profiles p
  left join public.question_progress qp on qp.user_id = p.id
  group by p.id, p.display_name
), dates as (
  select user_id, date(updated_at) as study_day
  from public.question_progress
  where updated_at is not null
  group by user_id, date(updated_at)
), numbered as (
  select user_id, study_day, row_number() over (partition by user_id order by study_day desc) as rn
  from dates
), groups as (
  select user_id, study_day, study_day - (rn::int * interval '1 day') as grp
  from numbered
), streaks as (
  select g.user_id, count(*)::int as streak
  from groups g
  join (select user_id, max(study_day) as max_day from dates group by user_id) m on m.user_id = g.user_id
  where g.grp = (select grp from groups x where x.user_id = g.user_id and x.study_day = m.max_day limit 1)
    and m.max_day >= current_date - 1
  group by g.user_id
)
select
  b.display_name,
  b.solved_count,
  case when b.accuracy_base > 0 then round((b.solved_count::numeric / b.accuracy_base::numeric) * 100)::int else 0 end as accuracy,
  coalesce(s.streak, 0) as streak
from base b
left join streaks s on s.user_id = b.id
where b.solved_count > 0
order by b.solved_count desc, accuracy desc
limit 100;
grant select on public.leaderboard_public to anon, authenticated;

notify pgrst, 'reload schema';
commit;
