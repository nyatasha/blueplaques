/**
 * The Iconic collect moment.
 *
 * Collecting a standard discovery raises a toast. Collecting one of the 49
 * Iconic plaques earns something that feels like a card falling out of a
 * packet: the plaque is drawn as a plaque, the person gets a line of their own,
 * and the XP lands with it.
 *
 * The line comes from `data/iconic-notes.json` where one has been written, and
 * otherwise from facts derived from the dataset — rank by Wikipedia readership,
 * whether they lived and died at the address, which sets they belong to.
 * Nothing here invents anything about a real person.
 */

import { state, progress } from './state.js';
import { esc, qs, on } from './ui.js';
import { icon } from './icons.js';

let notes = {};

/** Loaded once, lazily; a failure just means everyone gets a derived line. */
export async function loadIconicNotes(url = 'data/iconic-notes.json') {
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return;
    const data = await res.json();
    notes = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('_')));
  } catch { /* derived lines only */ }
}

/** Where this plaque ranks among the Iconic set by Wikipedia readership. */
function iconicRank(plaque) {
  const ranked = state.plaques.filter(p => p.fame >= 3).sort((a, b) => b.views - a.views);
  const at = ranked.findIndex(p => p.id === plaque.id);
  return at < 0 ? null : { rank: at + 1, of: ranked.length };
}

const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** A true sentence about this plaque, drawn from the data we hold. */
function derivedNote(plaque) {
  if (/lived and died/i.test(plaque.inscription)) {
    return 'They lived and died at this address — a whole life in one place.';
  }
  const smallSets = (progress().themes || [])
    .filter(t => t.total <= 30 && state.themes.find(s => s.id === t.id)?.ids.has(plaque.id));
  if (smallSets.length) {
    const set = smallSets[0];
    return `One of only ${set.total} in ${set.name}.`;
  }
  const rank = iconicRank(plaque);
  if (rank && rank.rank <= 10) {
    return `The ${ordinal(rank.rank)} most looked-up person on this whole map.`;
  }
  if (plaque.dates) {
    return `${plaque.dates} — one of ${rank ? rank.of : 49} Iconic Londoners on the map.`;
  }
  return 'One of the map\'s Iconic Londoners.';
}

export const noteFor = plaque => notes[plaque.id] || derivedNote(plaque);

/**
 * Renders the celebration. Resolves when it has been dismissed, so the caller
 * can queue anything that should follow it.
 */
export function celebrateIconic(plaque, xp) {
  return new Promise(resolve => {
    const host = qs('#celebrate');
    if (!host) { resolve(); return; }

    const surname = plaque.title.split(' ').slice(-1)[0];
    const count = progress().count;
    host.innerHTML = `
      <div class="cel-card" role="dialog" aria-label="Iconic discovery collected" tabindex="-1">
        <div class="cel-eyebrow">${icon('star')} Iconic discovery</div>
        <h2 class="sr-only">${esc(plaque.title)} — Iconic discovery collected</h2>
        <div class="cel-plaque" aria-hidden="true">
          <div class="cel-plaque-inner">
            <span class="cel-plaque-name">${esc(plaque.title)}</span>
            ${plaque.dates ? `<span class="cel-plaque-dates">${esc(plaque.dates)}</span>` : ''}
            <span class="cel-plaque-role">${esc(plaque.roles || plaque.categoryLabel)}</span>
          </div>
        </div>
        <p class="cel-note">${esc(noteFor(plaque))}</p>
        <div class="cel-xp">+${xp} XP</div>
        <button type="button" class="btn btn-primary btn-block cel-done" data-autofocus>
          Added to my London
        </button>
        <p class="cel-hint">${esc(surname)} joins ${count === 1 ? 'your first discovery'
          : `${count} discoveries`}</p>
      </div>`;

    host.hidden = false;
    requestAnimationFrame(() => host.classList.add('on'));

    const done = () => {
      host.classList.remove('on');
      setTimeout(() => { host.hidden = true; host.innerHTML = ''; resolve(); }, 260);
    };
    on(host.querySelector('.cel-done'), 'click', done);
    on(host, 'click', e => { if (e.target === host) done(); });
    on(host, 'keydown', e => { if (e.key === 'Escape') done(); });
    host.querySelector('.cel-done')?.focus({ preventScroll: true });
  });
}
