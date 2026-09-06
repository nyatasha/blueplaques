/**
 * Themed collections — curated sets that cut across the category taxonomy.
 *
 * Categories answer "what did this person do". Themes answer the more
 * interesting question: "what do these people have in common". They are the
 * cheaper, more characterful way to earn progress — most are between 15 and 66
 * plaques, so a set is finishable in a way that "Politics & Society" (258)
 * never is.
 *
 * Every theme is a rule over data already in the dataset, evaluated once at
 * load. Nothing is hand-listed, so a data refresh re-derives them all and no
 * membership can go stale.
 *
 * A note on what is deliberately absent: themes are only built from what the
 * plaques actually record — where someone lived, what the inscription says,
 * their dates and their fame. Anything the data does not state about a real,
 * named person is not ours to assert.
 */

/** Life dates as recorded on the plaque, e.g. "1882–1941". */
function lifespan(plaque) {
  const m = plaque.dates?.match(/^(\d{4})–(\d{4})$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const has = (plaque, re) => re.test(`${plaque.inscription} ${plaque.roles}`);

/** Nationality and origin words that appear on the plaques themselves. */
const FROM_ELSEWHERE = /\b(american|french|german|italian|indian|russian|polish|irish|australian|austrian|dutch|spanish|jamaican|nigerian|chinese|japanese|greek|hungarian|czech|swedish|danish|norwegian|south african|west indian|canadian|argentine|brazilian|turkish|persian|caribbean|pakistani|ghanaian|kenyan)\b/i;

export const THEME_DEFS = [
  {
    id: 'icons', name: 'Iconic Londoners', icon: 'star', gold: true,
    tagline: 'The names everyone knows.',
    match: p => p.fame >= 3,
  },
  {
    id: 'legends', name: 'London Legends', icon: 'trophy', gold: true,
    tagline: 'The twenty-five most looked-up people on the map.',
    match: (p, ctx) => p.views >= ctx.top25Views && p.views > 0,
  },
  {
    id: 'lived-died', name: 'A Whole Life Here', icon: 'bookmark',
    tagline: 'They lived and died at the same address.',
    match: p => /lived and died here/i.test(p.inscription),
  },
  {
    id: 'firsts', name: 'London Firsts', icon: 'sparkle',
    tagline: 'The first to do it.',
    match: p => /\bfirst\b/i.test(p.inscription),
  },
  {
    id: 'founders', name: 'The Founders', icon: 'building',
    tagline: 'They started something that outlived them.',
    match: p => has(p, /\bfound(er|ed|ing)\b/i),
  },
  {
    id: 'pioneers', name: 'The Pioneers', icon: 'compass',
    tagline: 'They went first so others could follow.',
    match: p => has(p, /\bpioneer/i),
  },
  {
    id: 'newcomers', name: 'New Londoners', icon: 'globe',
    tagline: 'They came from somewhere else and made London theirs.',
    match: p => FROM_ELSEWHERE.test(`${p.inscription} ${p.roles}`),
  },
  {
    id: 'sixties', name: 'Swinging Sixties', icon: 'masks',
    tagline: 'Artists, actors and musicians who saw London swing.',
    match: p => {
      const life = lifespan(p);
      return !!life && life[1] >= 1960 && life[0] <= 1945 && p.fame >= 2 &&
             ['music', 'film-theatre', 'art'].includes(p.category);
    },
  },
  {
    id: 'victorians', name: 'Victorian Giants', icon: 'book',
    tagline: 'They made their name under Victoria.',
    match: p => {
      const life = lifespan(p);
      return !!life && life[1] >= 1837 && life[1] <= 1901 && p.fame >= 2;
    },
  },
  {
    id: 'georgians', name: 'Georgian London', icon: 'building',
    tagline: 'Powdered wigs, coffee houses and the city before the railways.',
    match: p => {
      const life = lifespan(p);
      return !!life && life[1] >= 1714 && life[1] <= 1837;
    },
  },
  {
    id: 'at-work', name: 'Where They Worked', icon: 'footsteps',
    tagline: 'Not a home — the room where the work happened.',
    match: p => /worked here/i.test(p.inscription),
  },
  {
    id: 'south', name: 'South of the River', icon: 'navigate',
    tagline: 'Proof that London does not stop at the Thames.',
    match: p => /lambeth|southwark|greenwich|wandsworth|lewisham/i.test(p.address),
  },
  {
    id: 'hampstead', name: 'Hampstead Hill', icon: 'map',
    tagline: 'The village on the hill, thick with plaques.',
    match: p => /hampstead/i.test(p.address),
  },
  {
    id: 'bloomsbury', name: 'Bloomsbury & Soho', icon: 'layers',
    tagline: 'Literary squares and disreputable streets.',
    match: p => /bloomsbury|fitzrovia|\bsoho\b/i.test(p.address),
  },
  {
    id: 'before-blue', name: 'Before It Was Blue', icon: 'palette',
    tagline: 'The scheme’s earliest plaques — brown, stone, bronze and black.',
    match: p => Boolean(p.colour) && p.colour !== 'blue',
  },
];

/**
 * Resolves every theme to a concrete membership set.
 * @returns {Array<{id, name, tagline, icon, gold, ids: Set<string>, total: number}>}
 */
export function buildThemes(plaques) {
  const sorted = plaques.map(p => p.views || 0).sort((a, b) => b - a);
  const ctx = { top25Views: sorted[24] ?? 0 };

  return THEME_DEFS.map(def => {
    const ids = new Set();
    for (const plaque of plaques) {
      try {
        if (def.match(plaque, ctx)) ids.add(plaque.id);
      } catch { /* a malformed record must not break a whole theme */ }
    }
    return { ...def, ids, total: ids.size };
  }).filter(theme => theme.total >= 5 && theme.total <= 120);
  // A set larger than this is a category in disguise — not finishable, so not
  // motivating. Anything smaller is not worth a card.
}
