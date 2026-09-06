/**
 * Walks tab — the curated self-guided walks.
 *
 * Two views inside one screen: an index of walk cards, and one walk in full.
 * Neither holds any state of its own beyond which walk is open; progress comes
 * from the collection through walkProgress(), so collecting a plaque anywhere
 * in the app moves every walk that contains it.
 */

import { allWalks, walkBySlug, walkProgress, formatWalkDistance,
         routeDirectionsUrl, ROUTE_FACTOR } from './walks.js';
import { state, isCollected } from './state.js';
import { distanceMetres, formatDistance } from './geo.js';
import { qs, esc, delegate, plaqueRow, opensElsewhere, fmtNumber } from './ui.js';
import { icon } from './icons.js';
import { trackEvent } from './analytics.js';

let handlers = {};
let openSlug = null;

const meta = walk => `${walk.stops.length} stops<span class="dotsep">·</span>`
  + `${formatWalkDistance(walk.metres)}<span class="dotsep">·</span>about ${walk.minutes} min walking`;

/* ── Index ─────────────────────────────────────────────────────────────── */

function walkCard(walk) {
  const p = walkProgress(walk);
  return `
    <a class="walk-card${p.complete ? ' complete' : ''}" href="walks/${esc(walk.slug)}/"
       data-act="open-walk" data-walk="${esc(walk.slug)}">
      <span class="walk-card-top">
        <span class="collection-chip${p.complete ? ' gold' : ''}">${icon(walk.icon)}</span>
        <span class="walk-card-area">${esc(walk.area)}</span>
      </span>
      <span class="walk-card-name">${esc(walk.name)}</span>
      <span class="walk-card-tag">${esc(walk.tagline)}</span>
      <span class="walk-meta">${meta(walk)}</span>
      ${p.found ? `
        <span class="bar${p.complete ? ' gold' : ''}"><i style="width:${(p.percent * 100).toFixed(0)}%"></i></span>
        <span class="walk-card-progress">${p.complete
          ? `${icon('check')} Walk complete`
          : `${p.found} of ${p.total} stops collected`}</span>` : ''}
      <span class="collection-go">${p.found ? 'Continue this walk' : 'See the walk'} ${icon('arrowRight')}</span>
    </a>`;
}

function renderIndex() {
  const walks = allWalks();
  qs('#walks-body').innerHTML = `
    <h1 class="screen-title">Walks</h1>
    <p class="screen-sub">${walks.length
      ? `${walks.length} curated routes through London, built from the plaques on the map.`
      : 'Walks could not be loaded. The map is unaffected.'}</p>
    ${walks.map(walkCard).join('')}
    ${walks.length ? `<p class="walk-note">Distances are estimated from the straight line between
      consecutive stops with a ${ROUTE_FACTOR}× allowance for street layout, and walking times
      assume a steady pace with no stopping. Allow longer than the number says — the point is
      the stopping.</p>` : ''}`;
}

/* ── One walk ──────────────────────────────────────────────────────────── */

function stopRow(walk, stop, index) {
  const { plaque, note } = stop;
  const done = isCollected(plaque.id);
  const previous = index > 0 ? walk.stops[index - 1].plaque : null;
  const leg = previous
    ? Math.round(distanceMetres(previous, plaque) * ROUTE_FACTOR) : null;
  return `
    ${leg !== null ? `<p class="walk-leg">${icon('footsteps')} about ${esc(formatDistance(leg))} on</p>` : ''}
    ${plaqueRow({
      href: plaque.url,
      className: `walk-stop${done ? ' done' : ''}`,
      attrs: `data-act="open-plaque" data-id="${esc(plaque.id)}"`,
      html: `
        <span class="walk-stop-num">${done ? icon('check') : index + 1}</span>
        <span class="walk-stop-main">
          <span class="walk-stop-name">${esc(plaque.title)}</span>
          <span class="walk-stop-sub">${esc([plaque.dates, plaque.address].filter(Boolean).join(' · '))}</span>
          ${note ? `<span class="walk-stop-note">${esc(note)}</span>` : ''}
        </span>
        ${icon('chevronR')}`,
    })}`;
}

function renderWalk(walk) {
  const p = walkProgress(walk);
  qs('#walks-body').innerHTML = `
    <button type="button" class="walk-back" data-act="back">${icon('back')} All walks</button>

    <p class="eyebrow">${esc(walk.area)}</p>
    <h1 class="screen-title">${esc(walk.name)}</h1>
    <p class="screen-sub">${esc(walk.tagline)}</p>

    <div class="walk-facts">
      <div class="walk-fact"><b>${walk.stops.length}</b><span>stops</span></div>
      <div class="walk-fact"><b>${esc(formatWalkDistance(walk.metres))}</b><span>approx.</span></div>
      <div class="walk-fact"><b>${walk.minutes} min</b><span>walking</span></div>
    </div>

    <p class="walk-intro">${esc(walk.intro)}</p>
    ${walk.startHint ? `<p class="walk-hint">${icon('navigate')} <span>${esc(walk.startHint)}</span></p>` : ''}

    <div class="walk-progress card">
      <div class="collection-count"><b>${p.found}</b> / ${fmtNumber(p.total)} stops collected</div>
      <div class="bar${p.complete ? ' gold' : ''}"><i style="width:${(p.percent * 100).toFixed(0)}%"></i></div>
      <p class="walk-progress-note">${p.complete
        ? 'You have collected every stop on this walk.'
        : 'Collect a stop from its plaque card — on location it counts as a verified find.'}</p>
    </div>

    <button type="button" class="btn btn-primary btn-block" data-act="start">
      ${icon('map')} ${p.found ? 'Show the walk on the map' : 'Start walk'}
    </button>
    <a class="btn btn-secondary btn-block" style="margin-top:var(--sp-2)"
       href="${esc(routeDirectionsUrl(walk))}" target="_blank" rel="noopener" data-act="route">
      ${icon('navigate')} Open the route in Google Maps
    </a>

    <div class="section-head"><span class="eyebrow">The route</span>
      <span class="level-xp">${walk.stops.length} stops</span></div>
    ${walk.stops.map((stop, i) => stopRow(walk, stop, i)).join('')}

    <p class="walk-note">Distances are estimated from the straight line between consecutive stops
      with a ${ROUTE_FACTOR}× allowance for street layout. This walk has a
      <a href="walks/${esc(walk.slug)}/">page of its own</a> you can share or read offline.</p>`;
}

/* ── Shell ─────────────────────────────────────────────────────────────── */

export function renderWalks() {
  const walk = openSlug ? walkBySlug(openSlug) : null;
  if (walk) renderWalk(walk);
  else renderIndex();
}

export function showWalk(slug) {
  openSlug = walkBySlug(slug) ? slug : null;
  if (openSlug) trackEvent('walk_opened', { walk: openSlug });
  renderWalks();
  qs('#screen-walks')?.scrollTo({ top: 0 });
}

export const currentWalkSlug = () => openSlug;

export function initWalkScreen(handlerMap) {
  handlers = handlerMap;
  const root = qs('#walks-body');

  delegate(root, 'click', '[data-act]', (event, node) => {
    switch (node.dataset.act) {
      // Both rows below are real anchors to the static pages. A plain click is
      // the in-app navigation; a modifier-click is left to the browser.
      case 'open-walk':
        if (opensElsewhere(event)) return;
        event.preventDefault();
        showWalk(node.dataset.walk);
        break;
      case 'open-plaque':
        if (opensElsewhere(event)) return;
        event.preventDefault();
        handlers.onOpenPlaque(node.dataset.id);
        break;
      case 'back':   showWalk(null); break;
      case 'start':  handlers.onStartWalk(walkBySlug(openSlug)); break;
      case 'route':  trackEvent('walk_directions', { walk: openSlug }); break;
      default: break;
    }
  });
}
