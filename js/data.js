/**
 * Dataset loading and indexing.
 *
 * The GeoJSON is flattened into plain plaque objects once, so the rest of the
 * app never walks `feature.geometry.coordinates` or `feature.properties`.
 */

import { CATEGORY_BY_SLUG } from './config.js';

/**
 * The static page map written by scripts/generate_seo_pages.py. Loading it,
 * rather than reimplementing the generator's slugify() here, is what keeps the
 * app's links and the generated pages from drifting apart.
 */
const URL_MAP = 'data/plaque-urls.json';

/** Slugs come from our own build, but they end up in hrefs, so check the shape. */
const SLUG_RE = /^[a-z0-9-]+$/;

/** Address tails that are not useful as a "place" suggestion. */
const PLACE_STOPWORDS = new Set(['london', 'greater london', 'england', 'uk']);

function toPlaque(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  const p = feature.properties;
  const slug = CATEGORY_BY_SLUG.has(p.category) ? p.category : 'other';
  return {
    id: String(p.id),
    title: p.title || 'Unnamed plaque',
    inscription: p.inscription || '',
    address: p.address || '',
    area: p.area || '',
    year: p.year || '',
    photo: p.photo || '',
    wikipedia: p.wikipedia || '',
    roles: p.lead_roles || '',
    source: p.openplaques_url || '',
    /** The plaque's actual colour. The scheme's early plaques are not blue. */
    colour: p.colour || '',
    fame: Number(p.fame) || 0,
    views: Number(p.views) || 0,
    category: slug,
    categoryLabel: CATEGORY_BY_SLUG.get(slug).label,
    lat, lng,
    /** Path to this plaque's static page, or '' when the map is unavailable. */
    url: '',
    /** Life dates parsed out of the inscription, e.g. "1882–1941". */
    dates: extractDates(p.inscription || ''),
    search: '',   // filled below
  };
}

/** Inscriptions almost always carry the subject's dates right after the name. */
function extractDates(inscription) {
  const m = inscription.match(/\b(1[0-9]{3})\s*[–—-]\s*(1[0-9]{3}|20[0-2][0-9])\b/);
  return m ? `${m[1]}–${m[2]}` : '';
}

/** "165 Railton Road, Brixton, Lambeth, SE24" → ["Brixton", "Lambeth"] */
function placesFromAddress(address) {
  return address
    .split(',')
    .slice(1)                                   // drop the street line
    .map(s => s.trim())
    .filter(s => s.length > 2 &&
                 !/^[A-Z]{1,2}\d/.test(s) &&    // postcodes
                 !PLACE_STOPWORDS.has(s.toLowerCase()));
}

/**
 * id → `plaques/<slug>/`. Best-effort: the app is fully usable without it, so a
 * missing or malformed map costs the links, not the map.
 */
async function loadPlaqueUrls(url = URL_MAP) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return new Map();
    const { base, slugs } = await res.json();
    if (!SLUG_RE.test(String(base).replace(/\/$/, '')) || !slugs) return new Map();
    return new Map(Object.entries(slugs)
      .filter(([, slug]) => SLUG_RE.test(slug))
      .map(([id, slug]) => [String(id), `${base}${slug}/`]));
  } catch {
    return new Map();
  }
}

export async function loadPlaques(url = 'data/plaques.geojson') {
  const [res, urls] = await Promise.all([
    fetch(url, { cache: 'no-cache' }),
    loadPlaqueUrls(),
  ]);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const geojson = await res.json();
  if (!geojson || !Array.isArray(geojson.features)) throw new Error('Malformed GeoJSON');

  const plaques = [];
  const byId = new Map();
  const byCategory = new Map();
  const places = new Map();                     // place name → plaque ids

  for (const feature of geojson.features) {
    if (!feature?.geometry?.coordinates || feature.geometry.coordinates.length < 2) continue;
    const plaque = toPlaque(feature);
    if (!Number.isFinite(plaque.lat) || !Number.isFinite(plaque.lng)) continue;
    if (byId.has(plaque.id)) continue;          // ids are the collection key

    plaque.url = urls.get(plaque.id) || '';
    plaque.search = [plaque.title, plaque.roles, plaque.address, plaque.area,
                     plaque.categoryLabel, plaque.inscription].join(' ').toLowerCase();

    plaques.push(plaque);
    byId.set(plaque.id, plaque);
    if (!byCategory.has(plaque.category)) byCategory.set(plaque.category, []);
    byCategory.get(plaque.category).push(plaque);

    for (const place of placesFromAddress(plaque.address)) {
      const key = place.toLowerCase();
      if (!places.has(key)) places.set(key, { name: place, ids: [] });
      places.get(key).ids.push(plaque.id);
    }
  }

  if (!plaques.length) throw new Error('No usable plaques in dataset');
  return { plaques, byId, byCategory, places };
}
