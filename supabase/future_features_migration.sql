-- Future feature foundation for GATE PYQ Command Center.
-- Run after firebase_migration.sql. All user-owned rows are protected by Firebase JWT subject.

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

create index if not exists question_confidence_user_updated_idx
  on public.question_confidence(user_id, updated_at desc);

alter table public.question_confidence enable row level security;
alter table public.study_goals enable row level security;

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

grant select, insert, update, delete on public.question_confidence to anon, authenticated;
grant select, insert, update, delete on public.study_goals to anon, authenticated;

commit;
