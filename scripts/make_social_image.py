#!/usr/bin/env python3
"""
Generate the Open Graph / Twitter share card at assets/social/og-cover.png.

A static 1200×630 image, rendered once and committed — not generated per
visitor, which PRD §52 rules out. Re-run only if the branding changes.

Usage:
    python3 scripts/make_social_image.py
"""

import json
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "social", "og-cover.png")
DATA = os.path.join(ROOT, "data", "plaques.geojson")

W, H, SS = 1200, 630, 3          # supersample for clean curves and type
IVORY = (247, 245, 240)
BLUE = (20, 86, 160)
BLUE_SOFT = (195, 215, 238)
INK = (20, 32, 43)
INK_SOFT = (103, 113, 123)
GOLD = (185, 150, 82)

SERIF = "/System/Library/Fonts/Supplemental/Georgia.ttf"
SERIF_BOLD = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
SANS = "/System/Library/Fonts/Supplemental/Arial.ttf"


def font(path, size, fallback_size=None):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default(size=fallback_size or size)


def plaque(draw, cx, cy, r, fill=BLUE, ring=(255, 255, 255), ring_w=None):
    """The blue plaque mark: a disc inside a white ring."""
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
    w = ring_w or int(r * 0.075)
    inset = int(r * 0.11)
    draw.ellipse([cx - r + inset, cy - r + inset, cx + r - inset, cy + r - inset],
                 outline=ring, width=w)


def plaque_count():
    """Read the count off the dataset — never type it into the card by hand."""
    with open(DATA, encoding="utf-8") as fh:
        return len(json.load(fh)["features"])


def main():
    img = Image.new("RGB", (W * SS, H * SS), IVORY)
    d = ImageDraw.Draw(img)

    # Scattered markers, as if the card sat on the map itself.
    for x, y, r, c in [(0.82, 0.17, 9, BLUE_SOFT), (0.93, 0.42, 6, BLUE_SOFT),
                       (0.72, 0.78, 7, BLUE_SOFT), (0.88, 0.86, 11, GOLD),
                       (0.63, 0.12, 5, BLUE_SOFT), (0.97, 0.68, 8, BLUE_SOFT)]:
        d.ellipse([(x * W - r) * SS, (y * H - r) * SS,
                   (x * W + r) * SS, (y * H + r) * SS], fill=c)

    # Hero plaque, bleeding off the right edge.
    plaque(d, int(0.845 * W * SS), int(0.50 * H * SS), int(150 * SS))

    f_title = font(SERIF_BOLD, 78 * SS)
    f_tag = font(SERIF, 34 * SS)
    f_meta = font(SANS, 23 * SS)

    x = 78 * SS
    d.text((x, 196 * SS), "London", font=f_title, fill=INK)
    d.text((x, 286 * SS), "Uncovered", font=f_title, fill=BLUE)
    d.text((x, 402 * SS), "Discover the stories hiding around you.", font=f_tag, fill=INK_SOFT)

    # A small rule, then the factual line that carries the search keywords.
    d.rectangle([x, 470 * SS, (x + 62 * SS), 474 * SS], fill=GOLD)
    d.text((x, 500 * SS), f"{plaque_count():,} English Heritage blue plaques  ·  Interactive map",
           font=f_meta, fill=INK_SOFT)

    plaque(d, x + 15 * SS, 118 * SS, 26 * SS)
    d.text((x + 60 * SS, 100 * SS), "LONDON UNCOVERED", font=font(SANS, 20 * SS), fill=INK_SOFT)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.resize((W, H), Image.LANCZOS).save(OUT, optimize=True)
    print(f"✓  {OUT}  ({os.path.getsize(OUT) // 1024} KB, {W}×{H})")


if __name__ == "__main__":
    main()
