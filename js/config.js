/**
 * London Uncovered — shared constants.
 *
 * Nothing here is derived from the dataset at build time: totals, category
 * counts and percentages are all computed at runtime from the loaded GeoJSON
 * (PRD §73–74), so the app adapts automatically when the data is refreshed.
 */

export const STORAGE_KEY = 'londonUncovered:v0';
export const SCHEMA_VERSION = 1;

/** Metres. A discovery collected inside this radius counts as verified. */
export const VERIFY_RADIUS_M = 100;

/**
 * ── TEST OVERRIDE ────────────────────────────────────────────────────────
 * Verified collection normally requires standing within VERIFY_RADIUS_M of the
 * plaque, which makes that path awkward to exercise from a desk. Loading the
 * app with `?verify=anywhere` (or calling `__lu.verifyAnywhere(true)` in the
 * console) lifts the proximity check so any discovery can be collected as
 * verified.
 *
 * It is off unless explicitly switched on, it is never persisted, and while it
 * is active the sheet says so — so a test find cannot be mistaken for a real
 * one. Remove the query parameter to get normal behaviour back.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const VERIFY_ANYWHERE_PARAM = 'verify';
export const VERIFY_ANYWHERE_VALUE = 'anywhere';

/** Reported GPS accuracy worse than this is not trusted for verification. */
export const MAX_TRUSTED_ACCURACY_M = 250;

/**
 * How long the map is left alone before offering to use location on a first
 * visit. Long enough that the map has loaded and been looked at — PRD §54 wants
 * the product usable on arrival, not gated behind a dialog.
 */
export const LOCATION_INVITE_DELAY_MS = 4200;

/**
 * Discoveries before the Home Screen offer appears. Late enough that there is
 * something worth protecting, early enough to arrive before Safari's seven-day
 * storage cap can bite.
 */
export const HOME_SCREEN_PROMPT_AFTER = 3;

/** Walking speed used for the "approx. N min" hint. */
export const WALK_METRES_PER_MIN = 80;

export const XP = {
  standard: 10,   // fame 0–1
  famous:   25,   // fame 2
  iconic:   50,   // fame 3
  verified: 10,   // bonus for a location-verified find
};

/**
 * Collection counts announced to analytics as they are crossed. Lets a simple,
 * storage-less analytics service report activation and strong activation
 * without ever aggregating per visitor. See docs/analytics-plan.md.
 */
export const MILESTONES = [1, 3, 10, 25, 50, 100];

export const FAME = {
  3: { key: 'iconic', label: 'Iconic', badge: 'badge-iconic' },
  2: { key: 'famous', label: 'Famous', badge: 'badge-famous' },
  1: { key: 'notable', label: 'Notable', badge: '' },
  0: { key: 'notable', label: 'Notable', badge: '' },
};

/**
 * Top-level categories (PRD §16). `short` is used on map chips, `label` is the
 * canonical name used everywhere else. Order is the display order.
 */
export const CATEGORIES = [
  { slug: 'writers',      short: 'Writers',       label: 'Writers & Literature' },
  { slug: 'art',          short: 'Art',           label: 'Art & Design' },
  { slug: 'science',      short: 'Science',       label: 'Science & Technology' },
  { slug: 'film-theatre', short: 'Film & Theatre',label: 'Film & Theatre' },
  { slug: 'music',        short: 'Music',         label: 'Music' },
  { slug: 'politics',     short: 'Politics',      label: 'Politics & Society' },
  { slug: 'architecture', short: 'Architecture',  label: 'Architecture' },
  { slug: 'sport',        short: 'Sport',         label: 'Sport' },
  { slug: 'other',        short: 'Other',         label: 'Other' },
];

export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map(c => [c.slug, c]));

/** Categories that count toward the "Culture Collector" quest. */
export const CULTURE_CATEGORIES = ['writers', 'art', 'music', 'film-theatre'];

export const DISTANCE_FILTERS = [
  { key: 'all',  label: 'Anywhere', metres: Infinity },
  { key: '500',  label: '< 500 m',  metres: 500 },
  { key: '1000', label: '< 1 km',   metres: 1000 },
  { key: '2000', label: '< 2 km',   metres: 2000 },
];

/** Recommendation weighting (PRD §24). */
export const RECOMMEND = {
  distanceWeight: 0.60,
  fameWeight:     0.25,
  contextWeight:  0.15,
  idealRadiusM:   2000,   // beyond this the distance score is 0
  fallbackRadiusM: 12000, // widened search when nothing is close
};

/** Map view */
export const MAP_START = { center: [51.5074, -0.1278], zoom: 12 };
export const LABEL_MIN_ZOOM = 15;

/**
 * ── BASEMAP CONFIGURATION POINT ──────────────────────────────────────────
 * Esri's Light Gray Canvas: a restrained light basemap that needs no API key
 * and lets the blue markers carry the page. Street data is cached to zoom 16,
 * so Leaflet upscales beyond that (`maxNativeZoom`).
 *
 * CARTO Positron — which this project used previously — now stamps
 * "API KEY REQUIRED" across every tile requested without a key. To go back to
 * it, register a free key at carto.com and replace `url` with:
 *
 *   https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?api_key=KEY
 *
 * and set `subdomains: 'abcd'`, `labels: null`, `maxNativeZoom: 19`.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const BASEMAP = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
  subdomains: '',
  maxNativeZoom: 16,
  maxZoom: 18,
  // Kept to one line so it never collides with the map controls; the full
  // credit, including HERE and Garmin, is in the About sheet.
  attribution:
    '&copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> · ' +
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · ' +
    '<a href="https://openplaques.org" target="_blank" rel="noopener">OpenPlaques</a>',
};

/**
 * XP required to reach a level: 25n² + 25n − 50.
 * Level 1 = 0 XP, 2 = 100, 3 = 250, 4 = 450, 5 = 700 … (PRD §36)
 */
export function xpForLevel(level) {
  return 25 * level * level + 25 * level - 50;
}

export function levelFromXp(xp) {
  return Math.max(1, Math.floor((-1 + Math.sqrt(9 + (4 * xp) / 25)) / 2));
}
