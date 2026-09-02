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
 * One tap to directions (PRD §77). Apple platforms get Apple Maps, everything
 * else gets Google Maps; both fall back gracefully in any browser.
 */
export function directionsUrl(plaque) {
  const dest = `${plaque.lat},${plaque.lng}`;
  const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);
  return isApple
    ? `https://maps.apple.com/?daddr=${dest}&dirflg=w`
    : `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=walking`;
}
