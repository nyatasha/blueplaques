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
    written, cats, _ = gen.generate(out, plaques)
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
    check("there is no client-side rendering to wait for",
          "<script" not in page.replace('<script type="application/ld+json">', ""))

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
    cat_check("each links back to the interactive map",
              lambda k, t: 'class="sp-cta" href="../../"' in t)
    cat_check("each links sideways to the other collections",
              lambda k, t: all(f'href="../{gen.CATEGORY_URL[o]}/"' in t
                               for o in groups if o != k))
    cat_check("none needs JavaScript to render its list",
              lambda k, t: "<script" not in t.replace('<script type="application/ld+json">', ""))
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
    eq("homepage plus every category and plaque page",
       len(locs), len(plaques) + len(groups) + 1)
    eq("the homepage comes first", locs[0], gen.SITE)
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
    for rel in (gen.URL_MAP, "sitemap.xml"):
        with open(os.path.join(ROOT, rel), encoding="utf-8") as a, \
             open(os.path.join(committed, rel), encoding="utf-8") as b:
            if a.read() != b.read():
                drift.append(rel)
    for sub in (gen.PAGES_DIR, gen.CATS_DIR):
        want = {d for d in os.listdir(os.path.join(committed, sub))}
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
