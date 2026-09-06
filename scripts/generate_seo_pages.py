#!/usr/bin/env python3
"""
Generate one crawlable static page per plaque, plus the sitemap.

The interactive app renders every plaque from `data/plaques.geojson` in
JavaScript, so no plaque has a URL of its own. This script gives each one a
plain HTML page at

    plaques/<slug>/index.html      →  /blueplaques/plaques/freddie-mercury-1234/

built from the same dataset, with the useful facts in the initial HTML rather
than behind a fetch. Every page links back into the app at `/?plaque=<id>`,
which the app reads on boot and opens.

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

SITE = "https://nyatasha.github.io/blueplaques/"
SITE_NAME = "London Uncovered"
PAGES_DIR = "plaques"          # relative to the site root
SLUG_MAX = 60                  # characters before the id suffix
NEARBY = 5                     # internal links per page
DESC_MAX = 155

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


# ── Text helpers ────────────────────────────────────────────────────────────

def esc(value):
    """Escape for both text nodes and quoted attribute values."""
    return html.escape("" if value is None else str(value), quote=True)


def safe_url(url):
    """Return an escaped absolute http(s) URL, or '' for anything else.

    The dataset is public and third-party, so a `javascript:` or `data:` value
    must never reach an href or src.
    """
    if not url:
        return ""
    try:
        parts = urlsplit(str(url).strip())
    except ValueError:
        return ""
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return ""
    return esc(parts.geturl())


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
            "category": category,
            "category_label": props.get("category_label") or CATEGORY_LABELS[category],
            "lat": lat,
            "lng": lng,
        })

    for p in plaques:
        p["slug"] = slugify(p["title"], p["id"])
        p["dates"] = extract_dates(p["inscription"])
        p["locality"] = locality(p["address"])
    return plaques


def nearest(plaque, plaques, count=NEARBY):
    others = ((haversine(plaque, o), o) for o in plaques if o["id"] != plaque["id"])
    return [o for _, o in sorted(others, key=lambda pair: pair[0])[:count]]


# ── Page rendering ──────────────────────────────────────────────────────────

def page_title(p):
    where = f" in {p['locality']}" if p["locality"] else " in London"
    return f"{p['title']} blue plaque{where} — {SITE_NAME}"


def meta_description(p):
    """Inscription first — it is the one line unique to this plaque.

    Pieces are dropped whole rather than truncated mid-clause, so a description
    never trails off in the middle of an address.
    """
    parts = []
    if p["inscription"]:
        parts.append(f"\u201c{truncate(p['inscription'], 110)}\u201d")
    if p["address"]:
        parts.append(f"Blue plaque at {p['address']}.")
    elif not p["inscription"]:
        parts.append(f"English Heritage blue plaque for {p['title']} in London.")
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
        "name": f"{p['title']} blue plaque",
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
    if p["photo"].startswith(("http://", "https://")):
        node["image"] = thumb(p["photo"], 800)
    sameas = [u for u in (p["wikipedia"], p["source"])
              if u.startswith(("http://", "https://"))]
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
    rows.append(("Category", esc(p["category_label"])))
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
            '        <h2 id="nearby">Blue plaques nearby</h2>\n'
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
            f'        <img src="{src}" width="800" alt="The blue plaque for '
            f'{esc(p["title"])}" loading="lazy" decoding="async">\n'
            f'        {caption}\n      </figure>\n')


def render_page(p, neighbours):
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
      <p class="sp-eyebrow">London blue plaque</p>
      <h1>{esc(p['title'])}</h1>
{subtitle}      <p class="sp-badges">{''.join(badges)}</p>
{photo_block(p)}{inscription}{rows_block(p)}

      <a class="sp-cta" href="{esc(map_link)}">View on interactive map</a>

{links_block(p)}
    </article>

{nearby_block(p, neighbours)}  </main>

  <footer class="sp-footer">
    <p>Part of <a href="../../">{esc(SITE_NAME)}</a>, an interactive map of every
       English Heritage blue plaque in London.</p>
    <p>Plaque data from <a href="https://openplaques.org" rel="noopener nofollow"
       target="_blank">OpenPlaques</a> (public domain). {esc(SITE_NAME)} is an
       independent project and is not affiliated with or endorsed by English Heritage.</p>
  </footer>
</body>
</html>
"""


def render_sitemap(plaques):
    """Homepage plus every generated page.

    No `lastmod`: nothing in the pipeline records when a plaque's facts last
    changed, and an invented date is worse than none. No `priority` or
    `changefreq` either — Google ignores both.
    """
    urls = [SITE] + [f"{SITE}{PAGES_DIR}/{p['slug']}/" for p in plaques]
    body = "\n".join(f"  <url><loc>{esc(u)}</loc></url>" for u in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f"{body}\n</urlset>\n")


# ── Entry point ─────────────────────────────────────────────────────────────

def generate(out_root, plaques, clean=True):
    """Write `<out_root>/plaques/<slug>/index.html` and `<out_root>/sitemap.xml`."""
    pages_root = os.path.join(out_root, PAGES_DIR)
    if clean and os.path.isdir(pages_root):
        # Stale directories would otherwise outlive plaques dropped from the
        # dataset and stay in the index.
        shutil.rmtree(pages_root)
    os.makedirs(pages_root, exist_ok=True)

    for p in plaques:
        directory = os.path.join(pages_root, p["slug"])
        os.makedirs(directory, exist_ok=True)
        with open(os.path.join(directory, "index.html"), "w", encoding="utf-8") as fh:
            fh.write(render_page(p, nearest(p, plaques)))

    with open(os.path.join(out_root, "sitemap.xml"), "w", encoding="utf-8") as fh:
        fh.write(render_sitemap(plaques))
    return len(plaques)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--out", default=ROOT, help="site root to write into")
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    args = ap.parse_args(argv)

    plaques = load_plaques()
    slugs = {p["slug"] for p in plaques}
    if len(slugs) != len(plaques):
        raise SystemExit("slug collision — refusing to overwrite pages")

    if args.dry_run:
        print(f"{len(plaques)} plaques → {len(slugs)} pages under {PAGES_DIR}/ (nothing written)")
        for p in plaques[:5]:
            print(f"  {PAGES_DIR}/{p['slug']}/")
        return 0

    count = generate(args.out, plaques)
    print(f"wrote {count} plaque pages under {os.path.join(args.out, PAGES_DIR)}")
    print(f"wrote sitemap.xml with {count + 1} URLs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
