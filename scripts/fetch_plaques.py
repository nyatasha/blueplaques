#!/usr/bin/env python3
"""
Download the OpenPlaques London CSV and extract the plaques we ship.

Which rows are shipped is decided by one named predicate, `INCLUDE`. Today it is
`in_london_wide_scheme` — the official scheme administered by English Heritage,
identified by the organisation tag the dump records it under, not by the colour
of the plaque. The scheme's early plaques are brown terracotta, stone, bronze,
black, grey, white and green; filtering on `colour == "blue"` threw 76 of them
away (decision-log #24).

To widen the dataset, swap `INCLUDE` for another predicate — `every_plaque` is
provided — and change nothing else. The row loop does not know what the filter
is testing.

Every row that is not shipped is written to the excluded-rows report with a
reason, so the count in the GeoJSON plus the count in the report always equals
the number of rows in the dump.

Outputs, relative to the project root:
    data/plaques.geojson              the shipped features
    docs/data-quality/excluded-rows.csv   every row we did not ship, with a reason

Usage:
    python3 scripts/fetch_plaques.py
    python3 scripts/fetch_plaques.py --csv /path/to/local.csv   # skip the download
    python3 scripts/fetch_plaques.py --excluded /path/report.csv
"""

import argparse
import csv
import io
import json
import os
import sys
import urllib.request

CSV_URL = "https://openplaques.s3.eu-west-2.amazonaws.com/open-plaques-london-2025-12-14.csv"
CSV_DATE = "2025-12-14"          # the datapull this build is made from

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
OUTPUT = os.path.join(PROJECT_ROOT, "data", "plaques.geojson")
EXCLUDED = os.path.join(PROJECT_ROOT, "docs", "data-quality", "excluded-rows.csv")

# ── Scheme vocabulary ────────────────────────────────────────────────────────
# The dump tags the official London-wide scheme on the organisations field with
# this exact string. English Heritage administers it now; the London County
# Council, the Greater London Council, the (Royal) Society of Arts and a handful
# of others erected the plaques that carry it.
SCHEME_TAG = "administered by English Heritage as part of the London wide plaque scheme"

# organisation string → the scheme it means, for display and for filtering.
# Keyed by tag rather than by erecting body, so a plaque erected by the LCC in
# 1903 and one erected by English Heritage in 2024 land in the same scheme.
SCHEME_BY_TAG = {
    SCHEME_TAG: "English Heritage",
}
UNATTRIBUTED = "Unattributed"    # the dump records no organisation at all

# Words that stay lower-case inside an organisation name, so that the dump's
# "Royal Society Of Arts" reads as "Royal Society of Arts". Deliberately
# general: no table of known bodies, because phase 2 brings ~200 more.
SMALL_WORDS = {
    "a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "the", "to",
}

# ── Hand-set coordinates ─────────────────────────────────────────────────────
# id → (lat, lng, source). For rows the dump leaves ungeolocated but that are
# located upstream. Kept deliberately narrow: this is a two-column table of
# reviewed exceptions, not a geocoding stage (decision-log #27).
GEOCODE_OVERRIDES = {
    "40254": (
        51.57375, -0.15849,
        "openplaques.org/plaques/40254.json, accessed 2026-09-06",
    ),
}


# ── Filter predicates ────────────────────────────────────────────────────────
# Each takes the raw CSV row and its parsed organisations list, and answers
# whether the plaque belongs in the dataset.

def in_london_wide_scheme(row: dict, organisations: list[str]) -> bool:
    """The official scheme, whatever colour the plaque is and whoever put it up."""
    return SCHEME_TAG in organisations


def every_plaque(row: dict, organisations: list[str]) -> bool:
    """Every London plaque in the dump, from every erecting body. Phase 2."""
    return True


INCLUDE = in_london_wide_scheme


# ── Field parsing ────────────────────────────────────────────────────────────

def parse_organisations(raw: str) -> list[str]:
    """The dump stores organisations as a JSON array in a CSV cell."""
    raw = (raw or "").strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except ValueError:
        return [raw]
    if not isinstance(parsed, list):
        return [str(parsed).strip()]
    return [str(o).strip() for o in parsed if str(o).strip()]


def normalise_name(name: str) -> str:
    """Tidy an organisation name for display without renaming it."""
    words = name.split()
    out = []
    for i, word in enumerate(words):
        low = word.lower()
        if low in SMALL_WORDS and 0 < i < len(words) - 1:
            out.append(low)
        else:
            out.append(word)
    return " ".join(out)


def scheme_of(organisations: list[str]) -> str:
    """The scheme a plaque belongs to, in display form. Never empty."""
    for org in organisations:
        if org in SCHEME_BY_TAG:
            return SCHEME_BY_TAG[org]
    for org in organisations:
        return normalise_name(org)
    return UNATTRIBUTED


def erected_by(organisations: list[str], scheme: str) -> str:
    """The body that put the plaque up, which the scheme name can fold away."""
    for org in organisations:
        if org not in SCHEME_BY_TAG:
            return normalise_name(org)
    return scheme


def clean_title(title: str, lead_name: str) -> str:
    if lead_name:
        return lead_name
    for suffix in [" blue plaque", " Blue Plaque", " plaque", " Plaque"]:
        if title.endswith(suffix):
            return title[: -len(suffix)]
    return title


def extract_year(erected: str) -> str:
    s = (erected or "").strip()
    return s[:4] if s else ""


def coordinates(row: dict) -> tuple[float, float, str] | None:
    """(lat, lng, source) for a row, or None if we cannot place it."""
    plaque_id = row.get("id", "").strip()
    if plaque_id in GEOCODE_OVERRIDES:
        lat, lng, source = GEOCODE_OVERRIDES[plaque_id]
        return lat, lng, source
    try:
        return float(row["latitude"]), float(row["longitude"]), ""
    except (ValueError, KeyError, TypeError):
        return None


def exclusion_detail(row: dict, organisations: list[str]) -> str:
    """A note that makes a not-in-scheme row worth a second look, or ''."""
    if any(org == "English Heritage" for org in organisations):
        return "attributed to English Heritage but not tagged into the scheme"
    return ""


# ── Build ────────────────────────────────────────────────────────────────────

def load_csv(path: str | None) -> str:
    if path:
        print(f"Reading: {path}")
        with open(path, encoding="utf-8-sig") as f:
            return f.read()
    print(f"Downloading: {CSV_URL}")
    req = urllib.request.Request(CSV_URL, headers={"User-Agent": "blueplaquesmap/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8-sig")


def build(raw: str):
    reader = csv.DictReader(io.StringIO(raw))
    features = []
    excluded = []
    total = 0

    for row in reader:
        total += 1
        organisations = parse_organisations(row.get("organisations", ""))

        def drop(reason: str, detail: str = "") -> None:
            excluded.append({
                "id": row.get("id", "").strip(),
                "reason": reason,
                "detail": detail,
                "colour": row.get("colour", "").strip(),
                "organisations": "; ".join(organisations),
                "title": row.get("title", "").strip(),
                "address": row.get("address", "").strip(),
            })

        if not INCLUDE(row, organisations):
            drop("not-in-scheme", exclusion_detail(row, organisations))
            continue

        placed = coordinates(row)
        if placed is None:
            drop("no-coordinates", f"geolocated?={row.get('geolocated?', '').strip()}")
            continue
        lat, lng, geocode_source = placed

        plaque_id = row.get("id", "").strip()
        lead_name = row.get("lead_subject_name", "").strip()
        scheme = scheme_of(organisations)

        properties = {
            "id": plaque_id,
            "title": clean_title(row.get("title", "").strip(), lead_name),
            "inscription": row.get("inscription", "").strip(),
            "address": row.get("address", "").strip(),
            "area": row.get("area", "").strip(),
            "year": extract_year(row.get("erected", "")),
            "photo": row.get("main_photo", "").strip(),
            "wikipedia": row.get("lead_subject_wikipedia", "").strip(),
            "lead_roles": row.get("lead_subject_primary_role", "").strip(),
            "colour": row.get("colour", "").strip().lower(),
            "organisations": organisations,
            "scheme": scheme,
            "erected_by": erected_by(organisations, scheme),
            "openplaques_url": f"https://openplaques.org/plaques/{plaque_id}",
        }
        if geocode_source:
            properties["geocode_source"] = geocode_source

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lng, lat]},
            "properties": properties,
        })

    return features, excluded, total


def write_geojson(features: list[dict], path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(
            {"type": "FeatureCollection", "features": features},
            f,
            ensure_ascii=False,
            separators=(",", ":"),
        )


def write_excluded(excluded: list[dict], path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fields = ["id", "reason", "detail", "colour", "organisations", "title", "address"]
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in sorted(excluded, key=lambda r: (r["reason"], r["id"])):
            writer.writerow(row)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", help="read a local copy of the dump instead of downloading")
    ap.add_argument("--excluded", default=EXCLUDED, help="where to write the excluded-rows report")
    ap.add_argument("--out", default=OUTPUT, help="where to write the GeoJSON")
    args = ap.parse_args(argv)

    try:
        raw = load_csv(args.csv)
    except Exception as exc:
        print(f"Could not read the dump: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Selecting rows with: {INCLUDE.__name__}()")
    features, excluded, total = build(raw)

    write_geojson(features, args.out)
    write_excluded(excluded, args.excluded)

    reasons: dict[str, int] = {}
    for row in excluded:
        reasons[row["reason"]] = reasons.get(row["reason"], 0) + 1
    flagged = sum(1 for row in excluded if row["detail"])

    print()
    print(f"  dump rows      {total}")
    print(f"  shipped        {len(features)}  → {args.out}")
    print(f"  excluded       {len(excluded)}  → {args.excluded}")
    for reason, count in sorted(reasons.items()):
        print(f"    {reason:<18} {count}")
    if flagged:
        print(f"    …of which {flagged} carry a detail note worth reviewing")
    if len(features) + len(excluded) != total:
        print("  ✗ shipped + excluded does not equal the dump row count", file=sys.stderr)
        sys.exit(1)
    print("  ✓ every row is either shipped or explained")

    schemes: dict[str, int] = {}
    colours: dict[str, int] = {}
    for feat in features:
        p = feat["properties"]
        schemes[p["scheme"]] = schemes.get(p["scheme"], 0) + 1
        colours[p["colour"]] = colours.get(p["colour"], 0) + 1
    print()
    print("  schemes:", ", ".join(f"{k} {v}" for k, v in sorted(schemes.items(), key=lambda kv: -kv[1])))
    print("  colours:", ", ".join(f"{k} {v}" for k, v in sorted(colours.items(), key=lambda kv: -kv[1])))
    print()
    print("Next: classify_categories.py → add_fame.py → generate_seo_pages.py")


if __name__ == "__main__":
    main()
