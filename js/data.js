/**
 * Dataset loading and indexing.
 *
 * The GeoJSON is flattened into plain plaque objects once, so the rest of the
 * app never walks `feature.geometry.coordinates` or `feature.properties`.
 */

import { CATEGORY_BY_SLUG } from './config.js';

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
    fame: Number(p.fame) || 0,
    views: Number(p.views) || 0,
    category: slug,
    categoryLabel: CATEGORY_BY_SLUG.get(slug).label,
    lat, lng,
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

export async function loadPlaques(url = 'data/plaques.geojson') {
  const res = await fetch(url, { cache: 'no-cache' });
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
