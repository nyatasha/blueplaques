# London Uncovered

A mobile-first London exploration game built on an interactive map of the
English Heritage blue plaque scheme. Explore the map, find plaques near you,
collect the discoveries you make, and watch your London fill in.

**Live site:** https://nyatasha.github.io/blueplaques/

> Discover the stories hiding around you.

---

## What it does

- **Map** — the English Heritage scheme's London plaques, clustered, with
  markers that show fame tier and whether you have collected them.
- **Search** — people, places and categories, with grouped suggestions.
- **Categories** — every plaque is classified into one of nine top-level
  categories (Writers & Literature, Art & Design, Science & Technology,
  Film & Theatre, Music, Politics & Society, Architecture, Sport, Other).
- **Find my next discovery** — ranks nearby uncollected plaques by distance,
  fame and context, and points you at one.
- **Collecting** — collect a discovery on location (verified within 100 m) or
  mark one as seen from anywhere. Progress earns XP and levels.
- **Walks** — four curated self-guided routes built from plaques already on the
  map, each with its stops in walking order, the distance and the walking time.
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
| `tests/seo.test.py` | Python 3 | slug stability and collisions, HTML and URL escaping, generated page content, canonical URLs, relative paths, the internal link graph (category, nearby, walks), category and walk page contents, walk definitions and derived distances, the plaque URL map, sitemap contents |
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
— a page per plaque, a page per category, a page per curated walk, the URL map
the app links with, and the sitemap. Run it whenever the data changes:

```bash
python3 scripts/generate_seo_pages.py    # plaques/ + categories/ + walks/ + data/plaque-urls.json + sitemap.xml
```

The share card and app icons are generated too, and committed rather than built
per deploy. The card carries the plaque count, which it reads from the dataset,
so re-run it after a data refresh as well as after a branding change:

```bash
python3 scripts/make_social_image.py     # assets/social/og-cover.png
```

```
fetch plaques → add fame → classify categories → data/plaques.geojson
                                                       ↓
                                        generate SEO pages → deploy
```

`generate_seo_pages.py` also rewrites the plaque count in `index.html` — in the
Twitter description, the JSON-LD and the `<noscript>` block — from the dataset
it just read. Those numbers live inside `<!--gen:NAME-->…<!--/gen:NAME-->`
regions and must not be edited by hand; a refresh would overwrite them anyway.

### What the dataset covers

Every plaque in the [OpenPlaques London
datapull](https://openplaques.org/posts/data) of **14 December 2025** (accessed
2026-09-06) tagged into the scheme administered by English Heritage — 1,001
rows, whatever colour the plaque is. The scheme's early plaques are brown
terracotta, stone, bronze, black, grey, white and green, and selecting on
`colour == "blue"` used to discard 76 of them (decision-log #24).

This is **not** every plaque of the scheme that exists: Wikipedia's [list of
English Heritage blue
plaques](https://en.wikipedia.org/wiki/List_of_English_Heritage_blue_plaques_in_London)
gives 1,018 (accessed 2026-09-06), so the dump itself trails the scheme by
roughly 17. Nor is it every plaque in London — the same dump holds 3,781 across
some 200 erecting bodies. Rows we do not ship are written to
`docs/data-quality/excluded-rows.csv` with a reason, one line each, so the
shipped count plus the excluded count always equals the dump. That report is an
internal QA artefact — `docs/` is not tracked, and it is not served.

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
python3 scripts/make_social_image.py
bash tests/run.sh
git add data/plaques.geojson plaques categories walks sitemap.xml index.html \
  assets/social/og-cover.png \
  && git commit -m "refresh plaque data"
```

---

## Curated walks

Four self-guided routes, each a hand-picked run of plaques that already exist in
the dataset and stand close enough together to walk in an afternoon:

| Walk | Area | Stops | Distance | Walking |
|------|------|-------|----------|---------|
| Bloomsbury Writers & Thinkers | Bloomsbury & Fitzrovia, WC1 | 8 | ~3.0 km | ~38 min |
| Chelsea Riverside | Chelsea, SW3 & SW10 | 8 | ~1.7 km | ~21 min |
| Mayfair: Handel to Hendrix | Mayfair & St James's, W1 & SW1 | 7 | ~2.9 km | ~36 min |
| Hampstead Village | Hampstead, NW3 | 8 | ~2.3 km | ~28 min |

`data/walks.json` is the whole definition. It holds only what is genuinely
editorial — the slug, name, area, the copy, and the stops in walking order, each
a plaque id and one sentence saying why to stop there:

```json
{
  "slug": "chelsea-riverside",
  "name": "Chelsea Riverside",
  "area": "Chelsea, SW3 & SW10",
  "icon": "palette",
  "tagline": "Oscar Wilde, Bob Marley and a mile of the Thames.",
  "intro": "Cheyne Walk and the streets running off it …",
  "startHint": "Start near Sloane Square; finish near Chelsea Harbour …",
  "stops": [
    { "id": "287", "note": "Wilde lived at 34 Tite Street from 1884 until 1895 …" }
  ]
}
```

Adding a walk is adding one object to that array and re-running
`scripts/generate_seo_pages.py`.

**Nothing measurable is stored there.** Stop count, distance and walking time are
derived from the plaques' own coordinates — in `js/walks.js` for the app and in
`scripts/generate_seo_pages.py` for the pages — so a walk can never claim a
distance the map does not support, and a data refresh re-derives all of it.

Distance is the summed straight-line legs between consecutive stops multiplied
by `ROUTE_FACTOR` (1.3), the ordinary circuity allowance for a dense urban street
grid, and duration is that at the 80 m/min already in `js/config.js`. It is an
estimate, so every surface says "about" and the walk pages state the derivation
in their footer. The factor is declared once in each file and
`tests/seo.test.py` asserts the two agree.

**Progress is the collection.** A walk's progress is how many of its stops are
already collected — there is no walk-specific state, no walk XP and no schema
change, so collecting a plaque anywhere moves every walk it belongs to, and a
backup link carries walk progress without knowing walks exist.

In the app, **Walks** is the second tab. *Start walk* clears the filters, sets
`state.filters.walk` — the same mechanism themed collections use — and fits the
camera to the stops; the stops themselves are ordinary markers, so there is no
route layer to keep in step with the map. Each stop row opens the usual plaque
sheet, and that sheet links back to any walk the plaque is on.

Stop notes are hand-written to the same standard as the Iconic notes: each is
supported by the plaque's own inscription or is not in dispute. Nothing about a
named person is asserted that the record does not carry.

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
- Every page links five nearby plaques and up to its category page — twice, in
  the breadcrumb and in "More in this category" — so the set is crawlable by
  following links as well as through the sitemap.
- All text and URLs are escaped on the way out, and non-`http(s)` URLs in the
  dataset are dropped rather than emitted.
- Paths are relative (`../../css/tokens.css`, `../../?plaque=<id>`), which is
  what makes them work under the `/blueplaques/` project subdirectory.

**View on interactive map** on each page points at `/?plaque=<id>`. The app
reads that parameter once during boot and, after the dataset and markers are
ready, runs the ordinary selection path — so the camera move and the detail
sheet behave exactly as a tap on the marker does. An unknown or missing id is
ignored and the app starts normally.

### Category pages

The same script writes one landing page per category that has plaques:

```
categories/writers-literature/index.html
  → https://nyatasha.github.io/blueplaques/categories/writers-literature/
```

- The URL slug is derived from the category's canonical label, not its internal
  key (`writers` → `writers-literature`), so renaming a category renames its URL
  in one place and the URL carries the words people search for.
- Each page has its own title, meta description, canonical URL and `<h1>`, a
  short intro made only of counted facts — how many plaques, the earliest and
  latest year erected, the areas they cluster in — and a two-column list of
  every plaque in the category with its dates, role, address and year.
- Each links back to the map and sideways to the other collections.
- Nothing on them is generated prose.

The homepage reaches them through plain anchors in the About panel and in the
`<noscript>` fallback, both in the initial HTML, so a crawler can walk
home → category → plaque without running any JavaScript.

### Real links in the app

The app's discovery lists — the desktop panel, "Near me", search suggestions and
recent finds in My London — render as `<a href="plaques/<slug>/">` rather than
buttons. An ordinary click is still intercepted and opens the plaque on the map;
a modifier-click or middle-click opens the static page in a new tab, and the DOM
carries a real URL for a crawler.

The hrefs come from `data/plaque-urls.json`, which the generator writes in the
same run as the pages, so the app cannot link to a slug the generator did not
produce. `js/data.js` loads it alongside the GeoJSON and validates the shape of
every slug; if it is missing the rows fall back to buttons and nothing else
changes.

### Walk pages

Each curated walk also has a page a crawler can read, and there is an index of
them:

```
walks/index.html                 → https://nyatasha.github.io/blueplaques/walks/
walks/chelsea-riverside/         → .../walks/chelsea-riverside/
```

- The whole route is in the initial HTML: the name, the area, the stop count,
  the distance, the walking time, the introductory copy, then an `<ol>` of the
  stops in order, each with its dates, address, a sentence of context and a link
  to that plaque's page.
- Structured data is an `ItemList` whose elements point at the plaque pages, so
  the markup and the visible list say the same thing.
- **Follow this walk on the map** points at `/?walk=<slug>`, which the app reads
  on boot and opens on the Walks tab with the stops on the map.
- **Open the route in Google Maps** is a keyless universal `maps/dir/` URL with
  the intermediate stops as waypoints and `travelmode=walking`.
- The 31 plaques that are stops on a walk link up to it from their own pages.
  The other 970 get no walk section rather than an empty heading.

### Sitemap

`sitemap.xml` is generated by the same script and lists the homepage, the walks
index, every walk, every category page, then every plaque page, de-duplicated
and each at its own canonical URL. It carries no `lastmod`, `priority` or `changefreq`: nothing in
the pipeline records when a plaque's facts last changed, and an invented date is
worse than none.

The pages, the URL map and the sitemap are all committed, because GitHub Pages
serves the repository as-is.

---

## Project layout

```
index.html                     app shell, SEO metadata, crawlable About copy
manifest.json                  PWA manifest
sitemap.xml                    generated — homepage + walks + categories + plaque pages
plaques/<slug>/index.html      generated — one static page per plaque
categories/<slug>/index.html   generated — one landing page per category
walks/index.html               generated — the walk index
walks/<slug>/index.html        generated — one page per curated walk
css/
  tokens.css                   design tokens — colour, type, space, motion
  plaque-page.css              the generated plaque, category and walk pages
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
  walks.js                     curated walks: resolution, derived distance, progress
  walk-screen.js               Walks tab — the index and one walk in full
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
data/walks.json                curated walk definitions — prose plus ordered plaque ids
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
output is `plaques/`, `categories/`, `walks/`, `data/plaque-urls.json` and
`sitemap.xml`;
regenerate them with `python3 scripts/generate_seo_pages.py` whenever
`data/plaques.geojson` changes, and commit the result.

---

## Sources and attribution

Plaque data from [OpenPlaques](https://openplaques.org) (public domain).
Fame tiers derived from Wikipedia monthly pageview counts.
Map tiles © [Esri](https://www.esri.com), HERE, Garmin and
© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

London Uncovered is an independent project and is not affiliated with or
endorsed by English Heritage.
