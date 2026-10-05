begin;

create table if not exists public.question_comments (
  id uuid primary key default gen_random_uuid(),
  question_id text not null references public.questions(id) on delete cascade,
  user_id text not null,
  author_name text not null,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists question_comments_question_created_idx
  on public.question_comments(question_id, created_at desc);

alter table public.question_comments enable row level security;

drop policy if exists "public comments read" on public.question_comments;
create policy "public comments read"
  on public.question_comments for select
  to anon, authenticated
  using (true);

drop policy if exists "firebase comments insert own" on public.question_comments;
create policy "firebase comments insert own"
  on public.question_comments for insert
  to anon, authenticated
  with check ((auth.jwt()->>'sub') = user_id);

drop policy if exists "firebase comments update own" on public.question_comments;
create policy "firebase comments update own"
  on public.question_comments for update
  to anon, authenticated
  using ((auth.jwt()->>'sub') = user_id)
  with check ((auth.jwt()->>'sub') = user_id);

drop policy if exists "firebase comments delete own" on public.question_comments;
create policy "firebase comments delete own"
  on public.question_comments for delete
  to anon, authenticated
  using ((auth.jwt()->>'sub') = user_id);

grant select on public.question_comments to anon, authenticated;
grant insert, update, delete on public.question_comments to anon, authenticated;

grant usage, select on sequence public.question_comments_id_seq to anon, authenticated;

commit;
