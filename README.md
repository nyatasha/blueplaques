# London Uncovered

A mobile-first London exploration game built on an interactive map of every
English Heritage blue plaque in the city. Explore the map, find plaques near
you, collect the discoveries you make, and watch your London fill in.

**Live site:** https://nyatasha.github.io/blueplaques/

> Discover the stories hiding around you.

---

## What it does

- **Map** — all English Heritage blue plaques in London, clustered, with
  markers that show fame tier and whether you have collected them.
- **Search** — people, places and categories, with grouped suggestions.
- **Categories** — every plaque is classified into one of nine top-level
  categories (Writers & Literature, Art & Design, Science & Technology,
  Film & Theatre, Music, Politics & Society, Architecture, Sport, Other).
- **Find my next discovery** — ranks nearby uncollected plaques by distance,
  fame and context, and points you at one.
- **Collecting** — collect a discovery on location (verified within 100 m) or
  mark one as seen from anywhere. Progress earns XP and levels.
- **Quest** — five fixed goals that answer "what should I do next?".
- **My London** — discoveries, percentage of London uncovered, level, recent
  finds, category collections and achievement badges.

Progress lives in this browser's `localStorage`. There are no accounts, no
backend and no tracking of your location.

---

## Running it locally

No build step and no dependencies — it is static files plus Leaflet from a CDN.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

A server is required: the app uses native ES modules and `fetch`, neither of
which works from a `file://` URL.

---

## Tests

```bash
bash tests/run.sh
```

Two suites, both dependency-free:

| Suite | Runner | Covers |
|-------|--------|--------|
| `tests/logic.test.mjs` | JavaScriptCore (ships with macOS) | XP and levels, Haversine distances, `localStorage` robustness, derived progress, achievements, quests, recommendation ranking, dataset integrity |
| `tests/smoke.html` | headless Chrome via `tests/cdp.py` | boot, marker rendering, layout and touch targets at 390 px, search, the collect flow, tab navigation, filters, categories, reset |

`tests/cdp.py` is a small self-contained Chrome DevTools Protocol client; it
also takes screenshots:

```bash
python3 tests/cdp.py shot http://localhost:8000/ shot.png 390 844
```

---

## Data pipeline

Three scripts run in order. Each one reads and rewrites
`data/plaques.geojson`, so run them in sequence:

```bash
python3 scripts/fetch_plaques.py         # OpenPlaques CSV → GeoJSON
python3 scripts/add_fame.py              # + Wikipedia pageviews → fame 0–3
python3 scripts/classify_categories.py   # + category + category_label
```

```
fetch plaques → add fame → classify categories → data/plaques.geojson → deploy
```

Useful flags while working on the classifier:

```bash
python3 scripts/classify_categories.py --dry-run   # classify, write nothing
python3 scripts/classify_categories.py --report    # per-category samples and
                                                   # the unclassified list
```

Classification is deterministic keyword matching over each plaque's
`lead_roles` and `inscription`, with a small manual override table for
high-profile figures the rules place badly. **No AI runs at build or run
time** and the deployed site calls no API.

To refresh the data:

```bash
python3 scripts/fetch_plaques.py
python3 scripts/add_fame.py
python3 scripts/classify_categories.py
bash tests/run.sh
git add data/plaques.geojson && git commit -m "refresh plaque data"
```

---

## Project layout

```
index.html                     app shell, SEO metadata, crawlable About copy
manifest.json                  PWA manifest
css/
  tokens.css                   design tokens — colour, type, space, motion
  app.css                      reset, shell layout, buttons, boot screen
  map.css                      Leaflet surface, markers, clusters, map controls
  components.css               nav, sheets, cards, badges, screens, toasts
js/
  app.js                       bootstrap, tabs, collect flow, orchestration
  config.js                    constants, categories, XP, level curve, basemap
  data.js                      GeoJSON loading and indexing
  state.js                     app state and every derived value
  storage.js                   versioned, defensive localStorage
  map.js                       Leaflet map, marker states, clustering, camera
  search.js                    search index and grouped suggestions
  filters.js                   filter sheet
  plaque-sheet.js              discovery detail sheet
  quest-screen.js              Quest tab
  mylondon.js                  My London tab
  quests.js / achievements.js  fixed definitions, evaluated from progress
  location.js                  geolocation, requested only on user action
  recommend.js                 "find my next discovery" ranking
  geo.js                       Haversine, formatting, directions links
  sheet.js                     bottom-sheet controller
  ui.js / icons.js             DOM helpers, toasts, inline SVG icons
  analytics.js                 provider-agnostic trackEvent()
scripts/                       Python data pipeline
tests/                         logic + smoke suites, CDP client
data/plaques.geojson           the dataset
```

---

## Configuration points

Two things are deliberately left unset, each in one documented place:

- **Analytics** — `GA_MEASUREMENT_ID` in `js/analytics.js`. Empty by default,
  so nothing leaves the browser. Set a GA4 id to start sending events;
  no product code depends on the provider.
- **Basemap** — `BASEMAP` in `js/config.js`. Defaults to Esri's Light Gray
  Canvas, which needs no API key. CARTO Positron now watermarks every tile
  requested without a key; the comment there explains how to switch back if
  you register one.

---

## Deployment

GitHub Pages serves the repository root as-is. Push to the deployment branch
and the site updates — there is nothing to build.

---

## Sources and attribution

Plaque data from [OpenPlaques](https://openplaques.org) (public domain).
Fame tiers derived from Wikipedia monthly pageview counts.
Map tiles © [Esri](https://www.esri.com), HERE, Garmin and
© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

London Uncovered is an independent project and is not affiliated with or
endorsed by English Heritage.
