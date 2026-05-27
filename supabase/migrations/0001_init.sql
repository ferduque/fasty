-- Fasty initial schema: documents, progress, paste_sessions + RLS.
-- Run this in the Supabase SQL Editor.

-- ============== DOCUMENTS ==============
-- Cloud rows hold extracted text + cover only. Original PDF/EPUB binaries stay
-- in the user's IndexedDB on the importing device.
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  title         text not null,
  source        text not null check (source in ('pdf','epub','url','txt')),
  origin        jsonb not null default '{}'::jsonb, -- { fileName?, url? }
  cover_path    text,                  -- relative path in the 'covers' storage bucket
  chapters      jsonb not null,        -- [{ title, text, startWordIndex }]
  word_to_page  integer[] not null,    -- client converts to/from Uint32Array
  total_pages   integer not null,
  total_words   integer not null,
  imported_at   timestamptz not null default now(),
  last_read_at  timestamptz not null default now()
);
create index if not exists documents_user_idx
  on public.documents(user_id, last_read_at desc);

-- ============== PROGRESS ==============
create table if not exists public.progress (
  document_id           uuid primary key references public.documents on delete cascade,
  user_id               uuid not null references auth.users on delete cascade,
  current_chapter_index integer not null default 0,
  current_word_index    integer not null default 0,
  updated_at            timestamptz not null default now()
);
create index if not exists progress_user_idx on public.progress(user_id);

-- ============== PASTE SESSIONS ==============
create table if not exists public.paste_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  title         text not null,
  body          text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);
create index if not exists paste_sessions_user_idx
  on public.paste_sessions(user_id, last_used_at desc);

-- ============== RLS ==============
alter table public.documents       enable row level security;
alter table public.progress        enable row level security;
alter table public.paste_sessions  enable row level security;

drop policy if exists "owner full access docs" on public.documents;
drop policy if exists "owner full access progress" on public.progress;
drop policy if exists "owner full access sessions" on public.paste_sessions;

create policy "owner full access docs"     on public.documents
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner full access progress" on public.progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner full access sessions" on public.paste_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
