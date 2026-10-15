/**
 * Leaflet map: marker states, clustering, filtering and camera moves.
 *
 * Markers are built once and kept in a Map keyed by plaque id; state changes
 * (collected, current target, open plaque) swap the icon in place rather than
 * rebuilding.
 */

import { MAP_START, LABEL_MIN_ZOOM, DISTANCE_FILTERS, BASEMAP } from './config.js';
import { state, isCollected } from './state.js';
import { distanceMetres } from './geo.js';
import { walkBySlug } from './walks.js';
import { esc, qs } from './ui.js';
import { trackEvent } from './analytics.js';

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5 10 17l8.5-9.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const SIZE = { 3: 22, 2: 16, 1: 12, 0: 9 };
const COLLECTED_MIN = 18;   // a tick needs room to read

// The open plaque: grown, ringed (white, then amber) and lifted above its
// neighbours, so it reads as selected by size and outline, not colour alone.
const SELECTED_GROW = 8;
const SELECTED_MIN = 24;   // still larger than an ordinary iconic pin (22)
const SELECTED_RING = 8;    // must match the outermost ring in .pin-selected
const SELECTED_Z = 10000;   // above riseOnHover (250) and the user dot (1000)
const VIEW_MARGIN = 40;     // keep the selected pin this far inside the free area

let map = null;
let cluster = null;
const markers = new Map();
let onSelect = () => {};
let userMarker = null;
let accuracyRing = null;
let visibleIds = new Set();
/** Mirrors state.openPlaqueId; see syncSelection(). */
let selectedId = null;
/** Bumped by every new camera move and every user gesture; stale steps bail. */
let focusRun = 0;
/** False while chunked loading is still adding markers to the cluster group. */
let layersReady = true;
let reloadQueued = false;
let afterLayers = [];
/** The open plaque's id when it is on the map only because it is open. */
let extraId = null;

/* ── Icons ─────────────────────────────────────────────────────────────── */

function markerHtml(plaque) {
  const collected = isCollected(plaque.id);
  const target = state.targetId === plaque.id;
  const selected = selectedId === plaque.id;
  let size = collected ? Math.max(SIZE[plaque.fame] ?? SIZE[0], COLLECTED_MIN)
                       : (SIZE[plaque.fame] ?? SIZE[0]);
  if (selected) size = Math.max(size + SELECTED_GROW, SELECTED_MIN);
  const cls = ['pin', `pin-${plaque.fame}`];
  if (collected) cls.push('pin-collected');
  if (target) cls.push('pin-target');
  if (selected) cls.push('pin-selected');
  // The selected icon's box includes its rings, so they are part of the tap target.
  const ring = selected ? SELECTED_RING : 0;
  const margin = ring ? `;margin:${ring}px` : '';
  return {
    size: size + ring * 2,
    html: `<div class="${cls.join(' ')}" data-plaque="${esc(plaque.id)}" style="width:${size}px;height:${size}px${margin}">${collected ? CHECK_SVG : ''}</div>`,
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
  const children = group.getAllChildMarkers();
  const iconic = children.some(m => m._plaque?.fame >= 3);
  // When zoomed out, the open plaque's cluster carries the selection ring.
  const selected = selectedId && children.some(m => m._plaque?.id === selectedId);
  const size = n < 15 ? 32 : n < 80 ? 40 : 50;
  const cls = ['cluster'];
  if (iconic) cls.push('cluster-iconic');
  if (selected) cls.push('cluster-selected');
  return L.divIcon({
    className: '',
    html: `<div class="${cls.join(' ')}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px">${n}</div>`,
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
    chunkProgress: (done, total) => {
      if (done !== total) return;
      layersReady = true;
      if (reloadQueued) { reloadQueued = false; reloadLayers(); return; }
      const waiting = afterLayers;
      afterLayers = [];
      waiting.forEach(fn => fn());
    },
  });
  map.addLayer(cluster);

  map.on('zoomend', syncZoomClass);
  syncZoomClass();
  watchForFirstGesture();
  // A drag, pinch or wheel means the user is steering: drop whatever is left
  // of a programmatic camera move so it never pulls the map back.
  for (const type of GESTURES) {
    map.getContainer().addEventListener(type, () => { focusRun++; }, { passive: true });
  }
  return map;
}

const GESTURES = ['pointerdown', 'wheel', 'touchstart'];

/**
 * Records the first deliberate touch of the map — a drag, a pinch, a wheel, a
 * tap on a marker.
 *
 * Bound to the container's input events rather than to Leaflet's `moveend`,
 * because the app moves the camera itself constantly: a deep link, "find my
 * next discovery" and every walk fit the map programmatically, and each of
 * those would otherwise look like engagement that nobody performed.
 *
 * Fires at most once per page load, so the number reads as *what share of
 * arrivals touched the map at all* — the step between landing and opening a
 * plaque that the funnel was previously missing — rather than as a count of
 * gestures, which would say nothing and cost a beacon per pan.
 */
function watchForFirstGesture() {
  const container = map.getContainer();
  const once = () => {
    trackEvent('map_interacted');
    for (const type of GESTURES) container.removeEventListener(type, once);
  };
  for (const type of GESTURES) {
    container.addEventListener(type, once, { passive: true });
  }
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
  const { status, categories, fame, distance, theme, walk } = state.filters;
  const themeIds = theme ? state.themes.find(t => t.id === theme)?.ids : null;
  const walkIds = walk ? new Set(walkBySlug(walk)?.ids || []) : null;
  const q = state.query.trim().toLowerCase();
  const maxDistance = DISTANCE_FILTERS.find(d => d.key === distance)?.metres ?? Infinity;
  const origin = state.userPos;

  return state.plaques.filter(plaque => {
    if (q && !plaque.search.includes(q)) return false;
    if (themeIds && !themeIds.has(plaque.id)) return false;
    if (walkIds && !walkIds.has(plaque.id)) return false;
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
  reloadLayers();
  return visible;
}

/**
 * Replace the cluster group's markers with the filtered set.
 *
 * Chunked loading adds markers over several frames, and clearing the group
 * while a load is still running leaves its cluster tree inconsistent: markers
 * vanish at high zoom. So a reload asked for mid-load waits for that load to
 * finish, then runs once with whatever the filters are by then.
 */
function reloadLayers() {
  if (!layersReady) { reloadQueued = true; return; }
  const layers = [...visibleIds].map(id => markers.get(id));
  // The open plaque stays on the map while its sheet is open, even when the
  // filters would hide it (collected under "uncollected", outside a walk).
  extraId = selectedId && !visibleIds.has(selectedId) ? selectedId : null;
  if (extraId) layers.push(markers.get(extraId));
  cluster.clearLayers();
  layersReady = false;   // chunkProgress flips it back, possibly synchronously
  cluster.addLayers(layers.filter(Boolean));
}

/**
 * Run `fn` once every marker is in the cluster group. Until then a marker's
 * cluster membership is provisional: a neighbour still queued can fold it
 * into a cluster after it was revealed.
 */
function whenLayersReady(fn) {
  if (layersReady) fn();
  else afterLayers.push(fn);
}

/* ── Marker state ──────────────────────────────────────────────────────── */

export function refreshMarker(id, { pop = false } = {}) {
  const marker = markers.get(id);
  const plaque = state.byId.get(id);
  if (!marker || !plaque) return;
  const icon = buildIcon(plaque);
  marker.setIcon(icon);
  const tip = marker.getTooltip();
  if (tip) {
    // Keep the iconic name label clear of the selection rings.
    tip.options.offset = L.point(0, -(icon.options.iconSize[1] / 2 + 4));
    if (marker.isTooltipOpen()) tip.update();
  }
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

/**
 * Bring the map in line with state.openPlaqueId: the newly open plaque gets the
 * selected treatment, the previous one loses it. Call after the plaque sheet
 * opens or closes.
 */
export function syncSelection() {
  const next = state.openPlaqueId || null;
  if (next === selectedId) return;
  const previous = selectedId;
  selectedId = next;
  for (const [id, z] of [[previous, 0], [next, SELECTED_Z]]) {
    if (!id) continue;
    markers.get(id)?.setZIndexOffset(z);
    refreshMarker(id);
  }
  // Membership waits for any load in flight, for the reason in reloadLayers().
  whenLayersReady(() => {
    if (extraId && extraId !== selectedId) {
      cluster.removeLayer(markers.get(extraId));
      extraId = null;
    }
    const open = selectedId && markers.get(selectedId);
    if (open && !cluster.hasLayer(open)) {
      cluster.addLayer(open);
      extraId = selectedId;
    }
    // Re-draw the clusters holding either marker, so the ring follows it.
    const touched = [previous, selectedId].map(id => id && markers.get(id))
                      .filter(m => m && cluster.hasLayer(m));
    if (touched.length) cluster.refreshClusters(touched);
  });
}

/* ── Camera ────────────────────────────────────────────────────────────── */

const DESKTOP = () => window.matchMedia('(min-width: 900px)').matches;

/** The element's box, or null when it is hidden (display: none measures 0×0). */
function shownRect(selector) {
  const rect = qs(selector)?.getBoundingClientRect();
  return rect?.width && rect.height ? rect : null;
}

/**
 * How much of each map edge is covered by UI floating over it, in pixels.
 *
 * Read, never written: on a phone the search row sits over the top and the
 * plaque sheet (or the tab bar) over the bottom; on desktop the panels sit
 * beside the map, so only the narrow button stack on its left overlaps.
 */
function coveredEdges() {
  const box = map.getContainer().getBoundingClientRect();
  const edges = { top: 0, right: 0, bottom: 0, left: 0 };
  if (DESKTOP()) {
    const actions = shownRect('#map-actions');
    if (actions) edges.left = Math.max(0, actions.right - box.left);
    return edges;
  }
  const controls = shownRect('#map-controls');
  if (controls) edges.top = Math.max(0, controls.bottom - box.top);
  // The sheet may still be sliding in, so measure where it will rest rather
  // than where its transform has it now.
  const sheet = qs('#sheet-plaque');
  const sheetTop = state.openPlaqueId && sheet ? window.innerHeight - sheet.offsetHeight : Infinity;
  const tabbar = shownRect('#tabbar');
  const floor = Math.min(sheetTop, tabbar ? tabbar.top : Infinity);
  if (Number.isFinite(floor)) edges.bottom = Math.max(0, box.bottom - floor);
  return edges;
}

/** Centre of the part of the map nothing is covering, in container pixels. */
function freeCentre() {
  const size = map.getSize();
  const e = coveredEdges();
  return L.point((e.left + size.x - e.right) / 2, (e.top + size.y - e.bottom) / 2);
}

/** The map centre that puts `latlng` at the centre of the uncovered area. */
function centreFor(latlng, zoom) {
  const shift = freeCentre().subtract(map.getSize().divideBy(2));
  return map.unproject(map.project(latlng, zoom).subtract(shift), zoom);
}

/** Pan only if `latlng` has ended up under the UI or too near an edge. */
function keepInView(latlng) {
  const size = map.getSize();
  const e = coveredEdges();
  const p = map.latLngToContainerPoint(latlng);
  const m = VIEW_MARGIN;
  const inside = p.x >= e.left + m && p.x <= size.x - e.right - m
              && p.y >= e.top + m && p.y <= size.y - e.bottom - m;
  if (!inside) map.panBy(p.subtract(freeCentre()), { animate: true });
}

/**
 * Move the camera to a plaque so its own marker is visible on its own.
 *
 * 1. Centre it in the area the UI leaves uncovered, at `zoom`.
 * 2. If it is still inside a cluster there, let the cluster library reveal it
 *    (zooming in, or spiderfying at the deepest level).
 * 3. If that last step shifted it under a panel, pan it back out once.
 *
 * It starts once any marker load in flight has finished, and any user
 * gesture in between cancels the remaining steps.
 */
export function focusPlaque(id, { zoom = 16, animate = true } = {}) {
  const plaque = state.byId.get(id);
  if (!plaque) return;
  const marker = markers.get(id);
  const target = zoom ?? map.getZoom();
  const run = ++focusRun;
  const latlng = L.latLng(plaque.lat, plaque.lng);

  const reveal = () => {
    if (run !== focusRun || !marker || !cluster.hasLayer(marker)) return;
    // Leaflet's moveend arrives while the cluster group is still animating its
    // own split/merge; zooming again then strands the marker off the map.
    if (cluster._inZoomAnimation) { cluster.once('animationend', reveal); return; }
    cluster.zoomToShowLayer(marker, () => {
      // A spiderfied marker has moved off its true position; follow it.
      if (run === focusRun) keepInView(marker.getLatLng());
    });
  };
  // Opening a plaque usually re-applies the filters first. If that load ends
  // during a zoom animation the cluster group adds markers against stale
  // bounds and some never appear, so the camera waits for it.
  whenLayersReady(() => {
    if (run !== focusRun) return;
    // setView fires moveend even when there is nowhere to go, and
    // synchronously when it does not animate, so the listener goes on first.
    map.once('moveend', reveal);
    map.setView(centreFor(latlng, target), target, { animate });
  });
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
