/**
 * London Uncovered — logic regression tests.
 *
 * Runs in JavaScriptCore with the stubs in env.mjs:
 *     bash tests/run.sh          (or)  jsc --module-file=tests/logic.test.mjs
 *
 * Covers the parts of the game that must never silently drift: XP and levels,
 * distance maths, storage robustness, derived progress, achievements, quests
 * and the recommendation ranking.
 */

import { rawStorage } from './env.mjs';
import { xpForLevel, levelFromXp, XP, VERIFY_RADIUS_M, CATEGORY_BY_SLUG } from '../js/config.js';
import { distanceMetres, formatDistance, walkingMinutes, directionsUrl } from '../js/geo.js';
import * as storage from '../js/storage.js';
import { loadPlaques } from '../js/data.js';
import * as store from '../js/state.js';
import { state } from '../js/state.js';
import { evaluate as evaluateAchievements, syncUnlocks, ACHIEVEMENTS } from '../js/achievements.js';
import { evaluate as evaluateQuests, QUESTS } from '../js/quests.js';
import { recommendNext } from '../js/recommend.js';
import { encodeBackup, decodeBackup, mergeBackup } from '../js/backup.js';

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) { passed++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
const eq = (name, actual, expected) =>
  check(name, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const near = (name, actual, expected, tol) =>
  check(name, Math.abs(actual - expected) <= tol, `expected ~${expected} (±${tol}), got ${actual}`);

function group(title) { print(`\n  ${title}`); }

/* ── Levels and XP (PRD §35–36) ─────────────────────────────────────────── */
group('levels & xp');
eq('level 1 threshold', xpForLevel(1), 0);
eq('level 2 threshold', xpForLevel(2), 100);
eq('level 3 threshold', xpForLevel(3), 250);
eq('level 4 threshold', xpForLevel(4), 450);
eq('level 5 threshold', xpForLevel(5), 700);
eq('0 xp is level 1', levelFromXp(0), 1);
eq('99 xp is still level 1', levelFromXp(99), 1);
eq('100 xp is level 2', levelFromXp(100), 2);
eq('449 xp is level 3', levelFromXp(449), 3);
eq('450 xp is level 4', levelFromXp(450), 4);
check('levels are monotonic', Array.from({ length: 40 }, (_, i) => levelFromXp(i * 100))
  .every((lvl, i, all) => i === 0 || lvl >= all[i - 1]));
check('every level boundary round-trips',
  Array.from({ length: 30 }, (_, i) => i + 1).every(n => levelFromXp(xpForLevel(n)) === n));

/* ── Geo (PRD §76) ──────────────────────────────────────────────────────── */
group('geo');
const trafalgar = { lat: 51.5080, lng: -0.1281 };
const stPauls   = { lat: 51.5138, lng: -0.0984 };
near('Trafalgar Sq → St Paul\'s ≈ 2.1 km', distanceMetres(trafalgar, stPauls), 2130, 90);
eq('zero distance', Math.round(distanceMetres(trafalgar, trafalgar)), 0);
eq('symmetric', Math.round(distanceMetres(trafalgar, stPauls)), Math.round(distanceMetres(stPauls, trafalgar)));
eq('metres formatting', formatDistance(184), '180 m');
eq('sub-km formatting', formatDistance(950), '950 m');
eq('km formatting', formatDistance(1240), '1.2 km');
eq('long distance formatting', formatDistance(12400), '12 km');
eq('walk time floor is 1 min', walkingMinutes(10), 1);
eq('walk time 400 m', walkingMinutes(400), 5);
check('directions url carries the destination',
  directionsUrl({ lat: 51.5, lng: -0.12 }).includes('51.5,-0.12'));

/* ── Storage robustness (PRD §38) ───────────────────────────────────────── */
group('storage');
rawStorage.clear();
eq('missing save is empty', Object.keys(storage.load().collected).length, 0);

rawStorage.set('londonUncovered:v0', '{not json');
eq('corrupt json degrades to empty', Object.keys(storage.load().collected).length, 0);

rawStorage.set('londonUncovered:v0', JSON.stringify({
  version: 99,
  collected: {
    good: { collectedAt: '2026-01-01T00:00:00Z', verified: true },
    bad1: 'nope',
    bad2: null,
    bad3: { verified: 'yes' },               // missing date, non-boolean verified
  },
  unlockedAchievements: { first_find: '2026-01-01T00:00:00Z', broken: 12 },
  completedQuests: 'not-an-object',
  settings: { seenIntro: true },
  futureField: { unknown: true },
}));
const recovered = storage.load();
eq('valid entry survives', recovered.collected.good.verified, true);
eq('string entry dropped', recovered.collected.bad1, undefined);
eq('null entry dropped', recovered.collected.bad2, undefined);
eq('partial entry repaired, not dropped', recovered.collected.bad3.verified, false);
eq('non-string unlock date dropped', recovered.unlockedAchievements.broken, undefined);
eq('valid unlock date kept', typeof recovered.unlockedAchievements.first_find, 'string');
eq('bad completedQuests replaced with object', typeof recovered.completedQuests, 'object');
eq('settings preserved', recovered.settings.seenIntro, true);
eq('version normalised', recovered.version, 1);

/* ── Dataset ────────────────────────────────────────────────────────────── */
group('dataset');
rawStorage.clear();
const dataset = await loadPlaques('data/plaques.geojson');
store.setDataset(dataset);
state.saved = storage.load();
store.invalidate();

check('dataset is non-empty', dataset.plaques.length > 900, `${dataset.plaques.length} plaques`);
eq('index size matches', dataset.byId.size, dataset.plaques.length);
check('every plaque has a known category',
  dataset.plaques.every(p => CATEGORY_BY_SLUG.has(p.category)));
check('every plaque has a category label',
  dataset.plaques.every(p => typeof p.categoryLabel === 'string' && p.categoryLabel.length > 0));
check('every plaque has finite coordinates',
  dataset.plaques.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)));
check('all coordinates fall inside Greater London',
  dataset.plaques.every(p => p.lat > 51.2 && p.lat < 51.8 && p.lng > -1 && p.lng < 0.6));
check('ids are unique', new Set(dataset.plaques.map(p => p.id)).size === dataset.plaques.length);
check('places index built', dataset.places.size > 50, `${dataset.places.size} places`);
check('search corpus is populated', dataset.plaques.every(p => p.search.length > 0));
check('life dates extracted for most plaques',
  dataset.plaques.filter(p => p.dates).length > dataset.plaques.length * 0.6);
check('every category is represented',
  [...CATEGORY_BY_SLUG.keys()].every(slug => dataset.byCategory.has(slug)));

/* ── Derived progress (PRD §73) ─────────────────────────────────────────── */
group('progress');
const iconic = dataset.plaques.find(p => p.fame === 3);
const famous = dataset.plaques.find(p => p.fame === 2);
const plain  = dataset.plaques.find(p => p.fame === 0);

eq('iconic base xp', store.xpFor(iconic, false), XP.iconic);
eq('famous base xp', store.xpFor(famous, false), XP.famous);
eq('standard base xp', store.xpFor(plain, false), XP.standard);
eq('verified bonus applies', store.xpFor(iconic, true), XP.iconic + XP.verified);

store.collect(iconic.id, true);
store.collect(famous.id, false);
store.collect(plain.id, false);
const p1 = store.progress();
eq('count reflects three finds', p1.count, 3);
eq('xp is the sum', p1.xp, XP.iconic + XP.verified + XP.famous + XP.standard);
eq('iconic tally', p1.iconic, 1);
eq('verified tally', p1.verified, 1);
eq('total matches dataset', p1.total, dataset.plaques.length);
near('percent is derived', p1.percent, 3 / dataset.plaques.length, 1e-9);
eq('collecting twice is a no-op', store.collect(iconic.id, true), null);
eq('count unchanged after duplicate', store.progress().count, 3);
eq('recent list is newest first', p1.recent[0].plaque.id, plain.id);

const categoryTotal = p1.categories.reduce((sum, c) => sum + c.total, 0);
eq('category totals sum to the dataset', categoryTotal, dataset.plaques.length);
const foundTotal = p1.categories.reduce((sum, c) => sum + c.found, 0);
eq('category found counts sum to collected', foundTotal, 3);

eq('progress survives a reload from storage', (() => {
  const reloaded = storage.load();
  return Object.keys(reloaded.collected).length;
})(), 3);

/* ── Achievements (PRD §49, §75) ────────────────────────────────────────── */
group('achievements');
const ach = evaluateAchievements();
eq('achievement count', ach.length, ACHIEVEMENTS.length);
eq('First Find unlocked at one discovery', ach.find(a => a.id === 'first_find').unlocked, true);
eq('Icon Spotter unlocked by the iconic find', ach.find(a => a.id === 'icon_spotter').unlocked, true);
eq('Getting Started still locked at three', ach.find(a => a.id === 'getting_started').unlocked, false);
eq('locked achievements report partial progress', ach.find(a => a.id === 'getting_started').value, 3);
check('every achievement target is reachable in this dataset', ACHIEVEMENTS.every(a => {
  if (a.id === 'renaissance') return true;
  return a.goal <= dataset.plaques.length;
}));
const newlyUnlocked = syncUnlocks();
check('sync records the newly unlocked', newlyUnlocked.length >= 2);
eq('sync is idempotent', syncUnlocks().length, 0);
check('unlock dates are stored for display',
  typeof state.saved.unlockedAchievements.first_find === 'string');

// Collection state wins: strip the collection, the achievement must relock.
const backup = state.saved.collected;
state.saved.collected = {};
store.invalidate();
eq('achievement relocks when collection disagrees',
  evaluateAchievements().find(a => a.id === 'first_find').unlocked, false);
state.saved.collected = backup;
store.invalidate();

/* ── Quests (PRD §40) ───────────────────────────────────────────────────── */
group('quests');
const quests = evaluateQuests();
eq('quest count', quests.length, 5);
eq('First Steps complete at three', quests.find(q => q.id === 'first_steps').done, true);
eq('Local Explorer complete via verified find', quests.find(q => q.id === 'local_explorer').done, true);
eq('Icon Hunter complete via iconic find', quests.find(q => q.id === 'icon_hunter').done, true);
check('quest progress never exceeds its target', quests.every(q => q.value <= q.target));
check('every quest has an action', QUESTS.every(q => typeof q.action === 'string' && q.action));

/* ── Recommendation (PRD §24) ───────────────────────────────────────────── */
group('recommendation');
eq('no location means no recommendation', recommendNext(), null);

state.userPos = { lat: 51.5080, lng: -0.1281, accuracy: 20 };
const pick = recommendNext();
check('a recommendation is returned', !!pick);
check('recommendation is uncollected', !store.isCollected(pick.plaque.id));
check('recommendation is within the ideal radius', pick.distance <= 2000, `${Math.round(pick.distance)} m`);

const runAgain = recommendNext();
eq('scoring is deterministic', runAgain.plaque.id, pick.plaque.id);

const second = recommendNext({ excludeIds: [pick.plaque.id] });
check('excluded plaques are skipped', second.plaque.id !== pick.plaque.id);

state.filters.categories = new Set(['music']);
const musical = recommendNext();
eq('active category filter is respected', musical.plaque.category, 'music');
state.filters.categories = new Set();

// A collected plaque must never be recommended again.
store.collect(pick.plaque.id, false);
const afterCollect = recommendNext();
check('collected plaques drop out of recommendations', afterCollect.plaque.id !== pick.plaque.id);

// Nearest-but-one sanity: with fame and context equal, closer must win.
const near1 = { id: 'x1', fame: 1, category: 'other', lat: 51.5081, lng: -0.1282 };
const near2 = { id: 'x2', fame: 1, category: 'other', lat: 51.5400, lng: -0.1600 };
state.plaques = [near1, near2];
state.byId = new Map([['x1', near1], ['x2', near2]]);
state.byCategory = new Map([['other', [near1, near2]]]);
state.saved.collected = {};
store.invalidate();
eq('closer plaque wins when all else is equal', recommendNext().plaque.id, 'x1');

/* ── Backup links ───────────────────────────────────────────────────────── */
group('backup');

const day = (n) => new Date(n * 86400000).toISOString();
const sampleSave = () => ({
  collected: {
    '485':   { collectedAt: day(20700), verified: true,  seq: 1 },
    '10326': { collectedAt: day(20701), verified: false, seq: 2 },
    '190':   { collectedAt: day(20701), verified: false, seq: 3 },
  },
});

const token = encodeBackup(sampleSave());
check('token carries the format marker', token.startsWith('lu1-'), token.slice(0, 12));
check('token is compact', token.length < 40, `${token.length} chars: ${token}`);

const decoded = decodeBackup(token);
eq('all three entries survive', decoded.entries.length, 3);
eq('order is preserved', decoded.entries.map(e => e.id).join(','), '485,10326,190');
eq('verified flag round-trips', decoded.entries[0].verified, true);
eq('unverified flag round-trips', decoded.entries[1].verified, false);
eq('collection day round-trips', decoded.entries[0].collectedAt.slice(0, 10), day(20700).slice(0, 10));

eq('empty save yields no token', encodeBackup({ collected: {} }), '');
eq('garbage decodes to null', decodeBackup('not-a-backup'), null);
eq('wrong prefix decodes to null', decodeBackup('lu9-dh.fu0'), null);
eq('empty string decodes to null', decodeBackup(''), null);
eq('non-string decodes to null', decodeBackup(null), null);
check('a corrupt entry is skipped, not fatal', decodeBackup('lu1-dh.fu0-!!!-e9.fu0').entries.length === 2);

// Restoring into an empty browser.
const fresh = { collected: {} };
const intoFresh = mergeBackup(fresh, decoded.entries);
eq('all entries land in an empty save', intoFresh.added, 3);
eq('total is correct', intoFresh.total, 3);
check('seq is renumbered in date order',
  Object.values(fresh.collected).map(e => e.seq).sort((a, b) => a - b).join(',') === '1,2,3');

// Restoring over existing progress must never lose a find.
const existing = {
  collected: {
    '485':   { collectedAt: day(20800), verified: false, seq: 1 },   // later, unverified
    '99999': { collectedAt: day(20750), verified: false, seq: 2 },   // only on this device
  },
};
const merged = mergeBackup(existing, decoded.entries);
eq('new entries are added', merged.added, 2);
eq('nothing local is dropped', !!existing.collected['99999'], true);
eq('total counts both sources', merged.total, 4);
eq('the earlier collection date wins', existing.collected['485'].collectedAt.slice(0, 10), day(20700).slice(0, 10));
eq('verified survives a merge with an unverified copy', existing.collected['485'].verified, true);

// Merging the same backup twice must be a no-op.
const again = mergeBackup(existing, decoded.entries);
eq('re-importing adds nothing', again.added, 0);
eq('re-importing changes nothing', again.total, 4);

// A backup made against a different dataset must not resurrect dead ids.
const guarded = { collected: {} };
const guardedResult = mergeBackup(guarded, decoded.entries, { knownIds: new Set(['485']) });
eq('unknown ids are dropped', guardedResult.added, 1);
eq('only the known id is stored', Object.keys(guarded.collected).join(','), '485');

// A real save from the dataset should round-trip exactly.
// (The recommendation block above swapped in fixture plaques — put the real
// dataset back before touching the collection again.)
store.setDataset(dataset);
state.saved.collected = {};
store.invalidate();
const picks = dataset.plaques.slice(0, 40);
picks.forEach((p, i) => store.collect(p.id, i % 4 === 0));
const realToken = encodeBackup(state.saved);
const realDecoded = decodeBackup(realToken);
eq('40 real discoveries round-trip', realDecoded.entries.length, 40);
eq('ids match the originals',
   realDecoded.entries.map(e => e.id).join(','), picks.map(p => p.id).join(','));
eq('verified flags match',
   realDecoded.entries.filter(e => e.verified).length,
   picks.filter((_, i) => i % 4 === 0).length);
check('a 40-discovery link stays comfortably shareable', realToken.length < 500,
      `${realToken.length} chars`);

/* ── Report ─────────────────────────────────────────────────────────────── */
print('');
if (failures.length) {
  print(`FAIL  ${failures.length} of ${passed + failures.length} checks failed:\n`);
  failures.forEach(f => print(`   ✗ ${f}`));
  throw new Error(`${failures.length} logic test(s) failed`);
}
print(`PASS  ${passed} logic checks`);
