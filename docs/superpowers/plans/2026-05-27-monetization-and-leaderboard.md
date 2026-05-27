# Monetization (Free / Pro tiers) + Reading Leaderboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mandatory sign-in, Free/Pro tier gating with per-tier caps, a public 30-day reading leaderboard (country + global), and a waitlist landing page for the upcoming Pro purchase. Payments themselves are deferred — Pro is granted by flipping `profiles.tier = 'pro'` in SQL.

**Architecture:** All schema changes go to Supabase via the `mcp__supabase__apply_migration` tool (live remote project, no local stack). Client stays the same no-build vanilla-JS static site. A new `src/tiers.js` module caches the current user's tier and caps; every gated path reads from it. The leaderboard reads a `leaderboard_30d` materialized view refreshed hourly. Reading sessions are recorded server-side via an RPC.

**Tech Stack:** Vanilla ES modules, Supabase Postgres + Auth + Storage, `@supabase/supabase-js` 2.45 from esm.sh, IndexedDB cache via the existing `src/storage.js` facade, Supabase `pg_cron` extension for the hourly materialized-view refresh.

**Reference spec:** `docs/superpowers/specs/2026-05-27-monetization-and-leaderboard-design.md` — read it first.

---

## File map

### New files
```
supabase/migrations/
├── 0003_profiles.sql                  profiles table + protected-column trigger + signup hook
├── 0004_reading_sessions.sql          reading_sessions table + RLS
├── 0005_leaderboard_view.sql          leaderboard_30d materialized view + grants
├── 0006_tier_aware_caps.sql           updated enforce_doc_limit + enforce_session_limit
├── 0007_use_url_import_rpc.sql        per-user monthly URL counter RPC
├── 0008_record_reading_session_rpc.sql server-side validation + insert helper
├── 0009_waitlist.sql                  email capture for the "Notify me at launch" button
└── 0010_leaderboard_cron.sql          pg_cron job to refresh the view hourly

src/
├── tiers.js              load + cache the user's tier + caps; expose getTier(), getCaps(), onTierChange()
├── onboarding.js         first-time-sign-in modal: display name + country + opt-in
├── leaderboard.js        full-page overlay: Country + Global tabs, top-N rows
├── upgrade-ui.js         "Upgrade to Pro" page + waitlist email capture
└── timezone-country.js   hand-rolled IANA-TZ → ISO-3166-1-alpha-2 map (~50 lines)
```

### Modified files
- `src/cloud.js` — new exports: `getProfile`, `updateProfile`, `useUrlImport`, `recordReadingSession`, `loadLeaderboard`, `joinWaitlist`. Adapters for snake_case ↔ camelCase.
- `src/auth-ui.js` — auth modal becomes non-dismissible when no user; after sign-in, if `profile.display_name is null` show the onboarding modal.
- `src/storage.js` — cloud-mirror helper `mirror()` only fires when `tiers.getTier() === 'pro'`. `pullCloudIntoLocal()` and `migrateLocalToCloudIfNeeded()` likewise gated.
- `src/import-modal.js` — before `parseUrl()`, call `useUrlImport()`. If denied, surface upgrade toast.
- `src/library.js` — "X / cap" badge next to the section header; over-cap shows an inline "Upgrade to Pro" CTA card; library row click no longer auto-plays.
- `src/paste-sessions.js` — same badge + CTA.
- `app.js` — boot gates on auth; WPM `<select>` is rebuilt from `tiers.getCaps().maxWpm`; new `_recordReadingBout()` called from `pause()` / `closeCurrentDoc()` / `_advancePageRead()` / `beforeunload`.
- `index.html` — sidebar gets a 🏆 **Leaderboard** entry; sidebar footer gets the **Upgrade to Pro** CTA (hidden for Pro users); new overlays for onboarding / leaderboard / upgrade.
- `styles.css` — onboarding modal, leaderboard table, cap badges, upgrade CTA.

### Reuse (do NOT rewrite)
- `src/toasts.js` — every error / quota surface goes through `toast(...)`.
- `src/cloud.js` existing helpers (`signIn`, `signUp`, `signOut`, `currentUser`, `onAuthChange`, `signedCoverUrl`) — already there; we extend with new methods.
- `src/migration.js` — flip the no-op guard from `currentUser()` to `tier === 'pro'`.
- `src/library.js` + `src/paste-sessions.js` rendering — reuse the existing list rendering, add only the badge.

---

## Conventions

- **Schema changes go through the Supabase MCP** (`mcp__supabase__apply_migration` with snake-case names). Each migration is also saved to `supabase/migrations/<file>.sql` as a record so the repo carries the same SQL.
- **No automated tests** (the project has none; matches the previous feature). Each task ends with a verification step against the running app at `http://localhost:8080` and / or Supabase MCP queries.
- **Cache buster**: bump `?v=N` on `styles.css` / `app.js` in `index.html` whenever those files change.
- **Commits**: small, one per task, conventional voice ("Add X", "Fix Y"). Co-Authored-By line is added automatically by the harness when committing.
- **Don't break anonymous mode mid-plan.** Sign-in becomes mandatory in Task 12; until then the app must keep working for not-signed-in users so we can verify intermediate tasks.
- **Pro = SQL toggle**: to test Pro behavior, run `update public.profiles set tier='pro' where user_id = '<your_user_id>';` against the project.

---

## Task list

The plan starts with all database work (so the client tasks have something to talk to), then builds the client foundation (tiers cache + auth gate + onboarding), then layers per-tier enforcement, then the leaderboard + upgrade CTA, finishing with an end-to-end sweep.

---

### Task 1: `profiles` schema + per-user signup hook

**Files:**
- Create: `supabase/migrations/0003_profiles.sql`
- Apply via: `mcp__supabase__apply_migration` (name: `profiles_table_signup_hook_lock_trigger`)

**Why:** Every other gate reads from this table.

- [ ] **Step 1: Apply the migration via MCP**

```sql
-- profiles: one row per auth.users row.
create table public.profiles (
  user_id                 uuid primary key references auth.users on delete cascade,
  tier                    text not null default 'free' check (tier in ('free','pro')),
  display_name            text,
  country_code            text,
  leaderboard_optin       boolean not null default true,
  url_imports_used        integer not null default 0,
  url_imports_month_start date not null default date_trunc('month', now())::date,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles owner read" on public.profiles
  for select using (user_id = auth.uid());

create policy "profiles owner update" on public.profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Lock protected columns (tier + counters + created_at) against client updates.
create or replace function public.lock_profile_protected_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'service_role' then return new; end if;
  new.tier := old.tier;
  new.url_imports_used := old.url_imports_used;
  new.url_imports_month_start := old.url_imports_month_start;
  new.created_at := old.created_at;
  return new;
end; $$;

drop trigger if exists lock_profile_protected on public.profiles;
create trigger lock_profile_protected
  before update on public.profiles
  for each row execute function public.lock_profile_protected_columns();

-- Auto-create a profile row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 2: Save the same SQL to `supabase/migrations/0003_profiles.sql`** so the repo carries it.

- [ ] **Step 3: Verify in the dashboard / via MCP**

Use `mcp__supabase__list_tables({schemas:["public"], verbose:false})` — `public.profiles` should appear with RLS enabled. Run:

```sql
select count(*) from public.profiles;  -- should equal current auth.users count
```

(For users created before this trigger existed, run a backfill once: `insert into public.profiles(user_id) select id from auth.users on conflict do nothing;`.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0003_profiles.sql
git commit -m "Add profiles table, signup hook, and lock trigger"
```

---

### Task 2: `reading_sessions` schema

**Files:**
- Create: `supabase/migrations/0004_reading_sessions.sql`
- Apply via: `mcp__supabase__apply_migration` (name: `reading_sessions_table`)

- [ ] **Step 1: Apply the migration**

```sql
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
```

- [ ] **Step 2:** Save to `supabase/migrations/0004_reading_sessions.sql`.

- [ ] **Step 3:** Verify with `mcp__supabase__list_tables` — table exists, RLS on, 2 indexes.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0004_reading_sessions.sql
git commit -m "Add reading_sessions table"
```

---

### Task 3: `leaderboard_30d` materialized view

**Files:**
- Create: `supabase/migrations/0005_leaderboard_view.sql`
- Apply via: `mcp__supabase__apply_migration` (name: `leaderboard_30d_view`)

- [ ] **Step 1: Apply the migration**

```sql
create materialized view public.leaderboard_30d as
select
  p.user_id,
  coalesce(p.display_name, 'Anonymous reader')                        as display_name,
  p.country_code,
  round(avg(rs.wpm))::integer                                          as avg_wpm,
  sum(rs.words_read)                                                    as total_words,
  count(distinct coalesce(rs.document_id::text, rs.paste_session_id::text))
                                                                       as items_read
from public.profiles p
join public.reading_sessions rs on rs.user_id = p.user_id
where p.leaderboard_optin = true
  and rs.started_at > now() - interval '30 days'
group by p.user_id, p.display_name, p.country_code
having sum(rs.words_read) >= 500;

create unique index leaderboard_30d_user_idx    on public.leaderboard_30d(user_id);
create        index leaderboard_30d_wpm_idx     on public.leaderboard_30d(avg_wpm desc);
create        index leaderboard_30d_country_idx on public.leaderboard_30d(country_code, avg_wpm desc);

revoke all on public.leaderboard_30d from public, anon, authenticated;
grant select on public.leaderboard_30d to anon, authenticated;
```

- [ ] **Step 2:** Save to file. Verify via `mcp__supabase__execute_sql("select count(*) from public.leaderboard_30d")` returns 0 (empty since no sessions yet).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_leaderboard_view.sql
git commit -m "Add leaderboard_30d materialized view"
```

---

### Task 4: Tier-aware cap triggers

**Files:**
- Create: `supabase/migrations/0006_tier_aware_caps.sql`
- Apply via: `mcp__supabase__apply_migration` (name: `tier_aware_doc_session_caps`)

- [ ] **Step 1: Apply the migration**

```sql
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
```

(Triggers already exist from `0002_quotas.sql` and reuse the same names — `create or replace` is enough.)

- [ ] **Step 2:** Save file. Verify with a manual SQL test: temporarily set your profile to `tier='free'`, run `select public.enforce_doc_limit()` indirectly by inserting 5 fake docs (you should get the exception on the 5th). Roll back via `begin` / `rollback` block.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0006_tier_aware_caps.sql
git commit -m "Make doc/session cap triggers tier-aware (4/20 docs, 8/300 sessions)"
```

---

### Task 5: `use_url_import()` RPC

**Files:**
- Create: `supabase/migrations/0007_use_url_import_rpc.sql`
- Apply via: `mcp__supabase__apply_migration` (name: `use_url_import_rpc`)

- [ ] **Step 1: Apply the migration**

```sql
create or replace function public.use_url_import()
returns table(allowed boolean, used integer, remaining integer, cap integer)
language plpgsql security definer set search_path = '' as $$
declare
  prof record;
  current_month date := date_trunc('month', now())::date;
  user_cap integer;
  new_used integer;
begin
  select * into prof from public.profiles where user_id = auth.uid() for update;
  if prof is null then
    return query select false, 0, 0, 0;
    return;
  end if;
  if prof.url_imports_month_start <> current_month then
    prof.url_imports_used := 0;
    prof.url_imports_month_start := current_month;
  end if;
  user_cap := case prof.tier when 'pro' then 70 else 3 end;
  if prof.url_imports_used >= user_cap then
    update public.profiles
      set url_imports_month_start = current_month, updated_at = now()
      where user_id = auth.uid();
    return query select false, prof.url_imports_used, 0, user_cap;
    return;
  end if;
  new_used := prof.url_imports_used + 1;
  update public.profiles
    set url_imports_used = new_used,
        url_imports_month_start = current_month,
        updated_at = now()
    where user_id = auth.uid();
  return query select true, new_used, user_cap - new_used, user_cap;
end; $$;

revoke all on function public.use_url_import() from public, anon;
grant execute on function public.use_url_import() to authenticated;
```

- [ ] **Step 2:** Save file. Verify by calling the RPC three times in the SQL editor while signed in as a free user → first two return `allowed=true`; the third returns `allowed=true` with `remaining=0`; the fourth returns `allowed=false`.

- [ ] **Step 3: Commit**

---

### Task 6: `record_reading_session()` RPC

**Files:**
- Create: `supabase/migrations/0008_record_reading_session_rpc.sql`
- Apply via: `mcp__supabase__apply_migration` (name: `record_reading_session_rpc`)

- [ ] **Step 1: Apply the migration**

```sql
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
```

- [ ] **Step 2:** Save file. Verify by calling `select public.record_reading_session(150, 400, 30, null, null)` then `select count(*) from reading_sessions where user_id = auth.uid()` (should be 1).

- [ ] **Step 3: Commit**

---

### Task 7: `waitlist` table

**Files:**
- Create: `supabase/migrations/0009_waitlist.sql`
- Apply via: `mcp__supabase__apply_migration` (name: `waitlist_table`)

- [ ] **Step 1: Apply the migration**

```sql
create table public.waitlist (
  email      text primary key,
  user_id    uuid references auth.users on delete set null,
  source     text,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Anyone (authenticated or not) can add themselves; nobody reads it via the client.
create policy "waitlist anyone insert" on public.waitlist
  for insert with check (true);
```

- [ ] **Step 2:** Save file. Commit.

---

### Task 8: Hourly leaderboard refresh via `pg_cron`

**Files:**
- Create: `supabase/migrations/0010_leaderboard_cron.sql`
- Apply via: `mcp__supabase__apply_migration` (name: `leaderboard_cron_refresh`)

- [ ] **Step 1: Apply the migration**

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'refresh-leaderboard-30d',
  '0 * * * *',
  $$ refresh materialized view concurrently public.leaderboard_30d $$
);
```

- [ ] **Step 2:** Verify the cron job is registered:

```sql
select jobname, schedule from cron.job where jobname = 'refresh-leaderboard-30d';
```

Should return one row scheduled `0 * * * *`.

- [ ] **Step 3:** Save file. Commit.

---

### Task 9: `src/timezone-country.js` — IANA TZ → ISO country map

**Files:**
- Create: `src/timezone-country.js`

- [ ] **Step 1: Create the file**

```javascript
/**
 * Map a small set of common IANA timezones to ISO 3166-1 alpha-2 country codes.
 * Used only as a sane default for the onboarding country picker — the user
 * always has the final say.
 *
 * Coverage targets the EU + most-populated countries elsewhere. Unknown
 * timezones return `null` (the picker stays unselected).
 */

const MAP = {
  // Europe
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT',
  'Europe/Lisbon': 'PT',
  'Europe/Berlin': 'DE',
  'Europe/Zurich': 'CH',
  'Europe/Vienna': 'AT',
  'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ',
  'Europe/Budapest': 'HU',
  'Europe/Bucharest': 'RO',
  'Europe/Athens': 'GR',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Dublin': 'IE',
  'Europe/London': 'GB',
  'Europe/Moscow': 'RU',
  'Europe/Istanbul': 'TR',
  'Europe/Sofia': 'BG',
  'Europe/Belgrade': 'RS',
  'Europe/Zagreb': 'HR',
  'Europe/Tallinn': 'EE',
  'Europe/Riga': 'LV',
  'Europe/Vilnius': 'LT',
  'Europe/Luxembourg': 'LU',
  // Americas
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Phoenix': 'US',
  'America/Anchorage': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Mexico_City': 'MX',
  'America/Sao_Paulo': 'BR',
  'America/Buenos_Aires': 'AR',
  'America/Bogota': 'CO',
  'America/Santiago': 'CL',
  // Asia/Pacific
  'Asia/Tokyo': 'JP',
  'Asia/Shanghai': 'CN',
  'Asia/Hong_Kong': 'HK',
  'Asia/Singapore': 'SG',
  'Asia/Seoul': 'KR',
  'Asia/Kolkata': 'IN',
  'Asia/Bangkok': 'TH',
  'Asia/Jakarta': 'ID',
  'Asia/Dubai': 'AE',
  'Asia/Tel_Aviv': 'IL',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Pacific/Auckland': 'NZ',
  // Africa
  'Africa/Cairo': 'EG',
  'Africa/Johannesburg': 'ZA',
  'Africa/Lagos': 'NG',
  'Africa/Casablanca': 'MA',
};

export function detectCountryCode() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return MAP[tz] || null;
  } catch { return null; }
}
```

- [ ] **Step 2:** Verify by opening DevTools on the running app and:

```javascript
import('./src/timezone-country.js').then(m => console.log(m.detectCountryCode()));
```

Expected: `"NL"` (or whatever your timezone resolves to).

- [ ] **Step 3: Commit**

```bash
git add src/timezone-country.js
git commit -m "Add timezone-to-country map for onboarding default"
```

---

### Task 10: Extend `src/cloud.js` with profile + reading + leaderboard helpers

**Files:**
- Modify: `src/cloud.js`

- [ ] **Step 1: Add these exports at the end of `src/cloud.js`**

```javascript
// ============= Profile / Tier =============

export async function getProfile() {
  if (!currentUserCache) return null;
  const c = await loadClient();
  const { data, error } = await c.from('profiles').select('*').eq('user_id', currentUserCache.id).maybeSingle();
  if (error) throw error;
  return data ? {
    tier: data.tier,
    displayName: data.display_name,
    countryCode: data.country_code,
    leaderboardOptin: data.leaderboard_optin,
    urlImportsUsed: data.url_imports_used,
    urlImportsMonthStart: data.url_imports_month_start,
  } : null;
}

export async function updateProfile({ displayName, countryCode, leaderboardOptin }) {
  if (!currentUserCache) return;
  const c = await loadClient();
  const patch = {};
  if (displayName !== undefined) patch.display_name = displayName;
  if (countryCode !== undefined) patch.country_code = countryCode;
  if (leaderboardOptin !== undefined) patch.leaderboard_optin = leaderboardOptin;
  patch.updated_at = new Date().toISOString();
  const { error } = await c.from('profiles').update(patch).eq('user_id', currentUserCache.id);
  if (error) throw error;
}

// ============= URL imports =============

export async function useUrlImport() {
  if (!currentUserCache) return { allowed: false, used: 0, remaining: 0, cap: 0 };
  const c = await loadClient();
  const { data, error } = await c.rpc('use_url_import');
  if (error) throw error;
  // RPC returns a single-row resultset
  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: !!row?.allowed,
    used: row?.used ?? 0,
    remaining: row?.remaining ?? 0,
    cap: row?.cap ?? 0,
  };
}

// ============= Reading sessions =============

export async function recordReadingSession({ wordsRead, wpm, durationSeconds, documentId = null, pasteSessionId = null }) {
  if (!currentUserCache) return;
  const c = await loadClient();
  const { error } = await c.rpc('record_reading_session', {
    p_words_read: wordsRead,
    p_wpm: wpm,
    p_duration_seconds: durationSeconds,
    p_document_id: documentId,
    p_paste_session_id: pasteSessionId,
  });
  if (error) throw error;
}

// ============= Leaderboard =============

export async function loadLeaderboard({ scope = 'global', countryCode = null, limit = 50 } = {}) {
  const c = await loadClient();
  let q = c.from('leaderboard_30d').select('user_id, display_name, country_code, avg_wpm, total_words, items_read').order('avg_wpm', { ascending: false }).limit(limit);
  if (scope === 'country' && countryCode) q = q.eq('country_code', countryCode);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// ============= Waitlist =============

export async function joinWaitlist(email, source = 'upgrade_button') {
  const c = await loadClient();
  const payload = { email: email.toLowerCase().trim(), source };
  if (currentUserCache) payload.user_id = currentUserCache.id;
  const { error } = await c.from('waitlist').upsert(payload, { onConflict: 'email' });
  if (error) throw error;
}
```

- [ ] **Step 2:** Verify by opening DevTools in the running app, signing in (or being signed in already), and running:

```javascript
const cloud = await import('./src/cloud.js');
console.log(await cloud.getProfile());
console.log(await cloud.useUrlImport());
console.log(await cloud.loadLeaderboard({scope: 'global'}));
```

Expected: a profile object, a URL counter result, and an empty leaderboard array.

- [ ] **Step 3: Commit**

```bash
git add src/cloud.js
git commit -m "cloud.js: add profile / URL counter / reading session / leaderboard / waitlist helpers"
```

---

### Task 11: `src/tiers.js` — client tier cache + WPM caps

**Files:**
- Create: `src/tiers.js`

- [ ] **Step 1: Create the module**

```javascript
/**
 * Client-side tier cache. Reads the user's profile once on sign-in, caches it,
 * and exposes simple getters the rest of the app uses to gate features.
 *
 * The server enforces caps independently (triggers + RPCs) — this module is
 * about UI correctness, not security.
 */
import { getProfile, onAuthChange } from './cloud.js';

let cachedTier = 'free';
let cachedCaps = freeCaps();
const listeners = [];

const CAPS = {
  free: { maxDocs: 4,   maxSessions: 8,   maxWpm: 450,  urlImportsCap: 3  },
  pro:  { maxDocs: 20,  maxSessions: 300, maxWpm: 900,  urlImportsCap: 70 },
};

export function getTier() { return cachedTier; }
export function getCaps() { return cachedCaps; }
export function onTierChange(fn) { listeners.push(fn); fn(cachedTier, cachedCaps); }

export function isPro() { return cachedTier === 'pro'; }

function freeCaps() { return CAPS.free; }

export async function initTiers() {
  onAuthChange(async (user) => {
    if (!user) {
      cachedTier = 'free';
      cachedCaps = CAPS.free;
    } else {
      try {
        const profile = await getProfile();
        cachedTier = profile?.tier || 'free';
        cachedCaps = CAPS[cachedTier] || CAPS.free;
      } catch (err) {
        console.warn('tiers: failed to load profile', err);
        cachedTier = 'free';
        cachedCaps = CAPS.free;
      }
    }
    listeners.forEach(fn => { try { fn(cachedTier, cachedCaps); } catch (e) { console.error(e); } });
  });
}
```

- [ ] **Step 2: Wire `initTiers()` into `app.js` DOMContentLoaded**, AFTER `cloud.init()`:

```javascript
import { initTiers } from './src/tiers.js';
// ...
initTiers();
```

- [ ] **Step 3:** Verify in DevTools after a sign-in:

```javascript
const tiers = await import('./src/tiers.js');
console.log(tiers.getTier(), tiers.getCaps());
```

- [ ] **Step 4: Commit**

```bash
git add src/tiers.js app.js
git commit -m "Add tiers.js client cache for user tier + caps"
```

---

### Task 12: Mandatory sign-in gate

**Files:**
- Modify: `src/auth-ui.js`
- Modify: `app.js`
- Modify: `styles.css` (small)

**Why:** From this point on, the app body is invisible until the user is authenticated.

- [ ] **Step 1: Add a "blocking" mode flag to the auth modal in `src/auth-ui.js`**

In `buildAuthModal()`, set a new attribute on the backdrop so close behavior can be conditional:

```javascript
modal.dataset.mode = 'optional';  // initially closeable
```

In the close handler, only close if `modal.dataset.mode !== 'required'`. ESC handler same.

Add a new exported function:

```javascript
export function lockAuthOpen() {
  if (!modal) return;
  modal.dataset.mode = 'required';
  modal.hidden = false;
  document.body.classList.add('auth-required');
  // Hide the close X
  const closeBtn = modal.querySelector('#auth-close');
  if (closeBtn) closeBtn.style.display = 'none';
}

export function unlockAuthClosed() {
  if (!modal) return;
  modal.dataset.mode = 'optional';
  modal.hidden = true;
  document.body.classList.remove('auth-required');
  const closeBtn = modal.querySelector('#auth-close');
  if (closeBtn) closeBtn.style.display = '';
}
```

- [ ] **Step 2: Wire boot gate in `app.js`**

At the very end of the DOMContentLoaded handler, after `initTiers()`:

```javascript
import { lockAuthOpen, unlockAuthClosed } from './src/auth-ui.js';

cloud.onAuthChange((user) => {
  if (user) { unlockAuthClosed(); }
  else { lockAuthOpen(); }
});
```

(If cloud is not configured — `.env` missing — leave the app open as today; the auth-ui already no-ops in that case.)

- [ ] **Step 3: Add the "auth-required" CSS** to `styles.css`:

```css
body.auth-required .app-container > * { filter: blur(8px) brightness(0.6); pointer-events: none; user-select: none; }
body.auth-required .modal-backdrop { filter: none; pointer-events: auto; }
```

(The body hides the app behind the auth modal so users see *something* but can't interact.)

- [ ] **Step 4:** Bump cache buster in `index.html` from `?v=N` to `?v=N+1` for both `styles.css` and `app.js`.

- [ ] **Step 5: Verify**

Reload the app while signed out → the app behind the modal is blurred, the modal can't be dismissed (no ✕). Sign in → blur goes away. Sign out via the account chip → modal returns and locks.

- [ ] **Step 6: Commit**

```bash
git add src/auth-ui.js app.js styles.css index.html
git commit -m "Make sign-in mandatory: block the app behind the auth modal when signed out"
```

---

### Task 13: Onboarding modal — display name + country + opt-in

**Files:**
- Create: `src/onboarding.js`
- Modify: `index.html` (modal markup)
- Modify: `styles.css` (modal styles)
- Modify: `src/auth-ui.js` (trigger after sign-in if no display_name)
- Modify: `app.js` (import + init)

- [ ] **Step 1: Markup in `index.html` before `</body>`** (after the existing import modal):

```html
<div class="modal-backdrop" id="onboarding-backdrop" hidden>
  <div class="modal onboarding-modal" role="dialog" aria-labelledby="onboarding-title">
    <h2 id="onboarding-title">Welcome to Fasty</h2>
    <p class="muted">Tell us a name and country we can show on the leaderboard. You can change these any time in Settings, or skip for full privacy.</p>

    <form class="onboarding-form" id="onboarding-form">
      <label class="onboarding-field">
        <span>Display name</span>
        <input type="text" id="onb-name" maxlength="40" placeholder="e.g. ferdub" />
      </label>
      <label class="onboarding-field">
        <span>Country</span>
        <select id="onb-country">
          <option value="">(choose a country)</option>
        </select>
      </label>
      <label class="onboarding-check">
        <input type="checkbox" id="onb-optin" checked />
        <span>Show me on the public leaderboard</span>
      </label>
      <div class="onboarding-buttons">
        <button type="button" class="btn-ghost" id="onb-skip">Skip</button>
        <button type="submit" class="btn-primary" id="onb-save">Save and continue</button>
      </div>
    </form>
  </div>
</div>
```

- [ ] **Step 2:** Append to `styles.css`:

```css
.onboarding-modal { min-width: 420px; max-width: 480px; }
.onboarding-form { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
.onboarding-field { display: flex; flex-direction: column; gap: 4px; }
.onboarding-field > span { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; }
.onboarding-field input, .onboarding-field select {
  padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 6px;
  background: var(--bg); color: var(--text); font-family: inherit; font-size: 14px;
}
.onboarding-check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }
.onboarding-buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
```

- [ ] **Step 3:** Create `src/onboarding.js`:

```javascript
import { getProfile, updateProfile } from './cloud.js';
import { detectCountryCode } from './timezone-country.js';
import { toast } from './toasts.js';

const COUNTRIES = [
  ['NL','Netherlands'],['BE','Belgium'],['FR','France'],['ES','Spain'],['IT','Italy'],
  ['DE','Germany'],['GB','United Kingdom'],['IE','Ireland'],['PT','Portugal'],['CH','Switzerland'],
  ['AT','Austria'],['PL','Poland'],['CZ','Czechia'],['SE','Sweden'],['NO','Norway'],
  ['DK','Denmark'],['FI','Finland'],['GR','Greece'],['US','United States'],['CA','Canada'],
  ['MX','Mexico'],['BR','Brazil'],['AR','Argentina'],['JP','Japan'],['CN','China'],
  ['IN','India'],['SG','Singapore'],['KR','South Korea'],['AU','Australia'],['NZ','New Zealand'],
  ['ZA','South Africa'],['EG','Egypt'],['NG','Nigeria'],['MA','Morocco'],['IL','Israel'],
];

export async function maybeShowOnboarding() {
  const profile = await getProfile();
  if (!profile) return;
  if (profile.displayName) return;   // already done

  const backdrop = document.getElementById('onboarding-backdrop');
  if (!backdrop) return;
  const select = backdrop.querySelector('#onb-country');
  // Populate country select
  select.innerHTML = '<option value="">(choose a country)</option>' +
    COUNTRIES.map(([code, name]) => `<option value="${code}">${name}</option>`).join('');
  // Default to detected country
  const detected = profile.countryCode || detectCountryCode();
  if (detected) select.value = detected;

  backdrop.hidden = false;

  return new Promise(resolve => {
    const form = backdrop.querySelector('#onboarding-form');
    const onSubmit = async (e) => {
      e.preventDefault();
      const name = backdrop.querySelector('#onb-name').value.trim() || null;
      const country = backdrop.querySelector('#onb-country').value || null;
      const optin = backdrop.querySelector('#onb-optin').checked;
      try {
        await updateProfile({ displayName: name, countryCode: country, leaderboardOptin: optin });
        toast('Profile saved.');
      } catch (err) {
        toast(`Couldn't save: ${err.message}`, { error: true });
        return;
      }
      cleanup();
      resolve();
    };
    const onSkip = async () => {
      try {
        await updateProfile({ displayName: null, countryCode: null, leaderboardOptin: false });
      } catch (_) {}
      cleanup();
      resolve();
    };
    const cleanup = () => {
      backdrop.hidden = true;
      form.removeEventListener('submit', onSubmit);
      backdrop.querySelector('#onb-skip').removeEventListener('click', onSkip);
    };
    form.addEventListener('submit', onSubmit);
    backdrop.querySelector('#onb-skip').addEventListener('click', onSkip);
  });
}
```

- [ ] **Step 4:** In `src/auth-ui.js`, in the `onAuthChange` listener that already fires on sign-in (or in `app.js` after sign-in), add:

```javascript
import { maybeShowOnboarding } from './src/onboarding.js';
// ...inside onAuthChange handler when user is non-null and after migration finishes:
await maybeShowOnboarding();
```

- [ ] **Step 5:** Bump cache buster, then verify by signing up with a fresh account → modal appears, you pick name + country + opt-in or click Skip → modal closes; refresh and confirm it doesn't reappear (since `display_name` is now set, or `leaderboard_optin=false` if you skipped).

- [ ] **Step 6: Commit**

---

### Task 14: WPM dropdown caps per tier

**Files:**
- Modify: `app.js`

- [ ] **Step 1:** Add a function that rebuilds the WPM `<select>` from the current cap:

```javascript
// Inside FastyApp class
rebuildWpmDropdown(maxWpm) {
  const select = this.elements.wpmSelect;
  if (!select) return;
  const wanted = [250,300,350,400,450,500,550,600,650,700,750,800,850,900].filter(v => v <= maxWpm);
  const currentValue = parseInt(select.value, 10);
  select.innerHTML = wanted.map(v => `<option value="${v}">${v}</option>`).join('');
  // Preserve selection if still allowed; otherwise clamp.
  const clamped = wanted.includes(currentValue) ? currentValue : wanted[wanted.length - 1];
  select.value = clamped;
  if (this.wpm !== clamped) {
    this.wpm = clamped;
    this.onWpmChange();
  }
}
```

- [ ] **Step 2:** In `app.js` DOMContentLoaded, after `initTiers()`:

```javascript
import { onTierChange } from './src/tiers.js';
// ...
onTierChange((tier, caps) => {
  if (window.fastyApp) window.fastyApp.rebuildWpmDropdown(caps.maxWpm);
});
```

- [ ] **Step 3:** Verify by toggling your profile in SQL: `update public.profiles set tier='pro' where user_id = auth.uid();` then `update ... set tier='free';` and reloading — the WPM dropdown should change between 450 and 900 caps.

- [ ] **Step 4: Commit**

---

### Task 15: Library + paste-sessions "X / cap" badges + over-cap CTA

**Files:**
- Modify: `src/library.js`
- Modify: `src/paste-sessions.js`
- Modify: `index.html` (badge slots in section headers)
- Modify: `styles.css`

- [ ] **Step 1:** Add badge spans inside the existing `<summary class="sidebar-section-header">` in `index.html` (after the existing text):

```html
<!-- Library section -->
<span class="section-cap-badge" id="library-cap-badge"></span>

<!-- Pasted texts section -->
<span class="section-cap-badge" id="sessions-cap-badge"></span>
```

- [ ] **Step 2:** CSS:

```css
.section-cap-badge {
  margin-left: auto;
  font-size: 10px; font-weight: 500;
  padding: 2px 6px; border-radius: 999px;
  background: var(--bg-tertiary); color: var(--text-muted);
}
.section-cap-badge.at-cap { background: var(--accent); color: white; }
```

- [ ] **Step 3:** In `src/library.js` and `src/paste-sessions.js`, update `refresh()` so after rendering the list it also writes the badge:

```javascript
import { getCaps } from './tiers.js';
// ...
const caps = getCaps();
const badge = document.getElementById('library-cap-badge');
if (badge) {
  const count = docs.length;
  badge.textContent = `${count} / ${caps.maxDocs}`;
  badge.classList.toggle('at-cap', count >= caps.maxDocs);
}
```

Same shape for `sessions-cap-badge` with `caps.maxSessions`.

- [ ] **Step 4:** Wire a `refresh()` call after every `onTierChange()` (in `app.js`).

- [ ] **Step 5:** When at cap, the import modal should already surface the server's exception as an error toast. Verify by importing 5 files in a row while `tier='free'`: the 5th surfaces "Document limit reached (4 of 4)."

- [ ] **Step 6: Commit**

---

### Task 16: URL import counter check

**Files:**
- Modify: `src/import-modal.js`

- [ ] **Step 1:** In `handleUrl`, before calling `parseUrl(url)`, call `useUrlImport()`:

```javascript
import { useUrlImport } from './cloud.js';
// ...
async function handleUrl(url) {
  if (!url) return;
  showProgress(`Checking quota…`);
  try {
    const quota = await useUrlImport();
    if (!quota.allowed) {
      hideProgress();
      toast(`URL import quota reached (${quota.used}/${quota.cap} this month). Upgrade to Pro for ${70} URL imports per month.`, { error: true, duration: 7000 });
      return;
    }
    showProgress(`Fetching ${url}…`);
    const doc = await parseUrl(url);
    // ... existing flow
```

Keep the rest of `handleUrl` (the existing duplicate-check + save flow).

- [ ] **Step 2:** Verify — for a free user, three URL imports succeed; the fourth shows the toast and aborts.

- [ ] **Step 3: Commit**

---

### Task 17: Gate cloud sync on Pro

**Files:**
- Modify: `src/storage.js`
- Modify: `src/migration.js`

- [ ] **Step 1:** In `src/storage.js`'s `mirror()` helper, gate on tier:

```javascript
function mirror(thunk) {
  Promise.resolve().then(async () => {
    const { isPro } = await import('./tiers.js');
    if (!isPro()) return;        // free users: stay local
    return thunk();
  }).catch(err => {
    if (!err || /not configured|not signed in|cloud disabled/i.test(err.message || '')) return;
    console.warn('Cloud mirror failed:', err.message || err);
  });
}
```

- [ ] **Step 2:** `pullCloudIntoLocal()` already early-returns when not signed in. Wrap the same `isPro()` gate so free users don't pull cloud rows either.

- [ ] **Step 3:** `src/migration.js` — at the top of `migrateLocalToCloudIfNeeded()`:

```javascript
import { isPro } from './tiers.js';
// ...
if (!isPro()) return;
```

- [ ] **Step 4:** Verify by signing in as a free user and importing a doc → it should NOT appear in `select * from public.documents where user_id = '<your_uid>'`. Toggle yourself to Pro via SQL, reload, import another doc → it should appear in Postgres.

- [ ] **Step 5: Commit**

---

### Task 18: Record reading sessions

**Files:**
- Modify: `app.js`

**Why:** Without these, the leaderboard stays empty.

- [ ] **Step 1:** Inside `FastyApp`, track per-bout state:

```javascript
// In constructor:
this._bout = null;  // { wordsAtStart, startTime, wpmAtStart, sourceDocId, sourcePasteId }
```

- [ ] **Step 2:** Reset at the start of every `play()`:

```javascript
// at top of play() right after the isPlaying guard:
if (!this._bout) {
  this._bout = {
    wordsAtStart: this.currentWordIndex,
    startTime: Date.now(),
    wpmAtStart: this.wpm,
    sourceDocId: this.currentDoc?.id || null,
    sourcePasteId: this._currentSessionId || null,
  };
}
```

- [ ] **Step 3:** Flush the bout in `pause()` and `closeCurrentDoc()` and `enterPasteMode()` and the existing `beforeunload`:

```javascript
async _flushReadingBout() {
  if (!this._bout) return;
  const wordsRead = this.currentWordIndex - this._bout.wordsAtStart;
  const durationSeconds = Math.round((Date.now() - this._bout.startTime) / 1000);
  const wpm = this._bout.wpmAtStart;
  const documentId = this._bout.sourceDocId;
  const pasteSessionId = this._bout.sourcePasteId;
  this._bout = null;
  if (wordsRead < 20 || durationSeconds < 10) return;  // matches server-side floor
  try {
    const { recordReadingSession } = await import('./src/cloud.js');
    await recordReadingSession({ wordsRead, wpm, durationSeconds, documentId, pasteSessionId });
  } catch (err) {
    console.warn('record reading session failed:', err.message);
  }
}
```

Add `this._flushReadingBout();` calls in:
- `pause()` (at the end)
- `closeCurrentDoc()`
- `enterPasteMode()`
- `_advancePageRead()` — at the very start, BEFORE awaiting the continuation, so the bout for the page just finished is recorded as its own session.
- the `beforeunload` listener

- [ ] **Step 4:** Verify by reading a doc for 30+ seconds, pausing, then in SQL Editor:

```sql
select * from public.reading_sessions where user_id = auth.uid() order by started_at desc limit 5;
```

A row appears with the expected words/wpm/duration.

- [ ] **Step 5: Commit**

---

### Task 19: Leaderboard overlay

**Files:**
- Create: `src/leaderboard.js`
- Modify: `index.html` (sidebar button + overlay markup)
- Modify: `styles.css`
- Modify: `app.js` (init)

- [ ] **Step 1:** Sidebar entry in `index.html` (inside `.sidebar-actions`, after the Import button):

```html
<button class="sidebar-btn" id="open-leaderboard">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M17 5H7l-2 5a5 5 0 0 0 14 0l-2-5z"/></svg>
  <span>Leaderboard</span>
</button>
```

- [ ] **Step 2:** Overlay markup before `</body>`:

```html
<div class="leaderboard-overlay" id="leaderboard-overlay" hidden>
  <div class="leaderboard-topbar">
    <h2>30-day leaderboard</h2>
    <div class="lb-tabs">
      <button class="lb-tab active" data-scope="country">Your country</button>
      <button class="lb-tab" data-scope="global">Global</button>
    </div>
    <button class="modal-close" id="leaderboard-close" aria-label="Close">✕</button>
  </div>
  <div class="leaderboard-body" id="leaderboard-body">
    <p class="lb-empty">Loading…</p>
  </div>
</div>
```

- [ ] **Step 3:** Styles:

```css
.leaderboard-overlay { position: fixed; inset: 0; background: var(--bg); z-index: 650; display: flex; flex-direction: column; overflow: auto; }
.leaderboard-overlay[hidden] { display: none; }
.leaderboard-topbar { display: flex; align-items: center; gap: 16px; padding: 16px 24px; border-bottom: 1px solid var(--border-color); }
.leaderboard-topbar h2 { margin: 0; font-size: 18px; }
.lb-tabs { display: inline-flex; gap: 4px; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
.lb-tab { background: transparent; color: var(--text-secondary); padding: 4px 12px; border: none; cursor: pointer; font-size: 13px; }
.lb-tab.active { background: var(--accent); color: white; }
.leaderboard-topbar .modal-close { margin-left: auto; position: static; }
.leaderboard-body { padding: 24px; max-width: 720px; margin: 0 auto; }
.lb-row {
  display: grid; grid-template-columns: 40px 1fr auto auto;
  gap: 16px; align-items: center;
  padding: 10px 12px; border-radius: 8px;
  border-bottom: 1px solid var(--border-color);
}
.lb-row.self { background: var(--bg-tertiary); }
.lb-rank { font-weight: 600; color: var(--text-muted); }
.lb-name { font-weight: 500; }
.lb-name .country { color: var(--text-muted); font-size: 12px; margin-left: 6px; }
.lb-wpm { font-size: 18px; font-weight: 600; color: var(--accent); }
.lb-meta { font-size: 11px; color: var(--text-muted); text-align: right; }
.lb-empty { text-align: center; color: var(--text-muted); padding: 40px 0; }
```

- [ ] **Step 4:** Create `src/leaderboard.js`:

```javascript
import { loadLeaderboard, getProfile, currentUser } from './cloud.js';

let overlay, body;
let currentScope = 'country';

export function initLeaderboard() {
  overlay = document.getElementById('leaderboard-overlay');
  body = document.getElementById('leaderboard-body');
  document.getElementById('open-leaderboard').addEventListener('click', open);
  document.getElementById('leaderboard-close').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });
  overlay.querySelectorAll('.lb-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.lb-tab').forEach(b => b.classList.toggle('active', b === btn));
      currentScope = btn.dataset.scope;
      render();
    });
  });
}

async function open() { overlay.hidden = false; await render(); }
function close() { overlay.hidden = true; }

async function render() {
  body.innerHTML = '<p class="lb-empty">Loading…</p>';
  const profile = await getProfile();
  const me = currentUser();
  const countryCode = profile?.countryCode || null;
  if (currentScope === 'country' && !countryCode) {
    body.innerHTML = '<p class="lb-empty">Set your country in Settings to see your local board.</p>';
    return;
  }
  let rows;
  try {
    rows = await loadLeaderboard({ scope: currentScope, countryCode, limit: 100 });
  } catch (err) {
    body.innerHTML = `<p class="lb-empty">Couldn't load: ${err.message}</p>`;
    return;
  }
  if (!rows.length) {
    body.innerHTML = `<p class="lb-empty">No rankings yet ${currentScope === 'country' ? `for ${countryCode}` : ''}. Read more to be the first!</p>`;
    return;
  }
  body.innerHTML = rows.map((r, i) => `
    <div class="lb-row ${r.user_id === me?.id ? 'self' : ''}">
      <div class="lb-rank">#${i + 1}</div>
      <div class="lb-name">${escapeHtml(r.display_name || 'Anonymous reader')}${r.country_code ? ` <span class="country">${r.country_code}</span>` : ''}</div>
      <div class="lb-wpm">${r.avg_wpm} <span style="font-size:10px;color:var(--text-muted)">WPM</span></div>
      <div class="lb-meta">${r.total_words.toLocaleString()} words · ${r.items_read} read</div>
    </div>
  `).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
```

- [ ] **Step 5:** Wire `initLeaderboard()` into `app.js` DOMContentLoaded.

- [ ] **Step 6:** Verify by clicking Leaderboard → table renders with one row (you, with your reading session from Task 18).

- [ ] **Step 7: Commit**

---

### Task 20: Upgrade-to-Pro CTA + waitlist signup

**Files:**
- Create: `src/upgrade-ui.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `app.js`

- [ ] **Step 1:** Sidebar footer CTA in `index.html`, inside `.sidebar-footer` ABOVE the settings row:

```html
<button class="upgrade-cta" id="open-upgrade" hidden>
  ✨ Upgrade to Pro
</button>
```

- [ ] **Step 2:** Modal markup before `</body>`:

```html
<div class="modal-backdrop" id="upgrade-backdrop" hidden>
  <div class="modal upgrade-modal" role="dialog" aria-labelledby="upgrade-title">
    <button class="modal-close" id="upgrade-close" aria-label="Close">✕</button>
    <h2 id="upgrade-title">Fasty Pro</h2>
    <p class="muted">Pay what you want, from €5. One-time, lifetime access.</p>
    <ul class="upgrade-features">
      <li>📚 <strong>20 documents</strong> in your library (vs 4 free)</li>
      <li>💬 <strong>300 paste sessions</strong> (vs 8 free)</li>
      <li>⚡ <strong>WPM up to 900</strong> (vs 450 free)</li>
      <li>🌐 <strong>70 article URL imports / month</strong> (vs 3 free)</li>
      <li>☁️ <strong>Cloud sync</strong> across all your devices</li>
      <li>✨ Supporter badge</li>
    </ul>
    <p class="upgrade-soon">Pro launches soon. Drop your email and we'll let you know:</p>
    <form id="upgrade-form" class="upgrade-form">
      <input type="email" id="upgrade-email" required placeholder="you@example.com" />
      <button type="submit" class="btn-primary">Notify me at launch</button>
    </form>
    <p id="upgrade-thanks" class="upgrade-thanks" hidden>Thanks — we'll be in touch.</p>
  </div>
</div>
```

- [ ] **Step 3:** Styles:

```css
.upgrade-cta {
  width: 100%;
  background: linear-gradient(135deg, var(--accent), #ff8585);
  color: white; border: none; padding: 10px;
  border-radius: 8px; cursor: pointer;
  font-family: inherit; font-size: 13px; font-weight: 500;
  margin-bottom: 10px;
  transition: filter .15s;
}
.upgrade-cta:hover { filter: brightness(1.06); }

.upgrade-modal { min-width: 420px; max-width: 480px; }
.upgrade-features { list-style: none; padding: 0; margin: 16px 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.upgrade-soon { font-size: 13px; color: var(--text-secondary); margin-top: 16px; }
.upgrade-form { display: flex; gap: 8px; margin-top: 8px; }
.upgrade-form input { flex: 1; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg); color: var(--text); }
.upgrade-thanks { color: var(--accent); margin-top: 8px; font-size: 13px; }
```

- [ ] **Step 4:** Create `src/upgrade-ui.js`:

```javascript
import { joinWaitlist, currentUser } from './cloud.js';
import { onTierChange } from './tiers.js';
import { toast } from './toasts.js';

export function initUpgradeUI() {
  const cta = document.getElementById('open-upgrade');
  const backdrop = document.getElementById('upgrade-backdrop');
  const closeBtn = document.getElementById('upgrade-close');
  const form = document.getElementById('upgrade-form');
  const emailInput = document.getElementById('upgrade-email');
  const thanks = document.getElementById('upgrade-thanks');

  // Show CTA only for non-pro users.
  onTierChange((tier) => { cta.hidden = tier === 'pro'; });

  cta.addEventListener('click', () => {
    backdrop.hidden = false;
    thanks.hidden = true;
    form.hidden = false;
    const user = currentUser();
    if (user?.email) emailInput.value = user.email;
    setTimeout(() => emailInput.focus(), 0);
  });
  closeBtn.addEventListener('click', () => { backdrop.hidden = true; });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.hidden = true; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;
    try {
      await joinWaitlist(email, 'upgrade_button');
      form.hidden = true;
      thanks.hidden = false;
    } catch (err) {
      toast(`Couldn't sign you up: ${err.message}`, { error: true });
    }
  });
}
```

- [ ] **Step 5:** Wire `initUpgradeUI()` in `app.js`.

- [ ] **Step 6:** Verify: as a free user, click Upgrade → modal appears, enter your email, submit → "Thanks" message. Check via SQL: `select * from public.waitlist;` — your email is there. Toggle yourself to Pro via SQL → CTA disappears on next reload.

- [ ] **Step 7: Commit**

---

### Task 21: End-to-end acceptance sweep

**Files:** none (verification only).

- [ ] **Step 1:** Walk through every acceptance criterion in §13 of the spec:

  1. Sign-in mandatory: log out → app blurred behind unclosable modal. ✅
  2. Onboarding modal on first sign-in. ✅
  3. Free user can import 4 docs; the 5th raises the error toast. ✅
  4. Same for 8 paste sessions. ✅
  5. WPM dropdown: 450 free, 900 Pro. ✅
  6. URL imports: 4th in a month blocked for free. ✅
  7. Pro syncs to cloud; free stays in IDB. ✅
  8. Leaderboard shows two tabs and ≥ 500-word users only. ✅
  9. Upgrade modal saves to waitlist. ✅
  10. SQL `update profiles set tier='pro'` flips behavior on next load. ✅

- [ ] **Step 2:** Push the branch and update the PR description with the new monetization features.

- [ ] **Step 3: Commit any small fixes found during the sweep**

```bash
git add -A
git commit -m "Fix issues found during monetization end-to-end sweep"
```

If nothing needed fixing, skip this step.

---

## Done

When all 21 tasks pass: the feature is ready for live test. Tell Fernando:
- The PR is updated.
- Toggle yourself to Pro via SQL Editor: `update public.profiles set tier='pro' where user_id = '<your_id>';`
- Read a few docs to seed the leaderboard.
- When ready to launch payments, add Lemonsqueezy and wire a webhook to flip `profiles.tier = 'pro'` automatically (separate spec).
