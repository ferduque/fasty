create or replace function public.enforce_doc_limit() returns trigger
language plpgsql set search_path = '' as $$
declare
  user_tier text;
  max_docs  integer;
begin
  select coalesce((select tier from public.profiles where user_id = new.user_id), 'free') into user_tier;
  max_docs := case user_tier when 'pro' then 20 else 4 end;
  if (select count(*) from public.documents where user_id = new.user_id) >= max_docs then
    raise exception 'Document limit reached (% of %). Delete one or upgrade to Pro.', max_docs, max_docs;
  end if;
  return new;
end; $$;

create or replace function public.enforce_session_limit() returns trigger
language plpgsql set search_path = '' as $$
declare
  user_tier text;
  max_sess  integer;
begin
  select coalesce((select tier from public.profiles where user_id = new.user_id), 'free') into user_tier;
  max_sess := case user_tier when 'pro' then 300 else 8 end;
  if (select count(*) from public.paste_sessions where user_id = new.user_id) >= max_sess then
    raise exception 'Paste session limit reached (% of %). Delete one or upgrade to Pro.', max_sess, max_sess;
  end if;
  return new;
end; $$;
