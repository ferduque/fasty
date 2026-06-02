# Account Data Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop cross-account IndexedDB pollution. Sign-out purges local data; sign-in detects owner mismatch and purges before pulling cloud.

**Architecture:** New `localStorage` key `fasty.localOwner` stores the user.id of whichever account currently "owns" the local IndexedDB. New helper `applyAccountIsolation(user)` in `src/storage.js` is wired as an auth-change listener in `app.js` **before** the existing migrate + pull calls, so purges run first.

**Tech Stack:** Vanilla ES modules, no build step, manual DevTools verification.

**Spec:** `docs/superpowers/specs/2026-06-02-account-data-isolation-design.md`

**Commit cadence:** One commit per task. Cache bump on the last task.

---

## File Structure

- `src/storage.js` — add `purgeLocalIDB()` and `applyAccountIsolation(user)`
- `app.js` — wire the new helper into the existing `cloud.onAuthChange` listener at line ~1379, before migrate + pull
- `index.html` — bump `?v=36` → `?v=37`

No new files.

---

## Task 1: Add purge + isolation helpers in storage.js

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/src/storage.js`

- [ ] **Step 1: Add `purgeLocalIDB()` after the existing `openDB()` helper**

Find the end of `openDB()` (around line 55). After the closing brace, add:

```js

/**
 * Delete the entire local IndexedDB. Used on sign-out and on detecting an
 * owner-mismatch at sign-in. Closes any open connection first so the
 * deleteDatabase request isn't blocked. Also clears per-user migration
 * flags so a subsequent sign-in re-runs migration cleanly.
 *
 * Returns a promise that resolves once the DB is deleted (or once the
 * delete is blocked by another tab — best-effort).
 */
async function purgeLocalIDB() {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch (_) {}
    dbPromise = null;
  }
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve(); // best-effort, don't throw on the auth flow
    req.onblocked = () => resolve(); // another tab still has the DB open
  });
  // Wipe per-user migration flags. A new sign-in will set its own flag
  // after running migrate cleanly.
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith('fasty.migratedAt.')) {
      localStorage.removeItem(key);
    }
  }
}
```

- [ ] **Step 2: Add `applyAccountIsolation(user)` exported helper**

Append at the end of `storage.js` (after the existing exports):

```js

// ==================== Account isolation ====================
// Ensures the local IndexedDB belongs to exactly one user at a time.
// See docs/superpowers/specs/2026-06-02-account-data-isolation-design.md

const OWNER_KEY = 'fasty.localOwner';
const ANONYMOUS = 'anonymous';

/**
 * Called on every auth-state change (sign-in, sign-out). Decides whether
 * the current local IDB is safe to keep (matching owner stamp), needs to
 * claim ownership (anonymous or empty stamp), or needs to be purged
 * (mismatch — a different user previously owned this device's data).
 *
 * Must be called BEFORE migrateLocalToCloudIfNeeded() and pullCloudIntoLocal()
 * so purges happen first and downstream sync sees a clean slate.
 */
export async function applyAccountIsolation(user) {
  const stored = localStorage.getItem(OWNER_KEY);

  if (!user) {
    // Sign-out: purge and mark anonymous.
    await purgeLocalIDB();
    localStorage.setItem(OWNER_KEY, ANONYMOUS);
    return;
  }

  const currentId = user.id;

  // No stamp yet, anonymous stamp, or already this user → claim and continue.
  if (!stored || stored === ANONYMOUS || stored === currentId) {
    localStorage.setItem(OWNER_KEY, currentId);
    return;
  }

  // Mismatch: previously owned by a different user. Purge then claim.
  await purgeLocalIDB();
  localStorage.setItem(OWNER_KEY, currentId);
}
```

- [ ] **Step 3: Syntax check**

```bash
node --check /Users/ferrduque/APPS\ AI/fasty/src/storage.js && echo "OK"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd "/Users/ferrduque/APPS AI/fasty"
git add src/storage.js
git commit -m "$(cat <<'EOF'
Add purgeLocalIDB + applyAccountIsolation to storage.js

Foundation for the account-isolation fix. purgeLocalIDB closes any
open IndexedDB connection, deletes the DB, and wipes per-user
fasty.migratedAt.<userId> flags so the next sign-in runs migrate
cleanly.

applyAccountIsolation(user) reads the localStorage owner stamp:
  - no stamp / anonymous / match → claim, no purge
  - mismatch → purge then claim
  - null user (sign-out) → purge, mark anonymous

Not wired in yet — next commit hooks it into the auth listener.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire applyAccountIsolation into the auth listener

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/app.js` (line ~15 import, line ~1379 listener)

- [ ] **Step 1: Add applyAccountIsolation to the storage import**

Find line ~15:

```js
import { pullCloudIntoLocal } from './src/storage.js';
```

Change to:

```js
import { pullCloudIntoLocal, applyAccountIsolation } from './src/storage.js';
```

- [ ] **Step 2: Call applyAccountIsolation FIRST in the auth listener**

Find the auth listener at line ~1379:

```js
        cloud.onAuthChange(async (user) => {
            if (user) {
                unlockAuthClosed();
                // First sign-in on this device pushes existing local data up.
                await migrateLocalToCloudIfNeeded();
                // And pulls anything else from the account back down.
                await pullCloudIntoLocal();
                // First-time-sign-in: prompt for display name + country + opt-in.
                await maybeShowOnboarding();
            } else {
                lockAuthOpen();
            }
            // Refresh sidebar either way (sign-in adds rows, sign-out keeps local).
            refreshLibrary();
            refreshPasteSessions();
        });
```

Change to:

```js
        cloud.onAuthChange(async (user) => {
            // Account isolation must run BEFORE migrate + pull so any purge
            // happens before downstream sync writes new rows.
            await applyAccountIsolation(user);

            if (user) {
                unlockAuthClosed();
                // First sign-in on this device pushes existing local data up.
                await migrateLocalToCloudIfNeeded();
                // And pulls anything else from the account back down.
                await pullCloudIntoLocal();
                // First-time-sign-in: prompt for display name + country + opt-in.
                await maybeShowOnboarding();
            } else {
                lockAuthOpen();
            }
            // Refresh sidebar either way (sign-in adds rows, sign-out resets local).
            refreshLibrary();
            refreshPasteSessions();
        });
```

(Comment tweaked: was "sign-out keeps local" — that's no longer true after this fix.)

- [ ] **Step 3: Syntax check**

```bash
node --check /Users/ferrduque/APPS\ AI/fasty/app.js && echo "OK"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "$(cat <<'EOF'
Wire applyAccountIsolation into the auth-change listener

Runs before migrate + pull so any cross-account purge happens BEFORE
any cloud sync writes new rows into the local IDB. On sign-out the
purge also runs, clearing local data so anonymous use of a shared
browser after sign-out doesn't expose the prior user's library.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Cache bump + push

**Files:**
- Modify: `/Users/ferrduque/APPS AI/fasty/index.html`

- [ ] **Step 1: Bump cache version**

Use Edit with `replace_all: true` on `?v=36` → `?v=37`.

Confirm both lines:

```bash
grep -n '?v=' /Users/ferrduque/APPS\ AI/fasty/index.html
```

Expected: both lines show `?v=37`.

- [ ] **Step 2: Commit + push**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Bump cache version to v=37 for account-isolation fix

Forces a clean JS reload so the new applyAccountIsolation logic is
live for all users on next visit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 3: Verify deploy**

```bash
curl -s https://getfasty.com/ | grep -oE 'v=[0-9]+' | head -2
```

Expected: `v=37` twice (after Cloudflare rebuild, ~1 min).

- [ ] **Step 4: Live verification (Fernando, after deploy)**

Same DevTools window:
1. Sign in as account A. Note the docs visible.
2. Sign out. Open DevTools → Application → IndexedDB → should be no `fasty` DB (or completely empty).
3. Sign in as account B. Confirm A's docs are NOT visible. Only B's cloud docs appear.
4. Sign out, sign back in as A. A's docs return via cloud sync.

Cloud-side sanity (via Supabase MCP or dashboard):
- `select user_id, count(*) from documents group by user_id;` — confirm no user has more docs than expected. Pre-existing cross-account leaks won't be cleaned by this fix; they need a separate audit.

---

## Summary

3 tasks. ~50 lines of new code. No new files. Mobile + desktop UX work unaffected. Cloud RLS was already correct; this fix closes the local-side gap.
