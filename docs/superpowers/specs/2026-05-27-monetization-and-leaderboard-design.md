# Fasty — Monetization (Free / Pro tiers) + Reading Leaderboard

**Date:** 2026-05-27
**Status:** Approved (brainstorming)
**Author:** Fernando Duque (with Claude)

---

## 1. Goal & context

Fasty has reached a usable single-device experience: paste / import / library / fasty mode / cloud sync. The next step is monetizing it sustainably (target: €200–€1,000/month side income) without making the app feel crippled.

Two changes in this iteration:

1. **Mandatory sign-in + Free / Pro tiers** with strict caps on the Free side so heavy users have a reason to upgrade.
2. **Reading leaderboard** — a 30-day global + country ranking by average WPM, to drive engagement, viral sharing and sign-ups.

Payments themselves are **deferred** for this spec. We build the tier system end-to-end so Pro status can be toggled manually via SQL today; a future Lemonsqueezy webhook will flip `profiles.tier = 'pro'` automatically once we wire the checkout.

---

## 2. Tiers

| Capability | Free | Pro |
|---|---|---|
| Sign-in required | ✅ | ✅ |
| Library documents (PDF / EPUB / TXT / URL) | **4** | **20** |
| Paste sessions stored | **8** | **300** |
| Max WPM in the dropdown | **450** | **900** |
| URL article imports per calendar month | **3** | **70** |
| Cloud sync across devices | ❌ — IndexedDB only | ✅ |
| Faithful PDF/EPUB view | ✅ | ✅ |
| Fasty (click-to-RSVP / select-passage) | ✅ | ✅ |
| Light / dark theme | ✅ | ✅ |
| Per-document auto-resume (local) | ✅ | ✅ |
| Public leaderboard participation | opt-in default ON | opt-in default ON |
| "Supporter" badge on the sidebar | — | ✅ |

**No anonymous mode.** First visit shows a sign-in / sign-up gate; the app body is blank until the user is authenticated. Existing local IndexedDB data from before this change is preserved and migrates up on first sign-in (we already have `migrateLocalToCloudIfNeeded()` — gated on `tier === 'pro'` post-change).

---

## 3. Database schema additions

### 3.1 `profiles`
One row per `auth.users` row, auto-created via a `handle_new_user` trigger.

```sql
create table public.profiles (
  user_id                 uuid primary key references auth.users on delete cascade,
  tier                    text not null default 'free' check (tier in ('free','pro')),
  display_name            text,                       -- shown on the leaderboard; user sets in onboarding
  country_code            text,                       -- ISO 3166-1 alpha-2 (e.g. 'NL'); user picks in onboarding
  leaderboard_optin       boolean not null default true,
  url_imports_used        integer not null default 0,
  url_imports_month_start date not null default date_trunc('month', now())::date,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Each user can read their own profile.
create policy "profiles owner read" on public.profiles
  for select using (user_id = auth.uid());

-- Users may update their own row, but a BEFORE UPDATE trigger forces protected
-- columns (tier, url_imports_used, url_imports_month_start) back to their old
-- values for non-service-role callers. Cleaner than RLS subqueries and easier
-- to test.
create policy "profiles owner update" on public.profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.lock_profile_protected_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Service role (used by webhooks) bypasses this guard.
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
```

### 3.2 `reading_sessions`
One row per "reading bout" — written when the user pauses, exits, or auto-saves progress, *if* at least N words were read since the last session row. Used to compute leaderboard stats.

```sql
create table public.reading_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade,
  document_id       uuid references public.documents on delete set null,
  paste_session_id  uuid references public.paste_sessions on delete set null,
  words_read        integer not null check (words_read > 0),
  wpm               integer not null check (wpm between 50 and 2000), -- wider than the client cap (450/900) by design — future-proof for higher tiers
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

### 3.3 `leaderboard_30d` materialized view
Recomputed on a schedule (hourly via Supabase cron). Public read.

```sql
create materialized view public.leaderboard_30d as
select
  p.user_id,
  coalesce(p.display_name, 'Anonymous reader')        as display_name,
  p.country_code,
  round(avg(rs.wpm))::integer                          as avg_wpm,
  sum(rs.words_read)                                   as total_words,
  count(distinct coalesce(rs.document_id::text, rs.paste_session_id::text)) as items_read
from public.profiles p
join public.reading_sessions rs on rs.user_id = p.user_id
where p.leaderboard_optin = true
  and rs.started_at > now() - interval '30 days'
group by p.user_id, p.display_name, p.country_code
having sum(rs.words_read) >= 500;  -- minimum activity to appear on the board

create unique index leaderboard_30d_user_idx    on public.leaderboard_30d(user_id);
create        index leaderboard_30d_wpm_idx     on public.leaderboard_30d(avg_wpm desc);
create        index leaderboard_30d_country_idx on public.leaderboard_30d(country_code, avg_wpm desc);

-- Public read of the leaderboard (no PII other than display_name + country).
revoke all on public.leaderboard_30d from public, anon, authenticated;
grant select on public.leaderboard_30d to anon, authenticated;
```

Refresh schedule (Supabase cron extension):

```sql
select cron.schedule('refresh-leaderboard-30d', '0 * * * *',
  $$ refresh materialized view concurrently public.leaderboard_30d $$);
```

---

## 4. Updated triggers (per-tier caps)

`enforce_doc_limit` and `enforce_session_limit` already exist (flat 200 / 500). Replace with tier-aware versions:

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

---

## 5. RPCs

### 5.1 `use_url_import()`
Atomically increments the per-user monthly URL-import counter and returns whether the import is allowed. Auto-resets at the start of each calendar month.

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

### 5.2 `record_reading_session(words_read, wpm, duration_seconds, document_id, paste_session_id)`
A thin wrapper around the `reading_sessions` insert so the client doesn't have to know the column shape. Drops rows shorter than 10 seconds or with fewer than 20 words to filter out accidental sessions.

---

## 6. Onboarding flow

First time a user signs in (no `profiles.display_name` set yet), show a one-screen modal:

> **Welcome to Fasty.**
> Pick a display name (e.g. "ferdub") and your country, used only for the leaderboard. You can change these later in Settings. Uncheck below if you'd rather not appear on the leaderboard at all.
>
> [Display name __________]
> [Country dropdown — defaults to detected from browser locale]
> [☑] Show me on the public leaderboard
>
> [Skip] [Save and continue]

"Skip" → profile gets `display_name = NULL`, `leaderboard_optin = false` **regardless of the checkbox state** (Skip is treated as full opt-out). They can flip back on in Settings any time.

---

## 7. Client-side changes (file-level)

| File | Change |
|---|---|
| `src/cloud.js` | Add `getProfile()`, `updateProfile({display_name, country_code, leaderboard_optin})`, `useUrlImport()` (calls the RPC), `recordReadingSession(payload)`, `loadLeaderboard({scope: 'country' | 'global'})`. |
| `src/auth-ui.js` | Make the sign-in modal modal-with-no-dismiss when the user isn't authenticated. After sign-in, if `profile.display_name is null`, show the onboarding modal. |
| `src/tiers.js` | **New.** Small module that loads the current user's `tier` and caches it. Exposes `getTier()`, `getCaps()` → `{ maxDocs, maxSessions, maxWpm, urlImportsCap }`. Re-fetches on auth-change. |
| `app.js` | Block app boot until `cloud.currentUser()` returns. WPM dropdown re-populates from `tiers.getCaps().maxWpm`. On each `advanceWord` that crosses a "session" threshold (configurable; default = pause/exit + 20 words minimum), call `recordReadingSession`. |
| `src/storage.js` | Cloud mirror calls only fire when `tiers.getTier() === 'pro'`. Free users still write to IDB but their writes don't go up. (Migration to cloud also only runs on first sign-in *if* user is Pro.) |
| `src/import-modal.js` | Before calling `parseUrl()`, call `useUrlImport()`. If `allowed = false`, show a paywall toast ("You've used 3/3 article imports this month. Upgrade to Pro for 70/month."). |
| `src/library.js` | Show "X/4 used" or "X/20 used" badge next to the Library section header. Show an "Upgrade to Pro" inline card when at cap. |
| `src/paste-sessions.js` | Same badge + cap behavior. |
| `src/leaderboard.js` | **New.** Renders the leaderboard view. Tabs: **Country** (auto-selected on country_code) / **Global**. Each row: rank, display name, country flag (from country code), avg WPM, total words 30d. |
| `index.html` | New nav item in sidebar: a small "Leaderboard 🏆" button below Import. Opens a full-page overlay (similar to existing modals). |
| `src/upgrade-ui.js` | **New.** "Upgrade to Pro" page/modal. For now: marketing copy + an email form ("Notify me when Pro launches" — captured to `public.waitlist`). Later: replaced by Lemonsqueezy checkout button. |

`profiles.tier` is the single source of truth for client gating — but the server-side triggers and RPCs also enforce it, so a tampered client can't bypass anything important.

---

## 8. Waitlist (interim "upgrade" landing)

While payments are off:

```sql
create table public.waitlist (
  email      text primary key,
  user_id    uuid references auth.users on delete set null,
  source     text,                          -- 'upgrade_button' / 'sidebar_promo' / etc.
  created_at timestamptz not null default now()
);
alter table public.waitlist enable row level security;
create policy "waitlist owner insert" on public.waitlist
  for insert with check (true);  -- anyone (authenticated or anon) can sign up
```

The "Upgrade" button writes to this table. When Lemonsqueezy is wired later, we email these people first with a launch discount.

---

## 9. Reading-session tracking detail

Every time the client transitions from "playing" → "paused" or "finished", and at most every 30s during long reads, the client calls `recordReadingSession` with:

- `words_read` — how many word ticks happened since the last record
- `wpm` — current WPM setting
- `duration_seconds` — wall-clock duration of the segment
- `document_id` *or* `paste_session_id` (or both null, for transient fasty-from-selection reads)

The server-side function silently drops rows under the floor (10 s OR 20 words). The client never reads `reading_sessions` directly — it only reads its aggregate stats via the leaderboard view.

---

## 10. Country detection

On signup, default the country selector to whatever the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone` maps to (e.g. `Europe/Amsterdam` → `NL`).

**Deliverable:** ship a small hand-rolled timezone-to-country map (~50 lines) covering every IANA timezone whose name starts with `Europe/`, `America/`, `Asia/`, `Australia/`, plus the half-dozen common one-offs (`Africa/Cairo` → `EG`, etc.). Unknown timezones default to *no preselection* (the user picks manually in the dropdown). No third-party libraries.

We **do not** call any geo-IP service. No IP lookups, no third-party dependencies, no GDPR exposure beyond "user told us they're in NL".

---

## 11. UI sketches (descriptive)

- **Sidebar (top to bottom)**: `f a s t y` logo · "+ New paste" · "Import" · "🏆 Leaderboard" · ▼ Library (4/4 used badge) · ▼ Pasted texts (8/8 used badge) · ▼ Settings · Pro badge or "Upgrade to Pro" CTA · WPM/Pause/theme
- **Leaderboard overlay**: title "🏆 30-day leaderboard" · Tabs [Your country: NL 🇳🇱] [Global 🌍] · Table with rank, name, country flag, avg WPM (big), total words 30d (small), items read 30d (small) · Your own row pinned at the top with a "You" badge if outside top 50
- **Onboarding modal**: shown once after first sign-in (when display_name is null)
- **Upgrade modal**: title "Pro — coming soon" · benefit bullets · email field · "Notify me at launch" button

---

## 11.1 Downgrade behavior

If a Pro user is ever flipped back to Free (refund, manual SQL, future webhook):

- The cap triggers re-enforce immediately: any new `insert into documents/paste_sessions` over the 4/8 cap raises an exception. **Reads are unaffected**; existing rows stay visible until the user deletes down to the cap. (Same behavior as "library full" today.)
- Cloud sync stops mirroring; their IDB cache remains intact. New writes go to IDB only.
- WPM dropdown re-caps at 450 next time `tiers.getCaps()` refreshes.

No "destructive auto-delete" — we never throw away the user's data on a downgrade.

## 12. Out of scope (explicit)

- **Lemonsqueezy / actual payments.** Built later in a follow-up spec.
- **iOS native version.** Same as before; the Pro/Free split will translate cleanly to Apple's In-App Purchase when we get there.
- **Friends-only leaderboards / following users.** Possible v2; not now.
- **Email digests of leaderboard standing.** v2.
- **Anti-cheat detection of fake high WPM.** v2 — the 500-word minimum and 30-day rolling average filter most casual abuse.
- **Multilingual leaderboard.** v2 — country grouping is enough geographic flavor for now.

---

## 13. Acceptance criteria

- Sign-in is required to use the app. Auth modal can't be dismissed when signed out.
- First-time sign-in shows an onboarding modal asking for display name + country.
- Free user can import at most 4 docs; trying a 5th surfaces a toast with the cap and an "Upgrade" call to action.
- Same for 8 paste sessions.
- WPM dropdown caps at 450 (free) / 900 (pro).
- 4th URL import in a calendar month is blocked for free users; the 71st for pro.
- Pro users sync everything; free users sign in but their data stays in IndexedDB only.
- The leaderboard overlay shows two tabs (country / global), updates within an hour of new reading sessions, and only includes users with `leaderboard_optin = true` AND ≥ 500 words read in 30 days.
- Clicking "Upgrade to Pro" saves the email to `waitlist` and shows a thank-you message.
- Manually flipping `profiles.tier` to `'pro'` via SQL immediately unlocks all Pro features on next page load.

---

## 14. Risks & open questions

- **Onboarding friction.** Asking display name + country + leaderboard opt-in on first run might bounce some users. Mitigation: a prominent "Skip" with sensible defaults (leaderboard_optin=false if skipped).
- **Cheating WPM.** Someone could blast a single paragraph at 2000 WPM repeatedly. The 500-word activity floor + 30-day rolling avg handles most of it; if it becomes a problem we add a max-WPM-per-session sanity cap.
- **`leaderboard_30d` refresh load.** Hourly refresh on a small free-tier Postgres is fine for a few thousand users; switch to `refresh ... concurrently` (already in spec) and add a partial-window incremental approach later if it ever becomes slow.
- **GDPR.** Only PII collected: email (Supabase Auth), display_name (user-chosen), country_code (user-chosen / inferred from timezone). Nothing leaves Supabase. Leaderboard exposes display_name + country to the public — covered by the opt-in toggle at signup.
