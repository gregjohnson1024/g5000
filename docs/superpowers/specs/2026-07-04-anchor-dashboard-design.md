# At-Anchor Dashboard (`/anchor`) + Victron Cerbo Integration — Design

**Date:** 2026-07-04
**Status:** Implemented (sim-verified; live Cerbo verification pending a powered boat)
**Branch:** `anchor-dashboard` (off `develop`)

## Intent

A single-screen "at anchor" dashboard, inspired by the S/V _Ingenuity_ Cerbo dashboard.
When Sula is on the hook, one page should answer: where's the anchor and am I dragging,
what's the wind doing (with gusts), who's nearby, how deep, what's the tide, what's the
weather/sky ahead, and **what's the boat's power/systems state** (battery, solar, tanks,
temperatures). It is a **monitoring** page, not a helm/tactical page.

The layout is faithful to Ingenuity: a fixed **top zone** of panels plus a **slide-up drawer**
of sub-tabs at the bottom. The visual theme is g5000's existing dark chartplotter theme (not
Ingenuity's parchment day-mode). Interaction is mouse/click-driven (the Pi chart is a mouse UI —
no swipe gestures).

This spec now covers **two subsystems**: (A) the dashboard UI, and (B) a new **Victron Venus OS
(Cerbo) MQTT driver** that feeds the power/systems panels. Sula has a Cerbo on the network
(`192.168.1.129` Wi-Fi / `192.168.60.181` wired), so this data is real — but g5000 has no Victron
integration today, and the boat is currently on the hard, so the driver is built against a
deterministic **simulator** with live verification deferred to a boat-powered session.

## Decisions (locked)

| Decision             | Choice                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Home                 | New top-level **Anchor** navbar tab → dedicated `/anchor` page                                                 |
| Theme                | g5000 dark theme; Ingenuity-faithful _layout_ (top zone + slide-up drawer)                                     |
| Units                | Metric display (m, °C); wind in **knots**; lat/lon compact DMM; storage stays SI                               |
| General weather      | **Open-Meteo** (free, keyless) → Today & Now + Forecast Graph + Table                                          |
| Weather radar        | **Windy** weather-radar embed as an optional, online-only sub-tab                                              |
| Systems              | **Victron Cerbo included** — MQTT driver → battery, solar, DC/AC totals, tanks, temperatures, generator        |
| Victron transport    | **MQTT over TCP 1883** to the Cerbo's local FlashMQ broker (Node connects directly; no websocket)              |
| Off-boat development | **Deterministic Victron simulator** (env-gated), so the dashboard is fully buildable/demoable without the boat |

## Non-goals (this spec)

- **Emporia Vue 2 per-circuit AC monitoring.** Sula has no Emporia. Ingenuity's _AC Loads_ /
  _AC History_ sub-tabs (per-circuit L1/L2 breakdown + kWh history) are out of scope. The Cerbo
  **does** give AC in/out **totals** (via the vebus/system service), which the Systems panel shows;
  the per-circuit breakdown is what's excluded.
- **Writing to the Cerbo** (generator start, hot-water control). The driver is **read-only** for
  v1. Victron MQTT supports `W/` writes, but control is a later, safety-reviewed feature.
- **VRM cloud API / Modbus-TCP.** We use the local MQTT broker only. VRM (cloud) and Modbus
  (register maps) are alternatives we deliberately don't take.
- **No new autopilot / helm control surfaces.** Read-only dashboard.

## Data source map

| Panel / sub-tab        | Source                                                     | Status                                                                      |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| Depth                  | `nav.depth` (m below transducer)                           | Live. Under-keel/total only if optional offsets set                         |
| Position               | `nav.gps.position` + heading                               | Live                                                                        |
| Nearby Vessels         | `GET /api/ais/targets`                                     | Live; range + age computed client-side                                      |
| Apparent-Wind dial     | `wind.apparent.angle` / `.speed` (+ heading for course-up) | Live                                                                        |
| Gust 10-min / 1-hr     | rolling max over apparent-speed history                    | New (client rolling-max)                                                    |
| Anchor Watch           | `GET/POST /api/alarms/anchor`                              | Live (built in Orca work)                                                   |
| Rode & Scope           | user inputs + `nav.depth` + config                         | New (pure calc + config)                                                    |
| Today & Now (weather)  | Open-Meteo current                                         | New (Open-Meteo)                                                            |
| Today & Now (tide)     | `@g5000/tide` lib                                          | Live (reuse)                                                                |
| **Battery & Power**    | Victron MQTT (`system` + `battery` + `vebus`)              | **New (Cerbo driver)**                                                      |
| **Tanks**              | Victron MQTT (`tank`)                                      | **New (Cerbo driver)**                                                      |
| **Temperatures**       | Victron MQTT (`temperature`)                               | **New (Cerbo driver)**                                                      |
| Forecast Graph / Table | Open-Meteo hourly + daily                                  | New (Open-Meteo)                                                            |
| Tides sub-tab          | `/api/tide/*` + `@g5000/tide`                              | Live (reuse; inherits Admiralty/CHS coverage + `canadianTideCurrents` gate) |
| **Solar sub-tab**      | Victron MQTT (`solarcharger` per-MPPT)                     | **New (Cerbo driver)**                                                      |
| Sky sub-tab            | `suncalc` (offline)                                        | New (offline, keyless)                                                      |
| Radar sub-tab          | Windy embed                                                | New (external iframe, online-only)                                          |

## Architecture — Part A: the dashboard UI

### Page shell — `packages/web/src/app/anchor/page.tsx`

- Client page. Subscribes to live channels via the existing `useSse()` hook (channel `Map`).
- A **top zone** (CSS grid of panels) always visible, and a **drawer** docked at the bottom.
- Drawer state: a bottom tab bar (Forecast · Table · Tides · Radar · Sky · Solar). Clicking a tab
  slides a content panel up over the lower part of the top zone; a chevron collapses it. Selected
  tab persisted in `localStorage` key `anchor:drawer` (`null` = collapsed).
- No full MapLibre `<Map>` on this page — only the Anchor Watch mini plan-view (a small,
  self-contained `<canvas>`/SVG), avoiding the chart-page overlay machinery.

### Panels — `packages/web/src/app/anchor/panels/`

Each panel is a small, independently-understandable card:

1. **`DepthPanel`** — `nav.depth`. With `depthOffsets` config set, also shows _total depth_ =
   sounder + transducer-below-waterline and _under keel_ = sounder − keel-below-transducer.
   Unset → single raw number labeled `DEPTH`.
2. **`PositionPanel`** — DMM lat/lon + heading.
3. **`NearbyVesselsPanel`** — polls `/api/ais/targets`; haversine range from own fix, age from
   `lastSeenMs`; sorts nearest-first; fades > 60 s. Reuses `aisDetailRows()` where useful.
4. **`WindDial`** — reusable course-up apparent-wind dial (SVG): AWA badge, big AWS (kts),
   port/stbd label, compass ring rotated so heading is up, gust 10-min / 1-hr footers. Extracted
   general enough to reuse on `/helm` later.
5. **`AnchorWatchPanel`** — reuses `/api/alarms/anchor`. Mini plan-view (boat in drag circle,
   anchor marker, rode line) from the same geometry as `AnchorWatchLayer`. Distance/bearing
   computed client-side. Drop/Set/Clear controls. Embeds **`RodeScopeCalc`**:
   `rode = chainCounter − droopDeduct`, `totalPlusBow = depth + bowHeight`, `scope = rode / totalPlusBow`.
   Chain-counter = per-anchoring `localStorage`; `bowHeight`/`droopDeduct` = ConfigStore constants.
6. **`TodayNowPanel`** — Open-Meteo current (temp, condition, precip %, wind) + tide-now
   (`interpolateHeight`) + next HW/LW.
7. **`SystemsPanel`** — **live from the Victron driver** via `GET /api/victron/state`:
   battery SoC/voltage/current/power (charge/discharge), solar total W, AC in/out totals, DC power,
   time-to-go, generator state. Renders a "Cerbo offline" state when the registry is empty
   (driver not connected). Tanks + Temperatures are sibling cards fed from the same state.

### Drawer sub-tabs — `packages/web/src/app/anchor/tabs/`

1. **`ForecastGraphTab`** — Open-Meteo meteogram (temp, precip, cloud, wind + direction, day/night
   bands from `suncalc`).
2. **`ForecastTableTab`** — Open-Meteo hourly heatmap (temp, wind, gusts, dir, cloud, precip prob,
   humidity, UV, pressure).
3. **`TidesTab`** — reuse the `/tide` curve + current-height + next-events + station picker.
4. **`RadarTab`** — Windy weather-radar iframe when online; graceful "no connection" offline.
5. **`SkyTab`** — `suncalc`: sun rise/set, civil/nautical/astro twilight, day length, moon phase +
   upcoming phases.
6. **`SolarTab`** — **Victron per-MPPT** charger cards (V/I/P, state, day-max, yield-today) + a
   system-total curve, from the Victron state. (AC Loads / AC History remain out of scope — Emporia.)

### New server routes (web)

- **`GET /api/weather/current`**, **`GET /api/weather/forecast`** — call Open-Meteo server-side
  (avoids CORS, centralizes caching), keyed by live fix or a pinned anchorage. Memory + disk cache
  under `~/.g5000-router/weather-cache`, short TTLs (~15 min current, ~1 h forecast); serve last
  cached payload when upstream is unreachable. Thin dashboard-shaped DTOs, not raw Open-Meteo.
- **`GET /api/victron/state`** — returns the `VictronRegistry` snapshot (see Part B). `503`/empty
  body shape when the driver isn't connected so the UI can show "Cerbo offline".

### New client libs (`packages/web/src/lib/`)

- **`sky.ts`** — pure `computeSky(lat, lon, date)` over `suncalc`. Offline. Unit-tested.
- **`gust.ts`** — pure `rollingMax(samples, windowMs, now)` + `useGust(channel, windowMs)` over
  `useChannelHistory`.
- **`rode-scope.ts`** — pure `computeScope({ chainCounter, droopDeduct, depth, bowHeight })`.
- **`nearby-vessels.ts`** — pure `rankVessels(targets, ownFix, now)`.

## Architecture — Part B: the Victron Cerbo MQTT driver

New driver in `@g5000/bridge` under `packages/bridge/src/victron/`, a **parallel data source** to
NGT-1/YDWG (not N2K): it reads the Cerbo's MQTT broker and publishes to the same `Bus` + a registry.

### `victron-mqtt-driver.ts`

- Connects to `mqtt://<host>:1883` using the `mqtt` npm package (Node TCP client — no websocket).
- **Portal-ID discovery:** on connect, subscribe `N/+/system/0/Serial`; the first message's topic
  segment yields the portal ID; cache it.
- **Keepalive:** publish `R/<portalId>/keepalive` (empty) once to force a full republish, then every
  **30 s** publish `R/<portalId>/keepalive` with `{"keepalive-options":["suppress-republish"]}`.
  Without this FlashMQ stops publishing after ~60 s. (Scheduled via a timer; fake-timer tested.)
- **Subscribe:** `N/<portalId>/#`; filter in code to the services we care about (`system`,
  `battery`, `solarcharger`, `tank`, `temperature`, `vebus`, `generator`).
- **Resilience:** reconnect with capped backoff; on disconnect the registry is marked stale/empty
  and the UI shows "Cerbo offline". Self-healing in the spirit of the radar discover/capabilities
  retry. Never blocks boot.

### `victron-topics.ts` (pure parser — unit-tested)

- `parseTopic(topic)` → `{ service, instance, path } | null`.
- `applyMessage(state, topic, payloadJson)` → new `VictronState`; payloads are `{"value": …}`
  (number | string | null). Ignores non-`N/` topics.
- `deriveSnapshot(state)` → the curated `VictronSnapshot` the UI consumes:
  - `battery: { soc, voltage, current, power, temperatureC }`
  - `solar: { totalPower, chargers: [{ id, name, power, voltage, current, state, yieldTodayKwh, dayMaxPower }] }`
  - `dc: { power }`, `ac: { inputPower, outputPower, consumptionPower }`
  - `tanks: [{ id, fluidType, level, capacityL }]`
  - `temperatures: [{ id, name, celsius }]`
  - `generator: { state, runtimeH }`
  - `updatedAt`
    Preference: use `system/0/*` aggregates for headline battery/PV/consumption; per-device services
    for detail (per-MPPT, per-tank, per-temperature).

### `VictronRegistry` + channels

- `VictronRegistry` (types in `@g5000/core`, singleton on `globalThis.__g5000_victron__`, mirroring
  the AIS-targets registry) holds the latest `VictronSnapshot`. Exposed via `GET /api/victron/state`.
- Headline scalars also published to the `Bus` (so H-LINK, the session logger, and any subscriber
  get them, and they're replayable):
  - `electrical.battery.soc`, `electrical.battery.current`, `electrical.battery.power`
  - `electrical.dc.power`, `electrical.ac.input.power`, `electrical.ac.output.power`
  - `electrical.solar.power`
    (Existing `electrical.battery.voltage` stays.) Added to `packages/core/src/channels.ts`.

### `victron-sim.ts` — off-boat development

- A deterministic simulator producing realistic, slowly-varying values (SoC that ramps with a
  solar day-curve, per-MPPT curves, tank levels, temperatures, AC/DC loads). Drives the same
  registry + channels, so the whole dashboard builds and demos with no boat.
- Selected via env (below) or under `DEMO_MODE`.
- A second, smaller **recorded-fixture** replay (a captured set of `N/…` messages) backs the
  parser/driver unit tests.

### Wiring — `apps/g5000/src/index.ts`

- If `VICTRON_MQTT_HOST` is set (and not `none`), start `VictronMqttDriver`. Off by default.
- If `VICTRON_SIM=1` (or `DEMO_MODE`), start `VictronSimSource` instead.
- Either way, register the `VictronRegistry` singleton and publish headline channels. Failure to
  reach the Cerbo must never block boot or trip the systemd watchdog.

### Env-var gates (add to CLAUDE.md)

- `VICTRON_MQTT_HOST` — Cerbo broker host (e.g. `192.168.1.129`); unset/`none` = driver off.
- `VICTRON_MQTT_PORT=1883` (default).
- `VICTRON_SIM=1` — run the simulator instead of the live driver (also implied by `DEMO_MODE`).
- `VICTRON_PORTAL_ID` — optional override; normally auto-discovered.

## Persistence (ConfigStore additions)

A single `anchorDashboard` config blob (`(id, value JSON)` table pattern):

```
anchorDashboard: {
  bowHeightM?: number,
  droopDeductM?: number,
  depthOffsets?: { transducerToWaterlineM?: number, keelBelowTransducerM?: number },
  weatherPin?: { lat: number, lon: number } | null,   // null = follow live fix
}
```

Edited from a small `/settings` section. Chain-counter (rode currently out) is per-anchoring
`localStorage`. The Victron host/port live in env, not ConfigStore (deployment config, like NGT1/YDWG).

## Units

- Depth / anchor radius / rode / scope: **metres**. Temperature: **°C**. Wind/gusts: **knots**
  (convert from m/s at render). Victron powers in **W**, energy in **kWh**, voltages **V**,
  currents **A**. Lat/lon: compact DMM. Storage/channels stay SI.

## Error handling & degradation

- **Cerbo unreachable / on the hard:** driver retries with backoff; `/api/victron/state` returns
  the "offline" shape; Systems/Solar/Tanks/Temps panels show "Cerbo offline". No boot impact.
- **Offline internet:** Open-Meteo panels show last cached payload with a staleness note; Windy
  radar shows "no connection"; instrument-fed panels (depth, wind, AIS, anchor) and the Cerbo
  panels (local LAN) are unaffected.
- **No GPS fix:** range/bearing/nearby distances → `—`; anchor watch shows stored anchor position;
  weather follows `weatherPin` if set.
- **Stale AIS** (> 60 s): faded; dropped > 5 min (existing registry).
- **Anchor not armed:** panel shows "drop here" instead of a live watch.

## Testing

- **Unit-tested pure fns:** `victron-topics` (parseTopic / applyMessage / deriveSnapshot against a
  recorded fixture), keepalive scheduling (fake timers), portal-ID discovery, `computeSky`,
  gust `rollingMax`, `computeScope`, `rankVessels`, Open-Meteo DTO parsing, depth-offset math.
- **Simulator determinism:** `victron-sim` produces a stable sequence for a fixed seed/time input
  so a snapshot test is meaningful.
- **Not unit-tested (visual):** dial SVG, drawer slide, meteogram/table, mini plan-view, Solar
  curves — manual review against the screenshots.
- Baseline: the known-environmental failures in CLAUDE.md remain the accepted red baseline; any
  other failure is a regression.
- **`mqtt` is a new runtime dependency** — add to `@g5000/bridge`. Confirm it's in
  `serverExternalPackages` if Next ever imports bridge types that pull it (it shouldn't; the driver
  runs only in `apps/g5000`).

## Build order (for the plan)

1. **Victron core:** `victron-topics` parser + types + tests (fixture-driven); `VictronRegistry`
   in `@g5000/core`; new channels in `channels.ts`.
2. **Victron driver + sim:** `victron-mqtt-driver` (discovery, keepalive, subscribe, resilience) +
   `victron-sim`; wire into `apps/g5000` with env gates; `GET /api/victron/state`.
3. **Page shell** + navbar tab + drawer mechanism (empty panels).
4. **Pure UI libs** + tests (`sky`, `gust`, `rode-scope`, `nearby-vessels`, depth-offset).
5. **Instrument panels** (Depth, Position, NearbyVessels, WindDial+gust, AnchorWatch+RodeScope).
6. **Open-Meteo** routes + cache; TodayNow + ForecastGraph + ForecastTable.
7. **Systems / Tanks / Temperatures panels + Solar sub-tab** (Victron state).
8. **Tides** tab (reuse), **Sky** tab (suncalc), **Radar** tab (Windy embed).
9. **ConfigStore `anchorDashboard`** blob + `/settings` section.
10. Wire-up review against the screenshots (with the simulator); deploy; **live Cerbo verification
    is a boat-powered follow-up.**

## Open follow-ups (not blocking)

- **Live Cerbo verification** once the boat is powered: confirm portal-ID discovery, topic paths,
  and units against the real broker; refine `deriveSnapshot` mappings if Sula's service/instance
  layout differs from the assumed one.
- Read/write control (generator start, hot water) — a later, safety-reviewed feature.
- Durable server-side gust stats (mirror `sog-stats.ts`) if client rolling-max proves lossy.
- Emporia per-circuit AC Loads / History if that hardware is ever added.
