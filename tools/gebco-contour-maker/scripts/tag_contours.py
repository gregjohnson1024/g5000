#!/usr/bin/env python3
"""Tag a GeoJSONSeq contour stream with depth / rank / per-feature minzoom.

Reads newline-delimited GeoJSON features (GeoJSONSeq, as written by
`gdal_contour -f GeoJSONSeq`) on stdin, looks up each feature's signed
contour elevation in the map produced by `gebco_levels.py map`, and writes
augmented features on stdout, one per line.

For each feature it:
  - reads the elevation attribute (default name `elev`),
  - rounds it to the nearest integer to use as the join key,
  - sets properties.depth (positive m) and properties.rank,
  - sets a top-level `tippecanoe` member {"minzoom": N} so tippecanoe drops
    the feature below its rank's minimum zoom.

Streaming and line-oriented, so memory stays bounded no matter how many
features the global contour pass emits. Features whose elevation isn't in the
map (shouldn't happen if -fl matched the config) are dropped with a stderr
warning count at the end.
"""
from __future__ import annotations

import argparse
import json
import sys


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--map", required=True, help="elevation->{depth,rank,minzoom} JSON")
    ap.add_argument("--attr", default="elev", help="gdal_contour elevation attribute name")
    args = ap.parse_args(argv)

    with open(args.map, "r", encoding="utf-8") as fh:
        elev_map: dict[str, dict] = json.load(fh)

    kept = 0
    dropped = 0
    out = sys.stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        feat = json.loads(line)
        props = feat.get("properties") or {}
        raw = props.get(args.attr)
        if raw is None:
            dropped += 1
            continue
        key = str(int(round(float(raw))))
        info = elev_map.get(key)
        if info is None:
            dropped += 1
            continue
        feat["properties"] = {"depth": info["depth"], "rank": info["rank"]}
        feat["tippecanoe"] = {"minzoom": info["minzoom"]}
        out.write(json.dumps(feat, separators=(",", ":")))
        out.write("\n")
        kept += 1

    print(f"tag_contours: kept {kept}, dropped {dropped}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
