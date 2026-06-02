# Account Data Isolation — Design Spec

**Date:** 2026-06-02
**Status:** Approved, ready for implementation plan
**Author:** Fernando + Claude

## Problem

Local IndexedDB (`fasty` database, stores: `documents`, `progress`, `paste_sessions`) is **not scoped per user**. No `user_id` column exists on any local store. `cloud.signOut()` only clears the Supabase auth session — IndexedDB persists. Consequences:

1. **Visible cross-account contamination.** Sign in as A → A's docs pulled from cloud into local IDB. Sign out → IDB retains A's docs. Sign in as B → B's docs pulled into the same IDB. Library now shows A's + B's docs mixed.

2. **Data exfiltration via migration (worse).** `src/migration.js` runs once per (device, user) pair on sign-in for Pro users. It iterates `listDocuments()` (all rows in local IDB) and calls `cloudSaveDoc()` for each — uploading A's leftover local docs to **B's cloud account**. Cross-account upload, permanent until B manually deletes them.

3. **Privacy on shared devices.** A signs out, B uses the same browser anonymously — sees A's local docs in the sidebar.

The Supabase cloud layer is unaffected: RLS policies on `documents`, `progress`, `paste_sessions`, `reading_sessions` all enforce `user_id = auth.uid()`. The leak is purely client-side IndexedDB.

## Goal

Stop the leak by tying local IndexedDB ownership to a single user. Sign-out purges. Sign-in detects ownership mismatch and purges before pulling new data.

## Out of scope

- Cleaning up cross-account data that's *already* in the Supabase cloud (separate forensic cleanup, not done here)
- Per-user IndexedDB namespacing (Option B from the analysis) — bigger refactor, deferred
- Adding `user_id` columns to local stores (Option C) — overkill
- Anonymous-user data lifetime policies (free-tier users staying signed-out indefinitely)

## Design (Option A from the analysis)

### State

A single new `localStorage` key:

```
fasty.localOwner = <user.id | "anonymous">
```

`user.id` is the Supabase auth user UUID. `"anonymous"` is the sentinel for never-signed-in usage.

### Behaviour

**On sign-in (auth state change to a non-null user):**

```
if localOwner is empty:
    set localOwner = currentUser.id        # claim local data for this user
    pullCloudIntoLocal()                    # normal sync
elif localOwner === currentUser.id:
    # match — local data is already theirs
    pullCloudIntoLocal()
elif localOwner === "anonymous":
    set localOwner = currentUser.id        # claim anonymous local data
    pullCloudIntoLocal()
else:
    # mismatch — local data belongs to a different user
    purgeLocalIDB()
    set localOwner = currentUser.id
    pullCloudIntoLocal()                    # fresh start from cloud
```

**On sign-out (auth state change to null):**

```
purgeLocalIDB()
clear localOwner (or set to "anonymous")
```

**On anonymous read/write (currentUser is null and never has been):**

```
if localOwner is empty:
    set localOwner = "anonymous"
# proceed normally
```

### Purge implementation

```js
async function purgeLocalIDB() {
    // Close any open connection then delete the DB so the next open
    // recreates fresh stores via onupgradeneeded.
    if (dbPromise) {
        try { (await dbPromise).close(); } catch (_) {}
        dbPromise = null;
    }
    await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve(); // other tabs holding the DB — best effort
    });
    // Wipe any per-user migration flags too so the next user's first
    // sign-in re-runs migrate cleanly without re-uploading stale data.
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('fasty.migratedAt.')) {
            localStorage.removeItem(key);
        }
    }
}
```

### Auth state change wiring

Currently `src/cloud.js init()` registers a single `onAuthStateChange` listener that updates `currentUserCache` and notifies external `authListeners`. The purge / owner-check logic runs as one of those external listeners, registered from `src/storage.js` (or a new `src/account-isolation.js` if cleaner).

```js
// in storage.js, exported and registered from app.js on boot
export async function onAuthChange(user) {
    const OWNER_KEY = 'fasty.localOwner';
    const stored = localStorage.getItem(OWNER_KEY);

    if (!user) {
        // Sign-out
        await purgeLocalIDB();
        localStorage.setItem(OWNER_KEY, 'anonymous');
        return;
    }

    const currentId = user.id;
    if (!stored || stored === 'anonymous' || stored === currentId) {
        localStorage.setItem(OWNER_KEY, currentId);
        return; // no purge needed
    }

    // Mismatch
    await purgeLocalIDB();
    localStorage.setItem(OWNER_KEY, currentId);
}
```

The existing `app.js` already wires `onAuthChange` from `cloud.js`. We add one more listener for the isolation logic, ordered **before** `pullCloudIntoLocal()` and `migrateLocalToCloudIfNeeded()` so purges happen first.

### Edge cases

1. **Concurrent tabs:** if user signs out in tab A, tab B is still open with stale data. `deleteDatabase` returns `onblocked` because tab B holds the connection. We resolve the promise on blocked (best effort) so the sign-out flow doesn't hang. Tab B will continue showing stale data until reloaded — acceptable for this fix; the user can close other tabs.

2. **Free-tier user signs in then out repeatedly:** every sign-out purges. They lose any local-only documents they added while signed in. Acceptable — Pro is the documented path for persistence across devices; free is single-device, no expectation of sync.

3. **Page load detects an existing local DB but no owner stamp:** can happen on the first load *after* this fix deploys for existing users. Behaviour:
   - If currently signed in → claim existing local data as theirs (best-guess: it's their browser).
   - If currently signed out → mark as `"anonymous"` and leave data alone (it's whoever last used the browser; could be wrong, but purging surprise-deletes existing free-tier users' libraries).

   This means **the fix stops the leak going forward** but doesn't retroactively clean up already-contaminated browsers. Fernando's own browser may carry stale entries until he manually clears site data or signs out + back in to trigger a purge.

4. **Migration flag interaction:** `fasty.migratedAt.<userId>` exists per (device, user) pair. After purge we clear all such flags so a subsequent sign-in re-runs migration cleanly. Without clearing them, a re-signed-in user would skip migration and the cloud copy stays authoritative — which is fine, but inconsistent.

5. **Cloud-side cleanup of historical leaks:** outside scope. If Fernando has Pro accounts that received foreign-uploaded docs from prior sign-ins, that data is in their cloud. A separate audit + delete pass would be needed. Track separately.

## Files affected

- `src/storage.js` — add `purgeLocalIDB()`, `onAuthChange(user)` helper, export both
- `src/cloud.js` — minor: no behaviour change, but `signOut()` could explicitly call `onAuthChange(null)` first as a belt-and-suspenders (the auth state change listener will fire anyway, but ordering is clearer)
- `app.js` — register the new `onAuthChange` listener from `storage.js` near the existing auth wiring (around line ~1245)
- `index.html` — cache bust

No new files needed. ~30–40 lines of new code.

## Testing

No automated tests. Manual verification:

1. **Single-account stability**
   - Sign in as A. Import a doc, add a paste session. Sign out.
   - Sign back in as A. Confirm doc + session still there (came back via cloud sync).

2. **Cross-account purge**
   - Sign in as A. Import a doc unique to A. Sign out.
   - Sign in as B (different account). Confirm A's doc is gone. Confirm B's own docs (from cloud) are present.
   - Sign out, sign back in as A. Confirm A's doc returns from cloud.

3. **Anonymous → sign-in (claim)**
   - Open in a fresh browser profile, don't sign in. Paste text and save it as a session (free-tier local).
   - Sign in as a new user A. Confirm session is still there (claimed by A).
   - If A is Pro, confirm the session uploaded to A's cloud account.

4. **Anonymous → sign-in (purge)**
   - Sign in as A. Use the app. Sign out.
   - Confirm local IDB is empty (open DevTools → Application → IndexedDB → fasty → should be empty or DB recreated).
   - Sign in as B. Confirm B's docs only.

5. **Migration leak no longer happens**
   - Sign in as Pro account A. Note A's cloud docs.
   - Sign out, sign in as Pro account B.
   - Check B's cloud documents table — should contain only B's pre-existing docs, none of A's.
   - Use Supabase MCP or dashboard to verify: `select user_id, title from documents where user_id = '<B user_id>';`

## Risks

- **Existing free-tier users may lose local-only libraries on first sign-out post-deploy.** They've never had cloud sync, so the IDB is their only copy. Mitigation: the spec preserves data for users who don't sign out (claim-on-first-load).
- **`indexedDB.deleteDatabase` is async + can block.** Handled via `onblocked` resolve so the sign-out flow never hangs.
- **The `pullCloudIntoLocal` call after a purge is the new source of truth.** If Supabase is unreachable at that moment, the user sees an empty library until next reload. Acceptable for an offline-rare flow; the sidebar already shows an empty state.
