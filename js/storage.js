/**
 * Versioned localStorage persistence (PRD §37–38).
 *
 * Only facts are stored — which plaques were collected, when, and whether the
 * find was location-verified. Everything derivable (XP, level, percentages,
 * category and quest progress) is recomputed at runtime so saved state can
 * never disagree with the dataset.
 *
 * Every read is defensive: missing, malformed, truncated or future-schema data
 * degrades to an empty-but-valid save rather than throwing.
 */

import { STORAGE_KEY, SCHEMA_VERSION } from './config.js';

function emptySave() {
  return {
    version: SCHEMA_VERSION,
    collected: {},
    unlockedAchievements: {},
    completedQuests: {},
    settings: {},
  };
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Keep only entries that match the expected shape; drop anything else. */
function sanitiseCollected(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [id, entry] of Object.entries(raw)) {
    if (typeof id !== 'string' || !id) continue;
    if (!isPlainObject(entry)) continue;
    const collectedAt = typeof entry.collectedAt === 'string' ? entry.collectedAt
                                                              : new Date(0).toISOString();
    // `seq` orders finds made in the same second. Object key order cannot do
    // this job: numeric-looking plaque ids iterate numerically, not by
    // insertion, so without it "most recent" would be arbitrary.
    const seq = Number.isFinite(entry.seq) ? entry.seq : 0;
    out[id] = { collectedAt, verified: entry.verified === true, seq };
  }
  return out;
}

function sanitiseDates(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key === 'string' && typeof value === 'string') out[key] = value;
  }
  return out;
}

let available = null;

/** Feature-detect once; Safari private mode and locked-down browsers throw. */
export function storageAvailable() {
  if (available !== null) return available;
  try {
    const probe = `${STORAGE_KEY}:probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export function load() {
  if (!storageAvailable()) return emptySave();
  let parsed;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySave();
    parsed = JSON.parse(raw);
  } catch {
    return emptySave();                     // corrupt JSON — start clean
  }
  if (!isPlainObject(parsed)) return emptySave();

  // A save written by a newer version of the app may contain fields we do not
  // understand. Read the parts we do recognise and leave the rest alone.
  return {
    version: SCHEMA_VERSION,
    collected: sanitiseCollected(parsed.collected),
    unlockedAchievements: sanitiseDates(parsed.unlockedAchievements),
    completedQuests: sanitiseDates(parsed.completedQuests),
    settings: isPlainObject(parsed.settings) ? parsed.settings : {},
  };
}

export function save(data) {
  if (!storageAvailable()) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;                           // quota exceeded — keep running
  }
}

/** Safe reset, exposed on window.__lu rather than as a prominent UI button. */
export function reset() {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  return emptySave();
}
