/**
 * Search (PRD §15).
 *
 * One field drives two things: it filters the markers on the map as you type,
 * and it offers grouped suggestions — People, Categories, Places. Selecting a
 * person opens their sheet, a category activates that filter, a place frames
 * the map on it.
 */

import { CATEGORIES } from './config.js';
import { state, isCollected } from './state.js';
import { qs, esc, mark, on } from './ui.js';
import { icon as svg } from './icons.js';
import { trackEvent } from './analytics.js';

const MAX_PEOPLE = 6, MAX_PLACES = 4, MAX_CATEGORIES = 3;

let input, box, list, handlers = {};
let items = [];
let activeIndex = -1;

function rank(plaque, q) {
  const title = plaque.title.toLowerCase();
  if (title.startsWith(q)) return 0;
  if (title.includes(q)) return 1;
  // Match on a later surname token before falling back to the body text.
  if (title.split(/\s+/).some(w => w.startsWith(q))) return 2;
  return 3;
}

function buildSuggestions(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const people = state.plaques
    .filter(p => p.search.includes(q))
    .map(p => ({ plaque: p, r: rank(p, q) }))
    .sort((a, b) => a.r - b.r || b.plaque.fame - a.plaque.fame || a.plaque.title.localeCompare(b.plaque.title))
    .slice(0, MAX_PEOPLE)
    .map(({ plaque }) => ({
      kind: 'plaque', id: plaque.id, label: plaque.title,
      sub: plaque.categoryLabel, done: isCollected(plaque.id),
    }));

  const categories = CATEGORIES
    .filter(c => c.label.toLowerCase().includes(q) || c.short.toLowerCase().includes(q))
    .slice(0, MAX_CATEGORIES)
    .map(c => ({
      kind: 'category', id: c.slug, label: c.label,
      sub: `${state.byCategory.get(c.slug)?.length || 0}`,
    }));

  const places = [...state.places.values()]
    .filter(p => p.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts || b.ids.length - a.ids.length;
    })
    .slice(0, MAX_PLACES)
    .map(p => ({ kind: 'place', id: p.name, ids: p.ids, label: p.name, sub: `${p.ids.length}` }));

  return [
    ...(people.length ? [{ group: 'People' }, ...people] : []),
    ...(categories.length ? [{ group: 'Categories' }, ...categories] : []),
    ...(places.length ? [{ group: 'Places' }, ...places] : []),
  ];
}

const ICON_FOR = { plaque: 'bookmark', category: 'layers', place: 'map' };

function render(query) {
  const rows = buildSuggestions(query);
  items = rows.filter(r => !r.group);
  activeIndex = -1;

  if (!rows.length) {
    // Say so in place rather than opening anything — the field keeps focus.
    if (query.trim().length >= 2) {
      list.innerHTML = `<div class="sg-group">Nothing found</div>
        <p class="sg-item" style="color:var(--ink-400);cursor:default">Try another person, place or category.</p>`;
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    } else {
      list.hidden = true;
      list.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
    }
    return;
  }

  list.innerHTML = rows.map(row => {
    if (row.group) return `<div class="sg-group" role="presentation">${row.group}</div>`;
    const index = items.indexOf(row);
    return `<button type="button" class="sg-item" role="option" id="sg-${index}"
              aria-selected="false" data-kind="${row.kind}" data-id="${esc(row.id)}">
              ${svg(ICON_FOR[row.kind])}
              <span>${mark(row.label, query.trim())}</span>
              ${row.done ? `<span class="sg-tick" title="Collected">${svg('check')}</span>` : ''}
              <span class="sg-sub">${esc(row.sub)}</span>
            </button>`;
  }).join('');

  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function setActive(next) {
  const nodes = list.querySelectorAll('.sg-item');
  if (!nodes.length) return;
  activeIndex = (next + nodes.length) % nodes.length;
  nodes.forEach((n, i) => {
    const on_ = i === activeIndex;
    n.classList.toggle('active', on_);
    n.setAttribute('aria-selected', String(on_));
  });
  nodes[activeIndex].scrollIntoView({ block: 'nearest' });
  input.setAttribute('aria-activedescendant', `sg-${activeIndex}`);
}

function choose(item) {
  if (!item) return;
  hide();
  input.blur();
  trackEvent('search_used', { kind: item.kind });
  if (item.kind === 'plaque') {
    clear({ silent: true });
    handlers.onPlaque(item.id);
  } else if (item.kind === 'category') {
    clear({ silent: true });
    handlers.onCategory(item.id);
  } else {
    clear({ silent: true });
    handlers.onPlace(item.ids);
  }
}

function hide() {
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
}

export function clear({ silent = false } = {}) {
  input.value = '';
  state.query = '';
  box.classList.remove('has-value');
  hide();
  if (!silent) handlers.onQuery('');
}

export function initSearch({ onQuery, onPlaque, onCategory, onPlace }) {
  handlers = { onQuery, onPlaque, onCategory, onPlace };
  input = qs('#search');
  box = qs('.searchbox');
  list = qs('#suggest');

  on(input, 'input', () => {
    const value = input.value;
    state.query = value;
    box.classList.toggle('has-value', value.length > 0);
    render(value);
    onQuery(value);
  });

  on(input, 'keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
    else if (e.key === 'Enter') {
      if (activeIndex >= 0) { e.preventDefault(); choose(items[activeIndex]); }
      else if (items.length) { e.preventDefault(); choose(items[0]); }
    } else if (e.key === 'Escape') {
      if (!list.hidden) hide(); else clear();
    }
  });

  on(list, 'mousedown', e => e.preventDefault());   // keep focus in the input
  on(list, 'click', e => {
    const node = e.target.closest('.sg-item');
    if (node) choose(items[Number(node.id.replace('sg-', ''))]);
  });

  on(qs('#search-clear'), 'click', () => { clear(); input.focus(); });

  on(document, 'pointerdown', e => {
    if (!box.contains(e.target) && !list.contains(e.target)) hide();
  });

  on(input, 'focus', () => { if (input.value.trim().length >= 2) render(input.value); });
}
