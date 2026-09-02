/**
 * Geolocation (PRD §19–21, §62).
 *
 * Permission is never requested on load — only from an explicit user action.
 * The position is held in memory for the session and never written to storage
 * or sent to analytics. There is no background tracking.
 */

import { MAX_TRUSTED_ACCURACY_M } from './config.js';
import { state, emit } from './state.js';
import { trackEvent } from './analytics.js';

const OPTIONS = { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 };

let inFlight = null;

export const hasLocation = () => state.userPos !== null;
export const wasDenied = () => state.locationStatus === 'denied';

/** Accuracy good enough to call a find "verified"? */
export const accuracyIsTrustworthy = () =>
  !!state.userPos && (state.userPos.accuracy || 0) <= MAX_TRUSTED_ACCURACY_M;

function setStatus(status) {
  if (state.locationStatus === status) return;
  state.locationStatus = status;
  emit('location-status', status);
}

/**
 * Resolves with { lat, lng, accuracy } or rejects with a reason string of
 * 'denied' | 'unavailable' | 'timeout'. Concurrent calls share one request.
 */
export function requestLocation({ silent = false } = {}) {
  if (inFlight) return inFlight;

  if (!('geolocation' in navigator)) {
    setStatus('unavailable');
    return Promise.reject('unavailable');
  }

  if (!silent) trackEvent('location_requested');
  setStatus('asking');

  inFlight = new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.userPos = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setStatus('granted');
        if (!silent) trackEvent('location_granted');
        emit('location', state.userPos);
        resolve(state.userPos);
      },
      err => {
        const reason = err.code === err.PERMISSION_DENIED ? 'denied'
                     : err.code === err.TIMEOUT ? 'timeout' : 'unavailable';
        setStatus(reason === 'timeout' ? 'idle' : reason);
        if (!silent && reason === 'denied') trackEvent('location_denied');
        emit('location-error', reason);
        reject(reason);
      },
      OPTIONS,
    );
  }).finally(() => { inFlight = null; });

  return inFlight;
}

/**
 * Location if we already have it, otherwise ask — but never re-prompt someone
 * who has already said no (PRD §21: never nag).
 */
export function ensureLocation() {
  if (state.userPos) return Promise.resolve(state.userPos);
  if (state.locationStatus === 'denied') return Promise.reject('denied');
  return requestLocation();
}
