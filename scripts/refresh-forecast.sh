#!/usr/bin/env bash
# Periodic forecast refresh. Fires from g5000-forecast-refresh.timer on the
# Pi, ~every 3 h. Hits the local autopilot's /api/forecast/refresh with the
# user-configured ROI (Settings → Forecast refresh ROI) and forecast hours
# spanning the next ~2 days. Per-model results: GFS publishes ~4 h after
# run time, ECMWF ~6-9 h, so partial 404s are normal — the endpoint
# returns ok per (model, hour) so a stale ECMWF doesn't poison GFS.
#
# Two guards:
#   1. Skip silently if the autopilot service isn't active (no point firing
#      against a dead localhost:3000).
#   2. ROI is fetched fresh from /api/settings on every run so the user can
#      change the bbox in the UI and have the next tick pick it up.

set -euo pipefail

HOST=${HOST:-http://localhost:3000}
MODELS=${MODELS:-'["gfs","ecmwf"]'}

# Hard-coded 3-h cadence out to 168 h (7 days). Native resolutions:
#   - GFS 0.25°: 1 h to +120 h, then 3 h to +384 h.
#   - ECMWF IFS 0p25: 3 h to +144 h, then 6 h to +240 h.
# Sampling at 3 h keeps both happy and matches the timer cadence so each
# wall-clock tick is the same density. 57 snapshots × ~50 KB Range fetch ≈
# 3 MB per model per tick.
HOURS=$(seq 0 3 168 | tr '\n' ',' | sed 's/,$//')
HOURS="[$HOURS]"

# Default bbox: covers a generous North-Atlantic operating area. Used only
# if Settings has no forecastBbox yet.
DEFAULT_BBOX='{"latMin":25,"latMax":45,"lonMin":-80,"lonMax":-55}'

# Guard 1 — only run if the autopilot is alive.
if ! systemctl is-active --quiet g5000-autopilot.service; then
  echo "[refresh-forecast] g5000-autopilot.service not active — skipping"
  exit 0
fi

# Guard 2 — read ROI from /api/settings; fall back to the default.
settings_json=$(curl -sS "${HOST}/api/settings" -m 5 || true)
bbox=$(printf '%s' "$settings_json" \
  | python3 -c '
import json, sys
try:
  d = json.load(sys.stdin)
  b = (d.get("settings") or {}).get("forecastBbox")
  if (
    isinstance(b, dict)
    and all(isinstance(b.get(k), (int, float)) for k in ("latMin","latMax","lonMin","lonMax"))
    and b["latMin"] < b["latMax"]
    and b["lonMin"] < b["lonMax"]
  ):
    print(json.dumps(b))
except Exception:
  pass
' 2>/dev/null)
if [[ -z "${bbox}" ]]; then
  bbox="$DEFAULT_BBOX"
  echo "[refresh-forecast] no ROI in settings — using default: $bbox"
else
  echo "[refresh-forecast] ROI from settings: $bbox"
fi

payload=$(printf '{"bbox":%s,"models":%s,"hours":%s}' "$bbox" "$MODELS" "$HOURS")

echo "[refresh-forecast] POST ${HOST}/api/forecast/refresh"
curl -sS -X POST "${HOST}/api/forecast/refresh" \
  -H 'Content-Type: application/json' \
  -d "$payload" \
  -m 300
echo
