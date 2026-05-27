# Fasty — Supabase backend for users, library & paste-sessions sync

## Context

Fasty currently runs as a pure static site with all data in **IndexedDB**: imported documents (text + cover + original binary), reading progress, and paste sessions. That means everything is locked to one device/browser. To make the app scalable and shareable, we add **Supabase** for:

- Public sign-up with auth (email/password + Google OAuth)
- Per-user **cloud library** (extracted text + chapters + cover only)
- Per-user **paste sessions** (the ChatGPT-style history)
- Per-user **reading progress** sync (resume the same book on a different device)
- One-time migration of existing local data → cloud on first sign-in

**Out of scope (decided up front):**

- **DJVU is dropped.** It's a separate format, only helps for scanned PDFs, breaks for EPUB/MOBI, needs server-side conversion (DjVuLibre), has no native iOS support, and `djvu.js` is far less mature than PDF.js. Storage savings on born-digital PDFs are marginal. We get a much bigger win by **storing extracted text + cover only** in Supabase and keeping the original PDF/EPUB binary in IndexedDB on the importing device.
- **Original PDF/EPUB binaries do NOT go to the cloud.** They stay local. The cloud row references the doc by `id`; if a user opens it on a new device, Faithful view will be unavailable for that doc unless they re-import the file — but RSVP + fasty (selection mode) work fully from cloud text alone.

## Architecture overview

```
        ┌────────────────────────────────────────┐
        │   Browser (static site, no build)      │
        │                                        │
        │  IndexedDB (cache + local binaries)    │
        │      ▲                                 │
        │      │ existing API: storage.js        │
        │      ▼                                 │
        │  cloud.js  ── Supabase JS SDK ─────►   │
        │      │      auth + REST + Storage      │
        └──────┼─────────────────────────────────┘
               │
               ▼
        ┌────────────────────────────────────────┐
        │   Supabase project                     │
        │   ├── auth.users (built-in)            │
        │   ├── public.documents (text only)     │
        │   ├── public.progress                  │
        │   ├── public.paste_sessions            │
        │   └── Storage bucket: covers/{uid}/…   │
        └────────────────────────────────────────┘
```

**Local-first, cloud-when-signed-in.** Anonymous users keep working exactly as today (IndexedDB only). Signing in turns on dual-write + sync: every save goes to IndexedDB first (instant UI), then mirrors to Supabase in the background. On sign-in, a one-time migration pushes existing local docs/sessions up. On other devices, the user signs in and gets the same library back.

---

## 1. Supabase project setup (Codex executes)

### 1.1 Create project

1. Sign in to https://supabase.com, click **New project**.
2. Region: closest to user (e.g. `us-east-1`).
3. Save the project URL (e.g. `https://abcd.supabase.co`) and the **anon public key** (under Settings → API). These go in `src/config.js` (see §3).

### 1.2 Run SQL migration

In **SQL Editor**, run this file (Codex creates `supabase/migrations/0001_init.sql`):

```sql
-- ============== DOCUMENTS ==============
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  title         text not null,
  source        text not null check (source in ('pdf','epub','url','txt')),
  origin        jsonb not null default '{}'::jsonb, -- { fileName?, url? }
  cover_path    text,                  -- relative path in 'covers' bucket
  chapters      jsonb not null,        -- [{title,text,startWordIndex}]
  word_to_page  integer[] not null,    -- ints, client converts to/from Uint32Array
  total_pages   integer not null,
  total_words   integer not null,
  imported_at   timestamptz not null default now(),
  last_read_at  timestamptz not null default now()
);
create index documents_user_idx on public.documents(user_id, last_read_at desc);

-- ============== PROGRESS ==============
create table public.progress (
  document_id           uuid primary key references public.documents on delete cascade,
  user_id               uuid not null references auth.users on delete cascade,
  current_chapter_index integer not null default 0,
  current_word_index    integer not null default 0,
  updated_at            timestamptz not null default now()
);
create index progress_user_idx on public.progress(user_id);

-- ============== PASTE SESSIONS ==============
create table public.paste_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  title         text not null,
  body          text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);
create index paste_sessions_user_idx on public.paste_sessions(user_id, last_used_at desc);

-- ============== RLS ==============
alter table public.documents       enable row level security;
alter table public.progress        enable row level security;
alter table public.paste_sessions  enable row level security;

create policy "owner full access docs"     on public.documents      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner full access progress" on public.progress       for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner full access sessions" on public.paste_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

### 1.3 Storage bucket for covers

In **Storage → Create bucket**:

- Name: `covers`
- Public: **NO** (we generate signed URLs)
- File size limit: 200 KB
- Allowed MIME types: `image/jpeg, image/png`

Then add policies in **Storage → Policies → covers**:

```sql
-- Users can read/write only their own folder (covers/{auth.uid()}/…)
create policy "covers owner read" on storage.objects
  for select using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "covers owner write" on storage.objects
  for insert with check (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "covers owner delete" on storage.objects
  for delete using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

### 1.4 Auth configuration

**Auth → Providers**:

- **Email**: enable. Set `Confirm email` ON for public sign-ups (free tier abuse mitigation).
- **Google**: enable. Add OAuth client ID/secret from Google Cloud Console; redirect URL is given by Supabase.

**Auth → URL Configuration**:

- Site URL: `https://fasty.app` (or wherever it'll be hosted; for local dev add `http://localhost:8080`).

### 1.5 Per-user quotas (abuse defense for public sign-up)

In SQL editor:

```sql
-- Soft cap: 200 docs and 500 paste sessions per user, enforced by trigger.
create or replace function enforce_doc_limit() returns trigger as $$
begin
  if (select count(*) from public.documents where user_id = new.user_id) >= 200 then
    raise exception 'Document limit reached (200). Delete some to add more.';
  end if;
  return new;
end; $$ language plpgsql;
create trigger doc_limit before insert on public.documents
  for each row execute function enforce_doc_limit();

create or replace function enforce_session_limit() returns trigger as $$
begin
  if (select count(*) from public.paste_sessions where user_id = new.user_id) >= 500 then
    raise exception 'Paste session limit reached (500). Delete some to add more.';
  end if;
  return new;
end; $$ language plpgsql;
create trigger session_limit before insert on public.paste_sessions
  for each row execute function enforce_session_limit();
```

---

## 2. Client-side architecture

**No build step**. Keep the static-site approach. Supabase JS SDK is loaded via ESM CDN:

```js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
```

### File-level changes

| File | Change |
|---|---|
| `src/config.js` | **New.** Exports `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Listed in `.gitignore`; ship a `src/config.example.js` for new clones. |
| `src/cloud.js` | **New.** Wraps the Supabase client: auth helpers (`signIn`, `signUp`, `signOut`, `currentUser`, `onAuthChange`), CRUD (`cloudListDocs/cloudGetDoc/cloudSaveDoc/cloudDeleteDoc`, `cloudListSessions/cloudSaveSession/cloudDeleteSession`, `cloudSaveProgress/cloudGetProgress`), and `uploadCover(docId, blob)` / `signedCoverUrl(path)` helpers. |
| `src/storage.js` | **Modify.** Each existing export stays IDB-write-first. After IDB succeeds, if `cloud.currentUser()` exists, mirror the write to Supabase via `cloud.js` (fire-and-forget; surface errors via toast). On `listDocuments()` and `listPasteSessions()`, when signed in: fetch cloud rows, upsert into IDB if newer (by `updated_at`/`last_used_at`), return merged. This keeps the public API of `storage.js` unchanged — callers stay identical. |
| `src/auth-ui.js` | **New.** Renders an account button in the sidebar bottom and an auth modal (email/password + Google). Reuses existing `.modal-backdrop` styles. |
| `src/migration.js` | **New.** `migrateLocalToCloud()`: iterates IndexedDB docs and paste-sessions, calls `cloudSaveDoc`/`cloudSaveSession` for each. Idempotent (uses the local UUID as the cloud `id`, so re-running won't duplicate). Called once on first auth event per device, gated by `localStorage.fasty.migratedAt`. |
| `index.html` | **Modify.** Add: a small auth area in `.sidebar-footer` (signed-out: "Sign in" button → opens auth modal; signed-in: user email + sign-out menu). Add markup for the auth modal. |
| `styles.css` | **Modify.** Styles for the auth area and modal forms — small additions; reuse existing `.modal-*`, `.btn-primary`, `.btn-ghost`. |
| `app.js` | **Modify.** On boot, call `cloud.init()` and `cloud.onAuthChange(handler)`. The handler triggers `migrateLocalToCloud()` on first sign-in for a given device, then `library.refresh()` + `pasteSessions.refresh()` so the sidebar repopulates from cloud. On sign-out, clear in-memory state but keep IDB. |

### Shape conversions (already mapped in the data audit)

- `Uint32Array wordToPage` ↔ Postgres `integer[]`: convert via `Array.from(uint)` outgoing, `new Uint32Array(arr)` incoming.
- **Cover Blob**: upload to Storage at `covers/{user_id}/{doc_id}.jpg` via `supabase.storage.from('covers').upload(...)`. Save the resulting `path` in `documents.cover_path`. On read, call `createSignedUrl(path, 3600)` to render `<img src>`.
- **Binary Blob (PDF/EPUB)**: never sent to cloud. Stays in IndexedDB only.
- **Field name mapping** (snake_case in DB ↔ camelCase in client) lives in `cloud.js` adapters: `toCloud(doc)` and `fromCloud(row)` — single point of truth.

### Sync model (precise)

- **Write path (signed in):** IDB write → resolve UI → enqueue cloud write. If cloud write fails, retry once after 5s, then surface a toast and leave the local change in place (it'll re-sync on next list).
- **Read path (signed in):** IDB read first (instant). In parallel, fetch cloud list; for each cloud row newer than local, upsert into IDB; emit a `library:changed` event so the sidebar re-renders. This is the "eventually consistent" pattern — fast UI, self-healing data.
- **Progress autosave** stays at 5s on play + on pause + on `beforeunload`. Cloud write is throttled to once every 10s to keep request count down.
- **Anonymous users:** none of the cloud paths run. Same behavior as today.
- **Sign-out:** keep IDB intact so the user can still read offline. Next sign-in re-merges.

---

## 3. Local config & secrets

Create `src/config.js` (gitignored). Codex generates the file with values from Supabase. Commit `src/config.example.js`:

```js
// src/config.example.js — copy to src/config.js and fill in.
export const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

The anon key is intended to be public. RLS in §1.2 keeps user data isolated. No service-role key ever ships to the client.

Add to `.gitignore`:

```
src/config.js
```

---

## 4. Migration of existing local data

`src/migration.js`:

1. Reads `localStorage.fasty.migratedAt`. If present, return immediately.
2. Calls `listDocuments()` and `listPasteSessions()` from `storage.js` (IDB-only path).
3. For each local doc: fetches its full record via `getDocument()`, calls `cloudSaveDoc()` (uploads cover, inserts/upserts row). Skips the `binary` field — that stays in IDB.
4. For each local paste session: `cloudSaveSession()`.
5. For each progress row: `cloudSaveProgress()`.
6. On success: `localStorage.setItem('fasty.migratedAt', Date.now())`.
7. Toast: "Synced N documents and M paste sessions to your account."
8. Errors during a single row don't abort the batch — they get logged and surfaced as a single summary toast at the end.

Migration is **idempotent**: cloud writes use the local UUID as the cloud `id`, so re-running merges instead of duplicating.

---

## 5. Existing utilities to reuse (don't rewrite)

- **`src/storage.js` public API**: keep the function signatures (`listDocuments`, `saveDocument`, `getDocument`, `deleteDocument`, `getProgress`, `saveProgress`, `listPasteSessions`, `savePasteSession`, `getPasteSession`, `deletePasteSession`, `deriveSessionTitle`). Just add the cloud-mirror behavior inside; callers stay unchanged.
- **`src/library.js`** and **`src/paste-sessions.js`**: already listen to "refresh" calls. They just need to be re-rendered after auth events — wire `cloud.onAuthChange(() => { library.refresh(); pasteSessions.refresh(); })`.
- **`src/toasts.js`**: use it for all auth + sync errors. No new notification system needed.
- **`src/parsers/cover-tile.js`**: keep using the generated tile fallback when no real cover exists.
- **`onDocumentImported`** hook in `src/import-modal.js`: piggyback to trigger cloud sync of the just-imported doc.

---

## 6. Verification (end-to-end)

After Codex finishes:

1. **Anonymous flow unchanged**: hard-reload the app while signed out → existing IDB docs/sessions still appear in the sidebar; can import, read, fasty, back-to-page exactly as before.
2. **Sign up + migration**: click "Sign in" → "Create account" → email/password → confirm email → on return, watch toast "Synced N documents and M paste sessions". Open Supabase **Table Editor** → `documents` has N rows under your user_id with `cover_path` set. Storage → `covers/{your_uid}/` has the JPEGs.
3. **Cross-device read**: open the app in a different browser/profile → sign in with the same account → library + paste sessions appear → click a doc → Faithful is unavailable (no local binary) but RSVP / fasty still works from cloud text.
4. **Progress sync**: read 200 words on device A → wait 10s → open same doc on device B → it resumes at the right word.
5. **Delete propagation**: delete a doc on device A → 5s later device B's sidebar drops it on next refresh / page reload.
6. **Quota**: insert 201 docs via SQL → next import on the client surfaces the trigger's error toast.
7. **RLS check**: in Supabase SQL editor, run `select * from documents;` while signed in as user A → only A's rows return.
8. **Offline**: airplane mode → app still works against IDB; reconnect → pending writes flush.
9. **Sign-out**: data stays in IDB; sidebar still populated; re-sign-in re-merges without dupes.

---

## 7. Things explicitly NOT in this plan

- **DJVU conversion / different file formats** — see Context.
- **iOS app integration** — same data model will translate cleanly when the iOS rewrite ships; iOS will use the same Supabase project via the native Swift SDK.
- **Sharing / collaboration** — single-user accounts only. No "shared library" feature yet.
- **Payments / premium tiers** — quotas in §1.5 are flat for v1; revisit when we hit them.
- **Search / full-text** — Postgres `tsvector` is straightforward later but isn't needed for v1.
