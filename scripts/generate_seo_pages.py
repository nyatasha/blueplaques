#!/usr/bin/env python3
"""
Generate the crawlable static layer: one page per plaque, one per category,
the client's plaque-URL map, and the sitemap.

The interactive app renders every plaque from `data/plaques.geojson` in
JavaScript, so no plaque has a URL of its own. This script gives each one a
plain HTML page at

    plaques/<slug>/index.html      →  /blueplaques/plaques/freddie-mercury-1234/

built from the same dataset, with the useful facts in the initial HTML rather
than behind a fetch. Every page links back into the app at `/?plaque=<id>`,
which the app reads on boot and opens.

Category pages live at

    categories/<slug>/index.html   →  /blueplaques/categories/writers-literature/

and list every plaque in that category, so a crawler reaching the site can walk
home → category → plaque without running any JavaScript. Plaque pages link back
up to their category and sideways to their five nearest neighbours.

Curated self-guided walks live at

    walks/<slug>/index.html        →  /blueplaques/walks/bloomsbury-writers/

with an index at walks/. Each is defined in `data/walks.json` as a name, some
prose and an ordered list of plaque ids; the stop count, distance and walking
time on the page are derived here from the coordinates, never typed. A plaque
that is a stop on a walk links up to it from its own page.

`data/plaque-urls.json` is written by the same run, so the app can render its
discovery lists as real links to these pages without reimplementing slugify()
in JavaScript and drifting from it.

Nothing is invented: each page carries only fields already in the dataset —
inscription, address, year erected, roles, category, photo, source links and
coordinates. Text is HTML-escaped and URLs are scheme-checked on the way out.

Output is committed, because GitHub Pages serves the repository as-is.

Usage:
    python3 scripts/generate_seo_pages.py            # write pages + sitemap
    python3 scripts/generate_seo_pages.py --dry-run  # report, write nothing
    python3 scripts/generate_seo_pages.py --out DIR  # write somewhere else
"""

import argparse
import collections
import html
import json
import math
import os
import re
import shutil
import sys
import unicodedata
from urllib.parse import quote, urlsplit

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)
DATA = os.path.join(ROOT, "data", "plaques.geojson")
WALKS_DATA = os.path.join(ROOT, "data", "walks.json")

SITE = "https://nyatasha.github.io/blueplaques/"
SITE_NAME = "London Uncovered"
PAGES_DIR = "plaques"          # relative to the site root
CATS_DIR = "categories"        # relative to the site root
WALKS_DIR = "walks"            # relative to the site root
URL_MAP = os.path.join("data", "plaque-urls.json")
SLUG_MAX = 60                  # characters before the id suffix
NEARBY = 5                     # internal links per page
DESC_MAX = 155

# Straight-line legs understate a walk; 1.3 is the ordinary circuity allowance
# for a dense urban street grid, and every distance and duration a walk page
# shows is labelled approximate because of it. js/walks.js uses the same
# factor and js/config.js the same pace, so the app and these pages agree.
ROUTE_FACTOR = 1.3
WALK_METRES_PER_MIN = 80

CATEGORY_LABELS = {
    "writers": "Writers & Literature",
    "art": "Art & Design",
    "science": "Science & Technology",
    "film-theatre": "Film & Theatre",
    "music": "Music",
    "politics": "Politics & Society",
    "architecture": "Architecture",
    "sport": "Sport",
    "other": "Other",
}

# Address tails that say nothing about where a plaque is; mirrors js/data.js.
PLACE_STOPWORDS = {"london", "greater london", "england", "uk"}


def category_slug(key):
    """`"writers"` → `"writers-literature"`.

    Derived from the canonical label rather than hard-coded, so renaming a
    category renames its URL in one place, and the URL carries the words people
    search for rather than the internal key.
    """
    return re.sub(r"[^a-z0-9]+", "-", CATEGORY_LABELS[key].lower()).strip("-")


CATEGORY_URL = {key: category_slug(key) for key in CATEGORY_LABELS}


# ── Text helpers ────────────────────────────────────────────────────────────

def esc(value):
    """Escape for both text nodes and quoted attribute values."""
    return html.escape("" if value is None else str(value), quote=True)


# Anything outside printable ASCII cannot appear in a URI at all. `%` and the
# hex digits are inside this range, so an already-encoded URL is left alone and
# nothing is ever encoded twice.
URL_MUST_ENCODE = re.compile(r"[^\x21-\x7e]")


def percent_encode(component):
    """Percent-encode the characters a URI may not carry literally.

    Photo file names in the dataset contain en-dashes and accented letters, and
    a few carry spaces. A browser guesses at those, but `og:image` and the
    JSON-LD `image`/`sameAs` values are read by crawlers that do not, so the
    URL has to leave here already valid. Reserved characters keep their meaning:
    only what is genuinely illegal is touched.
    """
    return URL_MUST_ENCODE.sub(lambda m: quote(m.group(), safe=""), component)


def clean_url(url):
    """Return a valid absolute http(s) URL, or '' for anything else.

    The dataset is public and third-party, so a `javascript:` or `data:` value
    must never reach an href, a src, or a JSON-LD node.
    """
    if not url:
        return ""
    try:
        parts = urlsplit(str(url).strip())
    except ValueError:
        return ""
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return ""
    return parts._replace(path=percent_encode(parts.path),
                          query=percent_encode(parts.query),
                          fragment=percent_encode(parts.fragment)).geturl()


def safe_url(url):
    """`clean_url`, escaped for a quoted attribute value."""
    return esc(clean_url(url))


def slugify(title, plaque_id):
    """`"C. L. R. James", "485"` → `"c-l-r-james-485"`.

    Stable across builds because it depends only on the title and the id, and
    collision-free because the id is always appended.
    """
    ascii_title = (unicodedata.normalize("NFKD", str(title or ""))
                   .encode("ascii", "ignore").decode("ascii"))
    base = re.sub(r"[^a-z0-9]+", "-", ascii_title.lower()).strip("-")
    if len(base) > SLUG_MAX:                       # cut on a word boundary
        base = base[:SLUG_MAX].rsplit("-", 1)[0].strip("-")
    ident = re.sub(r"[^a-z0-9]+", "-", str(plaque_id).lower()).strip("-")
    return f"{base}-{ident}" if base else f"plaque-{ident}"


def extract_dates(inscription):
    """Life dates sit right after the name in almost every inscription."""
    m = re.search(r"\b(1[0-9]{3})\s*[–—-]\s*(1[0-9]{3}|20[0-2][0-9])\b",
                  inscription or "")
    return f"{m.group(1)}–{m.group(2)}" if m else ""


def locality(address):
    """"165 Railton Road, Brixton, Lambeth, SE24" → "Brixton"."""
    for part in [p.strip() for p in (address or "").split(",")[1:]]:
        if (len(part) > 2 and not re.match(r"^[A-Z]{1,2}\d", part)
                and part.lower() not in PLACE_STOPWORDS):
            return part
    return ""


def truncate(text, limit=DESC_MAX):
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(" ,.;:—-") + "…"


def thumb(photo, width):
    """Commons Special:FilePath already carries a width; ask for the one we want."""
    if not photo:
        return ""
    return (re.sub(r"width=\d+", f"width={width}", photo)
            if "width=" in photo else photo)


def haversine(a, b):
    r = 6371000.0
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp = p2 - p1
    dl = math.radians(b["lng"] - a["lng"])
    h = (math.sin(dp / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2)
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


# ── Dataset ─────────────────────────────────────────────────────────────────

# The scheme is called the blue plaque scheme, but a quarter of its earliest
# plaques are brown terracotta, stone, bronze, black, grey, white or green.
# Naming the collection "blue plaques" is right; calling John Keats's brown
# terracotta roundel a blue plaque is not, so a page about one plaque uses the
# colour the dataset records for it.
KNOWN_COLOURS = {"blue", "brown", "black", "stone", "grey", "bronze", "white", "green"}


def plaque_noun(p):
    """"blue plaque" / "brown plaque" — what this one plaque should be called."""
    colour = p.get("colour", "")
    return f"{colour} plaque" if colour in KNOWN_COLOURS else "plaque"


def load_plaques(path=DATA):
    with open(path, encoding="utf-8") as fh:
        geojson = json.load(fh)
    features = geojson.get("features")
    if not isinstance(features, list):
        raise SystemExit(f"{path}: not a FeatureCollection")

    plaques, seen = [], set()
    for feature in features:
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        try:
            lng, lat = float(coords[0]), float(coords[1])
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(lat) and math.isfinite(lng)):
            continue
        props = feature.get("properties") or {}
        pid = str(props.get("id") or "").strip()
        if not pid or pid in seen:            # ids are the app's identity key
            continue
        title = (props.get("title") or "").strip()
        if not title:
            continue
        seen.add(pid)
        category = props.get("category") if props.get("category") in CATEGORY_LABELS else "other"
        plaques.append({
            "id": pid,
            "title": title,
            "inscription": (props.get("inscription") or "").strip(),
            "address": (props.get("address") or "").strip(),
            "year": str(props.get("year") or "").strip(),
            "photo": (props.get("photo") or "").strip(),
            "wikipedia": (props.get("wikipedia") or "").strip(),
            "roles": (props.get("lead_roles") or "").strip(),
            "source": (props.get("openplaques_url") or "").strip(),
            "fame": int(props.get("fame") or 0),
            "colour": (props.get("colour") or "").strip().lower(),
            "category": category,
            "category_label": props.get("category_label") or CATEGORY_LABELS[category],
            "lat": lat,
            "lng": lng,
        })

    for p in plaques:
        p["slug"] = slugify(p["title"], p["id"])
        p["dates"] = extract_dates(p["inscription"])
        p["locality"] = locality(p["address"])
        p["category_url"] = CATEGORY_URL[p["category"]]
    return plaques


def by_category(plaques):
    """Category key → its plaques, strongest first, in CATEGORY_LABELS order.

    Empty categories are left out: a landing page listing nothing is a page
    Google should never have been offered.
    """
    groups = {key: [] for key in CATEGORY_LABELS}
    for p in plaques:
        groups[p["category"]].append(p)
    for rows in groups.values():
        rows.sort(key=lambda p: (-p["fame"], p["title"].lower()))
    return {key: rows for key, rows in groups.items() if rows}


def nearest(plaque, plaques, count=NEARBY):
    others = ((haversine(plaque, o), o) for o in plaques if o["id"] != plaque["id"])
    return [o for _, o in sorted(others, key=lambda pair: pair[0])[:count]]


# ── Page rendering ──────────────────────────────────────────────────────────

def page_title(p):
    where = f" in {p['locality']}" if p["locality"] else " in London"
    return f"{p['title']} {plaque_noun(p)}{where} — {SITE_NAME}"


def meta_description(p):
    """Inscription first — it is the one line unique to this plaque.

    Pieces are dropped whole rather than truncated mid-clause, so a description
    never trails off in the middle of an address.
    """
    parts = []
    if p["inscription"]:
        parts.append(f"\u201c{truncate(p['inscription'], 110)}\u201d")
    if p["address"]:
        parts.append(f"{plaque_noun(p).capitalize()} at {p['address']}.")
    elif not p["inscription"]:
        parts.append(f"English Heritage {plaque_noun(p)} for {p['title']} in London.")
    if p["year"]:
        parts.append(f"Erected {p['year']}.")

    while len(parts) > 1 and len(" ".join(parts)) > DESC_MAX:
        parts.pop()
    return truncate(" ".join(parts), DESC_MAX)


def structured_data(p, url):
    """Only facts already in the dataset; no prose is synthesised here."""
    node = {
        "@context": "https://schema.org",
        "@type": "Place",
        "name": f"{p['title']} {plaque_noun(p)}",
        "url": url,
        "geo": {"@type": "GeoCoordinates",
                "latitude": round(p["lat"], 5), "longitude": round(p["lng"], 5)},
    }
    if p["inscription"]:
        node["description"] = p["inscription"]
    if p["address"]:
        node["address"] = {"@type": "PostalAddress",
                           "streetAddress": p["address"], "addressLocality": "London",
                           "addressCountry": "GB"}
    image = clean_url(thumb(p["photo"], 800))
    if image:
        node["image"] = image
    sameas = [u for u in (clean_url(p["wikipedia"]), clean_url(p["source"])) if u]
    if sameas:
        node["sameAs"] = sameas
    # </script> can never appear: the payload is escaped for the script context.
    return json.dumps(node, ensure_ascii=False, indent=2).replace("<", "\\u003c")


def rows_block(p):
    rows = []
    if p["address"]:
        rows.append(("Address", esc(p["address"])))
    if p["year"]:
        rows.append(("Erected", esc(p["year"])))
    if p["roles"]:
        rows.append(("Known for", esc(p["roles"][:1].upper() + p["roles"][1:])))
    rows.append(("Category",
                 f'<a href="../../{CATS_DIR}/{esc(p["category_url"])}/">'
                 f'{esc(p["category_label"])}</a>'))
    rows.append(("Coordinates", f"{p['lat']:.5f}, {p['lng']:.5f}"))
    body = "\n".join(
        f'        <div class="sp-row"><dt>{name}</dt><dd>{value}</dd></div>'
        for name, value in rows)
    return f'      <dl class="sp-rows">\n{body}\n      </dl>'


def links_block(p):
    links = []
    wiki, source = safe_url(p["wikipedia"]), safe_url(p["source"])
    if wiki:
        links.append(f'<a class="sp-link" href="{wiki}" rel="noopener nofollow" '
                     f'target="_blank">Wikipedia</a>')
    if source:
        links.append(f'<a class="sp-link" href="{source}" rel="noopener nofollow" '
                     f'target="_blank">OpenPlaques record</a>')
    maps = ("https://www.google.com/maps/search/?api=1&query="
            f"{p['lat']:.5f},{p['lng']:.5f}")
    links.append(f'<a class="sp-link" href="{esc(maps)}" rel="noopener" '
                 f'target="_blank">Directions</a>')
    return ('      <nav class="sp-links" aria-label="Sources">\n        '
            + "\n        ".join(links) + "\n      </nav>")


def category_block(p, siblings):
    """A link up to the category page, with the size of the set behind it."""
    count = f"{siblings:,} plaques" if siblings != 1 else "1 plaque"
    return ('      <section class="sp-more">\n'
            f'        <h2>More in {esc(p["category_label"])}</h2>\n'
            f'        <p><a href="../../{CATS_DIR}/{esc(p["category_url"])}/">'
            f'Browse all {count} in {esc(p["category_label"])}</a></p>\n'
            '      </section>\n')


def nearby_block(p, neighbours):
    if not neighbours:
        return ""
    items = []
    for n in neighbours:
        metres = round(haversine(p, n))
        distance = f"{metres} m" if metres < 950 else f"{metres / 1000:.1f} km"
        meta = " · ".join(filter(None, [n["locality"], distance]))
        items.append(
            f'          <li><a href="../{esc(n["slug"])}/">{esc(n["title"])}</a>'
            f'<span class="sp-near-meta">{esc(meta)}</span></li>')
    return ('      <section class="sp-near" aria-labelledby="nearby">\n'
            '        <h2 id="nearby">Plaques nearby</h2>\n'
            '        <ul>\n' + "\n".join(items) + '\n        </ul>\n'
            '      </section>\n')


def photo_block(p):
    src = safe_url(thumb(p["photo"], 800))
    if not src:
        return ""
    credit = safe_url(p["source"])
    caption = (f'<figcaption>Photograph via '
               f'<a href="{credit}" rel="noopener nofollow" target="_blank">OpenPlaques</a>'
               f'</figcaption>') if credit else ""
    return (f'      <figure class="sp-figure">\n'
            f'        <img src="{src}" width="800" alt="The {plaque_noun(p)} for '
            f'{esc(p["title"])}" loading="lazy" decoding="async">\n'
            f'        {caption}\n      </figure>\n')


def crumbs_block(p):
    """Home › Category › this plaque — the crawler's way back up the tree."""
    return ('      <nav class="sp-crumbs" aria-label="Breadcrumb">\n'
            f'        <a href="../../">{esc(SITE_NAME)}</a>\n'
            f'        <span aria-hidden="true">›</span>\n'
            f'        <a href="../../{CATS_DIR}/{esc(p["category_url"])}/">'
            f'{esc(p["category_label"])}</a>\n'
            '      </nav>\n')


def walks_block(walks):
    """The cross-link from a plaque up to the curated walks it is a stop on.

    Absent from the great majority of pages, which are on no walk — an empty
    "Walks" heading on 970 pages would be boilerplate, and boilerplate is what
    this generator exists not to write.
    """
    if not walks:
        return ""
    items = "\n".join(
        f'          <li><a href="../../{WALKS_DIR}/{esc(w["slug"])}/">{esc(w["name"])}</a>'
        f'<span class="sp-near-meta">{esc(walk_summary(w))}</span></li>'
        for w in walks)
    heading = "On this walk" if len(walks) == 1 else "On these walks"
    return ('      <section class="sp-walks" aria-labelledby="walks">\n'
            f'        <h2 id="walks">{heading}</h2>\n'
            '        <ul>\n' + items + '\n        </ul>\n'
            '      </section>\n')


def render_page(p, neighbours, siblings, on_walks=()):
    url = f"{SITE}{PAGES_DIR}/{p['slug']}/"
    description = meta_description(p)
    og_image = safe_url(thumb(p["photo"], 1200)) or esc(f"{SITE}assets/social/og-cover.png")
    map_link = f"../../?plaque={quote(p['id'], safe='')}"
    badges = [f'<span class="sp-badge">{esc(p["category_label"])}</span>']
    if p["fame"] >= 3:
        badges.append('<span class="sp-badge sp-badge-gold">Iconic</span>')
    elif p["fame"] == 2:
        badges.append('<span class="sp-badge">Famous</span>')
    if p["year"]:
        badges.append(f'<span class="sp-badge">Erected {esc(p["year"])}</span>')

    inscription = (f'      <blockquote class="sp-inscription">{esc(p["inscription"])}'
                   f'</blockquote>\n' if p["inscription"] else "")
    subtitle = (f'      <p class="sp-dates">{esc(p["dates"])}</p>\n'
                if p["dates"] else "")

    return f"""<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1456A0">
<title>{esc(page_title(p))}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{esc(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="{esc(SITE_NAME)}">
<meta property="og:url" content="{esc(url)}">
<meta property="og:title" content="{esc(page_title(p))}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:image" content="{og_image}">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(page_title(p))}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{og_image}">
<link rel="icon" href="../../assets/app-icons/icon-192.png" sizes="192x192">
<link rel="manifest" href="../../manifest.json">
<link rel="stylesheet" href="../../css/tokens.css">
<link rel="stylesheet" href="../../css/plaque-page.css">
<script type="application/ld+json">
{structured_data(p, url)}
</script>
</head>
<body class="sp-body">
  <header class="sp-header">
    <a class="sp-brand" href="../../">
      <span class="sp-brand-disc" aria-hidden="true"></span>
      <span>{esc(SITE_NAME)}</span>
    </a>
  </header>

  <main class="sp-main">
    <article class="sp-card">
{crumbs_block(p)}      <p class="sp-eyebrow">London {plaque_noun(p)}</p>
      <h1>{esc(p['title'])}</h1>
{subtitle}      <p class="sp-badges">{''.join(badges)}</p>
{photo_block(p)}{inscription}{rows_block(p)}

      <a class="sp-cta" href="{esc(map_link)}">View on interactive map</a>

{links_block(p)}
    </article>

{walks_block(on_walks)}{nearby_block(p, neighbours)}{category_block(p, siblings)}  </main>

  <footer class="sp-footer">
    <p>Part of <a href="../../">{esc(SITE_NAME)}</a>, an interactive map of the
       English Heritage blue plaque scheme in London.</p>
    <p>Plaque data from <a href="https://openplaques.org" rel="noopener nofollow"
       target="_blank">OpenPlaques</a> (public domain). {esc(SITE_NAME)} is an
       independent project and is not affiliated with or endorsed by English Heritage.</p>
  </footer>
</body>
</html>
"""


# ── Category pages ──────────────────────────────────────────────────────────

def year_range(rows):
    """(earliest, latest) year erected among rows that record one."""
    years = sorted(int(p["year"]) for p in rows
                   if re.fullmatch(r"\d{4}", p["year"] or ""))
    return (years[0], years[-1]) if years else (None, None)


def category_intro(label, rows, total):
    """Counted facts only — no invented history, no padding.

    Every clause here is derived from the dataset, so the page says something
    true about this collection rather than restating the title in prose.
    """
    sentences = [f"{len(rows):,} of the {total:,} English Heritage blue plaques "
                 f"on this map are classified as {label}."]
    first, last = year_range(rows)
    if first and last and first != last:
        sentences.append(f"The earliest was erected in {first}, the most recent in {last}.")
    elif first:
        sentences.append(f"They were erected in {first}.")
    # Only worth saying when the areas really are repeated: in a small category
    # every locality appears once, and "most concentrated in" would be a lie.
    counts = collections.Counter(p["locality"] for p in rows if p["locality"])
    areas = [a for a, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:4]
             if n > 1]
    if len(areas) >= 3:
        sentences.append("They are most concentrated in "
                         + ", ".join(areas[:-1]) + f" and {areas[-1]}.")
    sentences.append("Every name below links to that plaque's page, with its "
                     "inscription, address and location on the map.")
    return " ".join(sentences)


def category_description(label, rows):
    names = ", ".join(p["title"] for p in rows[:6])
    return truncate(f"All {len(rows):,} London blue plaques for {label}, "
                    f"including {names}.")


def category_rows_block(rows):
    items = []
    for p in rows:
        meta = " · ".join(filter(None, [
            p["dates"],
            (p["roles"][:1].upper() + p["roles"][1:]) if p["roles"] else "",
            p["address"] or p["locality"],
            f"erected {p['year']}" if p["year"] else "",
        ]))
        items.append(
            f'      <li class="cat-item">\n'
            f'        <a href="../../{PAGES_DIR}/{esc(p["slug"])}/">{esc(p["title"])}</a>\n'
            f'        <span class="cat-meta">{esc(meta)}</span>\n'
            f'      </li>')
    return '    <ul class="cat-list">\n' + "\n".join(items) + "\n    </ul>"


def category_nav_block(current, groups):
    links = [f'      <a href="../{esc(CATEGORY_URL[key])}/">{esc(CATEGORY_LABELS[key])} '
             f'<span class="cat-nav-n">{len(rows):,}</span></a>'
             for key, rows in groups.items() if key != current]
    return ('    <nav class="cat-nav" aria-labelledby="other-cats">\n'
            '      <h2 id="other-cats">Other collections</h2>\n'
            + "\n".join(links) + "\n    </nav>")


def render_category_page(key, groups, total):
    rows = groups[key]
    label = CATEGORY_LABELS[key]
    url = f"{SITE}{CATS_DIR}/{CATEGORY_URL[key]}/"
    title = f"{label} — London blue plaques — {SITE_NAME}"
    description = category_description(label, rows)
    listing = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": f"{label} blue plaques in London",
        "url": url,
        "description": description,
        "isPartOf": {"@type": "WebSite", "name": SITE_NAME, "url": SITE},
    }
    payload = json.dumps(listing, ensure_ascii=False, indent=2).replace("<", "\\u003c")

    return f"""<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1456A0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{esc(SITE_NAME)}">
<meta property="og:url" content="{esc(url)}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:image" content="{esc(SITE)}assets/social/og-cover.png">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{esc(SITE)}assets/social/og-cover.png">
<link rel="icon" href="../../assets/app-icons/icon-192.png" sizes="192x192">
<link rel="manifest" href="../../manifest.json">
<link rel="stylesheet" href="../../css/tokens.css">
<link rel="stylesheet" href="../../css/plaque-page.css">
<script type="application/ld+json">
{payload}
</script>
</head>
<body class="sp-body">
  <header class="sp-header">
    <a class="sp-brand" href="../../">
      <span class="sp-brand-disc" aria-hidden="true"></span>
      <span>{esc(SITE_NAME)}</span>
    </a>
  </header>

  <main class="sp-main cat-main">
    <nav class="sp-crumbs" aria-label="Breadcrumb">
      <a href="../../">{esc(SITE_NAME)}</a>
      <span aria-hidden="true">›</span>
      <span>{esc(label)}</span>
    </nav>
    <p class="sp-eyebrow">London blue plaques</p>
    <h1>{esc(label)}</h1>
    <p class="cat-intro">{esc(category_intro(label, rows, total))}</p>
    <a class="sp-cta" href="../../">Explore them on the interactive map</a>

{category_rows_block(rows)}

{category_nav_block(key, groups)}
  </main>

  <footer class="sp-footer">
    <p>Part of <a href="../../">{esc(SITE_NAME)}</a>, an interactive map of the
       English Heritage blue plaque scheme in London.</p>
    <p>Plaque data from <a href="https://openplaques.org" rel="noopener nofollow"
       target="_blank">OpenPlaques</a> (public domain). {esc(SITE_NAME)} is an
       independent project and is not affiliated with or endorsed by English Heritage.</p>
  </footer>
</body>
</html>
"""


# ── Walks ───────────────────────────────────────────────────────────────────
#
# A walk is a hand-picked, ordered run of plaques that already exist in the
# dataset. `data/walks.json` holds only identity and prose — slug, name, area,
# copy, and the stop ids in walking order. Everything measurable is derived
# here from the coordinates, exactly as js/walks.js derives it for the app, so
# a walk page can never claim a distance the dataset does not support.


def load_walks(plaques, path=WALKS_DATA):
    """Resolve the walk definitions against the dataset.

    A walk with an unresolvable stop is a hard error rather than a short walk:
    these files are hand-edited, and a typo that silently drops a stop would
    ship a route that leaves a gap in the middle of it.
    """
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        payload = json.load(fh)

    by_id = {p["id"]: p for p in plaques}
    walks = []
    for definition in payload.get("walks") or []:
        slug = str(definition.get("slug") or "")
        if not re.fullmatch(r"[a-z0-9-]+", slug):
            raise SystemExit(f"walks.json: bad slug {slug!r}")
        stops = []
        for stop in definition.get("stops") or []:
            plaque = by_id.get(str(stop.get("id")))
            if plaque is None:
                raise SystemExit(f"walks.json: {slug} names unknown plaque "
                                 f"{stop.get('id')!r}")
            stops.append({"plaque": plaque, "note": (stop.get("note") or "").strip()})
        if len(stops) < 2:
            raise SystemExit(f"walks.json: {slug} needs at least two stops")

        line = sum(haversine(stops[i - 1]["plaque"], stops[i]["plaque"])
                   for i in range(1, len(stops)))
        metres = line * ROUTE_FACTOR
        walks.append({
            "slug": slug,
            "name": definition.get("name") or slug,
            "area": definition.get("area") or "London",
            "tagline": (definition.get("tagline") or "").strip(),
            "intro": (definition.get("intro") or "").strip(),
            "start_hint": (definition.get("startHint") or "").strip(),
            "stops": stops,
            "metres": metres,
            "minutes": max(1, round(metres / WALK_METRES_PER_MIN)),
        })

    slugs = [w["slug"] for w in walks]
    if len(set(slugs)) != len(slugs):
        raise SystemExit("walks.json: duplicate slug")
    return walks


# Small counts read better as words in prose. Anything larger stays a numeral.
WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
         7: "seven", 8: "eight", 9: "nine", 10: "ten"}


def spell(n):
    return WORDS.get(n, f"{n:,}")


def walk_distance(metres):
    """`1.7 km` / `900 m` — mirrors formatWalkDistance() in js/walks.js."""
    if metres < 1000:
        return f"{round(metres / 50) * 50} m"
    return f"{metres / 1000:.1f} km"


def walks_by_plaque(walks):
    """Plaque id → the walks it is a stop on, for the cross-link on its page."""
    index = collections.defaultdict(list)
    for walk in walks:
        for stop in walk["stops"]:
            index[stop["plaque"]["id"]].append(walk)
    return index


def walk_summary(walk):
    """The one line of facts that appears on every surface a walk has."""
    return (f"{len(walk['stops'])} stops · about {walk_distance(walk['metres'])} · "
            f"about {walk['minutes']} minutes' walking")


def walk_description(walk):
    return truncate(f"{walk['tagline']} A self-guided London walk past "
                    f"{len(walk['stops'])} blue plaques in "
                    f"{walk['area'].split(',')[0]} — about "
                    f"{walk_distance(walk['metres'])} and {walk['minutes']} "
                    f"minutes on foot.")


def walk_stops_block(walk):
    """The ordered stops, as an <ol> — each an anchor to that plaque's page."""
    items = []
    for i, stop in enumerate(walk["stops"]):
        p = stop["plaque"]
        leg = ""
        if i:
            metres = round(haversine(walk["stops"][i - 1]["plaque"], p) * ROUTE_FACTOR)
            leg = (f'<span class="walk-leg">about '
                   f'{metres} m from the last stop</span>'
                   if metres < 950 else
                   f'<span class="walk-leg">about {metres / 1000:.1f} km '
                   f'from the last stop</span>')
        meta = " · ".join(filter(None, [p["dates"], p["address"]]))
        note = (f'<p class="walk-stop-note">{esc(stop["note"])}</p>'
                if stop["note"] else "")
        items.append(
            f'        <li class="walk-stop">\n'
            + (f'          {leg}\n' if leg else "")
            + f'          <h3><a href="../../{PAGES_DIR}/{esc(p["slug"])}/">'
            + f'{esc(p["title"])}</a></h3>\n'
            + f'          <p class="walk-stop-meta">{esc(meta)}</p>\n'
            + (f'          {note}\n' if note else "")
            + '        </li>')
    return ('      <ol class="walk-stops">\n' + "\n".join(items) + "\n      </ol>")


def walk_structured_data(walk, url):
    """An ItemList of the stops.

    ItemList is the schema.org type that actually describes what this page is —
    an ordered list of places — and Google reads it. Each element is the plaque
    page's own URL, so the structured data and the visible list say the same
    thing. Nothing here is asserted that the page does not show.
    """
    node = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": walk["name"],
        "description": walk_description(walk),
        "url": url,
        "numberOfItems": len(walk["stops"]),
        "itemListOrder": "https://schema.org/ItemListOrderAscending",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": i,
                "name": stop["plaque"]["title"],
                "url": f"{SITE}{PAGES_DIR}/{stop['plaque']['slug']}/",
            }
            for i, stop in enumerate(walk["stops"], start=1)
        ],
    }
    return json.dumps(node, ensure_ascii=False, indent=2).replace("<", "\\u003c")


def walk_head(title, description, url, extra=""):
    """The shared <head> for the walk pages. Two levels down from the root."""
    return f"""<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1456A0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{esc(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="{esc(SITE_NAME)}">
<meta property="og:url" content="{esc(url)}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:image" content="{esc(SITE)}assets/social/og-cover.png">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{esc(SITE)}assets/social/og-cover.png">
<link rel="icon" href="../../assets/app-icons/icon-192.png" sizes="192x192">
<link rel="manifest" href="../../manifest.json">
<link rel="stylesheet" href="../../css/tokens.css">
<link rel="stylesheet" href="../../css/plaque-page.css">
{extra}"""


def walk_footer():
    return f"""  <footer class="sp-footer">
    <p>Part of <a href="../../">{esc(SITE_NAME)}</a>, an interactive map of the
       English Heritage blue plaque scheme in London.</p>
    <p>Distances are estimated from the straight line between consecutive stops with a
       {ROUTE_FACTOR}× allowance for street layout, and walking times assume a steady
       pace with no stopping.</p>
    <p>Plaque data from <a href="https://openplaques.org" rel="noopener nofollow"
       target="_blank">OpenPlaques</a> (public domain). {esc(SITE_NAME)} is an
       independent project and is not affiliated with or endorsed by English Heritage.</p>
  </footer>"""


def render_walk_page(walk, others):
    url = f"{SITE}{WALKS_DIR}/{walk['slug']}/"
    title = f"{walk['name']} — a self-guided blue plaque walk — {SITE_NAME}"
    description = walk_description(walk)
    first, last = walk["stops"][0]["plaque"], walk["stops"][-1]["plaque"]
    waypoints = "|".join(f"{s['plaque']['lat']:.5f},{s['plaque']['lng']:.5f}"
                         for s in walk["stops"][1:-1])
    route = (f"https://www.google.com/maps/dir/?api=1"
             f"&origin={first['lat']:.5f},{first['lng']:.5f}"
             f"&destination={last['lat']:.5f},{last['lng']:.5f}"
             + (f"&waypoints={quote(waypoints, safe='|')}" if waypoints else "")
             + "&travelmode=walking")
    more = "\n".join(
        f'      <li><a href="../{esc(o["slug"])}/">{esc(o["name"])}</a>'
        f'<span class="sp-near-meta">{esc(o["area"])} · {len(o["stops"])} stops · '
        f'{esc(walk_distance(o["metres"]))}</span></li>'
        for o in others)

    return f"""<!DOCTYPE html>
<html lang="en-GB">
<head>
{walk_head(title, description, url,
           '<script type="application/ld+json">\n'
           + walk_structured_data(walk, url) + '\n</script>')}
</head>
<body class="sp-body">
  <header class="sp-header">
    <a class="sp-brand" href="../../">
      <span class="sp-brand-disc" aria-hidden="true"></span>
      <span>{esc(SITE_NAME)}</span>
    </a>
  </header>

  <main class="sp-main">
    <article class="sp-card">
      <nav class="sp-crumbs" aria-label="Breadcrumb">
        <a href="../../">{esc(SITE_NAME)}</a>
        <span aria-hidden="true">›</span>
        <a href="../">Walks</a>
      </nav>
      <p class="sp-eyebrow">{esc(walk["area"])}</p>
      <h1>{esc(walk["name"])}</h1>
      <p class="walk-tagline">{esc(walk["tagline"])}</p>
      <p class="sp-badges">
        <span class="sp-badge">{len(walk["stops"])} stops</span>
        <span class="sp-badge">about {esc(walk_distance(walk["metres"]))}</span>
        <span class="sp-badge">about {walk["minutes"]} min walking</span>
      </p>
      <p class="walk-intro">{esc(walk["intro"])}</p>
      {f'<p class="walk-hint">{esc(walk["start_hint"])}</p>' if walk["start_hint"] else ''}

      <a class="sp-cta" href="../../?walk={esc(walk["slug"])}">Follow this walk on the map</a>
      <p class="walk-links">
        <a class="sp-link" href="{esc(route)}" rel="noopener nofollow" target="_blank">Open the
        route in Google Maps</a>
      </p>
    </article>

    <section class="sp-route" aria-labelledby="route">
      <h2 id="route">The route</h2>
{walk_stops_block(walk)}
    </section>

    <section class="sp-more">
      <h2>Other walks</h2>
      <ul class="walk-others">
{more}
      </ul>
      <p><a href="../">All self-guided walks</a> · <a href="../../">Explore the whole map</a></p>
    </section>
  </main>

{walk_footer()}
</body>
</html>
"""


def render_walks_index(walks):
    url = f"{SITE}{WALKS_DIR}/"
    title = f"Self-guided London blue plaque walks — {SITE_NAME}"
    description = truncate(
        f"{len(walks)} curated self-guided walks past London's blue plaques — "
        + ", ".join(w["name"] for w in walks) + ".")
    cards = "\n".join(
        f'      <li class="walk-card">\n'
        f'        <h2><a href="{esc(w["slug"])}/">{esc(w["name"])}</a></h2>\n'
        f'        <p class="walk-card-area">{esc(w["area"])}</p>\n'
        f'        <p class="walk-card-tag">{esc(w["tagline"])}</p>\n'
        f'        <p class="walk-card-meta">{esc(walk_summary(w))}</p>\n'
        f'      </li>'
        for w in walks)
    listing = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": f"Self-guided blue plaque walks in London",
        "url": url,
        "description": description,
        "isPartOf": {"@type": "WebSite", "name": SITE_NAME, "url": SITE},
    }
    payload = json.dumps(listing, ensure_ascii=False, indent=2).replace("<", "\\u003c")

    head = walk_head(title, description, url,
                     '<script type="application/ld+json">\n' + payload + '\n</script>')
    # The index sits one level down, not two.
    head = head.replace('href="../../', 'href="../')

    return f"""<!DOCTYPE html>
<html lang="en-GB">
<head>
{head}
</head>
<body class="sp-body">
  <header class="sp-header">
    <a class="sp-brand" href="../">
      <span class="sp-brand-disc" aria-hidden="true"></span>
      <span>{esc(SITE_NAME)}</span>
    </a>
  </header>

  <main class="sp-main cat-main">
    <nav class="sp-crumbs" aria-label="Breadcrumb">
      <a href="../">{esc(SITE_NAME)}</a>
      <span aria-hidden="true">›</span>
      <span>Walks</span>
    </nav>
    <p class="sp-eyebrow">London blue plaques</p>
    <h1>Self-guided walks</h1>
    <p class="cat-intro">London's blue plaques are not spread evenly: in a few
       neighbourhoods they stand within a couple of hundred metres of one another,
       close enough to string into an afternoon. These {spell(len(walks))} walks do that.
       Each one lists its stops in walking order with the distance between them, and
       every stop links to that plaque's page and its place on the map.</p>
    <a class="sp-cta" href="../">Explore the whole map</a>

    <ul class="walk-cards">
{cards}
    </ul>

    <nav class="cat-nav" aria-labelledby="browse">
      <h2 id="browse">Browse another way</h2>
      <a href="../{CATS_DIR}/writers-literature/">Writers &amp; Literature</a>
      <a href="../{CATS_DIR}/music/">Music</a>
      <a href="../{CATS_DIR}/science-technology/">Science &amp; Technology</a>
      <a href="../{CATS_DIR}/art-design/">Art &amp; Design</a>
    </nav>
  </main>

{walk_footer().replace('href="../../"', 'href="../"')}
</body>
</html>
"""


def render_sitemap(plaques, groups, walks=()):
    """Homepage, every category page, then every plaque page.

    Ordered home → walk → category → plaque so the file mirrors the link graph. Each
    URL is the page's own canonical, and duplicates are dropped rather than
    trusted not to occur.

    No `lastmod`: nothing in the pipeline records when a plaque's facts last
    changed, and an invented date is worse than none. No `priority` or
    `changefreq` either — Google ignores both.
    """
    ordered = ([SITE]
               + ([f"{SITE}{WALKS_DIR}/"] if walks else [])
               + [f"{SITE}{WALKS_DIR}/{w['slug']}/" for w in walks]
               + [f"{SITE}{CATS_DIR}/{CATEGORY_URL[key]}/" for key in groups]
               + [f"{SITE}{PAGES_DIR}/{p['slug']}/" for p in plaques])
    seen, urls = set(), []
    for u in ordered:
        if u not in seen:
            seen.add(u)
            urls.append(u)
    body = "\n".join(f"  <url><loc>{esc(u)}</loc></url>" for u in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f"{body}\n</urlset>\n")


# ── Generated counts in index.html ──────────────────────────────────────────
# The plaque count used to be typed by hand into the meta description, the
# JSON-LD and the <noscript> block, so a dataset change quietly made all three
# wrong (decision-log #26). Each is now a region delimited by HTML comments and
# rewritten here from the dataset. The markers are comments, so index.html at
# rest is still a valid page that can be served directly.

INDEX = "index.html"

INDEX_REGIONS = {
    "count": '{n}',

    "twitter-description":
        '  <meta name="twitter:description" content="Explore {n} English Heritage '
        'blue plaques in London. Find discoveries near you and collect the stories '
        'you uncover.">',

    "noscript-intro":
        '    <p>An interactive map of {n} English Heritage blue plaques in London. '
        'JavaScript is required to view the map.</p>',
}


def jsonld_region(count, subjects):
    """The WebApplication + Dataset block. Two counts, one source of truth."""
    payload = {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": SITE_NAME,
        "alternateName": "London Blue Plaques Map",
        "url": SITE,
        "description": (
            f"Interactive map of {count} English Heritage blue plaques in London. "
            "Explore by category, find blue plaques near you and collect the "
            "discoveries you make."
        ),
        "applicationCategory": "TravelApplication",
        "operatingSystem": "Any",
        "browserRequirements": "Requires JavaScript",
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"},
        "about": {
            "@type": "Dataset",
            "name": "English Heritage Blue Plaques London",
            "description": (
                f"{count} English Heritage blue plaques in London with locations, "
                "inscriptions, erected dates, categories and Wikipedia links. "
                f"Subjects include {subjects} and hundreds more."
            ),
            "spatialCoverage": {"@type": "Place", "name": "London",
                                "addressCountry": "GB"},
            "license": "https://opendatacommons.org/licenses/pddl/",
            "isBasedOn": {"@type": "WebSite", "name": "OpenPlaques",
                          "url": "https://openplaques.org"},
        },
    }
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    body = "\n".join("  " + line for line in body.split("\n"))
    return ('  <script type="application/ld+json">\n'
            f"{body}\n"
            "  </script>")


# Named in the JSON-LD dataset description. Hand-picked for recognisability, not
# derived — fame ranking would reshuffle the sentence on every refresh.
JSONLD_SUBJECTS = ("Freddie Mercury, John Lennon, Charles Darwin, Florence "
                   "Nightingale, Karl Marx, Oscar Wilde, Alan Turing, Charles "
                   "Dickens, Virginia Woolf, Jimi Hendrix")


def replace_region(text, name, body):
    """Swap the content between <!--gen:name--> and <!--/gen:name-->."""
    open_tag, close_tag = f"<!--gen:{name}-->", f"<!--/gen:{name}-->"
    start, end = text.find(open_tag), text.find(close_tag)
    if start < 0 or end < 0 or end < start:
        raise SystemExit(f"index.html has no <!--gen:{name}--> region")
    inner = text[start + len(open_tag):end]
    if inner.startswith("\n"):
        # A region on its own lines: keep the newlines and whatever indentation
        # the closing marker sits at, so rewriting does not reflow the file.
        indent = inner[inner.rfind("\n") + 1:]
        body = f"\n{body}\n{indent}"
    return text[:start + len(open_tag)] + body + text[end:]


def walk_links_region(walks):
    """The About panel's list of walk pages, as real anchors."""
    items = "\n".join(
        f'          <li><a href="{WALKS_DIR}/{esc(w["slug"])}/">{esc(w["name"])}</a></li>'
        for w in walks)
    return ('        <ul class="about-walks">\n' + items + "\n        </ul>")


def noscript_walks_region(walks):
    links = ",\n      ".join(
        f'<a href="{WALKS_DIR}/{esc(w["slug"])}/">{esc(w["name"])}</a>' for w in walks)
    return ('    <p>Follow a self-guided walk:\n      ' + links
            + f'.\n      <a href="{WALKS_DIR}/">All walks</a>.</p>')


def update_index(out_root, plaques, walks=()):
    """Rewrite every generated count in index.html.

    Returns the path written, or None when the target root has no index.html —
    which is the case when the generator writes into a scratch directory under
    test. `main()` insists on it for a real build.
    """
    path = os.path.join(out_root, INDEX)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        text = fh.read()

    count = f"{len(plaques):,}"
    for name, template in INDEX_REGIONS.items():
        text = replace_region(text, name, template.format(n=count))
    text = replace_region(text, "jsonld", jsonld_region(count, JSONLD_SUBJECTS))
    if walks:
        text = replace_region(text, "walk-links", walk_links_region(walks))
        text = replace_region(text, "noscript-walks", noscript_walks_region(walks))

    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return path


# ── Entry point ─────────────────────────────────────────────────────────────

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def render_url_map(plaques):
    """The id → page mapping the app uses to render its lists as real links.

    Written by the same run that writes the pages, so the hrefs in the app can
    never point at a slug this generator did not produce.
    """
    return json.dumps({
        "base": f"{PAGES_DIR}/",
        "slugs": {p["id"]: p["slug"] for p in plaques},
    }, ensure_ascii=False, indent=0, sort_keys=True) + "\n"


def generate(out_root, plaques, clean=True, walks=None):
    """Write the plaque, category and walk pages, the URL map and the sitemap."""
    groups = by_category(plaques)
    if walks is None:
        walks = load_walks(plaques)
    on_walk = walks_by_plaque(walks)
    pages_root = os.path.join(out_root, PAGES_DIR)
    cats_root = os.path.join(out_root, CATS_DIR)
    walks_root = os.path.join(out_root, WALKS_DIR)
    if clean:
        # Stale directories would otherwise outlive plaques, categories and
        # walks dropped from the data and stay in the index.
        for root in (pages_root, cats_root, walks_root):
            if os.path.isdir(root):
                shutil.rmtree(root)
    os.makedirs(pages_root, exist_ok=True)
    os.makedirs(cats_root, exist_ok=True)

    for p in plaques:
        write(os.path.join(pages_root, p["slug"], "index.html"),
              render_page(p, nearest(p, plaques), len(groups[p["category"]]),
                          on_walk.get(p["id"], ())))

    for key in groups:
        write(os.path.join(cats_root, CATEGORY_URL[key], "index.html"),
              render_category_page(key, groups, len(plaques)))

    if walks:
        os.makedirs(walks_root, exist_ok=True)
        write(os.path.join(walks_root, "index.html"), render_walks_index(walks))
        for walk in walks:
            others = [w for w in walks if w["slug"] != walk["slug"]]
            write(os.path.join(walks_root, walk["slug"], "index.html"),
                  render_walk_page(walk, others))

    write(os.path.join(out_root, URL_MAP), render_url_map(plaques))
    write(os.path.join(out_root, "sitemap.xml"), render_sitemap(plaques, groups, walks))
    indexed = update_index(out_root, plaques, walks)
    return len(plaques), len(groups), len(walks), indexed


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--out", default=ROOT, help="site root to write into")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = ap.parse_args(argv)

    plaques = load_plaques()
    walks = load_walks(plaques)
    slugs = {p["slug"] for p in plaques}
    if len(slugs) != len(plaques):
        raise SystemExit("slug collision — refusing to overwrite pages")

    if args.dry_run:
        groups = by_category(plaques)
        print(f"{len(plaques)} plaques → {len(slugs)} pages under {PAGES_DIR}/ "
              f"and {len(groups)} under {CATS_DIR}/ (nothing written)")
        for key, rows in groups.items():
            print(f"  {CATS_DIR}/{CATEGORY_URL[key]}/  ({len(rows)})")
        for walk in walks:
            print(f"  {WALKS_DIR}/{walk['slug']}/  ({walk_summary(walk)})")
        return 0

    count, categories, walk_count, indexed = generate(args.out, plaques, walks=walks)
    print(f"wrote {count} plaque pages under {os.path.join(args.out, PAGES_DIR)}")
    print(f"wrote {categories} category pages under {os.path.join(args.out, CATS_DIR)}")
    print(f"wrote {URL_MAP}")
    print(f"wrote {walk_count} walk pages under {os.path.join(args.out, WALKS_DIR)}")
    print(f"wrote sitemap.xml with "
          f"{count + categories + walk_count + (1 if walk_count else 0) + 1} URLs")
    if indexed:
        print(f"wrote the generated counts in {INDEX} ({count:,})")
    elif os.path.abspath(args.out) == os.path.abspath(ROOT):
        raise SystemExit(f"{INDEX} is missing from {args.out} — counts not written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
