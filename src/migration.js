/**
 * One-time push of local IndexedDB data into the cloud after the user signs
 * in. Idempotent — keyed on the local UUIDs so re-running upserts instead of
 * duplicating. Gated by localStorage `fasty.migratedAt.<userId>` so it only
 * runs once per device per account.
 */
import {
  listDocuments as localListDocs,
  getDocument as localGetDoc,
  listPasteSessions as localListSessions,
  getPasteSession as localGetSession,
  getProgress as localGetProgress,
} from './storage.js';
import {
  currentUser,
  cloudSaveDoc,
  cloudSaveSession,
  cloudSaveProgress,
} from './cloud.js';
import { waitForTierLoad, isPro } from './tiers.js';
import { toast } from './toasts.js';

const FLAG_PREFIX = 'fasty.migratedAt.';

export async function migrateLocalToCloudIfNeeded() {
  const user = currentUser();
  if (!user) return;
  await waitForTierLoad();
  if (!isPro()) return;
  const flagKey = FLAG_PREFIX + user.id;
  if (localStorage.getItem(flagKey)) return;

  let docsOk = 0, docsFail = 0;
  let sessionsOk = 0, sessionsFail = 0;

  // Documents (and their progress rows)
  const docs = await localListDocs().catch(() => []);
  for (const summary of docs) {
    try {
      const full = await localGetDoc(summary.id);
      if (!full) continue;
      await cloudSaveDoc(full);
      const progress = await localGetProgress(full.id);
      if (progress) await cloudSaveProgress(full.id, progress);
      docsOk++;
    } catch (err) {
      console.warn('Migration failed for doc', summary.id, err);
      docsFail++;
    }
  }

  // Paste sessions
  const sessions = await localListSessions().catch(() => []);
  for (const s of sessions) {
    try {
      const full = await localGetSession(s.id);
      if (!full) continue;
      await cloudSaveSession(full);
      sessionsOk++;
    } catch (err) {
      console.warn('Migration failed for session', s.id, err);
      sessionsFail++;
    }
  }

  localStorage.setItem(flagKey, String(Date.now()));

  if (docsOk + sessionsOk === 0 && docsFail + sessionsFail === 0) return;
  const total = docsOk + sessionsOk;
  const failed = docsFail + sessionsFail;
  if (failed === 0) {
    toast(`Synced ${docsOk} ${plural('document', docsOk)} and ${sessionsOk} paste ${plural('session', sessionsOk)} to your account.`);
  } else {
    toast(`Synced ${total} items. ${failed} couldn't sync — check the console.`, { error: true });
  }
}

function plural(word, n) { return n === 1 ? word : word + 's'; }
