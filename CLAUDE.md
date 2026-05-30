# Fasty — project orientation

Speed-reading web app (RSVP + faithful PDF/EPUB view). Free / Pro tiers, public
30-day leaderboard, lifetime Pro at €9 via Stripe.

## Stack

- **Frontend:** vanilla ES modules, **no build step**. HTML + CSS + JS served
  directly. Imports are static `import ... from './src/foo.js'`.
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions).
- **Payments:** Stripe Payment Link → webhook (Supabase Edge Function) → flips
  `profiles.tier` to `pro`.
- **Hosting:** Cloudflare Workers (with static assets). Auto-deploys from `main`
  on every push.

## URLs

- Live: **https://getfasty.com**
- Cloudflare fallback: `https://fasty.marketing-cea.workers.dev`
- Repo: https://github.com/ferduque/fasty
- Supabase project ref: `hdzykardmczasemtmbsm`
- Stripe account: `acct_1R3xiOD1kENjpXwh` (display_name: "Precence")

## Files that matter

- `app.js` — main app shell, `FastyApp` class.
- `index.html` — single-page entry. **Cache buster `?v=N`** on JS + CSS imports.
  **Bump this number on every JS or CSS change**, else users hit stale code.
- `src/cloud.js` — Supabase client wrapper. Loads config from `public-config.js`.
- `src/public-config.js` — `SUPABASE_URL` + `SUPABASE_ANON_KEY`. **Committed
  intentionally** — anon key is public-safe (RLS protects everything).
- `src/storage.js` — IndexedDB facade. `mirror()` helper gates cloud writes on
  Pro tier.
- `src/tiers.js` — client-side tier cache. `getCaps()`, `isPro()`,
  `waitForTierLoad()`, `refreshTier()`.
- `src/auth-ui.js` — sign-in modal. `lockAuthOpen()` makes it mandatory.
- `src/leaderboard.js` — overlay rendering, country + global tabs.
- `src/upgrade-ui.js` — Buy button + Stripe Payment Link redirect.
- `supabase/migrations/` — schema migrations (numbered 0001+). Apply via
  Supabase MCP `apply_migration` AND save identical SQL to the file.
- `supabase/functions/stripe-webhook/index.ts` — Deno edge function. Verifies
  Stripe signature, handles `checkout.session.completed` (→ tier='pro') and
  `charge.refunded` (→ tier='free').

## Database conventions

- Schema changes go through **Supabase MCP** (`mcp__supabase__apply_migration`)
  AND get saved to `supabase/migrations/NNNN_name.sql` as a record. The MCP
  applies the migration directly to the live remote project — there is no
  local stack.
- `public.profiles` has a **`lock_profile_protected_columns()` trigger** that
  reverts client writes to `tier`, counters, `stripe_customer_id`,
  `stripe_payment_intent_id`, and `created_at` unless `auth.role() = 'service_role'`.
  The edge function uses the service role and is the only path to flip tier.
- Materialized view `public.leaderboard_30d` UNION-s real users with
  `public.demo_leaderboard_entries` (seeded demo data, see memory). Refreshed
  hourly by `pg_cron`. After demo data changes, run `refresh materialized view`
  to see them immediately.

## Branching

- `main` is what's deployed. Push to `main` → Cloudflare auto-builds in ~1 min.
- Feature work goes on `feature/*` branches; merge to `main` when ready.
- The monetization work happened on `feature/monetization` (now merged).

## Mobile UI architecture (added May 30 2026)

Mobile uses a JS-toggled `.app-container.is-mobile` class as the gate for the
entire mobile cascade — no raw `@media` rules for layout (only for safe areas).
This keeps CSS and the JS reparenting logic in lockstep.

- **Detection:** `matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px)')`
  in `FastyApp.constructor`. Listener flips `this.isMobile` and re-runs
  `applyMobileMode()` on viewport / pointer changes.
- **JS reparenting (no DOM duplication):** WPM + Pause `<select>`s and the
  theme toggle are *physically moved* between `.sidebar-footer .settings-row`
  (desktop) and `#mobile-settings-row` / `#mobile-theme-slot` (mobile) when
  `applyMobileMode()` runs. Same element instance → listeners and values are
  preserved automatically, no sync logic needed.
- **Touch-aware copy:** `t(key)` helper picks desktop vs mobile string from a
  single `COPY` map (`'Press Space'` vs `'Tap'`, etc.). All `updateStatus()`
  callers pass keys, not literal HTML. `_currentStatusKey` is tracked so
  resize re-renders status with new wording.
- **Distraction-free reading:** `.app-container.is-mobile.reading` fades
  `.mobile-topbar`, `.mobile-settings-row`, `.paste-input` to opacity 0
  with pointer-events none. RSVP container is `position: absolute; inset: 0`
  with `z-index: 1` so the word is always at *true viewport center*, not
  the residual space after chrome.
- **"Tap here!" / "Next page" hint:** `#mobile-tap-hint` element. Shows only
  in two states: (a) initial — text loaded but never started, (b) end of a
  document page (pageBreak status). Hidden at paragraph breaks (small status
  text below RSVP handles those) and during active reading. Logic is in
  `updateMobileTapHint()`, called from every state transition.
- **iOS viewport lockdown:** `.app-container.is-mobile` is `position: fixed;
  inset: 0; touch-action: manipulation` so the page truly can't scroll or
  zoom. Viewport meta needs `maximum-scale=1, user-scalable=no,
  viewport-fit=cover` — the latter activates `env(safe-area-inset-*)` (notch
  + home indicator). Without `viewport-fit=cover` the insets return 0.
- **iOS auto-zoom-on-input:** any `<input>` / `<textarea>` with effective
  font-size below 16px causes iOS Safari to zoom in on focus. Mobile textarea
  is pinned to 16px to prevent that.
- **Safari URL bar:** use `100dvh` not `100vh` for any element that needs to
  fit *within* the visible viewport (URL bar can collapse, dvh tracks it).
  Sidebar drawer uses `height: 100dvh` not `bottom: 0` for this reason.

## Deploy verification

After every push, check:

```bash
curl -s https://getfasty.com/ | grep -E "v=[0-9]+"
```

`?v=N` should match the latest commit's `index.html`. Cloudflare cache is
configured (`_headers`) so `/index.html`, `/app.js`, `/styles.css`, and `/src/*`
all revalidate.

## Local dev

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Add `http://localhost:8080/**` to Supabase Auth redirect URLs (it's already
there from past setup). The same `public-config.js` works in local + prod since
Supabase Auth allows both URLs.

## Testing

There is **no automated test suite**. Every task ends with manual verification:
hard-reload `getfasty.com` and click through the changed flow. The plan in
`docs/superpowers/plans/2026-05-27-monetization-and-leaderboard.md` documents
this convention.

## MCP servers used

- **Supabase MCP** (`.mcp.json`) — apply migrations, run SQL, deploy edge
  functions, manage secrets.
- **Stripe MCP** (claude.ai connector) — create products/prices/payment links,
  issue refunds. **Mode (test vs live) is bound to whichever Stripe dashboard
  mode was active when MCP was authorized.** To switch modes, change the
  dashboard mode in the browser, then `/mcp` → disconnect → reconnect.

## Gotchas worth knowing

- **Profile lock trigger bypass for ad-hoc admin updates**: MCP `execute_sql`
  runs as `postgres` superuser but `auth.role()` returns NULL, so the lock
  trigger blocks tier updates. Use `SET LOCAL session_replication_role = replica;`
  in the same statement to bypass.
- **Stripe Payment Link doesn't create Customer objects by default** for guest
  checkouts → `session.customer` is null in the webhook. That's why we also
  store `stripe_payment_intent_id` — it's always present and used as the link
  for refund → downgrade flow.
- **Cloudflare auto-deploys from `main` only.** Pushing to feature branches
  doesn't deploy.
