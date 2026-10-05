-- Public aggregate leaderboard for the GATE PYQ Command Center.
-- Run after firebase_migration.sql and after question_progress exists.
-- It exposes only display name + aggregate study metrics, never Firebase UID.

begin;

drop view if exists public.leaderboard_public;

create view public.leaderboard_public as
with base as (
  select
    p.id,
    coalesce(nullif(trim(p.display_name), ''), 'GATE learner') as display_name,
    count(*) filter (where qp.status = 'solved')::int as solved_count,
    count(*) filter (where qp.status in ('solved','wrong'))::int as accuracy_base,
    count(*) filter (where qp.status = 'wrong')::int as wrong_count
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

commit;
