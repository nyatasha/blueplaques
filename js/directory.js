/**
 * The A–Z directory's search and filters — progressive enhancement over a
 * page that is already complete.
 *
 * blue-plaques/index.html ships every plaque as a row of plain HTML, grouped
 * under letter headings, so the list works without JavaScript and a crawler
 * reads all of it. This module adds three filters over those rows and combines
 * them: a text search over the name, category and address already printed in
 * each row; a category; and one A–Z letter. It loads no data — the index is
 * read once out of the DOM — and listens with one delegated handler per
 * region rather than one per row.
 *
 * Imported by js/static-page.js on this page only. Analytics records that a
 * control was used, never what was typed.
 */

import { trackEvent } from './analytics.js';

/** "Émile Zola’s" → "emile zola's", so a search need not get accents right. */
const fold = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[‘’]/g, "'").toLowerCase();

const fmt = n => n.toLocaleString('en-GB');

/** An empty aria-current reads as false, so it is "true" or absent. */
function setCurrent(node, on) {
  if (on) node.setAttribute('aria-current', 'true');
  else node.removeAttribute('aria-current');
}

export function initDirectory(root = document) {
  const form = root.querySelector('.dir-controls');
  const input = root.querySelector('#dir-q');
  const select = root.querySelector('#dir-cat');
  const count = root.querySelector('#dir-count');
  const empty = root.querySelector('#dir-empty');
  const az = root.querySelector('.dir-az');
  const main = root.querySelector('.dir-main');
  if (!form || !input || !select || !count || !az || !main) return;

  // Read once. Each row's searchable text is exactly what the row shows.
  const sections = [...root.querySelectorAll('.dir-letter')].map(el => ({
    el,
    id: el.id,
    link: az.querySelector(`a[href="#${el.id}"]`),
    rows: [...el.querySelectorAll('.dir-list > li')].map(li => ({
      li,
      category: li.dataset.c || '',
      text: fold(`${li.querySelector('.dir-name')?.textContent || ''} `
                 + `${li.querySelector('.dir-meta')?.textContent || ''}`),
    })),
  }));
  const allLink = az.querySelector('.dir-az-all');
  const clearInStatus = root.querySelector('.dir-status [data-clear]');

  let letter = '';          // the chosen section's id, or '' for all of them
  let searchTracked = false;

  function apply() {
    const terms = fold(input.value).trim().split(/\s+/).filter(Boolean);
    const category = select.value;
    let shown = 0;

    for (const section of sections) {
      const inView = !letter || section.id === letter;
      let matches = 0;
      for (const row of section.rows) {
        const match = (!category || row.category === category)
          && terms.every(term => row.text.includes(term));
        if (match) matches++;
        const hide = !(match && inView);
        if (row.li.hidden !== hide) row.li.hidden = hide;
      }
      section.el.hidden = !inView || !matches;
      if (inView) shown += matches;

      // A letter with nothing under the current search and category cannot be
      // chosen — but the one already chosen stays reachable, so it can be
      // un-chosen.
      if (section.link) {
        const off = !matches && section.id !== letter;
        section.link.classList.toggle('is-off', off);
        if (off) section.link.setAttribute('aria-disabled', 'true');
        else section.link.removeAttribute('aria-disabled');
        section.link.tabIndex = off ? -1 : 0;
        setCurrent(section.link, section.id === letter);
      }
    }
    if (allLink) setCurrent(allLink, !letter);

    const filtered = terms.length > 0 || !!category || !!letter;
    count.textContent = shown === 1 ? '1 plaque'
      : shown === 0 ? 'No plaques' : `${fmt(shown)} plaques`;
    if (empty) empty.hidden = shown > 0;
    if (clearInStatus) clearInStatus.hidden = !filtered || shown === 0;
  }

  function clear() {
    input.value = '';
    select.value = '';
    letter = '';
    apply();
    // The button that was pressed has just been hidden; keep focus somewhere useful.
    input.focus();
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    input.blur();           // closes the on-screen keyboard; results are already shown
    // On a phone the results start below the fold, under the keyboard that
    // just closed. Bring the count to the top so they are what is on screen.
    if (count.getBoundingClientRect().top > window.innerHeight * 0.6) {
      count.scrollIntoView({ block: 'start' });
    }
  });

  input.addEventListener('input', () => {
    if (!searchTracked && input.value.trim().length >= 2) {
      searchTracked = true;
      trackEvent('directory_search');
    }
    apply();
  });

  select.addEventListener('change', () => {
    if (select.value) trackEvent('directory_category', { category: select.value });
    apply();
  });

  az.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link) return;
    event.preventDefault();
    if (link.getAttribute('aria-disabled') === 'true') return;
    const id = link === allLink ? '' : link.getAttribute('href').slice(1);
    letter = id === letter ? '' : id;
    if (letter) trackEvent('directory_letter');
    apply();
  });

  main.addEventListener('click', event => {
    if (event.target.closest('[data-clear]')) { clear(); return; }
    const link = event.target.closest('.dir-list a');
    if (!link) return;
    if (link.classList.contains('dir-map')) trackEvent('directory_map');
    else trackEvent('directory_plaque');
  });

  form.hidden = false;
  // Back from a plaque page, the browser may have restored what was typed or
  // chosen; apply it so the list agrees with the controls.
  if (input.value || select.value) apply();
}
