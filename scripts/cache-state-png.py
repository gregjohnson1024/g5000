#!/usr/bin/env python3
"""
Render the NOAA ENC cache fill state as a PNG, one grid per zoom level.

Each tile in the seed bbox is drawn as one cell:
  - filled green   = .png present on disk
  - empty outline  = not yet cached

Usage:
  python3 scripts/cache-state-png.py \
      [--cache ~/.g5000-router/enc-cache] \
      [--south 30] [--west -75] [--north 45] [--east -60] \
      [--minz 2] [--maxz 12] \
      [--out /tmp/cache-state.png]

Defaults match scripts/seed-enc-cache.mjs. Requires Pillow (`pip install pillow`).
"""

import argparse
import math
import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.stderr.write("install Pillow: pip3 install --user Pillow\n")
    sys.exit(2)


def lon2tile(lon: float, z: int) -> int:
    return int((lon + 180) / 360 * (1 << z))


def lat2tile(lat: float, z: int) -> int:
    r = math.radians(lat)
    return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * (1 << z))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--cache", default=os.path.expanduser("~/.g5000-router/enc-cache"))
    p.add_argument("--south", type=float, default=30.0)
    p.add_argument("--west", type=float, default=-75.0)
    p.add_argument("--north", type=float, default=45.0)
    p.add_argument("--east", type=float, default=-60.0)
    p.add_argument("--minz", type=int, default=2)
    p.add_argument("--maxz", type=int, default=12)
    p.add_argument("--out", default="/tmp/cache-state.png")
    return p.parse_args()


def find_font() -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/SFNSMono.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, 14)
            except OSError:
                continue
    return ImageFont.load_default()


def main() -> None:
    args = parse_args()
    cache = Path(args.cache)

    # Pre-compute per-zoom bbox range + on-disk count.
    rows = []
    for z in range(args.minz, args.maxz + 1):
        x0 = lon2tile(args.west, z)
        x1 = lon2tile(args.east, z)
        # tile y grows southward — north has lower y
        y0 = lat2tile(args.north, z)
        y1 = lat2tile(args.south, z)
        nx, ny = x1 - x0 + 1, y1 - y0 + 1
        hits = 0
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                if (cache / str(z) / str(x) / f"{y}.png").is_file():
                    hits += 1
        rows.append(
            {"z": z, "x0": x0, "y0": y0, "nx": nx, "ny": ny, "total": nx * ny, "hits": hits}
        )

    # Choose a per-row scale so small grids stay visible without dwarfing the
    # composite. Target each row to land in a 50..220 px height band.
    for r in rows:
        target_h = 180
        scale = max(1, target_h // max(r["ny"], 1))
        # Clamp so tiny grids (1x1, 2x2) don't render absurdly large.
        scale = min(scale, 16)
        r["scale"] = scale
        r["w"] = r["nx"] * scale
        r["h"] = r["ny"] * scale

    # Composite layout.
    font = find_font()
    label_w = 240
    pad = 16
    row_gap = 24
    max_grid_w = max(r["w"] for r in rows)
    total_h = sum(max(r["h"], 22) for r in rows) + row_gap * (len(rows) - 1) + 2 * pad
    total_w = label_w + max_grid_w + 2 * pad

    img = Image.new("RGB", (total_w, total_h), (15, 23, 42))  # slate-900
    draw = ImageDraw.Draw(img)

    grand_total = sum(r["total"] for r in rows)
    grand_hits = sum(r["hits"] for r in rows)
    title = (
        f"NOAA ENC cache — {grand_hits:,}/{grand_total:,} tiles  "
        f"({100*grand_hits/grand_total:.1f}%)  bbox=[{args.south},{args.west} → {args.north},{args.east}]"
    )
    title_h = 20
    img2 = Image.new("RGB", (total_w, total_h + title_h + pad), (15, 23, 42))
    draw2 = ImageDraw.Draw(img2)
    draw2.text((pad, pad), title, fill=(226, 232, 240), font=font)

    y = title_h + pad
    for r in rows:
        h = max(r["h"], 22)
        # Label
        label = f"z={r['z']:>2}  {r['hits']:>6,}/{r['total']:<6,}  ({100*r['hits']/r['total']:5.1f}%)"
        draw2.text((pad, y + h // 2 - 8), label, fill=(226, 232, 240), font=font)

        # Grid
        gx0 = label_w + pad
        gy0 = y
        scale = r["scale"]
        # Bulk-fill background of grid area so empty cells get a faint frame.
        draw2.rectangle(
            [gx0, gy0, gx0 + r["w"] - 1, gy0 + r["h"] - 1],
            fill=(30, 41, 59),  # slate-800
            outline=(71, 85, 105),  # slate-600
        )
        for dx in range(r["nx"]):
            for dy in range(r["ny"]):
                x = r["x0"] + dx
                yy = r["y0"] + dy
                if (cache / str(r["z"]) / str(x) / f"{yy}.png").is_file():
                    px = gx0 + dx * scale
                    py = gy0 + dy * scale
                    if scale == 1:
                        draw2.point((px, py), fill=(34, 197, 94))  # green-500
                    else:
                        draw2.rectangle(
                            [px, py, px + scale - 1, py + scale - 1],
                            fill=(34, 197, 94),
                        )
        y += h + row_gap

    img2.save(args.out)
    print(f"wrote {args.out} ({img2.width}x{img2.height}, {grand_hits:,}/{grand_total:,} cached)")


if __name__ == "__main__":
    main()
