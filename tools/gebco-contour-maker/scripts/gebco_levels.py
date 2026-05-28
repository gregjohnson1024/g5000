#!/usr/bin/env python3
"""Expand the editable level config into the explicit data the build needs.

Pure standard-library Python (no GDAL, no third-party deps) so it can be
unit-tested and run anywhere. Everything the rest of the pipeline needs to
know about *which* contours to draw and *how* to tag them comes from here, so
changing config/levels.json + re-running is the only edit required to retune
the contour set or the zoom strategy.

Vocabulary:
  - depth     : positive metres below sea level (e.g. 200).
  - elevation : signed metres as GEBCO stores them; seabed is negative
                (e.g. -200). gdal_contour works in elevation.
  - rank      : importance tier name (major/deep/shelf/fine).
  - minzoom   : the lowest MapLibre zoom at which a feature should appear,
                derived from its rank. Coarse isobaths get a low minzoom so
                they show when zoomed out; the dense 20 m set gets a high
                minzoom so it only appears when zoomed in.

CLI (used by the Makefile):
  gebco_levels.py fl --grid coarse        -> space-separated signed elevations
  gebco_levels.py fl --grid fine          -> space-separated signed elevations
  gebco_levels.py map                      -> JSON {elevation: {...}} for tagging
  gebco_levels.py summary                  -> human-readable table
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

CONFIG_DEFAULT = Path(__file__).resolve().parent.parent / "config" / "levels.json"


def load_config(path: Path | str = CONFIG_DEFAULT) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def expand_levels(rules: list[dict[str, int]]) -> list[int]:
    """Expand interval rules to a sorted, de-duplicated list of POSITIVE depths.

    Each rule contributes v = fromM + k*stepM for k = 1, 2, ... while v <= toM.
    fromM is therefore exclusive and toM inclusive: {0, 1000, 20} yields
    20, 40, ... 1000. Rules may overlap; the union is de-duplicated.
    """
    out: set[int] = set()
    for rule in rules:
        from_m = int(rule["fromM"])
        to_m = int(rule["toM"])
        step = int(rule["stepM"])
        if step <= 0:
            raise ValueError(f"stepM must be positive, got {step}")
        v = from_m + step
        while v <= to_m:
            out.add(v)
            v += step
    return sorted(out)


def _matches(depth: int, match: Any) -> bool:
    if match == "default":
        return True
    if isinstance(match, dict):
        if "multipleOf" in match:
            n = int(match["multipleOf"])
            return n > 0 and depth % n == 0
        if "anyOf" in match:
            return depth in {int(x) for x in match["anyOf"]}
    raise ValueError(f"unrecognised rank match spec: {match!r}")


def classify(depth: int, ranks: list[dict[str, Any]]) -> tuple[str, int]:
    """Return (rank_name, minzoom) for a depth: first matching rule wins."""
    for rule in ranks:
        if _matches(depth, rule["match"]):
            return str(rule["name"]), int(rule["minzoom"])
    raise ValueError(
        f"no rank matched depth {depth}; the rank list must end with a "
        f'{{"match": "default"}} rule'
    )


def assign(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Full per-level assignment, sorted shallow -> deep.

    Each entry: {depth, elevation, rank, minzoom, grid} where grid is
    'coarse' or 'fine' depending on the build's coarseForMinzoomLE threshold.
    """
    depths = expand_levels(config["levels"])
    ranks = config["ranks"]
    coarse_le = int(config["build"]["coarseForMinzoomLE"])
    rows: list[dict[str, Any]] = []
    for d in depths:
        name, minzoom = classify(d, ranks)
        rows.append(
            {
                "depth": d,
                "elevation": -d,
                "rank": name,
                "minzoom": minzoom,
                "grid": "coarse" if minzoom <= coarse_le else "fine",
            }
        )
    return rows


def signed_elevations(config: dict[str, Any], grid: str | None = None) -> list[int]:
    """Signed elevations for gdal_contour -fl, optionally limited to one grid."""
    rows = assign(config)
    if grid is not None:
        rows = [r for r in rows if r["grid"] == grid]
    return [r["elevation"] for r in rows]


def elevation_map(config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Map keyed by string elevation -> {depth, rank, minzoom} for tagging.

    Keyed by the integer elevation rendered as a string because gdal_contour
    writes the contour value as a number that we read back as the join key.
    """
    return {
        str(r["elevation"]): {
            "depth": r["depth"],
            "rank": r["rank"],
            "minzoom": r["minzoom"],
        }
        for r in assign(config)
    }


def get_path(config: dict[str, Any], dotted: str) -> Any:
    """Resolve a dotted config path, e.g. 'build.maxzoom'."""
    node: Any = config
    for part in dotted.split("."):
        node = node[part]
    return node


def _main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("command", choices=["fl", "map", "summary", "levels", "get"])
    ap.add_argument("path", nargs="?", help="dotted config path for `get`")
    ap.add_argument("--grid", choices=["coarse", "fine"], default=None)
    ap.add_argument("--config", default=str(CONFIG_DEFAULT))
    args = ap.parse_args(argv)
    config = load_config(args.config)

    if args.command == "get":
        if not args.path:
            ap.error("`get` requires a dotted path, e.g. build.maxzoom")
        print(get_path(config, args.path))
    elif args.command == "fl":
        # gdal_contour -fl requires strictly increasing levels, so sort the
        # signed elevations ascending (deepest/most-negative first).
        elevs = sorted(signed_elevations(config, args.grid))
        print(" ".join(str(e) for e in elevs))
    elif args.command == "levels":
        print(" ".join(str(d) for d in expand_levels(config["levels"])))
    elif args.command == "map":
        json.dump(elevation_map(config), sys.stdout)
        print()
    elif args.command == "summary":
        rows = assign(config)
        by_rank: dict[str, list[int]] = {}
        for r in rows:
            by_rank.setdefault(f"{r['rank']} (minzoom {r['minzoom']})", []).append(r["depth"])
        print(f"{len(rows)} contour levels:")
        for label, depths in sorted(by_rank.items(), key=lambda kv: kv[1][0]):
            grid = next(r["grid"] for r in rows if r["depth"] == depths[0])
            head = ", ".join(str(d) for d in depths[:8])
            more = f" … (+{len(depths) - 8} more)" if len(depths) > 8 else ""
            print(f"  {label:24s} [{grid:6s}] {len(depths):3d}: {head}{more} m")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
