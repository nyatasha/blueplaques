#!/usr/bin/env python3
"""
Download OpenPlaques London CSV and extract English Heritage blue plaques.
Outputs data/plaques.geojson relative to the project root.

Usage:
    python3 scripts/fetch_plaques.py
"""

import csv
import io
import json
import os
import sys
import urllib.request

CSV_URL = "https://openplaques.s3.eu-west-2.amazonaws.com/open-plaques-london-2025-12-14.csv"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
OUTPUT = os.path.join(PROJECT_ROOT, "data", "plaques.geojson")


def is_english_heritage(organisations: str) -> bool:
    return "English Heritage" in organisations


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


def main():
    print(f"Downloading: {CSV_URL}")
    try:
        req = urllib.request.Request(CSV_URL, headers={"User-Agent": "blueplaquesmap/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8-sig")  # utf-8-sig strips BOM if present
    except Exception as exc:
        print(f"Download failed: {exc}", file=sys.stderr)
        sys.exit(1)

    print("Filtering English Heritage blue plaques…")
    reader = csv.DictReader(io.StringIO(raw))
    features = []
    skipped_coords = 0
    skipped_filter = 0

    for row in reader:
        colour = row.get("colour", "").strip().lower()
        organisations = row.get("organisations", "")
        geolocated = row.get("geolocated?", "").strip().lower()

        if colour != "blue" or not is_english_heritage(organisations):
            skipped_filter += 1
            continue

        if geolocated == "false":
            skipped_coords += 1
            continue

        try:
            lat = float(row["latitude"])
            lng = float(row["longitude"])
        except (ValueError, KeyError):
            skipped_coords += 1
            continue

        plaque_id = row.get("id", "").strip()
        lead_name = row.get("lead_subject_name", "").strip()
        title = clean_title(row.get("title", "").strip(), lead_name)

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lng, lat]},
            "properties": {
                "id": plaque_id,
                "title": title,
                "inscription": row.get("inscription", "").strip(),
                "address": row.get("address", "").strip(),
                "area": row.get("area", "").strip(),
                "year": extract_year(row.get("erected", "")),
                "photo": row.get("main_photo", "").strip(),
                "wikipedia": row.get("lead_subject_wikipedia", "").strip(),
                "lead_roles": row.get("lead_subject_primary_role", "").strip(),
                "openplaques_url": f"https://openplaques.org/plaques/{plaque_id}",
            },
        })

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(
            {"type": "FeatureCollection", "features": features},
            f,
            ensure_ascii=False,
            separators=(",", ":"),
        )

    print(f"✓  {len(features)} English Heritage blue plaques → {OUTPUT}")
    if skipped_coords:
        print(f"   ({skipped_coords} skipped — no coordinates)")
    print()
    print("To view the map:")
    print("  cd", PROJECT_ROOT)
    print("  python3 -m http.server 8000")
    print("  open http://localhost:8000")


if __name__ == "__main__":
    main()
