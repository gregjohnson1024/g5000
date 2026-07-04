# At-Anchor Dashboard (`/anchor`) — Design

**Date:** 2026-07-04
**Status:** Design — approved shape, pending spec review
**Branch:** `anchor-dashboard` (off `develop`)

## Intent

A single-screen "at anchor" dashboard, inspired by the S/V _Ingenuity_ Cerbo dashboard.
When Sula is on the hook, one page should answer: where's the anchor and am I dragging,
what's the wind doing (with gusts), who's nearby, how deep, what's the tide, and what's the
weather/sky ahead. It is a **monitoring** page, not a helm/tactical page.

The layout is faithful to Ingenuity: a fixed **top zone** of panels plus a **slide-up drawer**
of sub-tabs at the bottom. The visual theme is g5000's existing dark chartplotter theme (not
Ingenuity's parchment day-mode). Interaction is mouse/click-driven (the Pi chart is a mouse UI —
no swipe gestures).

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Home | New top-level **Anchor** navbar tab → dedicated `/anchor` page |
| Theme | g5000 dark theme; Ingenuity-faithful *layout* (top zone + slide-up drawer) |
| Units | Metric display (m, °C); wind in **knots**; lat/lon compact DMM; storage stays SI |
| General weather | **Add Open-Meteo** (free, keyless) → Today & Now + Forecast Graph + Table |
| Weather radar | **Include** a Windy weather-radar embed as an optional, online-only sub-tab |
| Systems (battery/solar/tanks/temps) | **Deferred** — reserved slots that light up when the Victron Cerbo driver lands as a separate project |

## Non-goals (this spec)

- **Victron Cerbo / Venus OS driver.** Sula has a Cerbo (`192.168.1.129` / `192.168.60.181`),
  but integrating it (battery SoC, solar MPPT, DC/AC, tanks, temperatures) is a separate,
  larger, hardware-in-the-loop project. This spec only reserves the UI slots and a channel-name
  contract so the later driver is a pure producer.
- **Emporia Vue 2 AC-circuit monitoring.** Sula has no Emporia; the AC Loads / AC History
  sub-tabs are out of scope until that hardware exists.
- **No new autopilot / control surfaces.** Read-only dashboard.

## Data source map

Every panel, and where its data comes from:

| Panel / sub-tab | Source | Status |
| --- | --- | --- |
| Depth | `nav.depth` (m below transducer) | Live. Under-keel/total only if optional offsets set |
| Position | `nav.gps.position` + heading | Live |
| Nearby Vessels | `GET /api/ais/targets` | Live; range + age computed client-side |
| Apparent-Wind dial | `wind.apparent.angle` / `.speed` (+ heading for course-up) | Live |
| Gust 10-min / 1-hr | rolling max over apparent-speed history | New (client rolling-max) |
| Anchor Watch | `GET/POST /api/alarms/anchor` | Live (built in Orca work) |
| Rode & Scope | user inputs + `nav.depth` + config | New (pure calc + config) |
| Today & Now (weather) | Open-Meteo current | New (Open-Meteo) |
| Today & Now (tide) | `@g5000/tide` lib | Live (reuse) |
| Systems (battery/solar/tanks/temps) | `electrical.battery.voltage` today; rest reserved | Reserved for Cerbo |
| Forecast Graph / Table | Open-Meteo hourly + daily | New (Open-Meteo) |
| Tides sub-tab | `/api/tide/*` + `@g5000/tide` | Live (reuse; inherits Admiralty/CHS coverage + `canadianTideCurrents` gate) |
| Sky sub-tab | `suncalc` (offline) | New (offline, keyless) |
| Radar sub-tab | Windy embed | New (external iframe, online-only) |

## Architecture

### Page shell — `packages/web/src/app/anchor/page.tsx`

- Client page. Subscribes to live channels via the existing `useSse()` hook (channel `Map`).
- Renders a **top zone** (CSS grid of panels) that is always visible, and a **drawer** docked
  at the bottom.
- Drawer state: a bottom tab bar (Forecast · Table · Tides · Radar · Sky). Clicking a tab slides
  a content panel up over the lower part of the top zone; a chevron collapses it. Selected tab
  persisted in `localStorage` key `anchor:drawer` (`null` = collapsed).
- No MapLibre on this page except the Anchor Watch mini plan-view (small, self-contained
  `<canvas>` or SVG — not a full `<Map>`; avoids the chart-page overlay machinery).

### Panels — isolated units, each in `packages/web/src/app/anchor/panels/`

Each panel is a small, independently-understandable component that takes the SSE channel map (or
its own fetch) and renders one card:

1. **`DepthPanel`** — reads `nav.depth`. If `depthOffsets` config is set, also computes
   *total depth* = sounder + transducer-below-waterline and *under keel* = sounder −
   keel-below-transducer. Unset → single raw number labeled `DEPTH`.
2. **`PositionPanel`** — DMM lat/lon + heading (mag/true per what's on the bus).
3. **`NearbyVesselsPanel`** — polls `/api/ais/targets`, computes haversine range from own fix
   and age from `lastSeenMs`, sorts nearest-first, fades entries > 60 s old. Name/MMSI + range +
   age. (Reuses `aisDetailRows()` where useful.)
4. **`WindDial`** — reusable course-up apparent-wind dial (SVG). AWA badge, big AWS (kts),
   port/stbd label, compass ring rotated so heading is up. Also renders **gust 10-min / 1-hr**
   footers. Extracted general enough to reuse on `/helm` later.
5. **`AnchorWatchPanel`** — reuses `/api/alarms/anchor`. Mini plan-view (boat inside drag circle,
   anchor marker, rode line) drawn from the same geometry as `AnchorWatchLayer`. Distance/bearing
   computed client-side (live fix → `anchorPoint`). Drop/Set/Clear controls. Embeds:
6. **`RodeScopeCalc`** — pure calc: `rode = chainCounter − droopDeduct`,
   `totalPlusBow = depth + bowHeight`, `scope = rode / totalPlusBow`. Chain-counter is a
   per-anchoring input (localStorage); `bowHeight` and `droopDeduct` are boat constants in
   ConfigStore.
7. **`TodayNowPanel`** — Open-Meteo current conditions (temp, condition, precip %, wind) + tide-now
   (`interpolateHeight` on the active station's events) + next HW/LW.
8. **`SystemsPanel` (reserved)** — renders whatever of the reserved `electrical.*` / `tanks.*` /
   `temperature.*` channels exist. Today that's only `electrical.battery.voltage`; the rest show a
   "Victron systems arrive with the Cerbo integration" stub. No redesign needed when the driver lands.

### Drawer sub-tabs — `packages/web/src/app/anchor/tabs/`

1. **`ForecastGraphTab`** — Open-Meteo meteogram: temp line, precip bars, cloud band, wind
   speed + direction, with day/night + sunrise/sunset bands (bands from `suncalc`).
2. **`ForecastTableTab`** — Open-Meteo hourly heatmap table (temp, wind, gusts, dir, cloud, precip
   prob, humidity, UV, pressure).
3. **`TidesTab`** — reuse the `/tide` curve + current-height + next-events + station picker.
4. **`RadarTab`** — Windy weather-radar iframe when online; graceful "no connection" state offline.
5. **`SkyTab`** — `suncalc`: sun rise/set, civil/nautical/astro twilight, day length, moon phase +
   upcoming phases.

### New server routes

- **`GET /api/weather/current`** and **`GET /api/weather/forecast`** —
  `packages/web/src/app/api/weather/*/route.ts`. Call Open-Meteo server-side (avoids CORS,
  centralizes caching), keyed by the current fix (or a pinned anchorage lat/lon). Cache in memory
  + disk under `~/.g5000-router/weather-cache` with short TTLs (~15 min current, ~1 h forecast);
  serve the last cached payload when the upstream is unreachable (offline degradation). Response
  shapes are thin, dashboard-shaped DTOs (not raw Open-Meteo).

### New client lib

- **`packages/web/src/lib/sky.ts`** — pure `computeSky(lat, lon, date)` wrapper over `suncalc`
  returning `{ sunrise, sunset, civil/nautical/astroTwilight, dayLengthMs, moon: { phase, illumination, rise, set } }`.
  Offline, no network. Unit-tested.
- **`packages/web/src/lib/gust.ts`** — pure `rollingMax(samples, windowMs, now)` helper +
  a `useGust(channel, windowMs)` hook layered on `useChannelHistory`.
- **`packages/web/src/lib/rode-scope.ts`** — pure `computeScope({ chainCounter, droopDeduct, depth, bowHeight })`.
- **`packages/web/src/lib/nearby-vessels.ts`** — pure `rankVessels(targets, ownFix, now)` (range,
  age, sort).

### Persistence (ConfigStore additions)

A single `anchorDashboard` config blob (the `(id, value JSON)` table pattern):

```
anchorDashboard: {
  bowHeightM?: number,          // bow-roller height above waterline
  droopDeductM?: number,        // chain-counter droop/catenary deduction
  depthOffsets?: {              // optional; unset → raw sounder depth
    transducerToWaterlineM?: number,
    keelBelowTransducerM?: number,
  },
  weatherPin?: { lat: number, lon: number } | null,  // null = follow live fix
}
```

Edited from a small section on `/settings` (or an inline gear on the panels). Chain-counter
(how much rode is currently out) is per-anchoring UI state in `localStorage`, not config.

### Reserved: Systems data-contract (for the future Cerbo driver)

So the Systems panel and the (future) Solar/AC sub-tabs are stubbed against a stable shape, the
Cerbo driver — when built — should publish these channels (names to be finalized in that spec, but
reserved here):

- `electrical.battery.soc` (%), `electrical.battery.current` (A, signed), `electrical.battery.power` (W)
- `electrical.dc.power` (W), `electrical.ac.output` (W), `electrical.ac.input` (W)
- `electrical.solar.power` (W total) + per-MPPT detail
- `tanks.<name>.level` (fraction) + capacity
- `temperature.<location>` (°C)

The Systems panel renders whichever exist; everything but `electrical.battery.voltage` is absent
today and shows the reserved stub.

## Units

- Depth / anchor radius / rode / scope inputs: **metres** (matches the `/alerts` anchor-radius field).
- Temperature: **°C**.
- Wind speed / gusts: **knots** (convert from m/s at the edge).
- Lat/lon: compact DMM (`33 42.232n 66 25.240w`).
- Internal storage and channels stay SI; conversion happens only at render.

## Error handling & degradation

- **Offline** (no internet): Open-Meteo panels show the last cached payload with a staleness
  note; Windy radar shows a "no connection" state; everything instrument-fed (depth, wind, AIS,
  anchor) is unaffected (local bus). Tides work from cached station events.
- **No GPS fix:** range/bearing/nearby-vessel distances show `—`; anchor watch still shows the
  stored anchor position; weather follows `weatherPin` if set.
- **Stale AIS** (> 60 s): faded; dropped > 5 min (existing registry behavior).
- **Tide gating:** if `canadianTideCurrents` is off and no Admiralty station is in range, the
  Tides tab shows the same empty state as `/tide` (no new behavior).
- **Anchor not armed:** Anchor Watch panel shows the "drop here" affordance instead of a live watch.

## Testing

- **Unit-tested pure fns:** `computeSky`, `rollingMax`/gust, `computeScope`, `rankVessels`,
  Open-Meteo DTO parsing, depth-offset math.
- **Not unit-tested (visual):** the dial SVG, the drawer slide, the meteogram/table rendering,
  the mini plan-view — covered by manual review against the screenshots.
- Baseline: the known-environmental failures in CLAUDE.md (coastline, ConfigStore route tests,
  wgrib2) remain the accepted red baseline; any *other* failure is a regression.

## Build order (for the plan)

1. Page shell + navbar tab + drawer mechanism (empty panels).
2. Pure libs + their tests (`sky`, `gust`, `rode-scope`, `nearby-vessels`, depth-offset).
3. Instrument panels (Depth, Position, NearbyVessels, WindDial+gust, AnchorWatch+RodeScope).
4. Open-Meteo routes + cache; TodayNow + ForecastGraph + ForecastTable.
5. Tides tab (reuse), Sky tab (suncalc), Radar tab (Windy embed).
6. ConfigStore `anchorDashboard` blob + `/settings` section; Systems reserved panel.
7. Wire-up review against the screenshots; deploy.

## Open follow-ups (not blocking)

- Durable server-side gust stats (mirror `sog-stats.ts`) if client rolling-max proves lossy across
  refreshes.
- Weather-pin UX: pick an anchorage vs. follow the live fix (default follow).
- The Cerbo driver spec (separate) finalizes the reserved channel names and the Solar/AC sub-tabs.
