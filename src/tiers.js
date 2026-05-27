/**
 * Client-side tier cache. Reads the user's profile once on sign-in, caches it,
 * and exposes simple getters the rest of the app uses to gate features.
 *
 * The server enforces caps independently (triggers + RPCs) — this module is
 * about UI correctness, not security.
 */
import { getProfile, onAuthChange } from './cloud.js';

const CAPS = {
  free: { maxDocs: 4,   maxSessions: 8,   maxWpm: 450,  urlImportsCap: 3  },
  pro:  { maxDocs: 20,  maxSessions: 300, maxWpm: 900,  urlImportsCap: 70 },
};

let cachedTier = 'free';
let cachedCaps = CAPS.free;
const listeners = [];

export function getTier() { return cachedTier; }
export function getCaps() { return cachedCaps; }
export function isPro() { return cachedTier === 'pro'; }

export function onTierChange(fn) {
  listeners.push(fn);
  try { fn(cachedTier, cachedCaps); } catch (e) { console.error(e); }
}

export function initTiers() {
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
