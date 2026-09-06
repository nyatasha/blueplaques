/** Small DOM helpers plus the toast queue. No framework, no virtual DOM. */

import { icon } from './icons.js';

export const qs  = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Highlight the matched run inside a suggestion label. */
export function mark(text, query) {
  const safe = esc(text);
  if (!query) return safe;
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return safe;
  return `${esc(text.slice(0, at))}<mark>${esc(text.slice(at, at + query.length))}</mark>${esc(text.slice(at + query.length))}`;
}

/**
 * A discovery row that points at a specific plaque.
 *
 * When the plaque's static page URL is known the row is rendered as a real
 * anchor, so the DOM a crawler sees carries an href and a modifier-click opens
 * the page in a new tab. Ordinary clicks are intercepted by the app and open
 * the plaque on the map exactly as before. Without a URL — the map file failed
 * to load — the row stays the button it has always been.
 */
export function plaqueRow({ href, className, attrs = '', html }) {
  return href
    ? `<a class="${className}" href="${esc(href)}" ${attrs}>${html}</a>`
    : `<button type="button" class="${className}" ${attrs}>${html}</button>`;
}

/**
 * True when a click on a link asks for somewhere other than this tab — a new
 * tab, a new window, a save — and so must be left to the browser.
 */
export function opensElsewhere(event) {
  return !!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
            || (event.button ?? 0) !== 0);
}

export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/** Event delegation: fires when the event originates inside `selector`. */
export function delegate(root, type, selector, handler) {
  return on(root, type, event => {
    const match = event.target.closest(selector);
    if (match && root.contains(match)) handler(event, match);
  });
}

export const fmtNumber = n => n.toLocaleString('en-GB');

export function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Wikimedia thumbnails are resizable via the width query parameter. */
export function thumbUrl(photo, width) {
  if (!photo) return '';
  return photo.includes('width=') ? photo.replace(/width=\d+/, `width=${width}`) : photo;
}

/* ── Toasts (PRD §50) ───────────────────────────────────────────────────── */

const TOAST_MS = 5200;
const MAX_VISIBLE_TOASTS = 3;

export function toast({ eyebrow, title, desc, iconName = 'star', gold = true, onClick }) {
  const host = qs('#toasts');
  if (!host) return;
  const el = document.createElement(onClick ? 'button' : 'div');
  el.className = `toast${gold ? '' : ' plain'}`;
  if (onClick) el.type = 'button';
  el.innerHTML = `
    <span class="toast-badge">${icon(iconName)}</span>
    <span class="toast-main">
      ${eyebrow ? `<span class="toast-eyebrow">${esc(eyebrow)}</span>` : ''}
      <span class="toast-title">${esc(title)}</span>
      ${desc ? `<span class="toast-desc">${esc(desc)}</span>` : ''}
    </span>`;
  const dismiss = () => {
    if (!el.isConnected) return;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  };
  if (onClick) el.addEventListener('click', () => { onClick(); dismiss(); });
  host.appendChild(el);
  // Cap the stack: several quick collects, or a quest and an achievement
  // landing together, must never wall off the map behind notifications.
  while (host.children.length > MAX_VISIBLE_TOASTS) host.firstElementChild.remove();
  setTimeout(dismiss, TOAST_MS);
}

/** The brief "+50 XP" flourish after a collect (PRD §32, §59). */
export function xpBurst(amount) {
  const el = document.createElement('div');
  el.id = 'xp-burst';
  el.textContent = `+${amount} XP`;
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

/** Announce a change to assistive technology without moving focus. */
export function announce(message) {
  const live = qs('#live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = message; }, 40);
}
