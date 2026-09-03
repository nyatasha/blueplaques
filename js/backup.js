/**
 * Backup links — move a collection to another browser without an account.
 *
 * A save is encoded into a compact token carried in the URL *fragment*, so it
 * is never sent to the server. Opening the link elsewhere offers to merge it
 * into whatever is already there; nothing is ever overwritten or lost.
 *
 * Only facts are encoded — which plaques, which day, verified or not.
 * Achievements, quests, XP and levels are all derived on arrival, so a backup
 * cannot carry inconsistent progress (PRD §73, §75).
 *
 * Format:  lu1-<entry>-<entry>-…
 *   entry: <id base36>.<day base36>[.1]      trailing .1 marks a verified find
 *   day:   whole days since the Unix epoch — collection dates are only ever
 *          displayed to day resolution, and order is preserved by position.
 */

const PREFIX = 'lu1';
const DAY_MS = 86400000;
const HASH_KEY = 'restore';

/** Links much longer than this survive browsers fine but not every chat app. */
export const COMFORTABLE_URL_LENGTH = 2000;

const toB36 = n => Math.max(0, Math.round(n)).toString(36);
const fromB36 = s => parseInt(s, 36);

function dayOf(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : 0;
}

const isoOfDay = day => new Date(day * DAY_MS).toISOString();

/* ── Encode ─────────────────────────────────────────────────────────────── */

export function encodeBackup(saved) {
  const entries = Object.entries(saved.collected || {})
    .sort((a, b) => (a[1].seq || 0) - (b[1].seq || 0))
    .map(([id, entry]) => {
      const idNum = Number(id);
      if (!Number.isFinite(idNum) || idNum < 0) return null;   // non-numeric ids
      const token = `${toB36(idNum)}.${toB36(dayOf(entry.collectedAt))}`;
      return entry.verified ? `${token}.1` : token;
    })
    .filter(Boolean);

  return entries.length ? `${PREFIX}-${entries.join('-')}` : '';
}

/* ── Decode ─────────────────────────────────────────────────────────────── */

/**
 * @returns {{entries: Array<{id, collectedAt, verified}>}|null}
 * Malformed tokens yield null; individual bad entries are skipped rather than
 * failing the whole restore.
 */
export function decodeBackup(token) {
  if (typeof token !== 'string') return null;
  const parts = token.trim().split('-');
  if (parts.shift() !== PREFIX || !parts.length) return null;

  const entries = [];
  const seen = new Set();
  for (const part of parts) {
    const bits = part.split('.');
    if (bits.length < 2) continue;
    const id = fromB36(bits[0]);
    const day = fromB36(bits[1]);
    if (!Number.isFinite(id) || !Number.isFinite(day) || id < 0 || day < 0) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ id: key, collectedAt: isoOfDay(day), verified: bits[2] === '1' });
  }
  return entries.length ? { entries } : null;
}

/* ── Links ──────────────────────────────────────────────────────────────── */

export function backupUrl(saved, base = location.href) {
  const token = encodeBackup(saved);
  if (!token) return '';
  const url = new URL(base);
  url.hash = `${HASH_KEY}=${token}`;
  url.search = '';
  return url.toString();
}

/** Reads a pending restore out of the address bar, if there is one. */
export function pendingRestore() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return null;
  const value = new URLSearchParams(hash).get(HASH_KEY);
  return value ? decodeBackup(value) : null;
}

/** Drops the token from the address bar so a refresh does not re-import. */
export function clearRestoreFromUrl() {
  if (!location.hash.includes(HASH_KEY)) return;
  history.replaceState(null, '', location.pathname + location.search);
}

/* ── Merge ──────────────────────────────────────────────────────────────── */

/**
 * Folds decoded entries into a save. Merging, never replacing: a plaque already
 * collected here keeps the earlier of the two dates and stays verified if it
 * was verified on either device. `seq` is renumbered so "recent discoveries"
 * still reads in a sensible order afterwards.
 *
 * @returns {{added: number, updated: number, total: number}}
 */
export function mergeBackup(saved, entries, { knownIds = null } = {}) {
  let added = 0;
  let updated = 0;

  for (const entry of entries) {
    if (knownIds && !knownIds.has(entry.id)) continue;   // not in this dataset
    const existing = saved.collected[entry.id];
    if (!existing) {
      saved.collected[entry.id] = {
        collectedAt: entry.collectedAt,
        verified: entry.verified,
        seq: 0,
      };
      added++;
      continue;
    }
    const earlier = entry.collectedAt < existing.collectedAt ? entry.collectedAt
                                                             : existing.collectedAt;
    const verified = existing.verified || entry.verified;
    if (earlier !== existing.collectedAt || verified !== existing.verified) updated++;
    existing.collectedAt = earlier;
    existing.verified = verified;
  }

  Object.entries(saved.collected)
    .sort((a, b) => a[1].collectedAt.localeCompare(b[1].collectedAt) ||
                    (a[1].seq || 0) - (b[1].seq || 0))
    .forEach(([, entry], index) => { entry.seq = index + 1; });

  return { added, updated, total: Object.keys(saved.collected).length };
}
