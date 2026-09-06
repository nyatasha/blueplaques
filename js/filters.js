/**
 * Filter sheet (PRD §18): status, category, fame, distance.
 *
 * Distance options only appear once a location is available; the footer CTA
 * always shows how many discoveries the current selection would leave on the
 * map, so the effect of a change is visible before the sheet is dismissed.
 */

import { CATEGORIES, DISTANCE_FILTERS } from './config.js';
import { state } from './state.js';
import { qs, esc, on, delegate, fmtNumber } from './ui.js';
import { trackEvent } from './analytics.js';

const STATUS = [
  { key: 'all', label: 'All' },
  { key: 'uncollected', label: 'Uncollected' },
  { key: 'collected', label: 'Collected' },
];
const FAME = [
  { key: 'all', label: 'All' },
  { key: 'famous', label: 'Famous' },
  { key: 'iconic', label: 'Iconic' },
];

let sheet, onChange, countFn;

const pressed = value => `aria-pressed="${value ? 'true' : 'false'}"`;

function render() {
  const { filters } = state;
  const hasLocation = !!state.userPos;

  qs('#filters-body').innerHTML = `
    <div class="fl-group">
      <h3 id="fl-status">Status</h3>
      <div class="fl-opts" role="group" aria-labelledby="fl-status">
        ${STATUS.map(s => `<button type="button" class="fl-opt" data-group="status"
            data-value="${s.key}" ${pressed(filters.status === s.key)}>${s.label}</button>`).join('')}
      </div>
    </div>

    <div class="fl-group">
      <h3 id="fl-cat">Category</h3>
      <div class="fl-opts" role="group" aria-labelledby="fl-cat">
        ${CATEGORIES.map(c => {
          const total = state.byCategory.get(c.slug)?.length || 0;
          if (!total) return '';
          return `<button type="button" class="fl-opt" data-group="category"
                    data-value="${c.slug}" ${pressed(filters.categories.has(c.slug))}>
                    ${esc(c.label)}<span class="n">${total}</span></button>`;
        }).join('')}
      </div>
    </div>

    <div class="fl-group">
      <h3 id="fl-fame">Fame</h3>
      <div class="fl-opts" role="group" aria-labelledby="fl-fame">
        ${FAME.map(f => `<button type="button" class="fl-opt" data-group="fame"
            data-value="${f.key}" ${pressed(filters.fame === f.key)}>${f.label}</button>`).join('')}
      </div>
    </div>

    <div class="fl-group">
      <h3 id="fl-dist">Distance</h3>
      <div class="fl-opts" role="group" aria-labelledby="fl-dist">
        ${DISTANCE_FILTERS.map(d => `<button type="button" class="fl-opt" data-group="distance"
            data-value="${d.key}" ${pressed(filters.distance === d.key)}
            ${hasLocation ? '' : 'disabled'}>${d.label}</button>`).join('')}
      </div>
      ${hasLocation ? '' : '<p style="font-size:var(--fs-xs);color:var(--ink-400);margin-top:var(--sp-3)">Turn on location to filter by distance.</p>'}
    </div>`;

  updateCta();
}

function updateCta() {
  const n = countFn();
  const cta = qs('#filters-apply');
  cta.textContent = n === 1 ? 'Show 1 discovery' : `Show ${fmtNumber(n)} discoveries`;
  cta.disabled = n === 0;
  qs('#filters-clear').hidden = !isFiltered();
}

export function isFiltered() {
  const f = state.filters;
  return f.status !== 'all' || f.fame !== 'all' || f.distance !== 'all' ||
         f.categories.size > 0 || !!f.theme || !!f.walk;
}

export function activeFilterCount() {
  const f = state.filters;
  return (f.status !== 'all' ? 1 : 0) + (f.fame !== 'all' ? 1 : 0) +
         (f.distance !== 'all' ? 1 : 0) + f.categories.size +
         (f.theme ? 1 : 0) + (f.walk ? 1 : 0);
}

export function clearFilters() {
  state.filters.theme = null;
  state.filters.walk = null;
  state.filters.status = 'all';
  state.filters.fame = 'all';
  state.filters.distance = 'all';
  state.filters.categories.clear();
}

export function initFilters(sheetInstance, { onChange: change, countVisible }) {
  sheet = sheetInstance;
  onChange = change;
  countFn = countVisible;

  delegate(qs('#filters-body'), 'click', '.fl-opt', (_e, btn) => {
    const { group, value } = btn.dataset;
    if (group === 'category') {
      state.filters.categories.has(value)
        ? state.filters.categories.delete(value)
        : state.filters.categories.add(value);
    } else {
      state.filters[group] = state.filters[group] === value && value !== 'all' ? 'all' : value;
    }
    trackEvent('filter_applied', { group, value });
    render();
    onChange();
  });

  on(qs('#filters-apply'), 'click', () => sheet.close());
  on(qs('#filters-clear'), 'click', () => { clearFilters(); render(); onChange(); });
}

export function openFilters() {
  render();
  sheet.open('full');
}

export const refreshFilters = () => { if (sheet?.isOpen) render(); };
