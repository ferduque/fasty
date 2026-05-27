-- Per-user soft caps so a public sign-up flow can't blow up free-tier storage.
-- Run after 0001_init.sql.

-- 200 documents per user
create or replace function public.enforce_doc_limit() returns trigger as $$
begin
  if (select count(*) from public.documents where user_id = new.user_id) >= 200 then
    raise exception 'Document limit reached (200). Delete some to add more.';
  end if;
  return new;
end; $$ language plpgsql;

drop trigger if exists doc_limit on public.documents;
create trigger doc_limit before insert on public.documents
  for each row execute function public.enforce_doc_limit();

-- 500 paste sessions per user
create or replace function public.enforce_session_limit() returns trigger as $$
begin
  if (select count(*) from public.paste_sessions where user_id = new.user_id) >= 500 then
    raise exception 'Paste session limit reached (500). Delete some to add more.';
  end if;
  return new;
end; $$ language plpgsql;

drop trigger if exists session_limit on public.paste_sessions;
create trigger session_limit before insert on public.paste_sessions
  for each row execute function public.enforce_session_limit();
