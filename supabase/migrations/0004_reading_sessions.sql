create table public.reading_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade,
  document_id       uuid references public.documents on delete set null,
  paste_session_id  uuid references public.paste_sessions on delete set null,
  words_read        integer not null check (words_read > 0),
  wpm               integer not null check (wpm between 50 and 2000),
  duration_seconds  integer not null check (duration_seconds > 0),
  started_at        timestamptz not null default now()
);
create index reading_sessions_user_started_idx on public.reading_sessions(user_id, started_at desc);
create index reading_sessions_started_idx       on public.reading_sessions(started_at desc);

alter table public.reading_sessions enable row level security;

create policy "reading_sessions owner insert" on public.reading_sessions
  for insert with check (user_id = auth.uid());
create policy "reading_sessions owner read" on public.reading_sessions
  for select using (user_id = auth.uid());
