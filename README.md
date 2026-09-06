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
- **Themed collections** — fourteen sets that cut across the categories, each
  finishable: Iconic Londoners, Swinging Sixties, Georgian London, South of the
  River, Where They Worked and more. All derived from the data, none hand-listed.
- **Iconic moments** — collecting one of the 49 Iconic plaques draws it as a
  plaque and tells you something true about the person.
- **Backup links** — move a collection to another browser or device without an
  account. The whole save travels inside a URL fragment.
- **A shareable card** — a 1080×1350 image of your progress, rendered in the
  browser, with a dot for every plaque on the map and yours filled in.
- **Add to Home Screen** — offered after a third discovery, because Safari
  clears site storage after a week away and a home-screen install is exempt.

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

Three suites, all dependency-free:

| Suite | Runner | Covers |
|-------|--------|--------|
| `tests/logic.test.mjs` | JavaScriptCore (ships with macOS) | XP and levels, Haversine distances, `localStorage` robustness, derived progress, achievements, quests, recommendation ranking, dataset integrity |
| `tests/seo.test.py` | Python 3 | slug stability and collisions, HTML and URL escaping, generated page content, canonical URLs, relative paths, sitemap contents |
| `tests/smoke.html` | headless Chrome via `tests/cdp.py` | boot, marker rendering, layout and touch targets at 390 px, search, the collect flow, tab navigation, filters, categories, reset, `?plaque=` deep links |

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

A fourth script turns the finished dataset into the crawlable half of the site
— one static page per plaque plus the sitemap. Run it whenever the data
changes:

```bash
python3 scripts/generate_seo_pages.py    # plaques/<slug>/index.html + sitemap.xml
```

The share card and app icons are generated too, but only when the branding
changes — they are committed, not built per deploy:

```bash
python3 scripts/make_social_image.py     # assets/social/og-cover.png
```

```
fetch plaques → add fame → classify categories → data/plaques.geojson
                                                       ↓
                                        generate SEO pages → deploy
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
python3 scripts/generate_seo_pages.py
bash tests/run.sh
git add data/plaques.geojson plaques sitemap.xml && git commit -m "refresh plaque data"
```

---

## Static plaque pages

Everything in the app is rendered from `data/plaques.geojson` in JavaScript, so
until now no individual plaque had a URL a search engine could index.
`scripts/generate_seo_pages.py` gives each one a plain HTML page:

```
plaques/freddie-mercury-12345/index.html
  → https://nyatasha.github.io/blueplaques/plaques/freddie-mercury-12345/
```

- The slug is `<name>-<openplaques id>`, so it is readable, lowercase,
  URL-safe, stable across builds and collision-free even when two plaques
  share a name.
- The facts are in the initial HTML — inscription, address, year erected,
  roles, category, photo, coordinates and the Wikipedia and OpenPlaques links.
  Nothing is written by a model and nothing waits on a fetch.
- Every page links five nearby plaques, so the set is crawlable by following
  links as well as through the sitemap.
- All text and URLs are escaped on the way out, and non-`http(s)` URLs in the
  dataset are dropped rather than emitted.
- Paths are relative (`../../css/tokens.css`, `../../?plaque=<id>`), which is
  what makes them work under the `/blueplaques/` project subdirectory.

**View on interactive map** on each page points at `/?plaque=<id>`. The app
reads that parameter once during boot and, after the dataset and markers are
ready, runs the ordinary selection path — so the camera move and the detail
sheet behave exactly as a tap on the marker does. An unknown or missing id is
ignored and the app starts normally.

`sitemap.xml` is generated by the same script and lists the homepage plus every
plaque page. It carries no `lastmod`, `priority` or `changefreq`: nothing in the
pipeline records when a plaque's facts last changed, and an invented date is
worse than none.

Both the pages and the sitemap are committed, because GitHub Pages serves the
repository as-is.

---

## Project layout

```
index.html                     app shell, SEO metadata, crawlable About copy
manifest.json                  PWA manifest
sitemap.xml                    generated — homepage + every plaque page
plaques/<slug>/index.html      generated — one static page per plaque
css/
  tokens.css                   design tokens — colour, type, space, motion
  plaque-page.css              the generated static plaque pages
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
  themes.js                    themed collections, derived from the dataset
  celebrate.js                 the Iconic collect moment
  share-card.js                canvas-rendered progress image
  install.js                   Add to Home Screen offer and detection
  backup.js                    save encoding, backup links, merge on restore
  location.js                  geolocation, requested only on user action
  recommend.js                 "find my next discovery" ranking
  geo.js                       Haversine, formatting, directions links
  sheet.js                     bottom-sheet controller
  ui.js / icons.js             DOM helpers, toasts, inline SVG icons
  analytics.js                 provider-agnostic trackEvent()
data/iconic-notes.json         hand-written notes for Iconic plaques
scripts/                       Python data pipeline
tests/                         logic + smoke suites, CDP client
data/plaques.geojson           the dataset
```

---

## Backup links

There are no accounts, so a collection lives in one browser. **My London → Move
to another browser** produces a link that carries the whole save:

```
https://nyatasha.github.io/blueplaques/#restore=lu1-dh.fyz.1-e9.fyz-…
```

Opening it anywhere offers to restore. Details worth knowing:

- The payload rides in the URL **fragment**, so it is never sent to any server.
- Restoring **merges** — a discovery made on the receiving browser is never lost,
  the earlier collection date wins, and verified beats unverified.
- Only facts are encoded: plaque id, day, verified. Achievements, quests, XP and
  levels are recomputed on arrival, so a backup cannot carry inconsistent state.
- Ids absent from the current dataset are dropped, so an old link stays safe
  after a data refresh.
- Roughly 9 characters per discovery — a 50-plaque collection is ~450 characters.
- Anyone holding the link can load that collection, so it is private by
  convention, not by cryptography. The UI says so.

`__lu.backupUrl()` returns the current link from the console.

---

## Testing the verified-collection flow

Collecting a discovery as **verified** normally requires standing within 100 m of the
plaque, which is awkward to exercise from a desk. Load the app with:

```
http://localhost:8000/?verify=anywhere
```

and any discovery can be collected as verified — the proximity check is skipped, and it
works whether or not the browser has a location fix. While it is active the plaque sheet
says *"Test mode — collecting as verified without checking your location"*, so a test find
cannot be mistaken for a real one.

It can also be toggled from the console without reloading:

```js
__lu.verifyAnywhere(true)    // skip the proximity check
__lu.verifyAnywhere(false)   // back to normal
```

The override is off unless explicitly switched on and is never persisted — dropping the
query parameter restores normal behaviour. The test suite asserts both that it defaults to
off and that switching it off again restores the proximity check.

Other console helpers on `__lu`: `progress()`, `events()`, `open(id)`,
`collect(id, verified)`, `backupUrl()` and `reset()`.

---

## Analytics

Events go to [GoatCounter](https://nyatasha.goatcounter.com). Nothing is stored
on the visitor's device — no cookies, no `localStorage`, no fingerprint — so no
consent banner is required, and no coordinates or plaque ids are ever sent.

To check the integration locally, GoatCounter ignores `localhost` unless asked:

```bash
python3 -m http.server 8000
# open http://localhost:8000/?gc=local
```

`__lu.events()` shows every event with the exact path that was sent, whether or
not the beacon got through.

Full taxonomy, metric derivations and known limits: `docs/analytics-plan.md`.

---

## Configuration points

Two things are deliberately left unset, each in one documented place:

- **Analytics** — `ENDPOINT` in `js/analytics.js`, pointing at GoatCounter.
  Set it to `''` to switch analytics off entirely. GoatCounter stores nothing on
  the visitor's device, so the site needs no consent banner. The event taxonomy
  and how each success metric is derived are in `docs/analytics-plan.md`.
  No product code names a provider — everything calls `trackEvent(name, props)`.
- **Basemap** — `BASEMAP` in `js/config.js`. Defaults to Esri's Light Gray
  Canvas, which needs no API key. CARTO Positron now watermarks every tile
  requested without a key; the comment there explains how to switch back if
  you register one.

---

## Deployment

GitHub Pages serves the repository root as-is. Push to the deployment branch
and the site updates — the app itself has no build step. The only generated
output is `plaques/` and `sitemap.xml`; regenerate them with
`python3 scripts/generate_seo_pages.py` whenever `data/plaques.geojson`
changes, and commit the result.

---

## Sources and attribution

Plaque data from [OpenPlaques](https://openplaques.org) (public domain).
Fame tiers derived from Wikipedia monthly pageview counts.
Map tiles © [Esri](https://www.esri.com), HERE, Garmin and
© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

London Uncovered is an independent project and is not affiliated with or
endorsed by English Heritage.
