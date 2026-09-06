#!/usr/bin/env python3
"""
Static SEO page generator — unit and output checks.

    python3 tests/seo.test.py

Generates the whole site into a temporary directory, so nothing here touches
the committed pages. Dependency-free: standard library only.
"""

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

out = tempfile.mkdtemp(prefix="seo-test-")
try:
    written = gen.generate(out, plaques)
    eq("a page was written for every plaque", written, len(plaques))
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

    group("sitemap")
    with open(os.path.join(out, "sitemap.xml"), encoding="utf-8") as fh:
        sitemap = fh.read()
    locs = re.findall(r"<loc>([^<]+)</loc>", sitemap)
    eq("homepage plus every plaque page", len(locs), len(plaques) + 1)
    eq("the homepage comes first", locs[0], gen.SITE)
    check("every plaque page is listed",
          {f"{gen.SITE}plaques/{p['slug']}/" for p in plaques} == set(locs[1:]))
    check("every URL is the canonical production URL",
          all(u.startswith(gen.SITE) for u in locs))
    check("no invented lastmod, priority or changefreq",
          not any(tag in sitemap for tag in ("<lastmod>", "<priority>", "<changefreq>")))

    group("regeneration")
    stale = os.path.join(out, gen.PAGES_DIR, "gone-from-the-dataset-0")
    os.makedirs(stale, exist_ok=True)
    gen.generate(out, plaques)
    check("a page dropped from the dataset is removed", not os.path.isdir(stale))
    with open(path, encoding="utf-8") as fh:
        check("regenerating is byte-for-byte stable", fh.read() == page)
finally:
    shutil.rmtree(out, ignore_errors=True)

print()
if failed:
    print(f"SEO FAIL — {failed} of {passed + failed} checks failed")
    sys.exit(1)
print(f"SEO PASS — {passed} checks")
