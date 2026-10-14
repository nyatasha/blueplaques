/**
 * The tiny runtime for the generated static pages.
 *
 * Plaque, category and walk pages are where search traffic lands, and until
 * now they carried no script at all — so the busiest half of the site was
 * invisible in analytics and offered no way to pass a page on. This module is
 * the whole of their behaviour:
 *
 *   1. starts the analytics provider, which records the page view;
 *   2. announces the *kind* of page, so the funnel can be read by page type
 *      without adding a thousand event paths;
 *   3. records the click through to the interactive map — the one conversion
 *      these pages exist to produce;
 *   4. powers a Share button, using the page's own title and description so a
 *      link handed to someone arrives already explaining itself.
 *
 * It shares `js/analytics.js` with the app, so the provider is still named in
 * exactly one place. It is loaded as a module and deferred by definition: the
 * page is complete and readable without it, which is the point of these pages.
 *
 * Nothing here reads storage, location or anything about the visitor.
 */

import { loadProvider, trackEvent, recordedEvents } from './analytics.js';

/** `plaque` | `category` | `walk` | `walks-index` | `directory`, set by the generator. */
const kind = document.body.dataset.page || 'unknown';

/* ── Share ─────────────────────────────────────────────────────────────── */

/**
 * The share payload, taken from the metadata already on the page.
 *
 * Reading `<title>` and the meta description rather than restating them keeps
 * one description per page: whatever a crawler and a chat preview see is
 * exactly what someone pasting the link gets, and there is no second copy to
 * drift. The site name is trimmed off the title because the sharing surface
 * shows the URL anyway.
 */
function payload() {
  const title = document.title.replace(/\s+—\s+London Uncovered$/, '');
  const text = document.querySelector('meta[name="description"]')?.content || '';
  const url = document.querySelector('link[rel="canonical"]')?.href || location.href;
  return { title, text, url };
}

async function share(button) {
  const { title, text, url } = payload();
  trackEvent('static_share', { kind });
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return;
    }
    await navigator.clipboard.writeText(`${title} — ${url}`);
    said(button, 'Link copied');
  } catch {
    // A dismissed share sheet and a refused clipboard are both ordinary. The
    // one case worth handling is a browser with neither API.
    if (!navigator.share && !navigator.clipboard) said(button, url);
  }
}

/** Confirms in the button itself — these pages have no toast system. */
function said(button, message) {
  if (!button) return;
  const original = button.textContent;
  button.textContent = message;
  button.disabled = true;
  setTimeout(() => { button.textContent = original; button.disabled = false; }, 2200);
}

/* ── Boot ──────────────────────────────────────────────────────────────── */

loadProvider();
trackEvent('static_page_view', { kind });

// Development helper, the static pages' counterpart of `window.__lu` in the
// app: the smoke suite reads what these pages recorded. Names only — the
// buffer never holds anything the paths do not.
window.__luStatic = { events: recordedEvents };

document.addEventListener('click', event => {
  const node = event.target.closest('[data-track]');
  if (!node) return;
  if (node.dataset.track === 'to-app') trackEvent('static_to_app', { kind });
  if (node.dataset.track === 'share') share(node);
});

// The button is inert without JavaScript, so the generator ships it hidden and
// this reveals it. A dead "Share" on a no-script page would be worse than none.
document.querySelectorAll('[data-track="share"]').forEach(b => { b.hidden = false; });

// The A–Z directory's search and filters. Imported here, on that page only, so
// the other 1,000-odd static pages never fetch it and every page still loads
// exactly one script.
if (kind === 'directory') {
  import('./directory.js')
    .then(({ initDirectory }) => initDirectory())
    .catch(() => { /* the full list is already on the page */ });
}
