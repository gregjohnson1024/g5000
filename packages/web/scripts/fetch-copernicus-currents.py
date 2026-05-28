#!/usr/bin/env python3
"""
Fetch a daily-mean surface-current slice from Copernicus Marine (CMEMS)
and emit a JSON grid for the g5000 chart overlay.

Authentication is handled by the `copernicusmarine` client's credentials
file (~/.copernicusmarine/.copernicusmarine-credentials), populated by
`copernicusmarine login --username ... --password ...`.

Dataset: cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m
  - Global Ocean Physics Analysis & Forecast — currents
  - Daily mean, 1/12° resolution, surface depth (0.494 m)
  - Variables: uo (eastward), vo (northward), both m/s

Usage:
    fetch-copernicus-currents.py <latMin> <latMax> <lonMin> <lonMax> <YYYY-MM-DD>

Output (stdout): JSON in the shape the routing planner's current loader expects:
    {
      "lats":    [...],                  # ascending
      "lons":    [...],                  # ascending
      "u":       [[lat0lon0, ...], ...], # m/s, [lat][lon]
      "v":       [[lat0lon0, ...], ...],
      "runAt":   <unix seconds>,         # midnight UTC of the requested day
      "validAt": <unix seconds>          # same
    }

Errors go to stderr; exit non-zero on failure.
"""

import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xarray as xr

DATASET_ID = "cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m"


def main() -> int:
    if len(sys.argv) != 6:
        print(
            "usage: fetch-copernicus-currents.py "
            "<latMin> <latMax> <lonMin> <lonMax> <YYYY-MM-DD>",
            file=sys.stderr,
        )
        return 2
    lat_min, lat_max, lon_min, lon_max = (float(x) for x in sys.argv[1:5])
    date_str = sys.argv[5]
    try:
        day = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError as e:
        print(f"bad date '{date_str}': {e}", file=sys.stderr)
        return 2

    # Import the client lazily so a missing-module error has a clear message.
    try:
        import copernicusmarine
    except ImportError as e:
        print(
            f"copernicusmarine not installed: {e}\n"
            "Install with: pip install --user copernicusmarine",
            file=sys.stderr,
        )
        return 4

    # copernicusmarine.subset returns the path of a downloaded NetCDF file
    # OR (with --return-content-only) a Dataset directly. We use the file
    # path so xarray can open lazily.
    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = Path(tmpdir) / "cmems_currents.nc"
        try:
            copernicusmarine.subset(
                dataset_id=DATASET_ID,
                variables=["uo", "vo"],
                minimum_longitude=lon_min,
                maximum_longitude=lon_max,
                minimum_latitude=lat_min,
                maximum_latitude=lat_max,
                minimum_depth=0,
                maximum_depth=1.0,
                start_datetime=day.isoformat(),
                end_datetime=day.isoformat(),
                output_directory=str(tmpdir),
                output_filename="cmems_currents.nc",
                overwrite=True,
                disable_progress_bar=True,
            )
        except Exception as e:
            print(f"copernicusmarine.subset failed: {e}", file=sys.stderr)
            return 5

        if not out_path.is_file():
            print(f"expected output file missing: {out_path}", file=sys.stderr)
            return 5

        ds = xr.open_dataset(out_path)

        # CMEMS cmems_mod_glo_phy-cur uses dims (time, depth, latitude, longitude)
        # — singleton time, singleton depth at our request. Squeeze to (lat, lon).
        uo = ds["uo"].squeeze().values
        vo = ds["vo"].squeeze().values
        lats = ds["latitude"].values
        lons = ds["longitude"].values

    # Defensive: lats/lons should be ascending already, but verify.
    if lats[0] > lats[-1]:
        lats = lats[::-1]
        uo = uo[::-1, :]
        vo = vo[::-1, :]
    if lons[0] > lons[-1]:
        lons = lons[::-1]
        uo = uo[:, ::-1]
        vo = vo[:, ::-1]

    uo = np.nan_to_num(uo, nan=0.0)
    vo = np.nan_to_num(vo, nan=0.0)

    unix_day = int(day.timestamp())
    print(json.dumps({
        "lats": lats.tolist(),
        "lons": lons.tolist(),
        "u": uo.tolist(),
        "v": vo.tolist(),
        "runAt": unix_day,
        "validAt": unix_day,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
