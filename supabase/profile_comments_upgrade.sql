begin;

alter table public.profiles add column if not exists verified boolean not null default false;

-- Publicly readable profile presentation fields only. No email or private account data is exposed here.
drop policy if exists "firebase profiles own read" on public.profiles;
drop policy if exists "firebase profiles public read" on public.profiles;
create policy "firebase profiles public read" on public.profiles for select to anon, authenticated using (true);

grant select (id, display_name, avatar_url, verified) on public.profiles to anon, authenticated;

-- Keep comment editing/deleting restricted to the comment owner.
drop policy if exists "firebase comments update own" on public.question_comments;
create policy "firebase comments update own" on public.question_comments for update to anon, authenticated
using ((auth.jwt()->>'sub') = user_id)
with check ((auth.jwt()->>'sub') = user_id);
drop policy if exists "firebase comments delete own" on public.question_comments;
create policy "firebase comments delete own" on public.question_comments for delete to anon, authenticated
using ((auth.jwt()->>'sub') = user_id);

commit;
