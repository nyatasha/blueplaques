/**
 * Leaflet map: marker states, clustering, filtering and camera moves.
 *
 * Markers are built once and kept in a Map keyed by plaque id; state changes
 * (collected, current target) swap the icon in place rather than rebuilding.
 */

import { MAP_START, LABEL_MIN_ZOOM, DISTANCE_FILTERS, BASEMAP } from './config.js';
import { state, isCollected } from './state.js';
import { distanceMetres } from './geo.js';
import { esc, qs } from './ui.js';

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5 10 17l8.5-9.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const SIZE = { 3: 22, 2: 16, 1: 12, 0: 9 };
const COLLECTED_MIN = 18;   // a tick needs room to read

let map = null;
let cluster = null;
const markers = new Map();
let onSelect = () => {};
let userMarker = null;
let accuracyRing = null;
let visibleIds = new Set();

/* ── Icons ─────────────────────────────────────────────────────────────── */

function markerHtml(plaque) {
  const collected = isCollected(plaque.id);
  const target = state.targetId === plaque.id;
  const size = collected ? Math.max(SIZE[plaque.fame] ?? SIZE[0], COLLECTED_MIN)
                         : (SIZE[plaque.fame] ?? SIZE[0]);
  const cls = ['pin', `pin-${plaque.fame}`];
  if (collected) cls.push('pin-collected');
  if (target) cls.push('pin-target');
  return {
    size,
    html: `<div class="${cls.join(' ')}" style="width:${size}px;height:${size}px">${collected ? CHECK_SVG : ''}</div>`,
  };
}

function buildIcon(plaque) {
  const { size, html } = markerHtml(plaque);
  return L.divIcon({
    className: '',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function clusterIcon(group) {
  const n = group.getChildCount();
  const iconic = group.getAllChildMarkers().some(m => m._plaque?.fame >= 3);
  const size = n < 15 ? 32 : n < 80 ? 40 : 50;
  return L.divIcon({
    className: '',
    html: `<div class="cluster${iconic ? ' cluster-iconic' : ''}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px">${n}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/* ── Setup ─────────────────────────────────────────────────────────────── */

export function initMap(handleSelect) {
  onSelect = handleSelect;

  map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
    maxZoom: BASEMAP.maxZoom,
    tap: true,
  }).setView(MAP_START.center, MAP_START.zoom);

  const tileOptions = {
    subdomains: BASEMAP.subdomains,
    maxZoom: BASEMAP.maxZoom,
    maxNativeZoom: BASEMAP.maxNativeZoom,
    detectRetina: false,
  };
  L.tileLayer(BASEMAP.url, { ...tileOptions, attribution: BASEMAP.attribution }).addTo(map);
  // Place names ride above the base so the grey canvas stays uncluttered.
  if (BASEMAP.labels) L.tileLayer(BASEMAP.labels, { ...tileOptions, pane: 'shadowPane' }).addTo(map);

  cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 52,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 17,
    iconCreateFunction: clusterIcon,
    chunkedLoading: true,
  });
  map.addLayer(cluster);

  map.on('zoomend', syncZoomClass);
  syncZoomClass();
  return map;
}

function syncZoomClass() {
  qs('#map')?.classList.toggle('zoomed-out', map.getZoom() < LABEL_MIN_ZOOM);
}

export function buildMarkers() {
  for (const plaque of state.plaques) {
    const marker = L.marker([plaque.lat, plaque.lng], {
      icon: buildIcon(plaque),
      keyboard: true,
      alt: plaque.title,
      riseOnHover: true,
      title: plaque.fame >= 3 ? '' : plaque.title,
    });
    marker._plaque = plaque;
    marker.on('click', () => onSelect(plaque.id, { from: 'marker' }));
    if (plaque.fame >= 3) {
      marker.bindTooltip(esc(plaque.title), {
        permanent: true, direction: 'top',
        offset: [0, -(SIZE[3] / 2 + 4)],
        className: 'plaque-label',
      });
    }
    markers.set(plaque.id, marker);
  }
}

/* ── Filtering ─────────────────────────────────────────────────────────── */

/** The plaques that pass search + every active filter (PRD §18). */
export function visiblePlaques() {
  const { status, categories, fame, distance } = state.filters;
  const q = state.query.trim().toLowerCase();
  const maxDistance = DISTANCE_FILTERS.find(d => d.key === distance)?.metres ?? Infinity;
  const origin = state.userPos;

  return state.plaques.filter(plaque => {
    if (q && !plaque.search.includes(q)) return false;
    if (categories.size && !categories.has(plaque.category)) return false;
    if (fame === 'famous' && plaque.fame < 2) return false;
    if (fame === 'iconic' && plaque.fame < 3) return false;
    const collected = isCollected(plaque.id);
    if (status === 'collected' && !collected) return false;
    if (status === 'uncollected' && collected) return false;
    if (origin && Number.isFinite(maxDistance) &&
        distanceMetres(origin, plaque) > maxDistance) return false;
    return true;
  });
}

export function applyFilters() {
  const visible = visiblePlaques();
  visibleIds = new Set(visible.map(p => p.id));
  cluster.clearLayers();
  cluster.addLayers(visible.map(p => markers.get(p.id)).filter(Boolean));
  return visible;
}

/* ── Marker state ──────────────────────────────────────────────────────── */

export function refreshMarker(id, { pop = false } = {}) {
  const marker = markers.get(id);
  const plaque = state.byId.get(id);
  if (!marker || !plaque) return;
  marker.setIcon(buildIcon(plaque));
  if (pop) {
    const pin = marker.getElement()?.querySelector('.pin');
    pin?.classList.add('pin-just-collected');
  }
}

export function setTarget(id) {
  const previous = state.targetId;
  state.targetId = id;
  if (previous && previous !== id) refreshMarker(previous);
  if (id) refreshMarker(id);
}

/* ── Camera ────────────────────────────────────────────────────────────── */

/** Offset the centre upward on mobile so the sheet does not cover the pin. */
function paddedCentre(latlng, zoom) {
  const isDesktop = window.matchMedia('(min-width: 900px)').matches;
  if (isDesktop) return latlng;
  const point = map.project(latlng, zoom);
  return map.unproject(point.add([0, map.getSize().y * 0.17]), zoom);
}

export function focusPlaque(id, { zoom = 16, animate = true } = {}) {
  const plaque = state.byId.get(id);
  if (!plaque) return;
  const marker = markers.get(id);
  const target = zoom ?? map.getZoom();
  const centre = paddedCentre(L.latLng(plaque.lat, plaque.lng), target);

  // Reveal a marker hidden inside a cluster before moving the camera.
  if (marker && cluster.hasLayer(marker)) {
    cluster.zoomToShowLayer(marker, () => map.setView(centre, target, { animate }));
  } else {
    map.setView(centre, target, { animate });
  }
}

export function fitToIds(ids) {
  const points = ids.map(id => state.byId.get(id)).filter(Boolean)
                    .map(p => [p.lat, p.lng]);
  if (!points.length) return;
  if (points.length === 1) { focusPlaque(ids[0], { zoom: 16 }); return; }
  map.fitBounds(L.latLngBounds(points), { padding: [60, 90], maxZoom: 16 });
}

export function centreOnUser(pos, { zoom = 15 } = {}) {
  map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), zoom), { animate: true });
}

export function setUserPosition(pos) {
  const latlng = [pos.lat, pos.lng];
  if (!userMarker) {
    userMarker = L.marker(latlng, {
      icon: L.divIcon({ className: '', html: '<div class="userdot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(map);
    accuracyRing = L.circle(latlng, {
      radius: pos.accuracy || 0, className: 'leaflet-accuracy',
      weight: 1, opacity: 0.35, fillOpacity: 0.08, interactive: false,
    }).addTo(map);
  } else {
    userMarker.setLatLng(latlng);
    accuracyRing.setLatLng(latlng).setRadius(pos.accuracy || 0);
  }
}

export const getMap = () => map;
export const isVisible = id => visibleIds.has(id);
export function invalidateSize() { map?.invalidateSize({ animate: false }); }
