#!/usr/bin/env python3
"""
Enrich plaques.geojson with Wikipedia pageview counts.
Adds 'fame' (0–3) and 'views' (30-day total) to every feature.

Fame levels:
  3  iconic   — ≥ 100,000 views/month  (Churchill, Darwin, Marx …)
  2  famous   —   10,000–99,999         (nationally/internationally known)
  1  notable  —    1,000–9,999
  0  obscure  —        < 1,000  OR  no Wikipedia article

Usage:
    python3 scripts/add_fame.py
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from math import ceil

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
GEOJSON = os.path.join(PROJECT_ROOT, "data", "plaques.geojson")

BATCH_SIZE = 50
PVIP_DAYS  = 30   # days of daily pageview data to fetch and sum

THRESHOLDS = {3: 100_000, 2: 10_000, 1: 1_000}   # views/PVIP_DAYS


def article_from_url(url: str) -> str | None:
    if not url or "/wiki/" not in url:
        return None
    raw = url.split("/wiki/", 1)[1]
    return urllib.parse.unquote(raw).replace("_", " ")


def fetch_pageviews(articles: list[str]) -> dict[str, int]:
    """Return {normalised_title: total_views} for up to BATCH_SIZE articles."""
    titles_param = "|".join(a.replace(" ", "_") for a in articles)
    url = (
        "https://en.wikipedia.org/w/api.php"
        f"?action=query&prop=pageviews&pvipdays={PVIP_DAYS}"
        f"&titles={urllib.parse.quote(titles_param, safe='|')}"
        "&format=json&formatversion=2"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "blueplaquesmap/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.load(resp)
            break
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 2 ** (attempt + 2)   # 4s, 8s, 16s, 32s
                print(f"  429 — waiting {wait}s…", end=" ", flush=True)
                time.sleep(wait)
            else:
                raise
    else:
        raise RuntimeError("Gave up after 4 retries")

    # Build normalisation map (API may capitalise differently)
    norm_map: dict[str, str] = {}
    for entry in data.get("query", {}).get("normalized", []):
        norm_map[entry["from"].replace("_", " ")] = entry["to"]

    result: dict[str, int] = {}
    for page in data.get("query", {}).get("pages", []):
        if "missing" in page:
            continue
        title = page["title"]
        total = sum(v for v in page.get("pageviews", {}).values() if v is not None)
        result[title] = total

    # Also index by original input titles so callers can look up by either form
    for orig, normalised in norm_map.items():
        if normalised in result:
            result[orig] = result[normalised]

    return result


def fame_level(views: int) -> int:
    for level in (3, 2, 1):
        if views >= THRESHOLDS[level]:
            return level
    return 0


def main() -> None:
    with open(GEOJSON, encoding="utf-8") as f:
        data = json.load(f)

    features = data["features"]

    # Map article title → list of feature indices (rare duplicates exist)
    article_index: dict[str, list[int]] = {}
    for i, feat in enumerate(features):
        article = article_from_url(feat["properties"].get("wikipedia", ""))
        if article:
            article_index.setdefault(article, []).append(i)

    # Skip articles already enriched (support incremental re-runs)
    already_done = {
        article_from_url(feat["properties"].get("wikipedia", ""))
        for feat in features
        if feat["properties"].get("views", 0) > 0
    }
    articles = [a for a in article_index if a not in already_done]
    if already_done:
        print(f"Skipping {len(already_done)} already-fetched articles.")
    n_batches = ceil(len(articles) / BATCH_SIZE)
    print(f"Fetching {PVIP_DAYS}-day pageviews for {len(articles)} Wikipedia articles "
          f"in {n_batches} batches…")

    views_map: dict[str, int] = {}
    for batch_start in range(0, len(articles), BATCH_SIZE):
        batch = articles[batch_start : batch_start + BATCH_SIZE]
        batch_no = batch_start // BATCH_SIZE + 1
        print(f"  [{batch_no:2d}/{n_batches}]", end=" ", flush=True)
        try:
            result = fetch_pageviews(batch)
            views_map.update(result)
            top = max(result.items(), key=lambda x: x[1], default=("—", 0))
            print(f"top: {top[0][:40]!s} ({top[1]:,})")
        except Exception as exc:
            print(f"error: {exc}")
        if batch_no < n_batches:
            time.sleep(1.0)

    # Apply scores — only overwrite views if this run actually fetched the article
    counts = {0: 0, 1: 0, 2: 0, 3: 0}
    for article, indices in article_index.items():
        if article in views_map:
            views = views_map[article]
        else:
            # Fetched in a previous run — keep the stored value
            views = features[indices[0]]["properties"].get("views", 0)
        level = fame_level(views)
        for i in indices:
            features[i]["properties"]["fame"]  = level
            features[i]["properties"]["views"] = views
        counts[level] += len(indices)

    for feat in features:
        if "fame" not in feat["properties"]:
            feat["properties"]["fame"]  = 0
            feat["properties"]["views"] = 0
            counts[0] += 1

    with open(GEOJSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    t = sum(counts.values())
    print(f"\nFame distribution ({t} plaques):")
    print(f"  3 iconic   ≥100k/month : {counts[3]:>4}")
    print(f"  2 famous    10k–99k    : {counts[2]:>4}")
    print(f"  1 notable    1k–9k     : {counts[1]:>4}")
    print(f"  0 obscure   <1k / none : {counts[0]:>4}")
    print(f"\n✓ Updated {GEOJSON}")

    # Print top-10 as a sanity check
    ranked = sorted(
        [(feat["properties"].get("views", 0), feat["properties"].get("title", ""))
         for feat in features],
        reverse=True,
    )[:10]
    print("\nTop 10 by monthly views:")
    for views, name in ranked:
        print(f"  {views:>10,}  {name}")


if __name__ == "__main__":
    main()
