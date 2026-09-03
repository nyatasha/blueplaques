/** Geographic helpers. All maths is local — no coordinate ever leaves the device. */

import { WALK_METRES_PER_MIN } from './config.js';

const R = 6371008.8;   // mean Earth radius, metres
const rad = deg => (deg * Math.PI) / 180;

/** Great-circle distance in metres (Haversine, PRD §76). */
export function distanceMetres(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 180 m · 450 m · 1.2 km */
export function formatDistance(metres) {
  if (!Number.isFinite(metres)) return '';
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  if (metres < 10000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres / 1000)} km`;
}

export function walkingMinutes(metres) {
  return Math.max(1, Math.round(metres / WALK_METRES_PER_MIN));
}

/**
 * One tap to walking directions (PRD §77).
 *
 * Google Maps on every platform rather than Apple Maps on Apple devices: its
 * walking directions and street-level detail are stronger for finding a
 * specific building, and one destination means one thing to test. On iOS the
 * link opens the Google Maps app when it is installed and the web map when it
 * is not, so nothing is lost by not detecting the platform.
 */
export function directionsUrl(plaque) {
  const destination = encodeURIComponent(`${plaque.lat},${plaque.lng}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=walking`;
}
