# Safety Alarms — Design

**Date:** 2026-05-18
**Status:** Approved (brainstorming complete; ready for implementation plan)
**Scope:** A centralized, predicate-driven alarm system for safety-critical conditions that g5000 itself can detect from Bus channels (anchor drift, MOB, shallow water, over-speed, low battery). Separate from the existing N2K-derived `AlertsRegistry`; unified in the UI.

## 1. Context & goal

G5000's only alarm surface today is the N2K-derived `AlertsRegistry` in `packages/core/src/alerts.ts` — alerts decoded from PGN 126983 / 126985 that the H5000 or another N2K device transmits. It does not handle conditions that g5000 itself observes (the boat drifting outside an anchor radius, depth-below-keel falling under a threshold, etc.).

For offshore single-handing, the highest-value missing feature is a small set of g5000-derived alarms with a credible alarm-center UX: a persistent root-level banner, an audible tone on the helm, an `/alerts` page consolidating active + history, and per-alarm enable/disable + threshold controls.

Goal: ship the framework + 5 alarms (anchor watch, MOB, shallow water, over-speed, low battery), persistent across restarts, with an N2K-/g5000-unified `/alerts` page.

Two alarms deliberately deferred (see §6): off-course (XTE) and arrival (DTW) require an "active plan tracker" compute pipeline that does not exist yet.

## 2. Existing state

- **`AlertsRegistry`** (`packages/core/src/alerts.ts`): N2K-only. Composite key `src|system|subSystem|id|occurrence`. Tracks PGN 126983 / 126985 lifecycle (Normal → Active → Acknowledged → ...). Has paired `setSharedAlerts` / `getSharedAlerts` globalThis-singleton accessors. Acknowledgement transmits PGN 126984.
- **`Bus`** (`packages/core/src/bus.ts`): RxJS-backed pub/sub. Pattern matching supports `wind.*`, `nav.**`. Subscribers can register exact, wildcard, or trailing-wildcard patterns.
- **`Channels`** (`packages/core/src/channels.ts`): canonical names. Existing relevant channels for v1: `nav.gps.position`, `nav.gps.sog`, `nav.depth`. **Missing for v1**: `electrical.battery.voltage` (requires adding to channels.ts + bridging from PGN 127508).
- **`ConfigStore`** (`packages/db/src/schema.ts`): every config table is `(id, value JSON)`. Existing tables include `boat_config`, `damping_config`, `ais_alarm_config`, `passage_log`. New tables here follow the same pattern.
- **`/api/alerts`** + **`/api/alerts/acknowledge`**: exist for N2K alerts. The unified `/alerts` page will need an extended endpoint that returns both N2K alerts and g5000 alarms.
- **No XTE/DTW publisher exists.** No "active plan tracker" pipeline subscribes to the active plan + current position to compute cross-track and distance-to-waypoint continuously. Confirmed via repo-wide grep.
- **No "active plan" concept exists.** `/api/plans` stores plan documents but no notion of "this is the one I'm sailing right now."

## 3. Files manifest

### Create

| File | Purpose |
|---|---|
| `packages/core/src/alarms.ts` | `AlarmsRegistry` interface + `AlarmSnapshot` type + `setSharedAlarms` / `getSharedAlarms` accessors. Distinct from `alerts.ts`; g5000-derived alarms only. |
| `packages/core/src/alarms.test.ts` | Unit tests for `AlarmsRegistry` impl: fire + auto-clear, sticky behaviour, ack lifecycle, dedupe by id. |
| `packages/compute/src/alarms/index.ts` | `startAlarmsPipeline(bus, registry, config)` — boots all predicates, returns subscription disposer. |
| `packages/compute/src/alarms/anchor-watch.ts` | Anchor-watch predicate: subscribes to `nav.gps.position`; if armed, fires when `haversine(pos, anchor) > radius`. |
| `packages/compute/src/alarms/shallow-water.ts` | Shallow-water predicate: subscribes to `nav.depth`; fires when `depth < threshold`. `nav.depth` semantics on this boat are whatever the channel-mapper produces from PGN 128267 (typically below-transducer); the user configures `thresholdM` to match their preferred safety margin against that reference. The plan should verify the actual semantics during implementation. |
| `packages/compute/src/alarms/over-speed.ts` | Over-speed predicate: subscribes to `nav.gps.sog`; fires when `sog > threshold`. |
| `packages/compute/src/alarms/low-battery.ts` | Low-battery predicate: subscribes to `electrical.battery.voltage`; fires when `volts < threshold`. |
| `packages/compute/src/alarms/anchor-watch.test.ts` | Per-predicate unit tests, fixture samples → assert fire/clear transitions. |
| `packages/compute/src/alarms/shallow-water.test.ts` | Same shape. |
| `packages/compute/src/alarms/over-speed.test.ts` | Same shape. |
| `packages/compute/src/alarms/low-battery.test.ts` | Same shape. |
| `packages/db/src/alarms-config.ts` | `AlarmsConfig` type + `loadAlarmsConfig` / `saveAlarmsConfig` ConfigStore helpers. |
| `packages/db/src/alarms-history.ts` | `AlarmHistoryRow` type + `appendAlarmHistory` / `listAlarmHistory(limit)` helpers. Uses a real Drizzle table, not the JSON-blob config pattern, because history is row-oriented and needs `ORDER BY fired_at LIMIT`. |
| `packages/web/src/app/alerts/page.tsx` | New `/alerts` page (replaces a 404 today). Tabs: **Active** (merges N2K alerts + g5000 alarms), **History** (alarm-only, last 200), **Settings** (per-alarm enable + threshold). |
| `packages/web/src/app/alerts/active-list.tsx` | Client component: SSE-driven unified active list. |
| `packages/web/src/app/alerts/history-list.tsx` | Client component: paginated history view. |
| `packages/web/src/app/alerts/settings-form.tsx` | Client component: per-alarm config editor. |
| `packages/web/src/app/api/alarms/route.ts` | GET (list active+config) / POST (manual trigger — MOB only) / PATCH (ack). |
| `packages/web/src/app/api/alarms/config/route.ts` | GET / PUT for `AlarmsConfig`. |
| `packages/web/src/app/api/alarms/history/route.ts` | GET, query params `limit` + `before`. |
| `packages/web/src/app/api/alarms/anchor/route.ts` | POST `{action: 'drop'\|'weigh'}` — sets/clears the anchor drop point. Convenience endpoint that just calls into AlarmsConfig. |
| `packages/web/src/components/alarm-banner.tsx` | Client component: SSE subscriber; renders highest-severity unacked alarm; mounts in root layout. |
| `packages/web/src/components/audible-alarm.tsx` | Client component: Web Audio API beep loop. Mounted only by `/helm/layout.tsx`. Persistent mute toggle in localStorage with visible indicator. |
| `packages/web/src/app/helm/mob-button.tsx` | Large red persistent footer button + confirm modal. Keyboard `M` shortcut with confirm. |

### Modify

| File | Change |
|---|---|
| `packages/core/src/channels.ts` | Add `Electrical.BatteryVoltage = 'electrical.battery.voltage'`. |
| Bridge channel-mapper (locate via `grep -r "PGN.*127" packages/bridge/src` during planning) | Add PGN 127508 (DC Battery Status) → `electrical.battery.voltage` mapping. Pick the lowest-instance battery (usually the house bank). Future spec can disambiguate instances. |
| `packages/db/src/schema.ts` | Add `alarms_config` (JSON-blob, same shape as other config tables) AND `alarms_history` (row-oriented: `id`, `alarm_id`, `severity`, `fired_at`, `cleared_at NULL`, `acked_at NULL`, `context JSON`). |
| `apps/autopilot-server/src/index.ts` | After bus + registries are constructed, instantiate `AlarmsRegistry`, register on globalThis, call `startAlarmsPipeline(bus, registry, config)` and stash the disposer. Load config from ConfigStore at boot. |
| `packages/web/src/app/layout.tsx` | Mount `<AlarmBanner />` in the root layout so it appears on every page. |
| `packages/web/src/app/helm/layout.tsx` (or `page.tsx` if no layout) | Mount `<AudibleAlarm />` + add `<MobButton />` to the page chrome. |

### No change

- `packages/core/src/alerts.ts` — N2K alert system untouched. Coexists.
- `/api/alerts` and `/api/alerts/acknowledge` — continue to serve N2K-decoded alerts only. The unified `/alerts` page fetches from both `/api/alerts` and `/api/alarms`.

## 4. Architecture

### Data flow

```
Bus (nav.gps.position, nav.depth, nav.gps.sog, electrical.battery.voltage)
      │
      ▼
AlarmPredicate (one per alarm type, in compute/src/alarms/*)
      │   ← reads enable+threshold from AlarmsConfig
      ▼
AlarmsRegistry  (globalThis singleton, same pattern as AlertsRegistry)
      │
      ├──► appendAlarmHistory()           (writes to alarms_history on fire + on clear + on ack)
      │
      └──► SSE on /api/stream as channel  `alarms.active`
                 │
                 ▼
       <AlarmBanner /> (root layout, all pages)
       <ActiveList /> (/alerts)
       <AudibleAlarm /> (/helm only)

Manual paths:
   MOB button → POST /api/alarms { id: 'mob', action: 'fire' } → AlarmsRegistry.upsert(...)
   Anchor drop → POST /api/alarms/anchor {action: 'drop'} → AlarmsConfig.anchor.point = currentPos
```

### Separation from N2K AlertsRegistry

Two distinct registries:

- **`AlertsRegistry`** (existing) — alerts received from N2K. Keys are N2K identifiers. Lifecycle driven by PGN 126983/126985 state transitions. Ack transmits PGN 126984.
- **`AlarmsRegistry`** (new) — alarms generated by g5000. Keys are stable strings (`mob`, `anchor-watch`, `shallow-water`, `over-speed`, `low-battery`). Lifecycle driven by predicate transitions or manual trigger. Ack is local-only (history row).

The `/alerts` page is the single UI surface; it queries both. Internally the page renders them as different row variants but the user sees one prioritized list.

### Predicate contract

Every predicate exports a single function:

```ts
export function startXxxAlarmPredicate(
  bus: Bus,
  registry: AlarmsRegistry,
  configRef: { current: AlarmsConfig },   // hot-reloaded on PUT /api/alarms/config
): { dispose(): void };
```

The predicate subscribes to relevant Bus channels, on each sample reads `configRef.current[id]` for enable/threshold, debounces via a per-predicate edge-trigger (single emit on rising edge, single emit on falling edge), and calls `registry.upsert(...)` or `registry.clear(id)`.

Debounce strategy: every predicate has a configurable `holdMs` (default 5 s for shallow-water and over-speed; 0 for anchor-watch since position updates are already smoothed; n/a for MOB which is manual). This prevents jitter on noisy channels.

### Severity tiers and stickiness

```ts
type AlarmSeverity = 'CRITICAL' | 'WARN' | 'INFO';

interface AlarmDef {
  id: string;
  severity: AlarmSeverity;
  /** If true, stays in active list even when predicate clears; only manual ack removes it. */
  sticky: boolean;
  /** Render label for the UI. */
  label: string;
}
```

V1 definitions:

| id | severity | sticky | label |
|---|---|---|---|
| `mob` | CRITICAL | true | Man Overboard |
| `anchor-watch` | CRITICAL | true | Anchor Drift |
| `shallow-water` | CRITICAL | false | Shallow Water |
| `over-speed` | WARN | false | Over Speed |
| `low-battery` | WARN | false | Low Battery |

CRITICAL + sticky means: the only way to remove MOB or Anchor Drift from the active list is an explicit ack — even if the predicate condition reverses (you recover the MOB, you re-anchor in radius), the alarm stays visible until you actively dismiss it. This is intentional: those events demand human attention regardless of whether the technical condition resolved.

### MOB UX detail

- Button location: `/helm` page, persistent red footer. Tall enough to thumb-press from any tilt angle on a phone.
- Keyboard shortcut: `M` key. Confirms via modal ("Confirm MOB?") with a 2-second confirm hold to prevent accidental keystroke triggers.
- On trigger:
  1. Capture `nav.gps.position` at the moment of press → `context: { position }` in the registry entry.
  2. Auto-create a waypoint via `/api/waypoints` named `MOB-<ISO>` at that position.
  3. Fire alarm with `sticky=true` and `severity='CRITICAL'`.
  4. If a page-level router is available, navigate `/chart` to a "chase MOB" view with the MOB waypoint centered + bearing/range tile from current `nav.gps.position`. Implementation: chart-page accepts a `?mob=<waypoint-id>` query param.
- Recovery (manual ack from `/alerts`) clears the alarm but leaves the waypoint and history row.

### Anchor watch UX detail

- "Drop anchor here" button on `/helm` (small, not prominent — anchored boats rarely look at the helm screen).
- On drop: records current `nav.gps.position` + ISO timestamp + radius (default 50 m, configurable in settings) into `AlarmsConfig.anchor`.
- Predicate is gated by `AlarmsConfig.anchor.armed === true`. Drop sets armed=true; "Weigh anchor" button sets armed=false.
- Threshold is per-drop, not global — the radius set at drop time persists with that drop.
- Predicate fires when `haversine(pos, anchor.point) > anchor.radius`. Sticky CRITICAL: even if the boat drifts back inside the radius, the alarm stays until ack (since a drift event indicates dragging — the user should know it happened even if it self-corrected).
- Persisted across restarts: `AlarmsConfig.anchor` lives in ConfigStore. If the autopilot-server restarts while at anchor, the anchor watch resumes automatically at boot.

### Audible alarm UX detail

- Web Audio API tones via a tiny synth (no audio asset files needed):
  - **CRITICAL**: 880 Hz square wave, 200 ms on / 200 ms off, looped
  - **WARN**: 440 Hz sine wave, 500 ms on / 1000 ms off, looped
  - **INFO**: 440 Hz sine wave, single 250 ms chime, not looped
- Mounted only by `/helm/layout.tsx` to avoid duplicate audio when chart + helm are both open on different devices.
- Mute toggle in helm chrome. Persisted to localStorage. **Visible mute indicator** is always rendered while mute is active — a small red mute icon in the helm footer. The intent: a forgotten mute can't silently kill MOB. The indicator is the failsafe.
- Acking the active alarm silences the tone (regardless of mute state).

### Banner UX detail

- Renders in `app/layout.tsx`, so it appears on every page including `/helm`, `/chart`, `/passage`, `/settings`, etc.
- Shows the single highest-severity unacked alarm or alert (CRITICAL > WARN > INFO; ties broken by most-recent fire). If multiple, badge with "+N more".
- Tap to ack inline or to navigate to `/alerts`.
- Reads from a combined SSE channel that fans in both `AlertsRegistry` and `AlarmsRegistry` updates. Implementation: a new SSE topic `alerts-and-alarms` on the existing `/api/stream`, with both registries publishing into it.

### Persistence

Two new tables:

```ts
// alarms_config: JSON-blob style (matches existing config tables)
{
  enabled: { [alarmId: string]: boolean },   // per-alarm master enable
  thresholds: {
    anchor: { armed: boolean; point?: {lat, lon}; droppedAt?: ISO; radiusM: number },
    shallowWater: { thresholdM: number; holdMs: number },
    overSpeed: { thresholdKn: number; holdMs: number },
    lowBattery: { thresholdV: number; holdMs: number },
  }
}

// alarms_history: row-oriented Drizzle table
{
  id INTEGER PK AUTOINCREMENT,
  alarm_id TEXT NOT NULL,         -- 'mob' | 'anchor-watch' | ...
  severity TEXT NOT NULL,
  fired_at TEXT NOT NULL,         -- ISO
  cleared_at TEXT,                -- ISO, null if still active
  acked_at TEXT,                  -- ISO, null if unacked
  context TEXT                    -- JSON: e.g. { position, depth, sog }
}
```

`alarms_history` is row-oriented because the UI needs `ORDER BY fired_at DESC LIMIT 200` — the JSON-blob pattern doesn't index. This is a deliberate departure from the dominant config-table pattern documented in CLAUDE.md.

### Restart behaviour

On autopilot-server boot:
1. Load `alarms_config` from ConfigStore.
2. Construct `AlarmsRegistry` (empty active set).
3. Start each predicate. Anchor predicate sees `armed=true` from the loaded config and resumes watching.
4. No active alarms are restored — a hard restart implies the human is paying attention. Active history rows with `cleared_at=NULL` from before the restart are left in that state for forensic value; the `/alerts` history view still shows them.

## 5. Test strategy

- **Unit (per-predicate):** fixture stream of Bus samples → assert sequence of `registry.upsert/clear` calls. Edge cases: threshold-crossing on the holdMs boundary, position jitter inside anchor radius, null-depth handling (depth temporarily unavailable should NOT fire shallow-water; depth must be a positive number to evaluate).
- **Unit (`AlarmsRegistry` impl):** lifecycle transitions, sticky vs non-sticky clear behaviour, ack writes history row, dedupe of repeated upserts.
- **Integration (replay-driven):** a fixture session `.jsonl.gz` containing (a) a depth excursion below threshold, (b) a synthesized GPS track that drifts outside an anchor radius. Boot the autopilot-server in replay mode, assert correct alarms appear in `AlarmsRegistry` and history rows are written.
- **Channel-mapper:** confirm PGN 127508 decodes to `electrical.battery.voltage`. Pre-existing canboatjs fixture or stub.

## 6. Out of scope

Deferred to follow-up specs:

- **Off-course (XTE) and Arrival (DTW) alarms.** Both require an "active plan tracker" compute pipeline that subscribes to the active plan + `nav.gps.position` and publishes `nav.route.xte` / `nav.route.dtw` channels. There's no "active plan" concept today (`/api/plans` stores plans but none is marked active). A follow-up spec should design that pipeline; once those channels exist, adding the two alarms is mechanical.
- **N2K-source alarms** beyond what `AlertsRegistry` already handles (engine PGN-specific alarms, bilge pump, alternator). Cluster C territory.
- **SMS/email push.** No offshore network. Could be added for at-anchor scenarios but not in v1.
- **Custom user-defined alarms** (predicate-authoring UI). Power-user trap; predicates are code-defined in v1.
- **Multi-device propagation.** V1 assumes one helm. Audible mounts only on helm; banner mounts everywhere. If a second device opens `/helm`, both will beep — acceptable for v1.
- **Alarm escalation.** No "you ignored this for 30s, escalate severity" logic. CRITICAL is already as loud as v1 gets.

## 7. Open questions

None — all design decisions resolved during brainstorming. Specifically:

- v1 alarm set: 5 (anchor, MOB, shallow, over-speed, low-battery). Off-course/arrival deferred.
- Battery channel: added in this spec, mapped from PGN 127508, lowest-instance battery selected.
- Audible scope: helm-only with mute indicator failsafe.
- Registry shape: new `AlarmsRegistry`, not extension of `AlertsRegistry`.

## 8. Risks

- **PGN 127508 mapping correctness.** "Lowest-instance battery" may not be the house bank on every boat. If wrong, low-battery alarm watches the wrong source. Mitigation: log the instance picked at boot; user can override in `alarms_config` if needed (post-v1).
- **Web Audio API autoplay policy.** Modern browsers require user gesture before audio can play. The helm page's first user interaction (any click) will need to "warm up" the AudioContext. Without that, the first alarm fires silently. Mitigation: warm AudioContext on first interaction with the helm page; document in CLAUDE.md.
- **Sticky alarm staleness.** A MOB or anchor alarm left unacked for hours adds visual clutter. Acceptable in v1 — better than auto-clearing critical events.
- **History table growth.** Unbounded `alarms_history` could accumulate. Mitigation: list endpoint defaults to `LIMIT 200`; no automatic eviction in v1. Add a vacuum/retention task in a follow-up if it becomes a problem.

## 9. Success criteria

- All 5 alarms fire correctly in unit + replay-integration tests.
- `/alerts` page renders N2K alerts + g5000 alarms in a unified Active list.
- Anchor watch survives an autopilot-server restart and resumes monitoring at the original drop point.
- MOB button captures position within 200 ms of press and creates a waypoint.
- Audible mute is visibly indicated whenever active.
- Per-alarm enable + threshold edits in `/alerts/settings` take effect within one sample without a restart (configRef hot-reload).
