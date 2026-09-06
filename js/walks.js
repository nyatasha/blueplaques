/**
 * Curated self-guided walks.
 *
 * A walk is a hand-picked, ordered run of plaques that already exist in the
 * dataset. `data/walks.json` holds only the identity of a walk — its slug,
 * name, area, prose and its stop ids in walking order. Everything measurable
 * about it (stop count, distance, walking time, which stops are collected) is
 * derived here from the dataset and from the existing collection state, so a
 * walk can never claim a distance the coordinates do not support, and a data
 * refresh re-derives every number.
 *
 * The same derivation lives in scripts/generate_seo_pages.py, which writes the
 * crawlable half of the same walk. Both use ROUTE_FACTOR and the walking speed
 * from config.js, and tests/seo.test.py asserts the two agree.
 *
 * No new persisted state: progress along a walk is simply how many of its
 * stops are in the collection.
 */

import { WALK_METRES_PER_MIN } from './config.js';
import { distanceMetres } from './geo.js';
import { isCollected } from './state.js';

const SOURCE = 'data/walks.json';

/**
 * Straight-line legs understate a walk: London's streets do not run between
 * two front doors in a line. 1.3 is the ordinary circuity allowance for a
 * dense urban grid, and every distance and duration a walk shows is labelled
 * "approximately" because of it. Shared with the page generator.
 */
export const ROUTE_FACTOR = 1.3;

let walks = [];

/** Slugs end up in hrefs and in generated directory names — check the shape. */
const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * Resolves the definitions against the loaded dataset.
 *
 * A walk whose stops cannot all be resolved is dropped rather than rendered
 * short: a five-stop walk silently missing two stops is worse than no walk.
 */
export function buildWalks(defs, byId) {
  const out = [];
  for (const def of defs || []) {
    if (!def || !SLUG_RE.test(String(def.slug || ''))) continue;
    const stops = (def.stops || []).map(stop => {
      const plaque = byId.get(String(stop.id));
      return plaque ? { plaque, note: stop.note || '' } : null;
    });
    if (!stops.length || stops.some(s => !s)) continue;

    let metres = 0;
    for (let i = 1; i < stops.length; i++) {
      metres += distanceMetres(stops[i - 1].plaque, stops[i].plaque);
    }
    const routeMetres = metres * ROUTE_FACTOR;
    out.push({
      slug: def.slug,
      name: def.name || def.slug,
      area: def.area || 'London',
      icon: def.icon || 'map',
      tagline: def.tagline || '',
      intro: def.intro || '',
      startHint: def.startHint || '',
      stops,
      ids: stops.map(s => s.plaque.id),
      metres: routeMetres,
      minutes: Math.max(1, Math.round(routeMetres / WALK_METRES_PER_MIN)),
    });
  }
  return out;
}

/** Best-effort: a missing or malformed file costs the walks, nothing else. */
export async function loadWalks(byId) {
  try {
    const response = await fetch(SOURCE);
    if (!response.ok) throw new Error(String(response.status));
    const payload = await response.json();
    walks = buildWalks(payload?.walks, byId);
  } catch {
    walks = [];
  }
  return walks;
}

export const allWalks = () => walks;
export const walkBySlug = slug => walks.find(w => w.slug === slug) || null;

/** The walks a given plaque appears on — powers the cross-link on the sheet. */
export const walksWithPlaque = id => walks.filter(w => w.ids.includes(id));

/** Progress along a walk, read straight from the collection. */
export function walkProgress(walk) {
  const found = walk.ids.filter(id => isCollected(id)).length;
  return {
    found,
    total: walk.ids.length,
    percent: walk.ids.length ? found / walk.ids.length : 0,
    complete: found === walk.ids.length,
  };
}

/** `1.7 km` / `900 m` — walks are always long enough to want one decimal. */
export function formatWalkDistance(metres) {
  return metres < 1000 ? `${Math.round(metres / 50) * 50} m`
                       : `${(metres / 1000).toFixed(1)} km`;
}

/**
 * One tap to walking directions for the whole route.
 *
 * Google Maps' universal URL takes an origin, a destination and up to eight
 * intermediate waypoints without any key, and `travelmode=walking` makes it
 * route on foot. On iOS the link opens the Google Maps app when it is
 * installed and the web map when it is not, which is the same behaviour the
 * single-plaque directions link already has (geo.js).
 */
export function routeDirectionsUrl(walk, { from = 0 } = {}) {
  const points = walk.stops.slice(from).map(s => `${s.plaque.lat},${s.plaque.lng}`);
  if (!points.length) return '';
  const origin = points[0];
  const destination = points[points.length - 1];
  const waypoints = points.slice(1, -1);
  // Built by hand rather than with URLSearchParams: the pipe between waypoints
  // is what Google's format wants literally, and encoding each part separately
  // is also what geo.js does for the single-plaque link.
  const query = [
    'api=1',
    `origin=${encodeURIComponent(origin)}`,
    `destination=${encodeURIComponent(destination)}`,
    ...(waypoints.length
      ? [`waypoints=${waypoints.map(encodeURIComponent).join('|')}`] : []),
    'travelmode=walking',
  ].join('&');
  return `https://www.google.com/maps/dir/?${query}`;
}
