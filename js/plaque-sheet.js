/**
 * Plaque bottom sheet (PRD §28–33).
 *
 * Collapsed it is a card over a still-usable map; expanded it carries the full
 * record. The primary action adapts to where the player is standing:
 *
 *   inside 100 m          → Collect this discovery   (verified)
 *   located but far away  → Get directions + Mark as seen
 *   no location yet       → Mark as seen, with an offer to use location
 */

import { VERIFY_RADIUS_M } from './config.js';
import { state, isCollected, collectionEntry, progress, xpFor } from './state.js';
import { distanceMetres, formatDistance, walkingMinutes, directionsUrl } from './geo.js';
import { esc, qs, on, delegate, thumbUrl, fmtDate, fmtNumber } from './ui.js';
import { icon, CATEGORY_ICON } from './icons.js';
import { trackEvent } from './analytics.js';

let sheet, actions = {}, currentId = null;

const FAME_BADGE = {
  3: `<span class="badge badge-iconic">${icon('star')} Iconic</span>`,
  2: `<span class="badge badge-famous">Famous</span>`,
};

function distanceTo(plaque) {
  return state.userPos ? distanceMetres(state.userPos, plaque) : null;
}

const isNearby = distance => distance !== null && distance <= VERIFY_RADIUS_M;

function photoBlock(plaque, kind) {
  const width = kind === 'hero' ? 800 : 200;
  const src = thumbUrl(plaque.photo, width);
  const cls = kind === 'hero' ? 'pq-hero' : 'pq-thumb';
  if (!src) {
    return `<div class="${cls} pq-thumb-fallback" aria-hidden="true"
              ${kind === 'hero' ? 'style="display:grid;place-items:center"' : ''}>${icon('bookmark')}</div>`;
  }
  return `<img class="${cls}" src="${esc(src)}" alt="Blue plaque for ${esc(plaque.title)}"
            loading="lazy" decoding="async" onerror="this.remove()">`;
}

function metaLine(plaque, distance) {
  const bits = [];
  if (plaque.roles) bits.push(esc(plaque.roles.replace(/^\w/, c => c.toUpperCase())));
  else bits.push(esc(plaque.categoryLabel));
  if (plaque.fame >= 2) bits.push(plaque.fame >= 3 ? 'Iconic' : 'Famous');
  const meta = bits.join('<span class="dotsep">·</span>');
  const dist = distance !== null
    ? `<span class="dotsep">·</span><span class="pq-dist">${formatDistance(distance)}</span>` : '';
  return meta + dist;
}

/** The action row — the piece that changes with location and collection state. */
function actionsBlock(plaque, distance) {
  const collected = isCollected(plaque.id);
  const entry = collectionEntry(plaque.id);
  const testMode = state.verifyAnywhere;
  const near = testMode || isNearby(distance);

  if (collected) {
    return `
      <div class="pq-actions">
        <button type="button" class="btn btn-done" disabled>
          ${icon('check')} Found${entry?.verified ? ' · verified' : ''}
        </button>
        <a class="btn btn-secondary" href="${esc(directionsUrl(plaque))}"
           target="_blank" rel="noopener" data-act="directions">${icon('navigate')} Directions</a>
      </div>
      ${entry?.collectedAt ? `<p class="pq-verify-note">Collected ${esc(fmtDate(entry.collectedAt))}</p>` : ''}`;
  }

  if (near) {
    return `
      <div class="pq-actions">
        <button type="button" class="btn btn-primary btn-block" data-act="collect" data-verified="1" data-autofocus>
          ${icon('check')} Collect this discovery
        </button>
      </div>
      <p class="pq-verify-note">${icon('shield')} ${
        testMode
          ? 'Test mode — collecting as verified without checking your location.'
          : `You're ${esc(formatDistance(distance))} away — this find will be verified.`
      }</p>`;
  }

  if (distance !== null) {
    return `
      <div class="pq-actions">
        <a class="btn btn-primary" href="${esc(directionsUrl(plaque))}" target="_blank"
           rel="noopener" data-act="directions">${icon('navigate')} Get directions</a>
        <button type="button" class="btn btn-secondary" data-act="collect">Mark as seen</button>
      </div>
      <p class="pq-verify-note">${esc(formatDistance(distance))} away · about ${walkingMinutes(distance)} min on foot</p>`;
  }

  return `
    <div class="pq-actions">
      <button type="button" class="btn btn-primary" data-act="collect" data-autofocus>Mark as seen</button>
      <a class="btn btn-secondary" href="${esc(directionsUrl(plaque))}" target="_blank"
         rel="noopener" data-act="directions">${icon('navigate')} Directions</a>
    </div>
    <p class="pq-verify-note">
      <button type="button" class="btn-ghost btn-sm" data-act="use-location">
        ${icon('locate')} Use my location to verify finds
      </button>
    </p>`;
}

function collectionBlock(plaque) {
  const cat = progress().categories.find(c => c.slug === plaque.category);
  if (!cat || !cat.total) return '';
  return `
    <button type="button" class="pq-collection" data-act="open-category" data-cat="${esc(cat.slug)}">
      <span class="eyebrow">${esc(cat.label)}</span>
      <div class="collection-count" style="margin:4px 0 0">
        <b>${cat.found}</b> / ${fmtNumber(cat.total)} discovered
      </div>
      <div class="bar"><i style="width:${(cat.percent * 100).toFixed(1)}%"></i></div>
    </button>`;
}

function linksBlock(plaque) {
  const links = [];
  if (plaque.wikipedia) {
    links.push(`<a class="btn btn-secondary btn-sm" href="${esc(plaque.wikipedia)}" target="_blank"
                  rel="noopener" data-act="wikipedia">${icon('wiki')} Wikipedia</a>`);
  }
  if (plaque.source) {
    links.push(`<a class="btn btn-secondary btn-sm" href="${esc(plaque.source)}" target="_blank"
                  rel="noopener">${icon('info')} OpenPlaques</a>`);
  }
  return links.length ? `<div class="pq-actions" style="margin-top:var(--sp-3)">${links.join('')}</div>` : '';
}

function targetFlag(plaque) {
  if (state.targetId !== plaque.id) return '';
  return `<div class="pq-target-flag">${icon('target')} Your next discovery</div>`;
}

export function renderPlaqueSheet(id = currentId) {
  const plaque = state.byId.get(id);
  if (!plaque) return;
  currentId = id;
  state.openPlaqueId = id;
  const distance = distanceTo(plaque);
  const isTarget = state.targetId === plaque.id;

  qs('#plaque-body').innerHTML = `
    ${targetFlag(plaque)}

    <button type="button" class="pq-peek" data-act="expand" aria-label="Expand details for ${esc(plaque.title)}">
      ${photoBlock(plaque, 'thumb')}
      <span class="pq-peek-main">
        <span class="pq-name">${esc(plaque.title)}</span>
        <span class="pq-meta">${metaLine(plaque, distance)}</span>
        ${isCollected(plaque.id) ? `<span class="badge badge-found">${icon('check')} Found</span>` : ''}
      </span>
    </button>

    <div class="pq-expanded">
      ${photoBlock(plaque, 'hero')}
      <h2 class="pq-name" style="font-size:var(--fs-lg);margin-bottom:var(--sp-1)">${esc(plaque.title)}</h2>
      ${plaque.dates ? `<p style="color:var(--ink-400);font-size:var(--fs-sm);margin-bottom:var(--sp-3)">${esc(plaque.dates)}</p>` : ''}
      <p style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:var(--sp-4)">
        <span class="badge badge-cat">${icon(CATEGORY_ICON[plaque.category])} ${esc(plaque.categoryLabel)}</span>
        ${FAME_BADGE[plaque.fame] || ''}
        ${isCollected(plaque.id) ? `<span class="badge badge-found">${icon('check')} Found</span>` : ''}
        ${collectionEntry(plaque.id)?.verified ? `<span class="badge badge-verified">${icon('shield')} Verified</span>` : ''}
      </p>

      ${plaque.inscription ? `<blockquote class="pq-inscription">${esc(plaque.inscription)}</blockquote>` : ''}

      <dl class="pq-rows">
        ${plaque.address ? `<div class="pq-row"><dt>Address</dt><dd>${esc(plaque.address)}</dd></div>` : ''}
        ${plaque.year ? `<div class="pq-row"><dt>Erected</dt><dd>${esc(plaque.year)}</dd></div>` : ''}
        ${plaque.roles ? `<div class="pq-row"><dt>Known for</dt><dd>${esc(plaque.roles)}</dd></div>` : ''}
        ${!isCollected(plaque.id) ? `<div class="pq-row"><dt>Worth</dt><dd>${xpFor(plaque, state.verifyAnywhere)} XP${
            state.userPos || state.verifyAnywhere ? '' : ' · +10 XP if verified on location'}</dd></div>` : ''}
      </dl>

      ${collectionBlock(plaque)}
      ${linksBlock(plaque)}
    </div>`;

  qs('#plaque-foot').innerHTML = actionsBlock(plaque, distance) + (
    isTarget && !isCollected(plaque.id)
      ? `<button type="button" class="btn btn-ghost btn-block btn-sm" data-act="choose-another"
           style="margin-top:var(--sp-2)">${icon('refresh')} Choose another</button>`
      : '');
}

export function openPlaque(id, { expand = false } = {}) {
  renderPlaqueSheet(id);
  sheet.open(expand ? 'full' : 'peek');
}

export const currentPlaqueId = () => currentId;

export function initPlaqueSheet(sheetInstance, handlers) {
  sheet = sheetInstance;
  actions = handlers;

  delegate(qs('#sheet-plaque'), 'click', '[data-act]', (event, node) => {
    const plaque = state.byId.get(currentId);
    if (!plaque) return;
    switch (node.dataset.act) {
      case 'expand':        sheet.setState('full'); break;
      case 'collect':       actions.onCollect(plaque, node.dataset.verified === '1'); break;
      case 'directions':    trackEvent('directions_clicked', { fame: plaque.fame, category: plaque.category }); break;
      case 'wikipedia':     trackEvent('wikipedia_clicked', { category: plaque.category }); break;
      case 'use-location':  actions.onUseLocation(); break;
      case 'choose-another':actions.onChooseAnother(); break;
      case 'open-category': actions.onOpenCategory(node.dataset.cat); break;
      default: break;
    }
  });

  on(qs('#plaque-close'), 'click', () => sheet.close());
}
