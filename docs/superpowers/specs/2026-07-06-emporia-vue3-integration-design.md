# Emporia Vue 3 → g5000 AC-loads Integration — Design

**Date:** 2026-07-06
**Status:** Implemented (sim-verified + live Cognito auth verified 2026-07-06; live per-circuit data pending Vue 3 registration on the account)
**Jira:** GJ-198
**Branch:** `emporia` (off `develop`)

## Intent

Add per-circuit AC-load monitoring to the `/anchor` dashboard by integrating an **Emporia Vue 3**
energy monitor, filling the reserved **AC Loads** + **AC History** drawer slot (as on S/V _Ingenuity_).
This is a **separate data source from the Victron Cerbo** — Victron gives battery/solar/DC and AC
_totals_ (and on Sula the AC totals are null: no vebus inverter), but cannot do per-circuit AC. The
Emporia reads each AC branch circuit directly.

The g5000 side **mirrors the Victron driver pattern** just built: a parallel data source → a
`globalThis` registry singleton → a `GET /api/emporia/*` route → a drawer panel. Phase 1 (this spec)
delivers **both** the live AC Loads view and the historical AC-History view. Hardware arrives today, so
we build now against the documented API + a deterministic simulator and verify on arrival.

## Decisions (locked)

| Decision                  | Choice                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Scope                     | **AC Loads (live per-circuit W) + AC History (kWh over time)** — full Ingenuity parity                                            |
| Client                    | **DIY** — `amazon-cognito-identity-js` (Cognito SRP) + `fetch`; NOT the brand-new `emporia-vue-lib` (v1.0.0, single 2025 release) |
| Placement                 | New **"AC" drawer tab** on `/anchor` (Loads + History sub-views); an AC-loads total line on the Systems top-zone panel            |
| Off-hardware build        | **`EMPORIA_SIM` mode** — synthetic devices/circuits/history so the UI builds + demos before the hardware/account exist            |
| Leg (L1/L2/240V) grouping | **User-configured** (channel→leg map in ConfigStore) — the API does NOT expose phase; default ungrouped                           |

## Non-goals (this spec)

- **Offline-local (ESPHome) path.** Phase 1 is cloud-only (needs internet; fine at anchor on Starlink).
  The ESPHome-flash local path is a future phase (noted in GJ-198), out of scope here.
- **Writing/controlling anything on the Emporia.** Read-only.
- **Putting per-circuit AC on the RxJS Bus / H-LINK / session log.** AC loads are cloud data, not
  instrument data; keeping them in a dedicated registry + API (like the AIS registry) avoids channel
  explosion. (A single AC-total could be added to the bus later if a consumer needs it.)

## The Emporia cloud API (verified — see the research report)

- **Auth: AWS Cognito SRP** (`USER_SRP_AUTH`). Public pool, no client secret, no MFA:
  - region `us-east-2`, pool `us-east-2_ghlOXVLi1`, app client `4qte47jbstod8apnfic0bunmrq`.
  - `amazon-cognito-identity-js` does SRP natively → `id/access/refresh` tokens. Call the API with the
    **`authtoken: <id_token>`** header (NOT `Authorization: Bearer`). id-token ≈ 1 h; refresh ≈ 30 d.
    **Cache the token** (disk) and refresh only on expiry — never re-auth per poll (Cognito throttles).
- **Base:** `https://api.emporiaenergy.com`.
  - **Devices:** `GET /customers/devices` → `{ customerGid, devices:[{ deviceGid, model, firmware,
channels:[{ channelNum, channelMultiplier, name }] }] }`. Mains = one channel `channelNum="1,2,3"`
    (name "Main"); branch circuits are `"1"`,`"2"`,… ; a synthesized `"Balance"` = mains − monitored.
  - **Live:** `GET /AppAPI?apiMethod=getDeviceListUsages&deviceGids={csv}&instant={iso}&scale=1S&energyUnit=KilowattHours`
    → per-channel `usage` (kWh over the interval; may be null). **Convert to Watts:**
    `W = usage_kWh × (3600 / interval_s) × 1000` → for `1S`, `usage × 3_600_000`; for `1MIN`, `× 60_000`.
    Apply `channelMultiplier` (240V paired CTs). Batch all device GIDs in one call.
  - **History:** `GET /AppAPI?apiMethod=getChartUsage&deviceGid={gid}&channel={num}&start={iso}&end={iso}&scale={1H|1D}&energyUnit=KilowattHours`
    → `{ usageList:[…], firstUsageInstant }` — ordered per-interval kWh from `firstUsageInstant` stepping
    by `scale`. One call per channel.
- **Poll cadence:** live ~15 s (HA uses 60 s; 5–10 s is the safe floor). History is on-demand (not polled).
- **Open item:** confirm the Vue 3's exact `model` string empirically via one `/customers/devices` call
  on arrival (PyEmVue/HA don't hardcode a generation map). Treat `model` as an opaque tag.

## Architecture

### `@g5000/core` — types + registry singleton (`emporia-state.ts`)

Mirrors `victron-state.ts`.

```
interface EmporiaCircuit { channelNum: string; name: string; watts: number | null; multiplier: number; }
interface EmporiaSnapshot {
  connected: boolean;
  updatedAt: number;
  deviceGid: number | null;
  model: string | null;
  circuits: EmporiaCircuit[];   // branch circuits (excl. mains + balance)
  mainsW: number | null;        // the "1,2,3" channel → Watts
  balanceW: number | null;      // synthesized "everything else"
}
interface EmporiaRegistry {
  setSnapshot(s: EmporiaSnapshot): void;
  snapshot(): EmporiaSnapshot;      // offline shell when never set
  setDevices(d: EmporiaDevice[]): void;
  devices(): EmporiaDevice[];       // channel list for the config UI
  markStale(): void;
}
get/setSharedEmporia() on globalThis.__g5000_emporia__
```

### `apps/g5000/src/emporia/` — client + poller + transform + sim

- **`client.ts`** — `EmporiaClient`: `login(email,password)` (Cognito SRP via `amazon-cognito-identity-js`,
  token cached to `~/.g5000-router/emporia-token.json`, `ensureToken()` refreshes on expiry),
  `getDevices()`, `getDeviceListUsages(gids, scale)`, `getChartUsage(gid, channel, start, end, scale)`.
  Thin HTTP over `fetch` with the `authtoken` header. Never throws out of the poller (logs + marks stale).
- **`transform.ts`** — PURE, unit-tested: `usageToWatts(usageKwh, scale, multiplier)`;
  `deriveSnapshot(devicesResp, usagesResp, now)` → `EmporiaSnapshot` (splits mains/balance/branches,
  applies multipliers, kWh→W). No I/O.
- **`sim.ts`** — deterministic synthetic devices + circuits + live Watts (day-varying) + history, driving
  the same registry. Selected by `EMPORIA_SIM=1` (or `DEMO_MODE=1`).
- **`poller.ts` / `index.ts`** — `startEmporia()`: if `EMPORIA_EMAIL`/`EMPORIA_PASSWORD` set → login +
  poll `getDeviceListUsages` every `EMPORIA_POLL_S` (default 15) → `deriveSnapshot` → registry; refresh
  devices list hourly. Else if sim → sim. Else registry stays empty ("Emporia not configured"). Creates
  the shared registry. Wired into `apps/g5000/src/index.ts` (after the Victron block). Never blocks boot.
- **`createEmporiaRegistry()`** — idempotent shared singleton (mirrors the AIS/Victron registry).

### `packages/web` — routes + UI

- **`GET /api/emporia/state`** — the live snapshot (or `{connected:false, offline:true}`).
- **`GET /api/emporia/devices`** — channel list (for the config UI: names, multipliers).
- **`GET /api/emporia/history?gid=&channel=&scale=&start=&end=`** — server proxies `getChartUsage`
  (so the browser doesn't hold Emporia creds), memory-cached briefly; returns the kWh series.
- **AC drawer tab** (`packages/web/src/app/anchor/tabs/AcLoadsTab.tsx`) with two sub-views:
  - **Loads:** per-circuit live bars (name + W + bar scaled to the biggest), a total, and — when the
    user has assigned legs — L1/L2/240V summary cards + grouping (like Ingenuity). "Balance" shown as
    "everything else." Polls `/api/emporia/state` every ~2 s (the server holds the fresh 15 s data).
  - **History:** DAY/WEEK/MONTH toggle; fetches `/api/emporia/history` per visible channel (`scale=1H`
    for day, `1D` for week/month), renders per-bucket stacked bars + top consumers + total kWh, like
    Ingenuity's AC History. SVG, no chart lib.
  - A **Config** affordance (or a `/settings` section): assign each channel a leg (`L1`/`L2`/`240V`/none)
    and optionally hide channels. Stored in ConfigStore.
  - Wired into `drawer.tsx` (`case 'ac'`) + the tab bar; the drawer already threads what it needs.
- **Systems panel** (top zone) gains an **"AC loads"** total line from `/api/emporia/state`.

### Persistence (ConfigStore)

`emporiaConfig` (the `(id, value JSON)` table pattern): `{ legAssignments: Record<channelNum,'L1'|'L2'|'240V'>, hiddenChannels: string[] }`. Edited from the AC-tab config / `/settings`.

### Config / env

`EMPORIA_EMAIL`, `EMPORIA_PASSWORD` (Pi env, secured drop-in — like the Victron creds; stored in
`~/.rbr-secrets.env`, never committed). `EMPORIA_SIM=1`, `EMPORIA_POLL_S=15` (optional).

## Units

Watts for live loads; kWh for history; amps/volts only if a circuit exposes them (Emporia gives energy,
not per-circuit V/A — so no A/V columns unless derived). Times UTC on the history axis. Metric elsewhere.

## Error handling & degradation

- **Not configured** (no email/password, no sim): `/api/emporia/state` → offline shell; the AC tab shows
  "Emporia not configured."
- **Offline / cloud unreachable:** the poller's fetch fails → `registry.markStale()` → tab shows
  "no connection — last known" with the last snapshot's timestamp. History needs internet; cache the
  last successful series and show it stale.
- **Auth failure** (bad creds / SRP error): logged once; registry stays offline; never crashes boot.
- **Null `usage`** (device hasn't reported): that circuit shows "—", not 0.

## Testing

- **Unit-tested pure fns:** `usageToWatts` (1S/1MIN conversion + multiplier), `deriveSnapshot`
  (mains/balance/branch split, kWh→W, null handling), history-series parsing, leg-grouping math.
- **Simulator determinism:** a fixed seed/time → stable snapshot + history (snapshot-testable).
- **Not unit-tested (visual):** the bars, stacked-history SVG, config UI — manual review vs the
  Ingenuity screenshots + the live device on arrival.
- **`amazon-cognito-identity-js`** is a new dep in `apps/g5000` — confirm it isn't pulled into the web
  bundle (it runs only in the app poller).

## Build order (for the plan)

1. `@g5000/core` emporia types + registry singleton.
2. `transform.ts` (usageToWatts + deriveSnapshot) + tests — PURE, TDD.
3. `EmporiaClient` (Cognito SRP + endpoints) + token cache; add `amazon-cognito-identity-js` dep.
4. `sim.ts` + `poller.ts`/`index.ts`; wire into boot (env gates); `createEmporiaRegistry`.
5. `GET /api/emporia/{state,devices,history}` routes.
6. AC drawer tab — Loads sub-view (bars + total + leg grouping); Systems-panel AC line.
7. AC History sub-view (DAY/WEEK/MONTH, stacked bars, top consumers).
8. `emporiaConfig` in ConfigStore + config UI (leg assignment / hide).
9. Docs (CLAUDE.md env gates) + full build/test; deploy; **live verification on hardware arrival**
   (confirm the `model` string, channel names/multipliers, and the kWh→W conversion against real draw).

## Open follow-ups (not blocking)

- ESPHome-local offline path (GJ-198 phase 2) for at-sea AC monitoring with no cloud.
- If a consumer wants it, publish a single `electrical.ac.loads.total` bus channel.
- Per-circuit A/V if a future need justifies deriving them.
