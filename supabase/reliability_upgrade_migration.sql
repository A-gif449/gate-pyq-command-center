begin;

-- Safe additive repair migration for an already-running deployment.
alter table public.profiles add column if not exists verified boolean not null default false;

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
create unique index if not exists notifications_user_dedupe_key on public.notifications(user_id, dedupe_key) where dedupe_key is not null;
create index if not exists notifications_user_created_at on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "firebase notifications own all" on public.notifications;
create policy "firebase notifications own all" on public.notifications for all to anon, authenticated
using ((auth.jwt()->>'sub') = user_id) with check ((auth.jwt()->>'sub') = user_id);
grant select, insert, update, delete on public.notifications to anon, authenticated;


drop policy if exists "firebase profiles own read" on public.profiles;
drop policy if exists "firebase profiles public read" on public.profiles;
create policy "firebase profiles public read" on public.profiles
for select to anon, authenticated using (true);

grant select (id, display_name, avatar_url, verified) on public.profiles to anon, authenticated;

create table if not exists public.question_comments (
  id uuid primary key default gen_random_uuid(),
  question_id text not null references public.questions(id) on delete cascade,
  user_id text not null,
  author_name text not null,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists question_comments_question_created_idx on public.question_comments(question_id, created_at desc);
alter table public.question_comments enable row level security;
drop policy if exists "public comments read" on public.question_comments;
create policy "public comments read" on public.question_comments for select to anon, authenticated using (true);
drop policy if exists "firebase comments insert own" on public.question_comments;
create policy "firebase comments insert own" on public.question_comments for insert to anon, authenticated with check ((auth.jwt()->>'sub') = user_id);
drop policy if exists "firebase comments update own" on public.question_comments;
create policy "firebase comments update own" on public.question_comments for update to anon, authenticated using ((auth.jwt()->>'sub') = user_id) with check ((auth.jwt()->>'sub') = user_id);
drop policy if exists "firebase comments delete own" on public.question_comments;
create policy "firebase comments delete own" on public.question_comments for delete to anon, authenticated using ((auth.jwt()->>'sub') = user_id);
grant select, insert, update, delete on public.question_comments to anon, authenticated;

create or replace function public.set_question_reaction(
  p_question_id text,
  p_reaction text
)
returns table (question_id text, likes int, dislikes int, my_reaction text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id text := auth.jwt()->>'sub';
begin
  if v_user_id is null or v_user_id = '' then
    raise exception 'Not authenticated';
  end if;
  if p_reaction is null or p_reaction = '' then
    delete from public.question_reactions qr
    where qr.user_id = v_user_id and qr.question_id = p_question_id;
  elsif p_reaction in ('like','dislike') then
    insert into public.question_reactions(user_id, question_id, reaction)
    values (v_user_id, p_question_id, p_reaction)
    on conflict (user_id, question_id) do update set reaction = excluded.reaction;
  else
    raise exception 'Invalid reaction';
  end if;
  return query
  select p_question_id,
    count(*) filter (where qr.reaction = 'like')::int,
    count(*) filter (where qr.reaction = 'dislike')::int,
    (select mine.reaction from public.question_reactions mine where mine.user_id = v_user_id and mine.question_id = p_question_id)
  from public.question_reactions qr
  where qr.question_id = p_question_id;
end;
$$;

grant execute on function public.set_question_reaction(text,text) to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
commit;
