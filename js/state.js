/**
 * Application state and every derived value.
 *
 * Persisted facts live in `saved` (collected ids, unlock dates, settings).
 * Everything a player sees — XP, level, percentages, category totals, quest
 * and achievement progress — is recomputed from those facts plus the dataset,
 * so the two can never drift apart (PRD §73).
 */

import { XP, CATEGORIES, levelFromXp, xpForLevel } from './config.js';
import * as storage from './storage.js';
import { mergeBackup } from './backup.js';

const listeners = new Set();

export const state = {
  /** @type {import('./data.js')} dataset */
  plaques: [],
  byId: new Map(),
  byCategory: new Map(),
  places: new Map(),

  saved: storage.load(),

  /** Transient UI state — never persisted. */
  tab: 'map',
  query: '',
  filters: { status: 'all', categories: new Set(), fame: 'all', distance: 'all' },
  userPos: null,          // { lat, lng, accuracy } — memory only (PRD §62)
  locationStatus: 'idle', // idle | asking | granted | denied | unavailable
  targetId: null,
  suggestedIds: [],       // recommendation history, for "Choose another" variety
  openPlaqueId: null,

  /**
   * Test override (see config.js). When true, a find counts as verified
   * without any proximity — or even any location — check. Off unless the
   * URL or the console switches it on; nothing persists it.
   */
  verifyAnywhere: false,
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(type, detail) { listeners.forEach(fn => fn(type, detail)); }

export function setDataset({ plaques, byId, byCategory, places }) {
  Object.assign(state, { plaques, byId, byCategory, places });
}

function persist() { storage.save(state.saved); }

/* ── Collection ─────────────────────────────────────────────────────────── */

export const isCollected = id => Object.hasOwn(state.saved.collected, id);
export const collectionEntry = id => state.saved.collected[id] || null;

export function xpFor(plaque, verified) {
  const base = plaque.fame >= 3 ? XP.iconic : plaque.fame >= 2 ? XP.famous : XP.standard;
  return base + (verified ? XP.verified : 0);
}

function nextSeq() {
  return Object.values(state.saved.collected)
    .reduce((max, entry) => Math.max(max, entry.seq || 0), 0) + 1;
}

/** Records a discovery. Returns null when it was already collected. */
export function collect(id, verified) {
  if (isCollected(id)) return null;
  const plaque = state.byId.get(id);
  if (!plaque) return null;
  state.saved.collected[id] = {
    collectedAt: new Date().toISOString(),
    verified: !!verified,
    seq: nextSeq(),
  };
  persist();
  const gained = xpFor(plaque, verified);
  emit('collect', { plaque, verified: !!verified, xp: gained });
  return { plaque, verified: !!verified, xp: gained };
}

/** Not surfaced in the main UI; used by the About sheet's undo affordance. */
export function uncollect(id) {
  if (!isCollected(id)) return false;
  delete state.saved.collected[id];
  persist();
  emit('collect', { plaque: state.byId.get(id), removed: true });
  return true;
}

export function markUnlocked(kind, key) {
  const bag = kind === 'quest' ? state.saved.completedQuests : state.saved.unlockedAchievements;
  if (bag[key]) return false;
  bag[key] = new Date().toISOString();
  persist();
  return true;
}

/**
 * Folds a decoded backup into the current save. Merges rather than replaces,
 * so restoring can never lose a discovery made on this device.
 */
export function applyBackup(entries) {
  const result = mergeBackup(state.saved, entries, { knownIds: new Set(state.byId.keys()) });
  persist();
  emit('restore', result);
  return result;
}

export function setSetting(key, value) {
  state.saved.settings[key] = value;
  persist();
}
export const getSetting = key => state.saved.settings[key];

export function resetProgress() {
  state.saved = storage.reset();
  state.targetId = null;
  state.suggestedIds = [];
  emit('reset');
}

/* ── Derived progress ───────────────────────────────────────────────────── */

let cache = null;
export function invalidate() { cache = null; }

/**
 * Everything the UI needs about the player, computed from collected ids.
 * Cached until the next mutation so repeated reads in one render are cheap.
 */
export function progress() {
  if (cache) return cache;

  const ids = Object.keys(state.saved.collected);
  const total = state.plaques.length;

  let xp = 0, iconic = 0, famous = 0, verified = 0;
  const byCategory = new Map(CATEGORIES.map(c => [c.slug, 0]));
  const collectedPlaques = [];

  for (const id of ids) {
    const plaque = state.byId.get(id);
    if (!plaque) continue;                      // dataset changed under us
    const entry = state.saved.collected[id];
    xp += xpFor(plaque, entry.verified);
    if (plaque.fame >= 3) iconic++;
    else if (plaque.fame >= 2) famous++;
    if (entry.verified) verified++;
    byCategory.set(plaque.category, (byCategory.get(plaque.category) || 0) + 1);
    collectedPlaques.push({ plaque, entry });
  }

  collectedPlaques.sort((a, b) =>
    b.entry.collectedAt.localeCompare(a.entry.collectedAt) ||
    (b.entry.seq || 0) - (a.entry.seq || 0));

  const level = levelFromXp(xp);
  const levelFloor = xpForLevel(level);
  const levelCeil = xpForLevel(level + 1);

  const categories = CATEGORIES.map(c => {
    const totalIn = state.byCategory.get(c.slug)?.length || 0;
    const found = byCategory.get(c.slug) || 0;
    return { ...c, total: totalIn, found, percent: totalIn ? found / totalIn : 0 };
  });

  cache = {
    count: collectedPlaques.length,
    total,
    percent: total ? collectedPlaques.length / total : 0,
    xp, level, levelFloor, levelCeil,
    xpIntoLevel: xp - levelFloor,
    xpForNextLevel: levelCeil - levelFloor,
    xpToNextLevel: Math.max(0, levelCeil - xp),
    iconic, famous, verified,
    categories,
    categoriesWithAny: categories.filter(c => c.found > 0).length,
    recent: collectedPlaques.slice(0, 8),
    collectedPlaques,
  };
  return cache;
}

/** Category totals for the map/filters, independent of what has been found. */
export function categoryTotals() {
  return CATEGORIES.map(c => ({ ...c, total: state.byCategory.get(c.slug)?.length || 0 }))
                   .filter(c => c.total > 0);
}

subscribe(invalidate);
