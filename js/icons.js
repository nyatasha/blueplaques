/** Inline SVG icon set — no icon font, no network request. 24×24 grid. */

const stroke = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  search:    `<circle cx="11" cy="11" r="7" ${stroke}/><path d="m20 20-3.6-3.6" ${stroke}/>`,
  close:     `<path d="M6 6l12 12M18 6L6 18" ${stroke}/>`,
  sliders:   `<path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M8 14.5v5" ${stroke}/>`,
  map:       `<path d="M9 4 3.5 6.2v13.3L9 17.3l6 2.4 5.5-2.2V4.2L15 6.4z" ${stroke}/><path d="M9 4v13.3M15 6.4v13.3" ${stroke}/>`,
  compass:   `<circle cx="12" cy="12" r="8.6" ${stroke}/><path d="m14.9 9.1-1.6 4.2-4.2 1.6 1.6-4.2z" ${stroke}/>`,
  bookmark:  `<path d="M12 3.6a8.4 8.4 0 0 1 8.4 8.4c0 5-8.4 12-8.4 12S3.6 17 3.6 12A8.4 8.4 0 0 1 12 3.6Z" ${stroke}/><circle cx="12" cy="11.8" r="2.8" ${stroke}/>`,
  locate:    `<circle cx="12" cy="12" r="7.2" ${stroke}/><path d="M12 1.8v3M12 19.2v3M22.2 12h-3M4.8 12h-3" ${stroke}/><circle cx="12" cy="12" r="2.4" fill="currentColor"/>`,
  navigate:  `<path d="M20.5 3.5 3.9 10.2c-.7.3-.6 1.3.1 1.5l6.7 1.9 1.9 6.7c.2.7 1.2.8 1.5.1z" ${stroke}/>`,
  sparkle:   `<path d="M12 3.2 13.8 9 19.6 10.8 13.8 12.6 12 18.4 10.2 12.6 4.4 10.8 10.2 9z" ${stroke}/><path d="M18.6 3.4v3M20.1 4.9h-3" ${stroke}/>`,
  check:     `<path d="M5 12.8 9.6 17.4 19 6.9" ${stroke}/>`,
  star:      `<path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z" ${stroke}/>`,
  arrowRight:`<path d="M4.5 12h15M13.5 6l6 6-6 6" ${stroke}/>`,
  chevronR:  `<path d="m9.5 5.5 6.5 6.5-6.5 6.5" ${stroke}/>`,
  back:      `<path d="M19.5 12h-15M10.5 6l-6 6 6 6" ${stroke}/>`,
  info:      `<circle cx="12" cy="12" r="8.6" ${stroke}/><path d="M12 11v5.4" ${stroke}/><circle cx="12" cy="7.9" r="1.05" fill="currentColor"/>`,
  share:     `<path d="M12 15.5V3.6M8.2 7.4 12 3.6l3.8 3.8" ${stroke}/><path d="M6 11.4H4.6v8.4a1.2 1.2 0 0 0 1.2 1.2h12.4a1.2 1.2 0 0 0 1.2-1.2v-8.4H18" ${stroke}/>`,
  book:      `<path d="M4.6 4.8A1.6 1.6 0 0 1 6.2 3.2h5.8v17.6H6.2a1.6 1.6 0 0 1-1.6-1.6z" ${stroke}/><path d="M19.4 4.8a1.6 1.6 0 0 0-1.6-1.6H12v17.6h5.8a1.6 1.6 0 0 0 1.6-1.6z" ${stroke}/><path d="M12 3.2v17.6" ${stroke}/>`,
  palette:   `<path d="M12 3.6a8.4 8.4 0 0 0 0 16.8c1.2 0 1.9-.8 1.9-1.7 0-1.4-1.2-1.6-1.2-2.7 0-.8.7-1.4 1.6-1.4h1.6a4.5 4.5 0 0 0 4.5-4.5c0-3.8-3.7-6.5-8.4-6.5Z" ${stroke}/><circle cx="8" cy="10.4" r="1.1" fill="currentColor"/><circle cx="12" cy="7.8" r="1.1" fill="currentColor"/><circle cx="15.9" cy="10.2" r="1.1" fill="currentColor"/>`,
  atom:      `<circle cx="12" cy="12" r="2.2" ${stroke}/><ellipse cx="12" cy="12" rx="9" ry="4" ${stroke}/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)" ${stroke}/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)" ${stroke}/>`,
  masks:     `<path d="M4 5.4h8.4v6.8a4.2 4.2 0 0 1-8.4 0z" ${stroke}/><path d="M11.6 5.4H20v6.8a4.2 4.2 0 0 1-6.6 3.4" ${stroke}/><path d="M6.6 9.2h.01M9.8 9.2h.01M15 9.2h.01M18 9.2h.01" ${stroke}/>`,
  layers:    `<path d="M12 3.6 3.4 8 12 12.4 20.6 8z" ${stroke}/><path d="m3.4 13 8.6 4.4 8.6-4.4" ${stroke}/>`,
  footsteps: `<path d="M8.4 4.4c1.6 0 2.4 1.5 2.2 3.4-.2 1.6-.7 2.6-.7 3.8 0 1.3-.7 2-1.9 2s-2-.7-2-2c0-1.2.3-2.2.2-3.8-.2-1.9.6-3.4 2.2-3.4Z" ${stroke}/><path d="M6.1 15.2h3.9v2.2a1.9 1.9 0 0 1-3.9 0z" ${stroke}/><path d="M16.1 8.6c1.6 0 2.4 1.5 2.2 3.4-.2 1.6-.7 2.6-.7 3.8 0 1.3-.7 2-1.9 2s-2-.7-2-2c0-1.2.3-2.2.2-3.8-.2-1.9.6-3.4 2.2-3.4Z" ${stroke}/>`,
  medal:     `<circle cx="12" cy="14.6" r="5.2" ${stroke}/><path d="M8.6 9.6 6.2 3.8h11.6l-2.4 5.8" ${stroke}/><path d="m12 12.1.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2L9.1 14.3l2-.3z" ${stroke}/>`,
  lock:      `<rect x="4.8" y="10.4" width="14.4" height="9.6" rx="2.2" ${stroke}/><path d="M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6" ${stroke}/>`,
  globe:     `<circle cx="12" cy="12" r="8.6" ${stroke}/><path d="M3.4 12h17.2M12 3.4c2.4 2.5 3.6 5.4 3.6 8.6s-1.2 6.1-3.6 8.6c-2.4-2.5-3.6-5.4-3.6-8.6S9.6 5.9 12 3.4Z" ${stroke}/>`,
  target:    `<circle cx="12" cy="12" r="8.4" ${stroke}/><circle cx="12" cy="12" r="4.2" ${stroke}/><circle cx="12" cy="12" r="1" fill="currentColor"/>`,
  shield:    `<path d="M12 3.4 5 6.1v5.5c0 4 2.9 7.6 7 8.9 4.1-1.3 7-4.9 7-8.9V6.1z" ${stroke}/><path d="m9.2 12.1 2 2 3.6-3.9" ${stroke}/>`,
  refresh:   `<path d="M20 12a8 8 0 1 1-2.6-5.9" ${stroke}/><path d="M20.4 3.9v4.6h-4.6" ${stroke}/>`,
  building:  `<path d="M5 20.4V5.2a1.6 1.6 0 0 1 1.6-1.6h6.6a1.6 1.6 0 0 1 1.6 1.6v15.2" ${stroke}/><path d="M14.8 9.6h3.6a1.6 1.6 0 0 1 1.6 1.6v9.2M3.4 20.4h17.2" ${stroke}/><path d="M8.2 7.6h3.4M8.2 11.4h3.4M8.2 15.2h3.4" ${stroke}/>`,
  trophy:    `<path d="M7.4 4.2h9.2v5a4.6 4.6 0 0 1-9.2 0z" ${stroke}/><path d="M7.4 5.8H4.9v1.4a3 3 0 0 0 2.6 3M16.6 5.8h2.5v1.4a3 3 0 0 1-2.6 3" ${stroke}/><path d="M12 13.8v3.4M8.6 20.2h6.8l-.7-3H9.3z" ${stroke}/>`,
  photo:     `<rect x="3.6" y="5" width="16.8" height="14" rx="2.2" ${stroke}/><circle cx="9" cy="10" r="1.7" ${stroke}/><path d="m4.4 17.4 4.4-4.1a1.8 1.8 0 0 1 2.5 0l4.3 4.1M14.4 14.6l1.6-1.5a1.8 1.8 0 0 1 2.5 0l1.5 1.4" ${stroke}/>`,
  wiki:      `<path d="M3.2 6.6h4.2M16.6 6.6h4.2M9.4 6.6h4" ${stroke}/><path d="m5.3 6.6 4 10.8 3-7.2M12.3 10.2l2.7 7.2 3.6-10.8" ${stroke}/>`,
};

/** Returns an <svg> string. Pass a size to override the 24px default box. */
export function icon(name, cls = '') {
  const body = PATHS[name];
  if (!body) return '';
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"${cls ? ` class="${cls}"` : ''}>${body}</svg>`;
}

/** Icon chosen for each top-level category. */
export const CATEGORY_ICON = {
  writers: 'book',
  art: 'palette',
  science: 'atom',
  'film-theatre': 'masks',
  music: 'sparkle',
  politics: 'globe',
  architecture: 'building',
  sport: 'medal',
  other: 'layers',
};
