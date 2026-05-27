create or replace function public.record_reading_session(
  p_words_read       integer,
  p_wpm              integer,
  p_duration_seconds integer,
  p_document_id      uuid default null,
  p_paste_session_id uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Silently drop accidental / micro sessions
  if p_words_read < 20 or p_duration_seconds < 10 then return; end if;
  if p_wpm < 50 or p_wpm > 2000 then return; end if;
  insert into public.reading_sessions
    (user_id, document_id, paste_session_id, words_read, wpm, duration_seconds)
  values
    (auth.uid(), p_document_id, p_paste_session_id, p_words_read, p_wpm, p_duration_seconds);
end; $$;

revoke all on function public.record_reading_session(integer,integer,integer,uuid,uuid) from public, anon;
grant execute on function public.record_reading_session(integer,integer,integer,uuid,uuid) to authenticated;
