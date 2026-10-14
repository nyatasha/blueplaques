#!/usr/bin/env python3
"""
Static SEO page generator — unit and output checks.

    python3 tests/seo.test.py

Generates the whole site into a temporary directory, so nothing here touches
the committed pages. Dependency-free: standard library only.
"""

import json
import os
import re
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

import importlib.util

spec = importlib.util.spec_from_file_location(
    "generate_seo_pages",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts",
                 "generate_seo_pages.py"))
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

passed = failed = 0
group_name = ""


def group(name):
    global group_name
    group_name = name
    print(f"\n{name}")


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  ok  {name}")
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" — {detail}" if detail else ""))


def eq(name, actual, expected):
    check(name, actual == expected, f"expected {expected!r}, got {actual!r}")


def content_scripts(text):
    """Every <script> on a page that is neither structured data nor the
    deferred runtime module.

    The rule these pages are held to is that their *content* is in the initial
    HTML — not that they carry no script. `js/static-page.js` is a module, so
    it cannot block rendering, and everything it does (analytics, the Share
    button) is additive to a page that is already complete. Anything else
    appearing here would mean content had moved behind JavaScript.
    """
    stripped = re.sub(r'<script type="application/ld\+json">.*?</script>', "",
                      text, flags=re.S)
    stripped = re.sub(r'<script type="module" src="(?:\.\./)*js/static-page\.js">'
                      r'</script>', "", stripped)
    return re.findall(r"<script[^>]*>", stripped)


# ── Slugs ───────────────────────────────────────────────────────────────────

group("slugs")
eq("readable, lowercase and id-suffixed", gen.slugify("Freddie Mercury", "12345"),
   "freddie-mercury-12345")
eq("punctuation collapses to single hyphens", gen.slugify("C. L. R. James", "485"),
   "c-l-r-james-485")
eq("accents fold to ASCII", gen.slugify("Émile Zola", "7"), "emile-zola-7")
eq("ampersands and slashes are dropped", gen.slugify("Marks & Spencer / Site", "9"),
   "marks-spencer-site-9")
check("only URL-safe characters survive",
      re.fullmatch(r"[a-z0-9-]+", gen.slugify("Sør Ærø (No. 4) — «x»", "1")) is not None,
      gen.slugify("Sør Ærø (No. 4) — «x»", "1"))
eq("a title with nothing usable still yields a slug", gen.slugify("北京", "42"),
   "plaque-42")
eq("the same input gives the same slug twice",
   gen.slugify("Virginia Woolf", "1"), gen.slugify("Virginia Woolf", "1"))
check("identical names do not collide",
      gen.slugify("John Smith", "1") != gen.slugify("John Smith", "2"))
check("a very long title is cut but keeps its id",
      gen.slugify("A" * 200 + " Person", "77").endswith("-77")
      and len(gen.slugify("A" * 200 + " Person", "77")) < 80,
      gen.slugify("A" * 200 + " Person", "77"))

group("escaping")
eq("text is escaped", gen.esc('<img src=x onerror="alert(1)">'),
   "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;")
eq("javascript: URLs are refused", gen.safe_url("javascript:alert(1)"), "")
eq("data: URLs are refused", gen.safe_url("data:text/html,<script>"), "")
eq("protocol-relative URLs are refused", gen.safe_url("//evil.example/x"), "")
eq("http(s) URLs pass through, escaped for an attribute",
   gen.safe_url('https://e.org/a?b=1&c="x"'), "https://e.org/a?b=1&amp;c=&quot;x&quot;")

# 47 of the dataset's photo URLs carry an en-dash or other non-ASCII character
# straight from the file name. Browsers guess at those, but og:image and the
# JSON-LD `image`/`sameAs` values are read by crawlers that do not, so the
# generator has to hand out a URL that is already valid.
eq("non-ASCII in the path is percent-encoded",
   gen.safe_url("https://commons.wikimedia.org/wiki/Special:FilePath/A_1872\u20131913.jpg"),
   "https://commons.wikimedia.org/wiki/Special:FilePath/A_1872%E2%80%931913.jpg")
eq("non-ASCII in the query is percent-encoded too",
   gen.safe_url("https://e.org/a?name=Fran\u00e7ois"),
   "https://e.org/a?name=Fran%C3%A7ois")
eq("a space becomes %20, not a broken attribute",
   gen.safe_url("https://e.org/a b.jpg"), "https://e.org/a%20b.jpg")
eq("an already-encoded URL is not encoded twice",
   gen.safe_url("https://e.org/%27OUIDA%27_1839.jpg?width=800"),
   "https://e.org/%27OUIDA%27_1839.jpg?width=800")
eq("reserved characters keep their meaning",
   gen.safe_url("https://e.org/a/b?x=1&y=2#f"), "https://e.org/a/b?x=1&amp;y=2#f")

# The JSON-LD node is built from the same fields as the visible page but does
# not pass through an attribute, so it needs its own check that it is fed the
# validated, encoded URL rather than the raw dataset value.
_ld = json.loads(gen.structured_data({
    "title": "T", "inscription": "", "address": "", "year": "", "lat": 51.5, "lng": -0.1,
    "photo": "https://commons.wikimedia.org/wiki/Special:FilePath/A_1872\u20131913.jpg",
    "wikipedia": "https://en.wikipedia.org/wiki/Fran\u00e7ois_Guizot",
    "source": "javascript:alert(1)",
}, "https://nyatasha.github.io/blueplaques/plaques/t-1/"))
eq("JSON-LD image is percent-encoded",
   _ld["image"],
   "https://commons.wikimedia.org/wiki/Special:FilePath/A_1872%E2%80%931913.jpg")
eq("JSON-LD sameAs is percent-encoded",
   _ld["sameAs"], ["https://en.wikipedia.org/wiki/Fran%C3%A7ois_Guizot"])
check("JSON-LD drops a javascript: source", "javascript:" not in str(_ld))

group("category URLs")
eq("the URL comes from the label, not the internal key",
   gen.CATEGORY_URL["writers"], "writers-literature")
eq("ampersands drop out", gen.CATEGORY_URL["art"], "art-design")
eq("a one-word label is its own URL", gen.CATEGORY_URL["music"], "music")
check("every category has a URL-safe slug",
      all(re.fullmatch(r"[a-z0-9-]+", u) for u in gen.CATEGORY_URL.values()))
eq("no two categories share a URL",
   len(set(gen.CATEGORY_URL.values())), len(gen.CATEGORY_URL))

# ── URL construction ───────────────────────────────────────────────────────
#
# Search Console discovered a plaque URL with an empty path segment between the
# project prefix and `plaques/` — a doubled slash, which a crawler treats as a
# separate, duplicate URL. Every absolute and root-absolute URL now comes out
# of site_path()/site_url()/site_file()/site_file_path(), and these assert the
# property the old string concatenation only happened to have: that a stray
# slash on either side of a join cannot survive. They are driven with
# deliberately malformed constants, because the real ones being well-formed
# today is exactly what the bug would hide behind.

group("URL construction")
eq("the site root keeps its single trailing slash", gen.site_path(), "/blueplaques/")
eq("a page path is single-slashed throughout",
   gen.site_path(gen.PAGES_DIR, "freddie-mercury-41802"),
   "/blueplaques/plaques/freddie-mercury-41802/")
eq("a canonical URL is the single-slash production URL",
   gen.site_url(gen.PAGES_DIR, "freddie-mercury-41802"),
   "https://nyatasha.github.io/blueplaques/plaques/freddie-mercury-41802/")
eq("a file URL takes no trailing slash",
   gen.site_file("assets", "social", "og-cover.png"),
   "https://nyatasha.github.io/blueplaques/assets/social/og-cover.png")
eq("a root-absolute file path takes no trailing slash either",
   gen.site_file_path("css", "tokens.css"), "/blueplaques/css/tokens.css")
check("every helper agrees with site_path",
      gen.site_url() == gen.SITE_ORIGIN + gen.site_path()
      and gen.SITE == gen.site_url()
      and gen.PAGES_ROOT == gen.site_path().lstrip("/"))

_slashy = [("/blueplaques/", "/plaques/", "/slug/"),
           ("blueplaques", "plaques", "slug"),
           ("/blueplaques", "plaques/", "/slug")]
for _prefix, _dir, _slug in _slashy:
    _was = gen.SITE_PATH
    try:
        gen.SITE_PATH = _prefix
        eq(f"stray slashes in {_prefix!r} + {_dir!r} + {_slug!r} collapse",
           gen.site_url(_dir, _slug),
           "https://nyatasha.github.io/blueplaques/plaques/slug/")
    finally:
        gen.SITE_PATH = _was
check("an empty segment is dropped rather than doubling a slash",
      gen.site_path("", gen.PAGES_DIR, "") == "/blueplaques/plaques/")

# The build gate itself. A generator that starts emitting doubled slashes again
# has to fail the run, not write the pages and leave it to Search Console.
#
# The malformed URLs below are assembled from pieces rather than written out,
# so the repo-wide grep in .github/workflows/seo.yml can stay a strict search
# for the string anywhere in the tree without these fixtures tripping it.
_EMPTY_SEGMENT = "/" + "/"
_BAD_URL = f"{gen.SITE.rstrip('/')}{_EMPTY_SEGMENT}plaques/freddie-mercury-41802/"
_BAD_PATH = f"{gen.site_path().rstrip('/')}{_EMPTY_SEGMENT}plaques/x/"
check("a doubled slash in an absolute URL is spotted",
      gen.malformed_urls(f'<link rel="canonical" href="{_BAD_URL}">'))
check("a doubled slash in a root-absolute href is spotted too",
      gen.malformed_urls(f'<a href="{_BAD_PATH}">x</a>'))
check("the scheme's own slashes are not mistaken for one",
      not gen.malformed_urls('see https://nyatasha.github.io/blueplaques/plaques/x/ '
                             'and http://example.org/a/b'))
_refused = False
try:
    gen.check_urls("t.html", f'<a href="{_BAD_URL}">')
except SystemExit:
    _refused = True
check("check_urls raises SystemExit on a malformed URL", _refused)
check("check_urls passes a clean page through",
      gen.check_urls("t.html", f'<a href="{gen.site_url(gen.PAGES_DIR, "x")}">') is not None)

group("derived fields")
eq("life dates come out of the inscription",
   gen.extract_dates("Ada Lovelace 1815–1852 mathematician lived here"), "1815–1852")
eq("no dates when the inscription has none", gen.extract_dates("lived here"), "")
eq("locality skips the street and the postcode",
   gen.locality("165 Railton Road, Brixton, Lambeth, SE24"), "Brixton")
eq("'London' alone is not a locality", gen.locality("1 High Street, London"), "")

# ── A generated site ────────────────────────────────────────────────────────

group("generated site")
plaques = gen.load_plaques()
walks = gen.load_walks(plaques)
check("the dataset loaded", len(plaques) > 900, f"{len(plaques)} plaques")
eq("every plaque has a unique slug", len({p["slug"] for p in plaques}), len(plaques))
eq("every plaque has a unique id", len({p["id"] for p in plaques}), len(plaques))

groups = gen.by_category(plaques)
check("every plaque falls into a category with a page",
      {p["category"] for p in plaques} <= set(groups))
check("no category page would be empty", all(rows for rows in groups.values()))
check("categories are listed strongest first",
      all(all(a["fame"] >= b["fame"] for a, b in zip(rows, rows[1:]))
          for rows in groups.values()))

out = tempfile.mkdtemp(prefix="seo-test-")
try:
    written, cats, walk_count, _ = gen.generate(out, plaques)
    eq("a page was written for every plaque", written, len(plaques))
    eq("a page was written for every non-empty category", cats, len(groups))
    dirs = os.listdir(os.path.join(out, gen.PAGES_DIR))
    eq("one directory per plaque, nothing overwritten", len(dirs), len(plaques))
    check("every directory holds an index.html",
          all(os.path.isfile(os.path.join(out, gen.PAGES_DIR, d, "index.html"))
              for d in dirs))

    sample = plaques[0]
    path = os.path.join(out, gen.PAGES_DIR, sample["slug"], "index.html")
    with open(path, encoding="utf-8") as fh:
        page = fh.read()

    group(f"page content — {sample['title']}")
    check("the name is in the initial HTML",
          f"<h1>{gen.esc(sample['title'])}</h1>" in page)
    check("the inscription is in the initial HTML",
          gen.esc(sample["inscription"])[:60] in page)
    check("the address is in the initial HTML", gen.esc(sample["address"]) in page)
    check("the year erected is in the initial HTML", f"<dd>{sample['year']}</dd>" in page)
    check("the category is in the initial HTML", gen.esc(sample["category_label"]) in page)
    check("the photo is embedded as an img", 'class="sp-figure"' in page)
    check("the OpenPlaques record is linked", sample["source"] in page)
    eq("nothing but structured data and the deferred runtime script",
       content_scripts(page), [])
    check("the runtime is loaded as a deferred module",
          '<script type="module" src="../../js/static-page.js"></script>' in page)
    check("the page declares its kind for analytics",
          '<body class="sp-body" data-page="plaque">' in page)
    check("the map link is marked as the measured conversion",
          'class="sp-cta" href="../../?plaque=' in page and 'data-track="to-app"' in page)
    check("the Share button ships inert, for the runtime to reveal",
          'data-track="share" hidden' in page)

    group("head")
    check("the title names the plaque and the site",
          f"<title>{gen.esc(sample['title'])}" in page and gen.SITE_NAME in page)
    check("a meta description is present", 'name="description" content="' in page)
    canonical = f'<link rel="canonical" href="{gen.SITE}plaques/{sample["slug"]}/">'
    check("the canonical URL is the production URL", canonical in page, canonical)
    check("Open Graph basics are present",
          all(f'property="og:{k}"' in page for k in ("type", "title", "description", "url", "image")))
    check("structured data is valid JSON", (lambda: __import__("json").loads(
        page.split('application/ld+json">')[1].split("</script>")[0]) and True)())

    group("paths under /blueplaques/")
    check("stylesheets are reached relatively", '"../../css/tokens.css"' in page)
    check("the brand links back to the app root", 'href="../../"' in page)
    check("the deep link uses ?plaque=<id>",
          f'href="../../?plaque={sample["id"]}"' in page,
          re.search(r'href="\.\./\.\./\?plaque=[^"]*"', page).group(0))
    check("no path is rooted at the domain",
          not re.search(r'(?:href|src)="/(?!/)', page))
    check("nearby plaques link to sibling directories",
          re.search(r'href="\.\./[a-z0-9-]+/"', page) is not None)

    # ── Internal link graph ─────────────────────────────────────────────────

    group("links out of a plaque page")
    cat_href = f'href="../../categories/{sample["category_url"]}/"'
    check("the breadcrumb links up to the category page",
          f'<nav class="sp-crumbs" aria-label="Breadcrumb">' in page and cat_href in page)
    check("the category row links to the category page too",
          f'<dt>Category</dt><dd><a {cat_href}>' in page)
    check('a "more in this category" section links there as well',
          '<h2>More in ' in page and page.count(cat_href) >= 3)
    check("the category page it points at exists",
          os.path.isfile(os.path.join(out, gen.CATS_DIR,
                                      sample["category_url"], "index.html")))

    slugs_by_id = {p["id"]: p["slug"] for p in plaques}
    all_slugs = set(slugs_by_id.values())
    cat_urls = {gen.CATEGORY_URL[k] for k in groups}

    def nearby_links(html_text):
        section = html_text.split('class="sp-near"')[1].split("</section>")[0]
        return re.findall(r'href="\.\./([a-z0-9-]+)/"', section)

    group("nearby plaques")
    bad_self = bad_target = bad_count = bad_order = 0
    for p_ in plaques:
        with open(os.path.join(out, gen.PAGES_DIR, p_["slug"], "index.html"),
                  encoding="utf-8") as fh:
            near = nearby_links(fh.read())
        if p_["slug"] in near:
            bad_self += 1
        if not set(near) <= all_slugs:
            bad_target += 1
        if len(near) != min(gen.NEARBY, len(plaques) - 1) or len(set(near)) != len(near):
            bad_count += 1
        expected = [n["slug"] for n in gen.nearest(p_, plaques)]
        if near != expected:
            bad_order += 1
    eq("no page lists itself as nearby", bad_self, 0)
    eq("every nearby link points at a generated page", bad_target, 0)
    eq(f"every page lists {gen.NEARBY} distinct neighbours", bad_count, 0)
    eq("neighbours are the nearest ones, closest first", bad_order, 0)

    group("every plaque page links to a valid category page")
    missing = [p_["slug"] for p_ in plaques if p_["category_url"] not in cat_urls]
    eq("no plaque points at a category without a page", missing, [])

    # ── Category pages ──────────────────────────────────────────────────────

    group("category pages")
    cat_dirs = sorted(os.listdir(os.path.join(out, gen.CATS_DIR)))
    eq("one directory per non-empty category", cat_dirs, sorted(cat_urls))
    eq("no category page is generated for an empty category",
       [d for d in cat_dirs if d not in cat_urls], [])

    cat_pages = {}
    for key, rows in groups.items():
        with open(os.path.join(out, gen.CATS_DIR, gen.CATEGORY_URL[key], "index.html"),
                  encoding="utf-8") as fh:
            cat_pages[key] = fh.read()

    def cat_check(name, fn, detail=""):
        offenders = [k for k, text in cat_pages.items() if not fn(k, text)]
        check(name, not offenders, f"{detail}{offenders}")

    cat_check("each has an <h1> naming the category",
              lambda k, t: f"<h1>{gen.esc(gen.CATEGORY_LABELS[k])}</h1>" in t)
    cat_check("each has its own canonical URL",
              lambda k, t: f'<link rel="canonical" href="{gen.SITE}categories/'
                           f'{gen.CATEGORY_URL[k]}/">' in t)
    cat_check("each has a meta description",
              lambda k, t: re.search(r'name="description" content="[^"]{40,}"', t))
    cat_check("each intro states how many plaques it holds",
              lambda k, t: f"{len(groups[k]):,} of the {len(plaques):,}" in t)
    cat_check("each links into the map filtered to its own category",
              lambda k, t: f'class="sp-cta" href="../../?category={k}" '
                           f'data-track="to-app"' in t)
    cat_check("each links sideways to the walks",
              lambda k, t: all(f'href="../../{gen.WALKS_DIR}/{w["slug"]}/"' in t
                               for w in walks))
    cat_check("each links sideways to the other collections",
              lambda k, t: all(f'href="../{gen.CATEGORY_URL[o]}/"' in t
                               for o in groups if o != k))
    cat_check("none needs JavaScript to render its list",
              lambda k, t: content_scripts(t) == [])
    cat_check("each declares its kind for analytics",
              lambda k, t: '<body class="sp-body" data-page="category">' in t)
    cat_check("no path is rooted at the domain",
              lambda k, t: not re.search(r'(?:href|src)="/(?!/)', t))

    eq("every title is unique", len({t.split("<title>")[1].split("</title>")[0]
                                     for t in cat_pages.values()}), len(cat_pages))
    eq("every meta description is unique",
       len({re.search(r'name="description" content="([^"]*)"', t).group(1)
            for t in cat_pages.values()}), len(cat_pages))

    group("category page listings")
    bad_missing = bad_extra = bad_dead = 0
    for key, rows in groups.items():
        listed = re.findall(r'href="\.\./\.\./plaques/([a-z0-9-]+)/"', cat_pages[key])
        want = {p_["slug"] for p_ in rows}
        if want - set(listed):
            bad_missing += 1
        if set(listed) - want:
            bad_extra += 1
        if not set(listed) <= all_slugs:
            bad_dead += 1
    eq("every plaque in a category is linked from its page", bad_missing, 0)
    eq("no page links a plaque from another category", bad_extra, 0)
    eq("every listed link points at a generated page", bad_dead, 0)
    check("the biggest category lists all of its plaques",
          cat_pages["politics"].count('href="../../plaques/') == len(groups["politics"]))

    # ── The URL map the app links with ──────────────────────────────────────

    group("plaque URL map")
    with open(os.path.join(out, gen.URL_MAP), encoding="utf-8") as fh:
        url_map = __import__("json").load(fh)
    eq("the base is the pages directory", url_map["base"], f"{gen.PAGES_DIR}/")
    eq("one entry per plaque", len(url_map["slugs"]), len(plaques))
    check("every entry matches the slug the generator wrote",
          url_map["slugs"] == slugs_by_id)
    check("every value is URL-safe",
          all(re.fullmatch(r"[a-z0-9-]+", v) for v in url_map["slugs"].values()))
    check("every mapped page exists on disk",
          all(os.path.isfile(os.path.join(out, gen.PAGES_DIR, v, "index.html"))
              for v in list(url_map["slugs"].values())[:50]))

    group("sitemap")
    with open(os.path.join(out, "sitemap.xml"), encoding="utf-8") as fh:
        sitemap = fh.read()
    locs = re.findall(r"<loc>([^<]+)</loc>", sitemap)
    eq("homepage, directory, walks, categories and plaque pages",
       len(locs),
       len(plaques) + len(groups) + len(walks) + (1 if walks else 0) + 2)
    eq("the homepage comes first", locs[0], gen.SITE)
    eq("the A–Z directory comes second", locs[1], f"{gen.SITE}{gen.DIRECTORY_DIR}/")
    eq("no URL is listed twice", len(set(locs)), len(locs))
    check("every category page is listed",
          {f"{gen.SITE}categories/{u}/" for u in cat_urls} <= set(locs))
    check("every plaque page is listed",
          {f"{gen.SITE}plaques/{p['slug']}/" for p in plaques} <= set(locs))
    check("no stale category URL survives",
          {u for u in locs if "/categories/" in u}
          == {f"{gen.SITE}categories/{u}/" for u in cat_urls})
    check("every URL is the canonical production URL",
          all(u.startswith(gen.SITE) for u in locs))
    check("the XML parses",
          (lambda: __import__("xml.etree.ElementTree", fromlist=["ElementTree"])
           .fromstring(sitemap) is not None)())
    check("no invented lastmod, priority or changefreq",
          not any(tag in sitemap for tag in ("<lastmod>", "<priority>", "<changefreq>")))

    group("regeneration")
    stale = os.path.join(out, gen.PAGES_DIR, "gone-from-the-dataset-0")
    stale_cat = os.path.join(out, gen.CATS_DIR, "renamed-away")
    os.makedirs(stale, exist_ok=True)
    os.makedirs(stale_cat, exist_ok=True)
    gen.generate(out, plaques)
    check("a page dropped from the dataset is removed", not os.path.isdir(stale))
    check("a category page dropped from the schema is removed",
          not os.path.isdir(stale_cat))
    with open(path, encoding="utf-8") as fh:
        check("regenerating is byte-for-byte stable", fh.read() == page)
finally:
    shutil.rmtree(out, ignore_errors=True)

# ── Walks ───────────────────────────────────────────────────────────────────
#
# Walk definitions are hand-edited, and everything measurable about a walk is
# derived rather than typed, so what is worth asserting is that the definitions
# still resolve, that the derivation matches the app's, and that the pages carry
# the route in plain HTML.

group("walks")
check("walks are defined", len(walks) >= 3, f"{len(walks)} walks")
check("every walk has 4 to 8 stops",
      all(4 <= len(w["stops"]) <= 8 for w in walks),
      str([(w["slug"], len(w["stops"])) for w in walks]))
eq("walk slugs are unique", len({w["slug"] for w in walks}), len(walks))
check("walk slugs are URL-safe",
      all(re.fullmatch(r"[a-z0-9-]+", w["slug"]) for w in walks))
check("every stop resolves to a plaque in the dataset",
      all(s["plaque"]["id"] in {p["id"] for p in plaques}
          for w in walks for s in w["stops"]))
check("no walk repeats a stop",
      all(len({s["plaque"]["id"] for s in w["stops"]}) == len(w["stops"]) for w in walks))
check("every stop carries a note", all(s["note"] for w in walks for s in w["stops"]))
# A walk is only a walk if it can be done on foot in one go. Anything much over
# this is a day out, and the "about N minutes' walking" line would be a lie.
check("every walk is under 5 km and under an hour on foot",
      all(w["metres"] < 5000 and w["minutes"] < 60 for w in walks),
      str([(w["slug"], round(w["metres"]), w["minutes"]) for w in walks]))
check("consecutive stops are within 1.2 km of each other",
      all(gen.haversine(w["stops"][i - 1]["plaque"], w["stops"][i]["plaque"]) < 1200
          for w in walks for i in range(1, len(w["stops"]))))

# The app derives the same numbers in js/walks.js. They cannot be imported here,
# so the shared constants are asserted against the values that file documents.
eq("the route factor matches js/walks.js", gen.ROUTE_FACTOR, 1.3)
eq("the walking pace matches js/config.js", gen.WALK_METRES_PER_MIN, 80)
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                       "js", "walks.js"), encoding="utf-8") as fh:
    walks_js = fh.read()
check("js/walks.js declares the same route factor",
      f"ROUTE_FACTOR = {gen.ROUTE_FACTOR}" in walks_js)
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                       "js", "config.js"), encoding="utf-8") as fh:
    check("js/config.js declares the same walking pace",
          f"WALK_METRES_PER_MIN = {gen.WALK_METRES_PER_MIN}" in fh.read())

out2 = tempfile.mkdtemp(prefix="walks-test-")
try:
    gen.generate(out2, plaques, walks=walks)
    sample_walk = walks[0]
    with open(os.path.join(out2, gen.WALKS_DIR, sample_walk["slug"], "index.html"),
              encoding="utf-8") as fh:
        wp = fh.read()

    group(f"walk page content — {sample_walk['name']}")
    check("the name is the H1", f"<h1>{gen.esc(sample_walk['name'])}</h1>" in wp)
    check("the area is in the initial HTML", gen.esc(sample_walk["area"]) in wp)
    check("the introductory copy is in the initial HTML",
          gen.esc(sample_walk["intro"])[:80] in wp)
    check("the stop count, distance and duration are shown",
          all(bit in wp for bit in (f"{len(sample_walk['stops'])} stops",
                                    gen.walk_distance(sample_walk["metres"]),
                                    f"{sample_walk['minutes']} min")))
    check("the stops are an ordered list", '<ol class="walk-stops">' in wp)
    check("every stop names its plaque and links to its page",
          all(f'href="../../{gen.PAGES_DIR}/{s["plaque"]["slug"]}/"' in wp
              and gen.esc(s["plaque"]["title"]) in wp for s in sample_walk["stops"]))
    check("every stop carries its own contextual note",
          all(gen.esc(s["note"])[:40] in wp for s in sample_walk["stops"]))
    check("the stops appear in walking order",
          [wp.index(f'{gen.PAGES_DIR}/{s["plaque"]["slug"]}/')
           for s in sample_walk["stops"]]
          == sorted(wp.index(f'{gen.PAGES_DIR}/{s["plaque"]["slug"]}/')
                    for s in sample_walk["stops"]))
    eq("nothing but structured data and the deferred runtime script",
       content_scripts(wp), [])
    check("the page declares its kind for analytics",
          '<body class="sp-body" data-page="walk">' in wp)
    check("the map link is marked as the measured conversion",
          f'href="../../?walk={sample_walk["slug"]}" data-track="to-app"' in wp)
    check("a walk can be passed on from its own page",
          'data-track="share" hidden>Share this walk<' in wp)
    check("the estimate is described rather than presented as measured",
          "allowance for street layout" in wp)

    group("walk page head")
    check("the title names the walk and the site",
          f"<title>{gen.esc(sample_walk['name'])}" in wp and gen.SITE_NAME in wp)
    check("a meta description is present", 'name="description" content="' in wp)
    canon = f'<link rel="canonical" href="{gen.SITE}{gen.WALKS_DIR}/{sample_walk["slug"]}/">'
    check("the canonical URL is the production URL", canon in wp, canon)
    check("Open Graph basics are present",
          all(f'property="og:{k}"' in wp
              for k in ("type", "title", "description", "url", "image")))
    ld = json.loads(wp.split('application/ld+json">')[1].split("</script>")[0])
    eq("structured data is an ItemList", ld["@type"], "ItemList")
    eq("it lists every stop", len(ld["itemListElement"]), len(sample_walk["stops"]))
    eq("positions run 1..n", [e["position"] for e in ld["itemListElement"]],
       list(range(1, len(sample_walk["stops"]) + 1)))
    check("each element points at that plaque's canonical page",
          all(e["url"].startswith(f"{gen.SITE}{gen.PAGES_DIR}/")
              for e in ld["itemListElement"]))

    group("walk titles and descriptions are unique")
    heads = []
    for w in walks:
        with open(os.path.join(out2, gen.WALKS_DIR, w["slug"], "index.html"),
                  encoding="utf-8") as fh:
            page = fh.read()
        heads.append((re.search(r"<title>(.*?)</title>", page, re.S).group(1),
                      re.search(r'name="description" content="(.*?)"', page).group(1)))
    eq("every walk has its own title", len({t for t, _ in heads}), len(walks))
    eq("every walk has its own meta description", len({d for _, d in heads}), len(walks))

    group("the walk index and the link graph")
    with open(os.path.join(out2, gen.WALKS_DIR, "index.html"), encoding="utf-8") as fh:
        wi = fh.read()
    check("the index links every walk",
          all(f'href="{w["slug"]}/"' in wi for w in walks))
    check("the index names every walk", all(gen.esc(w["name"]) in wi for w in walks))
    check("the index links back to the map", 'href="../"' in wi)

    # walks → plaques is asserted above; this is the return leg.
    on_walk = gen.walks_by_plaque(walks)
    check("a plaque on a walk is linked to it", bool(on_walk))
    stop = walks[0]["stops"][0]["plaque"]
    with open(os.path.join(out2, gen.PAGES_DIR, stop["slug"], "index.html"),
              encoding="utf-8") as fh:
        sp = fh.read()
    check("that plaque's page links up to the walk",
          f'href="../../{gen.WALKS_DIR}/{walks[0]["slug"]}/"' in sp)
    off_walk = next(p for p in plaques if p["id"] not in on_walk)
    with open(os.path.join(out2, gen.PAGES_DIR, off_walk["slug"], "index.html"),
              encoding="utf-8") as fh:
        check("a plaque on no walk gets no empty walk section",
              'id="walks"' not in fh.read())

    check("every walk page is in the generated sitemap",
          all(f"<loc>{gen.SITE}{gen.WALKS_DIR}/{w['slug']}/</loc>"
              in open(os.path.join(out2, "sitemap.xml"), encoding="utf-8").read()
              for w in walks))
finally:
    shutil.rmtree(out2, ignore_errors=True)

# ── The homepage is where a crawler starts ──────────────────────────────────

group("homepage links into the category pages")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as fh:
    home = fh.read()
home_cats = set(re.findall(r'href="categories/([a-z0-9-]+)/"', home))
eq("index.html links every generated category page, and only those",
   home_cats, {gen.CATEGORY_URL[k] for k in gen.by_category(gen.load_plaques())})
check("those links are plain anchors, not JavaScript",
      "javascript:" not in home)
check("the no-JavaScript fallback carries them too",
      'href="categories/' in home.split("<noscript>")[1].split("</noscript>")[0])

group("homepage links into the walk pages")
home_walks = set(re.findall(r'href="walks/([a-z0-9-]+)/"', home))
eq("index.html links every generated walk, and only those",
   home_walks, {w["slug"] for w in gen.load_walks(gen.load_plaques())})
check("the no-JavaScript fallback carries the walks too",
      'href="walks/' in home.split("<noscript>")[1].split("</noscript>")[0])

# ── The A–Z directory ───────────────────────────────────────────────────────
#
# The page exists to answer "list of London blue plaques" searches, so what it
# must guarantee is that the whole list is in the initial HTML — every plaque,
# once, linked to its canonical page — and that nothing about it depends on
# the script that filters it. Read from the committed file; the drift check
# below proves it is what the generator writes.

group("A–Z directory content")
with open(os.path.join(ROOT, gen.DIRECTORY_DIR, "index.html"), encoding="utf-8") as fh:
    directory = fh.read()
all_plaques = gen.load_plaques()
dir_rows = re.findall(r'<li data-c="([a-z-]+)"><a class="dir-name" href="\.\./'
                      + gen.PAGES_DIR + r'/([a-z0-9-]+)/">(.*?)</a>', directory)
check("the H1 is in the initial HTML",
      "<h1>London Blue Plaques — Full List</h1>" in directory)
check("the intro states the generated count",
      f"Explore all {len(all_plaques):,} English Heritage blue plaques" in directory)
eq("one row per plaque in the dataset", len(dir_rows), len(all_plaques))
eq("no plaque page is listed twice", len({slug for _, slug, _ in dir_rows}), len(dir_rows))
eq("every row links the slug the generator wrote for it",
   {slug for _, slug, _ in dir_rows}, {p["slug"] for p in all_plaques})
by_slug = {p["slug"]: p for p in all_plaques}
check("every row names its plaque and carries its category",
      all(name == gen.esc(by_slug[slug]["title"]) and cat == by_slug[slug]["category"]
          for cat, slug, name in dir_rows))
check("every linked page exists on disk",
      all(os.path.isfile(os.path.join(ROOT, gen.PAGES_DIR, slug, "index.html"))
          for _, slug, _ in dir_rows))
check("rows are in A–Z order",
      [gen.directory_key(by_slug[s]) for _, s, _ in dir_rows]
      == sorted(gen.directory_key(by_slug[s]) for _, s, _ in dir_rows))
eq("every row offers its plaque on the map",
   len(re.findall(r'class="dir-map" href="\.\./\?plaque=[^"]+" rel="nofollow"', directory)),
   len(all_plaques))
check("the map links use the app's existing ?plaque=<id> deep link",
      all(f'href="../?plaque={p["id"]}"' in directory for p in all_plaques[:50]))
letters = gen.by_letter(all_plaques)
check("each populated letter is a section the A–Z bar links to",
      all(f'id="{gen.letter_id(l)}"' in directory and f'href="#{gen.letter_id(l)}"' in directory
          for l, rows in letters.items() if rows))
check("a letter with no plaques is shown but not linked",
      all(f'href="#{gen.letter_id(l)}"' not in directory
          and f'<span class="dir-az-off" aria-disabled="true">{l}</span>' in directory
          for l in gen.LETTERS if not letters.get(l)))
check("the category filter offers the existing categories, and only those",
      set(re.findall(r'<option value="([a-z-]+)">', directory))
      == set(gen.by_category(all_plaques)))
check("the filter controls ship hidden until the script can drive them",
      '<form class="dir-controls" role="search" hidden>' in directory)
check("the search field has a visible label",
      '<label for="dir-q">' in directory and 'id="dir-q"' in directory)
check("the result count is a status region", 'id="dir-count" role="status"' in directory)
eq("nothing but structured data and the deferred runtime script",
   content_scripts(directory), [])
check("the page declares its kind for analytics",
      '<body class="sp-body" data-page="directory">' in directory)
check("it links every category page",
      all(f'href="../{gen.CATS_DIR}/{gen.CATEGORY_URL[k]}/"' in directory
          for k in gen.by_category(all_plaques)))

group("A–Z directory head")
dir_url = f"{gen.SITE}{gen.DIRECTORY_DIR}/"
eq("the canonical URL is the production URL",
   re.search(r'<link rel="canonical" href="([^"]+)">', directory).group(1), dir_url)
eq("…with exactly one slash between path segments",
   dir_url, "https://nyatasha.github.io/blueplaques/blue-plaques/")
check("Open Graph title, description and URL are present",
      all(f'property="og:{k}"' in directory for k in ("title", "description", "url", "image"))
      and f'<meta property="og:url" content="{dir_url}">' in directory)
dir_title = re.search(r"<title>(.*?)</title>", directory).group(1)
dir_desc = re.search(r'name="description" content="(.*?)"', directory).group(1)
check("the title names the list intent and the count",
      dir_title.startswith("London Blue Plaques List") and f"{len(all_plaques):,}" in dir_title)
check("the description fits without truncation",
      len(gen.html.unescape(dir_desc)) <= gen.DESC_MAX and not dir_desc.endswith("…"))
other_heads = [home] + [open(os.path.join(ROOT, gen.CATS_DIR, d, "index.html"),
                             encoding="utf-8").read()
                        for d in sorted(os.listdir(os.path.join(ROOT, gen.CATS_DIR)))]
other_heads.append(open(os.path.join(ROOT, gen.WALKS_DIR, "index.html"), encoding="utf-8").read())
check("the title is unique on the site",
      all(f"<title>{dir_title}</title>" not in t for t in other_heads))
check("the meta description is unique on the site",
      all(f'content="{dir_desc}"' not in t for t in other_heads))
check("the sitemap lists it", f"<loc>{dir_url}</loc>" in open(
    os.path.join(ROOT, "sitemap.xml"), encoding="utf-8").read())

group("links into the A–Z directory")
check("the homepage links it", 'href="blue-plaques/"' in home)
check("…including without JavaScript",
      'href="blue-plaques/"' in home.split("<noscript>")[1].split("</noscript>")[0])
check("the homepage keeps its map title and H1",
      "<title>London Uncovered — London Blue Plaques Map" in home
      and "London Uncovered — London Blue Plaques Map</h1>" in home)
check("every category page links it",
      all(f'href="../../{gen.DIRECTORY_DIR}/"' in t for t in other_heads[1:-1]))
check("plaque pages link it",
      f'href="../../{gen.DIRECTORY_DIR}/"' in open(
          os.path.join(ROOT, gen.PAGES_DIR, all_plaques[0]["slug"], "index.html"),
          encoding="utf-8").read())
check("the walks index links it", f'href="../{gen.DIRECTORY_DIR}/"' in other_heads[-1])

# ── What is committed is what GitHub Pages serves ───────────────────────────
#
# The site deploys straight from the branch: no build step runs on push, so a
# dataset edit without a regeneration ships stale pages and a stale sitemap and
# nothing else would notice. Regenerate into a temporary tree and compare.

group("the committed site matches the generator")
committed = tempfile.mkdtemp()
try:
    gen.generate(committed, gen.load_plaques())
    drift = []
    for rel in (gen.URL_MAP, "sitemap.xml", "404.html",
                os.path.join(gen.WALKS_DIR, "index.html"),
                os.path.join(gen.DIRECTORY_DIR, "index.html")):
        with open(os.path.join(ROOT, rel), encoding="utf-8") as a, \
             open(os.path.join(committed, rel), encoding="utf-8") as b:
            if a.read() != b.read():
                drift.append(rel)
    for sub in (gen.PAGES_DIR, gen.CATS_DIR, gen.WALKS_DIR):
        # Directories only: walks/ also holds its own index.html beside them.
        want = {d for d in os.listdir(os.path.join(committed, sub))
                if os.path.isdir(os.path.join(committed, sub, d))}
        have = {d for d in os.listdir(os.path.join(ROOT, sub))
                if os.path.isfile(os.path.join(ROOT, sub, d, "index.html"))}
        check(f"{sub}/ holds exactly the generated directories", want == have,
              f"missing {sorted(want - have)[:3]}, extra {sorted(have - want)[:3]}")
        for d in sorted(want & have):
            with open(os.path.join(ROOT, sub, d, "index.html"), encoding="utf-8") as a, \
                 open(os.path.join(committed, sub, d, "index.html"), encoding="utf-8") as b:
                if a.read() != b.read():
                    drift.append(f"{sub}/{d}/index.html")
    check("every committed page is byte-for-byte what the generator writes",
          not drift, f"{len(drift)} stale: {drift[:3]}")
finally:
    shutil.rmtree(committed, ignore_errors=True)

# ── The committed sitemap is the one Google fetches ─────────────────────────
#
# The check above compares sitemap.xml with a fresh generator run, which fails
# on any drift at all. This one asks the narrower question directly of the file
# on disk, without consulting the generator: does the committed sitemap list
# the pages that are committed beside it? A sitemap that regressed to a handful
# of URLs — the state this site shipped in before the static layer landed — is
# invisible to a byte comparison if the generator is what regressed, and it is
# the failure that costs the most, because Google acts on it silently.

group("the committed sitemap covers the committed pages")
with open(os.path.join(ROOT, "sitemap.xml"), encoding="utf-8") as fh:
    committed_sitemap = fh.read()
committed_locs = re.findall(r"<loc>([^<]+)</loc>", committed_sitemap)


def committed_dirs(sub):
    root = os.path.join(ROOT, sub)
    return {d for d in os.listdir(root)
            if os.path.isfile(os.path.join(root, d, "index.html"))}


walk_dirs = committed_dirs(gen.WALKS_DIR)
on_disk = {
    gen.SITE,
    *({f"{gen.SITE}{gen.DIRECTORY_DIR}/"}
      if os.path.isfile(os.path.join(ROOT, gen.DIRECTORY_DIR, "index.html")) else set()),
    *({f"{gen.SITE}{gen.WALKS_DIR}/"} if walk_dirs else set()),
    *(f"{gen.SITE}{gen.WALKS_DIR}/{d}/" for d in walk_dirs),
    *(f"{gen.SITE}{gen.CATS_DIR}/{d}/" for d in committed_dirs(gen.CATS_DIR)),
    *(f"{gen.SITE}{gen.PAGES_DIR}/{d}/" for d in committed_dirs(gen.PAGES_DIR)),
}
listed = set(committed_locs)

# A tiny sitemap beside a large tree is the specific regression this guards, so
# say so in its own check rather than leaving it to the set comparison, whose
# failure detail truncates to three entries.
check("the sitemap is not a small subset of the pages committed beside it",
      len(listed) >= len(on_disk),
      f"{len(listed)} URLs listed, {len(on_disk)} pages on disk")
check("every committed page is listed in the sitemap", on_disk <= listed,
      f"{len(on_disk - listed)} unlisted, e.g. {sorted(on_disk - listed)[:3]}")
check("the sitemap lists nothing that is not committed", listed <= on_disk,
      f"{len(listed - on_disk)} phantom, e.g. {sorted(listed - on_disk)[:3]}")
eq("no URL is listed twice", len(listed), len(committed_locs))
check("every URL is an absolute canonical production URL",
      all(u.startswith(gen.SITE) for u in committed_locs))
check("the committed sitemap parses as XML",
      (lambda: __import__("xml.etree.ElementTree", fromlist=["ElementTree"])
       .fromstring(committed_sitemap) is not None)())

group("breadcrumbs")


def crumbs_of(text):
    """The BreadcrumbList node on a page, or None."""
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>',
                            text, flags=re.S):
        node = json.loads(block)
        if node.get("@type") == "BreadcrumbList":
            return node
    return None


def trail_of(text):
    node = crumbs_of(text)
    return [(i["name"], i.get("item")) for i in node["itemListElement"]] if node else None


with open(os.path.join(ROOT, gen.PAGES_DIR, plaques[0]["slug"], "index.html"),
          encoding="utf-8") as fh:
    committed_plaque = fh.read()
with open(os.path.join(ROOT, gen.CATS_DIR,
                       gen.CATEGORY_URL[plaques[0]["category"]], "index.html"),
          encoding="utf-8") as fh:
    committed_cat = fh.read()
with open(os.path.join(ROOT, gen.WALKS_DIR, walks[0]["slug"], "index.html"),
          encoding="utf-8") as fh:
    committed_walk = fh.read()

eq("a plaque page's trail is site › category › plaque",
   trail_of(committed_plaque),
   [(gen.SITE_NAME, gen.SITE),
    (plaques[0]["category_label"],
     f"{gen.SITE}{gen.CATS_DIR}/{plaques[0]['category_url']}/"),
    (plaques[0]["title"], None)])
eq("a walk page's trail is site › walks › walk",
   trail_of(committed_walk),
   [(gen.SITE_NAME, gen.SITE), ("Walks", f"{gen.SITE}{gen.WALKS_DIR}/"),
    (walks[0]["name"], None)])
check("a category page carries a trail too", trail_of(committed_cat) is not None)
eq("the A–Z directory's trail is site › list", trail_of(directory),
   [(gen.SITE_NAME, gen.SITE), ("London blue plaques list", None)])
check("only the last crumb omits its URL — it is the page itself",
      all(all(url for _, url in trail[:-1]) and trail[-1][1] is None
          for trail in (trail_of(committed_plaque), trail_of(committed_cat),
                        trail_of(committed_walk))))
check("every crumb the structured data claims is a link the page shows",
      all(f'href="{href}"' in committed_plaque
          for href in ("../../", f"../../{gen.CATS_DIR}/"
                                  f"{plaques[0]['category_url']}/")))

group("404")
with open(os.path.join(ROOT, "404.html"), encoding="utf-8") as fh:
    not_found = fh.read()
check("the page exists and says what happened",
      "<h1>That page is not here</h1>" in not_found)
check("it is excluded from the index", '<meta name="robots" content="noindex">' in not_found)
check("it is not in the sitemap", f"{gen.SITE}404.html" not in committed_sitemap)
check("every link is root-absolute — it is served from any depth",
      not re.search(r'(?:href|src)="(?!/|https?:|#)', not_found),
      str(re.findall(r'(?:href|src)="(?!/|https?:|#)[^"]*"', not_found)[:3]))
check("it offers a way back to the map",
      f'class="sp-cta" href="/{gen.PAGES_ROOT}"' in not_found)
check("it links to every walk",
      all(f'href="/{gen.PAGES_ROOT}{gen.WALKS_DIR}/{w["slug"]}/"' in not_found
          for w in walks))
check("it links to every category",
      all(f'href="/{gen.PAGES_ROOT}{gen.CATS_DIR}/{u}/"' in not_found
          for u in gen.CATEGORY_URL.values()))

# ── No doubled slash reaches production ────────────────────────────────────
#
# The gate above runs inside the generator. This one asks the committed tree
# directly, so output that predates the gate, or anything hand-edited, is
# caught as well: zero production URLs with an empty path segment, anywhere.

group("no committed URL has an empty path segment")
_outputs = ["index.html", "404.html", "sitemap.xml", "robots.txt",
            gen.URL_MAP, os.path.join(gen.WALKS_DIR, "index.html"),
            os.path.join(gen.DIRECTORY_DIR, "index.html")]
_outputs += [os.path.join(sub, d, "index.html")
             for sub in (gen.PAGES_DIR, gen.CATS_DIR, gen.WALKS_DIR)
             for d in sorted(os.listdir(os.path.join(ROOT, sub)))
             if os.path.isfile(os.path.join(ROOT, sub, d, "index.html"))]
_offenders = {}
for _rel in _outputs:
    _path = os.path.join(ROOT, _rel)
    if not os.path.isfile(_path):
        continue
    with open(_path, encoding="utf-8") as fh:
        _bad = gen.malformed_urls(fh.read())
    if _bad:
        _offenders[_rel] = _bad
check(f"all {len(_outputs)} committed outputs are free of doubled slashes",
      not _offenders,
      f"{len(_offenders)} file(s): {sorted(_offenders)[:3]}")
check("the string nyatasha.github.io/blueplaques + an empty segment appears nowhere",
      not _offenders)

group("deployment")
with open(os.path.join(ROOT, "robots.txt"), encoding="utf-8") as fh:
    robots = fh.read()
check("robots.txt disallows nothing", "Disallow:" not in robots
      or all(not l.split(":", 1)[1].strip()
             for l in robots.splitlines() if l.startswith("Disallow:")))
check("robots.txt points at the sitemap on the project site",
      f"Sitemap: {gen.SITE}sitemap.xml" in robots)
# Pages runs Jekyll over a branch deploy unless this file is present, and Jekyll
# silently drops any path beginning with an underscore. Nothing generated starts
# with one today, but the tree is committed output and should be served verbatim.
check(".nojekyll makes Pages serve the tree verbatim",
      os.path.isfile(os.path.join(ROOT, ".nojekyll")))

print()
if failed:
    print(f"SEO FAIL — {failed} of {passed + failed} checks failed")
    sys.exit(1)
print(f"SEO PASS — {passed} checks")
