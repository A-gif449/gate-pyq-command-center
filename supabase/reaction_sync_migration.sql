begin;

create or replace function public.set_question_reaction(
  p_question_id text,
  p_reaction text
)
returns table (
  question_id text,
  likes int,
  dislikes int,
  my_reaction text
)
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
    delete from public.question_reactions
    where user_id = v_user_id and question_id = p_question_id;
  elsif p_reaction in ('like','dislike') then
    insert into public.question_reactions(user_id, question_id, reaction)
    values (v_user_id, p_question_id, p_reaction)
    on conflict (user_id, question_id)
    do update set reaction = excluded.reaction;
  else
    raise exception 'Invalid reaction: %', p_reaction;
  end if;

  return query
  select
    p_question_id,
    count(*) filter (where reaction = 'like')::int,
    count(*) filter (where reaction = 'dislike')::int,
    (select qr.reaction from public.question_reactions qr
      where qr.user_id = v_user_id and qr.question_id = p_question_id)
  from public.question_reactions qr
  where qr.question_id = p_question_id;
end;
$$;

grant execute on function public.set_question_reaction(text,text) to anon, authenticated;

commit;
