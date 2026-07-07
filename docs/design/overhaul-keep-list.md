# G5000 Overhaul Keep-List — hard constraints (the overhaul may NOT regress these)

Every implementer + reviewer on the `ui-overhaul` branch must treat this as law. These are
battle-tested behaviors and marine-correct semantics. If a task appears to require breaking
one, stop and flag it — do not "improve" it away.

## Chart / Map (packages/web/src/components/Map.tsx + layers)

- **Gesture engine untouched:** 500 ms long-press, 8 px tolerance, click-swallow after
  long-press; `e.originalEvent` user-vs-programmatic discrimination; 3° bearing dead-band
  (`wrapBearingDelta`, handles 0/360 seam).
- **`__above-wind__` z-order sentinel:** overlays add with `beforeId`; annotations append
  above. No `moveLayer` fights.
- **Tile-proxy pattern** for every raster (`/api/tiles`, `/api/enc-tiles`, `/api/sat-tiles`,
  `/api/seamark-tiles`): regex-validate z/x/y, disk cache, `x-cache` header, transparent 1×1
  for off-coverage, source `maxzoom` capped at upstream ceiling (MapLibre overzooms).
- **Radar/live raster = ImageSource + `updateImage`, NOT CanvasSource** (CanvasSource never
  re-uploads its texture on plain repaint). See RadarOverlay.tsx.
- **Do NOT gate add\* on `map.isStyleLoaded()`;** add from Map.tsx `onLoad`, retry on
  `styledata`, wrap in try/catch.

## Instruments / safety

- **AIS:** threats float to top; per-vessel mute with CPA-snapshot auto-re-arm; stale-target
  exclusion.
- **Race:** audible schedule + sync-to-gun optimistic snap; guard Reset.
- **Alarms:** silence-based Navico alert clearing.
- **Autopilot defense-in-depth:** env gate → capability gate → confirm → cooldown → ack log.
- **MOB:** hold-with-progress interaction (never a bare key / single click).
- **Demo mode:** explicit "this data is fake" messaging preserved.

## Data / formatting conventions

- **Compact DMM** lat/lon `33 42.232n 66 25.240w` (lowercase hemi glued to minute, no
  symbols) + paste-anything parser.
- **UTC everywhere;** never mix UTC and local on one panel.
- **mono / tabular numerals;** NM scale bar; 3-digit bearings.
- **WindDial port/stbd correct;** stable per-source session colors.
- **Offline-honest empty states** (`—` in a reserved slot, never a fake 0 or a frozen live
  value); `/damping`'s dirty-tracked save; `aria-pressed` / `role=radio` habits.

## IA / layout patterns worth preserving into the new grammar

- Helm CoreStrip + task-tabs IA · anchor card grammar + bottom drawer · wind-diag header
  voice · trips' StatCard + day-grouped feed · `/settings`' status-tinted container idea.

## New invariants the overhaul introduces (also law from the phase they land)

- **One accent:** amber = selected / primary action / own-boat, nothing else.
- **Three themes are token-only:** no component branches on theme; layout never changes with
  light. Night = strict all-red, hue-banned (port/stbd by shape+glyph, not hue).
- **StalenessShroud on every live value;** a frozen number may never impersonate a live one.
- **Canonical ramp law:** every legend derives from its render stops (generalize WindLegend's
  FILL_STOPS) — legend and render cannot drift.
- **Zero-reflow:** AlarmLane pre-reserved; conditional slots fixed; nothing muscle-memorized
  moves.
- **System proposes, sailor disposes:** suggestion dots + one-time toast; never auto-navigate
  or auto-switch theme.
- **Ship every phase:** app builds, passes baseline tests, is Pi-deployable at each phase end.
