# Ship-time clock — boat-wide UTC ↔ local display

**Status:** implemented 2026-07-09 (branch `ui-overhaul`).

## Problem

All UI times were UTC ('z' suffix, the house convention). Two per-page toggles
(chart route dock `chart:tz`, voyage passage `passage:tz`) offered "Local", but
"local" meant the **viewing device's OS timezone** — wrong on the Pi (whose OS
runs UTC), different per device, and the source of a React #418 hydration text
mismatch on every /chart load (server-rendered "local" text ≠ browser "local"
text). Greg asked for a proper setting: switch the whole app between UTC and
local, with the UTC offset suggested by GPS and manually overridable.

## Design

One boat-wide **ClockConfig**, synced to every connected browser exactly like
the theme:

```ts
type ClockMode = 'utc' | 'ship';
interface ClockConfig {
  mode: ClockMode;
  offsetMin: number | null; // minutes east of UTC; null = auto from GPS
}
```

- **UTC mode** — unchanged historic behaviour, 'z'/'Z' suffix everywhere.
- **Ship mode** — every wall-clock render becomes UTC + `offsetMin`, suffixed
  `±H` or `±H:MM` (e.g. `22:16-4`, `21:46+5:30`) so the two modes can never be
  confused on any panel. This is "ship's time" in the traditional sense — an
  offset the skipper chooses, not an IANA zone (no DST tables needed offline).
- **Auto offset** — `offsetMin: null` derives the offset from the GPS
  longitude via nautical zones: `round(lon/15)` hours, clamped ±12. Bristol RI
  (71.1°W) suggests UTC−5; the skipper overrides to −4 to match EDT if wanted.
  No fix → auto degrades to 0 (UTC), never guesses.

### Plumbing (mirrors the theme end-to-end)

| Layer | Change |
| --- | --- |
| `@g5000/mast` types.ts | `ClockMode`/`ClockConfig` + `MastRuntime.clock$`/`getClock()` |
| `@g5000/db` defaults.ts | `DisplayConfig.clock` (+ default `{mode:'utc', offsetMin:null}`; old rows merge with defaults at load) |
| `apps/g5000` MastService | `clock$`/`getClock()` mapped off `displayConfig$` |
| `POST/GET /api/mast/clock` | validate + persist (offset must be a 30-min step in [−720, 840] or null) |
| `/api/mast/stream` | `clock` SSE event (initial + on change) |
| `lib/theme-store.tsx` | `clockCfg` + `setClockCfg` (POSTs) + `receiveClockCfg` (inbound, **never POSTs** — echo-loop guard, see 1d837fe) + localStorage `g5000:clock` |
| `ThemeController` | `clock` SSE listener → `receiveClockCfg` |
| `lib/use-ship-clock.ts` | `useShipClock()` → resolved `ShipClock {mode, offsetMin:number}`; subscribes to `nav.gps.position` **only when auto** (no 1 Hz re-render otherwise) |
| `lib/tz.ts` | rewritten around `ShipClock`: `fmtTimestamp` / `fmtHourLabel` / `fmtClockTime` / `toDatetimeLocalInput` / `parseDatetimeLocalInput` / `fmtClockSuffix` / `suggestedOffsetMin` / `resolveClock`. **No local-time getters anywhere** — shift the instant, read UTC parts (deterministic SSR = client). |
| `/boat/setup` ClockSection | UTC \| Ship time segmented control + offset select (`Auto — GPS suggests −5` + explicit list −12:00…+14:00 in 30-min steps) + live preview; immediate-save |

### Consumers migrated (per-page toggles deleted)

- AppBar clock (NavShell) — `02:16:20z` or `22:16:20-4`; aria-label "Ship clock".
- Chart route dock: `PlanControls` departure picker (+ `≡ …Z` mirror shown only
  in ship mode), `RoutePlanPanel`, `PlaybackScrubber`, `WindTimeline`,
  `RouteLens` run/valid labels + a read-only mode chip (control lives in setup).
- Voyage: passage page tiles (ETA hero shows a `(…Z)` mirror in ship mode),
  `EnginePanel` log form + history table.
- Conditions: model run/next-run/grid tables.
- Logbook: trip rows, day groups, delete-confirm, underway banner, header chip.
- `TzToggle` component deleted; `chart:tz` / `passage:tz` keys retired.

### Hydration fixes folded in

`PlanControls`/`EnginePanel` initialised their datetime anchors with
`Date.now()` during render and formatted them in device-local time — the SSR
text never matched the client (#418 args=text on every /chart load). Both now
seed the anchor in a mount effect and format offset-shifted UTC parts.

## Long-tail sweep (done 2026-07-09, second commit)

All previously-listed hard-UTC render sites migrated to `useShipClock()` +
lib/tz formatters: anchor drawer tabs (Sky/Tides/ForecastTable/ForecastGraph/
AcLoads/TodayNow), conditions tides/currents/windows/models pages, autopilot
ack log, RouteTimeline, RouteWeatherPanel, WindowHeatmap, StationsOverlay
popups, StripChart axes, AnnotationDropper, RecordList — plus sites the
original list missed: boat diag logs + N2K sniffer (were device-local, a
bug), diag sessions page, alerts history table, MOB popup (date + seconds
precision), logbook delete-dialog (showed ship time labeled "UTC"), CMEMS
toast (kept UTC, now labeled). suncalc `getMoonTimes` now passes `inUTC` so
the moon-day window no longer depends on the viewing device's OS timezone.
New shared helpers grew in lib/tz.ts: `fmtShortTime`, `fmtClockTimeMs`,
`toDayKey`, `fmtDayLabel`, `shiftedDate`; `useShipClock` memoizes on the
resolved value so it is referentially stable in dependency lists.
`trip-stats` / `wind-runs` / `hrrr-helpers` / `current-fetch` were audited
and left alone — they compute data-plane values (GRIB runs, bucket keys),
not display text.

## Still not covered (deferred)

- **Server-rendered text**: `/api/boat-status` counts "sessions today" by
  UTC calendar day, and `/api/alarms/push-test` ntfy body renders UTC (both
  labeled). Making server routes clock-aware needs a server-side
  `resolveClock` against ConfigStore + last GPS fix — small design job, not
  a mechanical edit.
- **Unmounted dead code**: `WindowHeatmap` / `RouteTimeline` have no JSX
  consumers (windows page renders `HeatmapGrid`); they were migrated anyway
  so they're correct if remounted.
- Logbook trip rows render shifted time via `fmtParts` without a per-cell
  suffix (the header chip names the mode); delete-dialog now suffixes.
