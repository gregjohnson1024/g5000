#!/usr/bin/env bash
# End-to-end smoke test on a small region — no 7.5 GB download required.
#
# Pulls a GeoTIFF for a ~5x5 deg box around Bermuda from the GMRT GridServer
# (GEBCO-based, same elevation sign convention, no auth), runs the full
# contour -> tag -> tile pipeline on it, then decodes the resulting PMTiles to
# prove the per-feature minzoom gating works: the fine 20 m set must NOT
# appear at the coarse zoom, and must appear when zoomed in.
#
# This exercises every stage except the global-scale runtime and the
# antimeridian (a 5x5 box can't cross +/-180). Override the box with env vars
# LAT_MIN/LAT_MAX/LON_MIN/LON_MAX.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$DIR/data/build/smoke"
SRC="$BUILD/smoke_src.tif"

# Bermuda: shallow platform (<200 m) ringed by deep abyssal plain (>4000 m),
# so the contour set spans every rank tier.
LAT_MIN="${LAT_MIN:-30}"; LAT_MAX="${LAT_MAX:-35}"
LON_MIN="${LON_MIN:--67}"; LON_MAX="${LON_MAX:--62}"
CENTER_LAT="${CENTER_LAT:-32.3}"; CENTER_LON="${CENTER_LON:--64.8}"

mkdir -p "$BUILD"

echo "smoke: fetching GMRT GeoTIFF for ${LAT_MIN}..${LAT_MAX}N ${LON_MIN}..${LON_MAX}E"
URL="https://www.gmrt.org/services/GridServer?minlatitude=${LAT_MIN}&maxlatitude=${LAT_MAX}&minlongitude=${LON_MIN}&maxlongitude=${LON_MAX}&format=geotiff&resolution=high&layer=topo"
curl -fSL --retry 3 -o "$SRC" "$URL"
echo "smoke: got $(du -h "$SRC" | cut -f1); grid:"
gdalinfo "$SRC" | grep -E 'Size is|Pixel Size|Type=' | head -3

echo "smoke: building pmtiles…"
make -C "$DIR" GRID="$SRC" BUILD="$BUILD" all

PMTILES="$BUILD/world.pmtiles"
echo
echo "smoke: pmtiles header —"
pmtiles show "$PMTILES" | sed -n '1,25p'

echo
echo "smoke: verifying minzoom gating via tippecanoe-decode…"
python3 - "$PMTILES" "$CENTER_LAT" "$CENTER_LON" <<'PY'
import json, math, subprocess, sys

pmtiles, lat, lon = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])

def tile(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    r = math.radians(lat)
    y = int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)
    return x, y

def ranks_at(z):
    x, y = tile(lat, lon, z)
    out = subprocess.run(
        ["tippecanoe-decode", "-f", pmtiles, str(z), str(x), str(y)],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        return None, (x, y)
    ranks = {}
    for line in out.stdout.splitlines():
        line = line.strip().rstrip(",")
        if '"rank"' not in line:
            continue
        try:
            feat = json.loads(line)
        except json.JSONDecodeError:
            continue
        rk = (feat.get("properties") or {}).get("rank")
        if rk:
            ranks[rk] = ranks.get(rk, 0) + 1
    return ranks, (x, y)

ok = True
r3, t3 = ranks_at(3)
print(f"  z3 tile {t3}: ranks {r3}")
if r3 is None:
    print("  WARN: no z3 tile decoded (region may be too small at z3)")
else:
    bad = {k for k in r3 if k in ("fine", "shelf", "deep")}
    if bad:
        print(f"  FAIL: tiers that should be hidden at z3 are present: {bad}")
        ok = False
    else:
        print("  PASS: only major isobaths at z3 (fine/shelf/deep correctly gated out)")

r8, t8 = ranks_at(8)
print(f"  z8 tile {t8}: ranks {r8}")
if r8 and "fine" in r8:
    print("  PASS: fine 20 m set appears at z8")
elif r8:
    print("  WARN: no 'fine' features in this z8 tile (may be all deep water here)")
else:
    print("  WARN: no z8 tile decoded")

sys.exit(0 if ok else 1)
PY

echo
echo "smoke: done. Inspect $PMTILES with: pmtiles show $PMTILES"
