/**
 * Provider-agnostic analytics (PRD §63).
 *
 * ── CONFIGURATION POINT ──────────────────────────────────────────────────
 * Set GA_MEASUREMENT_ID to a GA4 id ("G-XXXXXXXXXX") to start sending events.
 * While it is empty nothing leaves the browser; events are buffered in memory
 * so they can be inspected with `window.__lu.events()` during development.
 * No other file knows which analytics provider is in use.
 * ─────────────────────────────────────────────────────────────────────────
 */

const GA_MEASUREMENT_ID = '';

const buffer = [];
const MAX_BUFFER = 200;
let ready = false;

function bootGa(id) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  window.gtag('js', new Date());
  window.gtag('config', id, { anonymize_ip: true });
  ready = true;
}

export function initAnalytics() {
  if (GA_MEASUREMENT_ID) bootGa(GA_MEASUREMENT_ID);
  trackEvent('page_view', { screen: 'map' });
}

/**
 * Record a product event.
 *
 * Never pass coordinates, addresses or anything that could locate a person
 * (PRD §62). Callers pass categorical properties only — fame tier, category
 * slug, verified true/false, counts.
 */
export function trackEvent(name, properties = {}) {
  const event = { name, properties, at: Date.now() };
  buffer.push(event);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  if (ready && typeof window.gtag === 'function') window.gtag('event', name, properties);
}

/** Development helper — surfaced on window.__lu in app.js. */
export function recordedEvents() { return buffer.slice(); }
