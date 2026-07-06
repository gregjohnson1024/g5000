# Emporia Vue 3 AC-loads Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-circuit AC monitoring to `/anchor` from an Emporia Vue 3 — a Cognito-SRP cloud client + poller → registry → `GET /api/emporia/*` → a new "AC" drawer tab with live **Loads** and historical **AC History** sub-views, plus a leg-assignment config. Sim-first so it's fully verifiable before the hardware/account exist.

**Architecture:** Mirrors the just-shipped Victron driver: `EmporiaSnapshot`/`EmporiaRegistry` types + `globalThis` singleton in `@g5000/core`; an app-side client (SRP via `amazon-cognito-identity-js`) + poller + deterministic simulator in `apps/g5000/src/emporia/`; `GET /api/emporia/{state,devices,history}` routes; and an `AcLoadsTab` in the `/anchor` drawer. Emporia data stays in its own registry + API (not the RxJS Bus) like the AIS registry.

**Tech Stack:** TypeScript (ESM strict), Node ≥22, npm workspaces, Next.js 16 web, Vitest (`pool: 'forks'`), `amazon-cognito-identity-js` (new, app-only).

## Global Constraints

- **ESM `.js` import extensions** in `packages/{core}` and `apps/g5000`; **extensionless** in `packages/web`.
- **Prettier:** 100 cols, single quotes, trailing commas all, 2-space.
- **Emporia API (verified — spec §"The Emporia cloud API"):** Cognito region `us-east-2`, pool `us-east-2_ghlOXVLi1`, app client `4qte47jbstod8apnfic0bunmrq` (no secret, SRP `USER_SRP_AUTH`). Base `https://api.emporiaenergy.com`; auth header **`authtoken: <id_token>`** (NOT `Bearer`). Endpoints: `GET /customers/devices`; `GET /AppAPI?apiMethod=getDeviceListUsages&deviceGids={csv}&instant={iso}&scale=1S&energyUnit=KilowattHours`; `GET /AppAPI?apiMethod=getChartUsage&deviceGid={gid}&channel={num}&start={iso}&end={iso}&scale={1H|1D}&energyUnit=KilowattHours`. Mains channel = `"1,2,3"`; a synthesized `"Balance"`. **Usage is kWh-per-interval → Watts = `usage × (3600/scaleSeconds) × 1000 × channelMultiplier`** (1S ⇒ ×3,600,000). `usage` may be null.
- **Poll cadence** live default 15 s (`EMPORIA_POLL_S`); cache the token, refresh only on expiry.
- **Read-only.** Never blocks boot (a mis-configured/offline Emporia must not affect the app).
- **Emporia data does NOT go on the RxJS Bus / H-LINK / session log** — dedicated registry + API only.
- **Config** (`emporiaConfig`) lives in the existing file-based app-settings blob via `GET/PUT /api/settings` (same as `anchorDashboard`) — MERGE, don't clobber other keys.
- **Test baseline:** the known-environmental failures in CLAUDE.md + the 6 pre-existing tile-proxy `*.char.test.ts` are the accepted red baseline; any _other_ new failure is a regression.
- **`npm run typecheck` does NOT cover `packages/web` `.tsx`** — run `npm run build --workspace @g5000/web` for web changes.
- Spec: `docs/superpowers/specs/2026-07-06-emporia-vue3-integration-design.md`.

## File Structure

- `packages/core/src/emporia-state.ts` — types + `get/setSharedEmporia` (+ `get/setSharedEmporiaHistory` provider).
- `apps/g5000/src/emporia/transform.ts` — pure `usageToWatts` + `deriveSnapshot` (+ scale helpers).
- `apps/g5000/src/emporia/client.ts` — `EmporiaClient` (SRP auth + token cache + 3 endpoints).
- `apps/g5000/src/emporia/registry.ts` — `createEmporiaRegistry()`.
- `apps/g5000/src/emporia/sim.ts` — deterministic simulator (live + history).
- `apps/g5000/src/emporia/index.ts` — `startEmporia()` (env gates, poller, wiring).
- `apps/g5000/src/index.ts` — call `startEmporia()`.
- `packages/web/src/app/api/emporia/{state,devices,history}/route.ts`.
- `packages/web/src/app/anchor/tabs/AcLoadsTab.tsx` (Loads + History sub-views).
- `packages/web/src/app/anchor/drawer.tsx`, `panels/SystemsPanel.tsx`, `app/settings/page.tsx` — wiring.

---

## Task 1: Emporia types + registry singleton (`@g5000/core`)

**Files:** Create `packages/core/src/emporia-state.ts`; Modify `packages/core/src/index.ts` (add `export * from './emporia-state.js';`).

**Interfaces — Produces:**

```ts
export type EmporiaScale = '1S' | '1MIN' | '15MIN' | '1H' | '1D' | '1W' | '1MON' | '1Y';
export interface EmporiaChannel {
  channelNum: string;
  name: string;
  multiplier: number;
}
export interface EmporiaDevice {
  deviceGid: number;
  model: string;
  firmware: string;
  channels: EmporiaChannel[];
}
export interface EmporiaCircuit {
  channelNum: string;
  name: string;
  watts: number | null;
  multiplier: number;
}
export interface EmporiaSnapshot {
  connected: boolean;
  updatedAt: number;
  deviceGid: number | null;
  model: string | null;
  circuits: EmporiaCircuit[]; // branch circuits (excludes mains + balance)
  mainsW: number | null;
  balanceW: number | null;
}
export interface EmporiaRegistry {
  setSnapshot(s: EmporiaSnapshot): void;
  snapshot(): EmporiaSnapshot;
  setDevices(d: EmporiaDevice[]): void;
  devices(): EmporiaDevice[];
  markStale(): void;
}
/** On-demand history provider (live client or sim), set by startEmporia. */
export type EmporiaHistoryFn = (
  gid: number,
  channel: string,
  scale: EmporiaScale,
  startIso: string,
  endIso: string,
) => Promise<{ firstUsageInstant: string; usageList: Array<number | null> }>;
export function getSharedEmporia(): EmporiaRegistry | undefined;
export function setSharedEmporia(r: EmporiaRegistry): void;
export function getSharedEmporiaHistory(): EmporiaHistoryFn | undefined;
export function setSharedEmporiaHistory(f: EmporiaHistoryFn): void;
```

- [ ] **Step 1: Write the file** (no test — pure types/accessors, mirror `victron-state.ts`).

```ts
// packages/core/src/emporia-state.ts  — types above, plus:
const OFFLINE: EmporiaSnapshot = {
  connected: false,
  updatedAt: 0,
  deviceGid: null,
  model: null,
  circuits: [],
  mainsW: null,
  balanceW: null,
};
declare const globalThis: {
  __g5000_emporia__?: EmporiaRegistry;
  __g5000_emporiaHistory__?: EmporiaHistoryFn;
};
export function getSharedEmporia() {
  return globalThis.__g5000_emporia__;
}
export function setSharedEmporia(r: EmporiaRegistry) {
  globalThis.__g5000_emporia__ = r;
}
export function getSharedEmporiaHistory() {
  return globalThis.__g5000_emporiaHistory__;
}
export function setSharedEmporiaHistory(f: EmporiaHistoryFn) {
  globalThis.__g5000_emporiaHistory__ = f;
}
export const EMPORIA_OFFLINE_SNAPSHOT = OFFLINE;
```

- [ ] **Step 2:** add the `export * from './emporia-state.js';` line to `packages/core/src/index.ts` (after `./victron-state.js`).
- [ ] **Step 3:** `npx tsc -b packages/core` → 0 errors.
- [ ] **Step 4:** `npx prettier --write packages/core/src/emporia-state.ts`; commit `feat(emporia): snapshot/registry types + shared singletons`.

---

## Task 2: Pure transform — usageToWatts + deriveSnapshot (TDD)

**Files:** Create `apps/g5000/src/emporia/transform.ts` + `apps/g5000/src/emporia/transform.test.ts`.

**Interfaces:**

- Consumes: `EmporiaScale`, `EmporiaDevice`, `EmporiaSnapshot`, `EmporiaChannel`, `EmporiaCircuit` from `@g5000/core`.
- Produces:
  - `scaleSeconds(scale: EmporiaScale): number`
  - `usageToWatts(usageKwh: number | null, scale: EmporiaScale, multiplier: number): number | null`
  - `parseDevices(raw: unknown): EmporiaDevice[]` — from `/customers/devices` JSON.
  - `deriveSnapshot(devices: EmporiaDevice[], usagesRaw: unknown, scale: EmporiaScale, now: number): EmporiaSnapshot` — from `getDeviceListUsages` JSON; splits mains (`"1,2,3"`) → `mainsW`, `"Balance"` → `balanceW`, everything else → `circuits[]`, applying `usageToWatts` with each channel's multiplier (from the device list; default 1).

- [ ] **Step 1: Write the failing test**

```ts
// apps/g5000/src/emporia/transform.test.ts
import { describe, it, expect } from 'vitest';
import { scaleSeconds, usageToWatts, parseDevices, deriveSnapshot } from './transform.js';

describe('usageToWatts', () => {
  it('converts 1S kWh to Watts (×3,600,000) with multiplier', () => {
    expect(usageToWatts(0.001, '1S', 1)).toBeCloseTo(3600, 6); // 0.001 kWh/s = 3.6 kW
    expect(usageToWatts(0.001, '1S', 2)).toBeCloseTo(7200, 6);
  });
  it('converts 1MIN kWh to Watts (×60,000)', () => {
    expect(usageToWatts(0.01, '1MIN', 1)).toBeCloseTo(600, 6);
  });
  it('null usage → null', () => {
    expect(usageToWatts(null, '1S', 1)).toBeNull();
  });
  it('scaleSeconds maps the enum', () => {
    expect(scaleSeconds('1S')).toBe(1);
    expect(scaleSeconds('1MIN')).toBe(60);
    expect(scaleSeconds('1H')).toBe(3600);
  });
});

const DEVICES = {
  customerGid: 1,
  devices: [
    {
      deviceGid: 111,
      model: 'VUE003',
      firmware: 'Vue-x',
      channels: [
        { channelNum: '1,2,3', channelMultiplier: 1, name: 'Main' },
        { channelNum: '1', channelMultiplier: 1, name: 'Galley' },
        { channelNum: '2', channelMultiplier: 2, name: 'AC' }, // 240V paired
      ],
    },
  ],
};
const USAGES = {
  deviceListUsages: {
    instant: '2026-07-06T12:00:00Z',
    scale: '1S',
    energyUnit: 'KilowattHours',
    devices: [
      {
        deviceGid: 111,
        channelUsages: [
          { name: 'Main', usage: 0.05, channelNum: '1,2,3', nestedDevices: [] },
          { name: 'Galley', usage: 0.001, channelNum: '1', nestedDevices: [] },
          { name: 'AC', usage: 0.002, channelNum: '2', nestedDevices: [] },
          { name: 'Balance', usage: 0.047, channelNum: 'Balance', nestedDevices: [] },
        ],
      },
    ],
  },
};

describe('parseDevices + deriveSnapshot', () => {
  it('parses the device list into channels with multipliers', () => {
    const d = parseDevices(DEVICES);
    expect(d[0]?.deviceGid).toBe(111);
    expect(d[0]?.channels.find((c) => c.channelNum === '2')?.multiplier).toBe(2);
  });
  it('splits mains/balance/branches and converts to Watts with multipliers', () => {
    const snap = deriveSnapshot(parseDevices(DEVICES), USAGES, '1S', 1000);
    expect(snap.connected).toBe(true);
    expect(snap.deviceGid).toBe(111);
    expect(snap.mainsW).toBeCloseTo(180000, 0); // 0.05 × 3.6e6
    expect(snap.balanceW).toBeCloseTo(169200, 0); // 0.047 × 3.6e6
    const ac = snap.circuits.find((c) => c.channelNum === '2');
    expect(ac?.name).toBe('AC');
    expect(ac?.watts).toBeCloseTo(0.002 * 3_600_000 * 2, 0); // multiplier 2 applied
    expect(snap.circuits.find((c) => c.channelNum === '1,2,3')).toBeUndefined(); // mains excluded
    expect(snap.circuits.find((c) => c.channelNum === 'Balance')).toBeUndefined(); // balance excluded
    expect(snap.updatedAt).toBe(1000);
  });
  it('null usage on a circuit → watts null (not 0)', () => {
    const u = JSON.parse(JSON.stringify(USAGES));
    u.deviceListUsages.devices[0].channelUsages[1].usage = null;
    const snap = deriveSnapshot(parseDevices(DEVICES), u, '1S', 1);
    expect(snap.circuits.find((c) => c.channelNum === '1')?.watts).toBeNull();
  });
});
```

- [ ] **Step 2:** run `npx vitest run apps/g5000/src/emporia/transform.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `transform.ts`**

```ts
import type { EmporiaScale, EmporiaDevice, EmporiaSnapshot, EmporiaCircuit } from '@g5000/core';

const SECONDS: Record<EmporiaScale, number> = {
  '1S': 1,
  '1MIN': 60,
  '15MIN': 900,
  '1H': 3600,
  '1D': 86400,
  '1W': 604800,
  '1MON': 2592000,
  '1Y': 31536000,
};
export function scaleSeconds(scale: EmporiaScale): number {
  return SECONDS[scale];
}

export function usageToWatts(
  usageKwh: number | null,
  scale: EmporiaScale,
  multiplier: number,
): number | null {
  if (usageKwh === null || !Number.isFinite(usageKwh)) return null;
  return usageKwh * (3600 / scaleSeconds(scale)) * 1000 * multiplier;
}

export function parseDevices(raw: unknown): EmporiaDevice[] {
  const r = raw as {
    devices?: Array<{
      deviceGid: number;
      model?: string;
      firmware?: string;
      channels?: Array<{ channelNum: string; channelMultiplier?: number; name?: string }>;
    }>;
  };
  return (r.devices ?? []).map((d) => ({
    deviceGid: d.deviceGid,
    model: d.model ?? '',
    firmware: d.firmware ?? '',
    channels: (d.channels ?? []).map((c) => ({
      channelNum: c.channelNum,
      name: c.name ?? c.channelNum,
      multiplier: typeof c.channelMultiplier === 'number' ? c.channelMultiplier : 1,
    })),
  }));
}

export function deriveSnapshot(
  devices: EmporiaDevice[],
  usagesRaw: unknown,
  scale: EmporiaScale,
  now: number,
): EmporiaSnapshot {
  const usages = usagesRaw as {
    deviceListUsages?: {
      devices?: Array<{
        deviceGid: number;
        channelUsages?: Array<{ name?: string; usage: number | null; channelNum: string }>;
      }>;
    };
  };
  const dev = usages.deviceListUsages?.devices?.[0];
  if (!dev) {
    return {
      connected: true,
      updatedAt: now,
      deviceGid: null,
      model: null,
      circuits: [],
      mainsW: null,
      balanceW: null,
    };
  }
  const meta = devices.find((d) => d.deviceGid === dev.deviceGid);
  const multOf = (channelNum: string): number =>
    meta?.channels.find((c) => c.channelNum === channelNum)?.multiplier ?? 1;
  const nameOf = (channelNum: string, fallback: string): string =>
    meta?.channels.find((c) => c.channelNum === channelNum)?.name?.trim() || fallback;

  let mainsW: number | null = null;
  let balanceW: number | null = null;
  const circuits: EmporiaCircuit[] = [];
  for (const cu of dev.channelUsages ?? []) {
    const mult = multOf(cu.channelNum);
    const watts = usageToWatts(cu.usage, scale, mult);
    if (cu.channelNum === '1,2,3') {
      mainsW = watts;
      continue;
    }
    if (cu.channelNum === 'Balance') {
      balanceW = watts;
      continue;
    }
    circuits.push({
      channelNum: cu.channelNum,
      name: nameOf(cu.channelNum, cu.name ?? cu.channelNum),
      watts,
      multiplier: mult,
    });
  }
  return {
    connected: true,
    updatedAt: now,
    deviceGid: dev.deviceGid,
    model: meta?.model ?? null,
    circuits,
    mainsW,
    balanceW,
  };
}
```

- [ ] **Step 4:** run the test → PASS. `npx tsc -b apps/g5000` → 0 errors. Prettier.
- [ ] **Step 5:** commit `feat(emporia): pure transform (kWh→W, device/usage parsing)`.

---

## Task 3: EmporiaClient — Cognito SRP + token cache + endpoints

**Files:** Create `apps/g5000/src/emporia/client.ts`; Modify `apps/g5000/package.json` (add `"amazon-cognito-identity-js": "^6"`), then `npm install`.

**Interfaces — Produces:**

```ts
export interface EmporiaClient {
  getDevices(): Promise<unknown>; // raw /customers/devices JSON
  getDeviceListUsages(gids: number[], scale: EmporiaScale): Promise<unknown>;
  getChartUsage(
    gid: number,
    channel: string,
    scale: EmporiaScale,
    startIso: string,
    endIso: string,
  ): Promise<{ firstUsageInstant: string; usageList: Array<number | null> }>;
}
export function createEmporiaClient(
  email: string,
  password: string,
  tokenCachePath?: string,
): EmporiaClient;
export function buildUsagesUrl(gids: number[], scale: EmporiaScale, instantIso: string): string; // pure, tested
export function buildChartUrl(
  gid: number,
  channel: string,
  scale: EmporiaScale,
  startIso: string,
  endIso: string,
): string; // pure, tested
```

**Design (implement to these — spec §API is authoritative):**

- `POOL = new CognitoUserPool({ UserPoolId: 'us-east-2_ghlOXVLi1', ClientId: '4qte47jbstod8apnfic0bunmrq' })`.
- `ensureToken()`: if a cached id-token exists and is not within 60 s of `exp`, reuse it; else refresh via `CognitoUser.refreshSession(refreshToken, cb)`; if that fails, full `authenticateUser` SRP with email+password. Persist `{ idToken, refreshToken, expMs }` to `tokenCachePath` (default `~/.g5000-router/emporia-token.json`), best-effort.
- All API calls: `fetch(url, { headers: { authtoken: idToken } })`; on `401`, force a refresh once and retry.
- Base `https://api.emporiaenergy.com`. `getDeviceListUsages` uses `instant = new Date().toISOString()` and `energyUnit=KilowattHours`.

- [ ] **Step 1: Add dep** — `cd apps/g5000 && npm install amazon-cognito-identity-js@^6 && cd ../..`.
- [ ] **Step 2: TDD the pure URL builders** — write `client.test.ts` asserting `buildUsagesUrl([111,112],'1S','2026-07-06T12:00:00Z')` and `buildChartUrl(111,'1','1H','A','B')` produce the exact query strings from the spec (apiMethod, deviceGids CSV / deviceGid+channel, scale, energyUnit, instant/start/end). Run → FAIL → implement the builders → PASS.
- [ ] **Step 3: Implement `createEmporiaClient`** per the Design. Keep the SRP/token logic in this file; the HTTP methods call the builders + `fetch`.
- [ ] **Step 4: Node-compat smoke (de-risk the SDK):** add a tiny script or test that `createEmporiaClient('x@x','bad')` can be constructed and that calling `getDevices()` REJECTS with an auth/network error — NOT a `ReferenceError: navigator is not defined` or import crash. `amazon-cognito-identity-js` must load + initiate SRP under Node 22. If it needs a global shim (e.g. `globalThis.fetch`, or a `navigator`), add the minimal shim at the top of `client.ts` and note it. (Real login is verified on hardware arrival — a password must exist on the Emporia account; Google-OAuth-only accounts have none.)
- [ ] **Step 5:** `npx tsc -b apps/g5000` → 0; the URL-builder tests pass. Prettier. Commit `feat(emporia): Cognito-SRP client + token cache + endpoint URLs` (include package.json + lockfile).

---

## Task 4: Registry + sim + poller + boot wiring + shared history provider

**Files:** Create `apps/g5000/src/emporia/registry.ts`, `sim.ts`, `index.ts`; Modify `apps/g5000/src/index.ts`.

**Interfaces:**

- Produces: `createEmporiaRegistry(): EmporiaRegistry` (idempotent shared singleton, mirror `createVictronRegistry`); `simSnapshotAt(tSec): { devices, usages }` (pure, deterministic — NO `Date.now`/`Math.random`); `startEmporia(): () => void`.

- [ ] **Step 1: `registry.ts`** — mirror `apps/g5000`'s Victron registry: get-existing-or-create, holds `snapshot` (default `EMPORIA_OFFLINE_SNAPSHOT`) + `devices`, `markStale()` sets `connected=false`; `setSharedEmporia`.
- [ ] **Step 2: `sim.ts` (TDD)** — `simSnapshotAt(tSec)` returns a deterministic `{ devices, usages }` in the SAME raw shapes the client returns (so `parseDevices`/`deriveSnapshot` consume them unchanged): ~6 circuits (e.g. "Galley", "AC", "Watermaker", "Outlets", "Starlink", one 240V with multiplier 2), a "1,2,3" main and a "Balance", with day-varying kWh derived from `tSec` (Math.sin). Add a sim history fn producing a plausible `usageList`. Test determinism + that `deriveSnapshot(parseDevices(sim.devices), sim.usages, '1S', t)` yields non-null mains + ≥5 circuits.
- [ ] **Step 3: `index.ts` — `startEmporia()`:** create the registry. If `EMPORIA_EMAIL` && `EMPORIA_PASSWORD` → `createEmporiaClient(...)`; fetch devices once (+ hourly), `setInterval` every `EMPORIA_POLL_S` (default 15) → `getDeviceListUsages` → `deriveSnapshot` → `registry.setSnapshot`; on error `registry.markStale()` (never throw). `setSharedEmporiaHistory((gid,ch,scale,s,e)=>client.getChartUsage(...))`. Else if `EMPORIA_SIM==='1' || DEMO_MODE==='1'` → drive the registry from `simSnapshotAt(Date.now()/1000)` on the same interval + `setSharedEmporiaHistory(simHistory)`. Else leave the registry empty. Return a teardown that clears timers. Log one line (`[g5000] emporia … online`), never block boot.
- [ ] **Step 4:** wire into `apps/g5000/src/index.ts` after the Victron block: `const stopEmporia = startEmporia(); teardown.push(async () => stopEmporia());`.
- [ ] **Step 5:** `npx tsc -b packages/core apps/g5000` → 0; sim test passes. Prettier. Commit `feat(emporia): registry + deterministic sim + poller wired into boot`.

---

## Task 5: API routes — /api/emporia/{state,devices,history}

**Files:** Create the three `packages/web/src/app/api/emporia/*/route.ts`.

- [ ] **Step 1: `state/route.ts`** — `runtime='nodejs'`, `dynamic='force-dynamic'`; `const r = getSharedEmporia(); return Response.json(r ? r.snapshot() : { connected:false, offline:true });`
- [ ] **Step 2: `devices/route.ts`** — returns `{ devices: getSharedEmporia()?.devices() ?? [] }`.
- [ ] **Step 3: `history/route.ts`** — read `gid, channel, scale, start, end` from query; validate (`scale` ∈ the enum; gid numeric); `const fn = getSharedEmporiaHistory(); if (!fn) return Response.json({offline:true}, {status:200}); const data = await fn(Number(gid), channel, scale, start, end); return Response.json(data);` Wrap in try/catch → `{ error }` 502. Extensionless imports (`@g5000/core`).
- [ ] **Step 4:** `npx tsc --noEmit -p packages/web/tsconfig.json` → 0. Prettier. Commit `feat(emporia): /api/emporia state|devices|history routes`.

---

## Task 6: AC Loads sub-view + drawer tab + Systems line

**Files:** Create `packages/web/src/app/anchor/tabs/AcLoadsTab.tsx`; Modify `drawer.tsx` (+ tab bar, `case 'ac'`), `panels/SystemsPanel.tsx`.

**Behavior (mirror `SolarTab.tsx` + Ingenuity's AC Loads):** `'use client'`. Poll `GET /api/emporia/state` every 2 s (server holds the 15 s-fresh data), cleanup on unmount. When `!connected`/`offline` → "Emporia not configured / offline (last known …)". Else: a header total (mains W), then per-circuit rows — name + W + a bar scaled to the largest circuit — sorted by watts desc; show `balanceW` as an "Everything else" row; nulls show "—". Grouping/L1/L2/240V cards come in Task 8 (default: flat list now). Add an `'ac'` entry to the drawer's `DrawerTab` union + tab bar (label "AC") + `renderTabContent` case. In `SystemsPanel`, add an "AC loads" line that fetches `/api/emporia/state` and shows the mains total (or "—").

- [ ] Implement; `npm run build --workspace @g5000/web` → clean; visual deferred. Commit `feat(anchor): AC Loads tab (live per-circuit) + systems AC line`.

## Task 7: AC History sub-view

**Files:** Modify `AcLoadsTab.tsx` (add a Loads|History toggle + the History view).

**Behavior (mirror Ingenuity's AC History):** a DAY/WEEK/MONTH selector; on select, fetch `/api/emporia/history` for each visible channel (`scale=1H` for day with start=00:00Z..now; `1D` for week/month) using the device list from `/api/emporia/devices`; render per-time-bucket **stacked bars** (one segment per circuit) + a "top consumers" summary + total kWh. UTC axis. Self-contained SVG, no chart lib. Cap concurrent history fetches (≤ ~8) and `log` if capped. Loading/empty/offline states.

- [ ] Implement; `npm run build --workspace @g5000/web` → clean. Commit `feat(anchor): AC History sub-view (kWh, DAY/WEEK/MONTH)`.

## Task 8: emporiaConfig (leg assignment + hide) + grouping

**Files:** Modify `app/settings/page.tsx` (new "Emporia AC" section), `AcLoadsTab.tsx` (consume config).

**Behavior:** store `emporiaConfig = { legAssignments: Record<channelNum,'L1'|'L2'|'240V'>, hiddenChannels: string[] }` in the file-based settings blob (`GET/PUT /api/settings`, MERGE-not-clobber — mirror the `anchorDashboard` section). The settings section lists the channels (from `/api/emporia/devices`) with a leg dropdown + a hide checkbox each. In the Loads view, when leg assignments exist, add L1/L2/240V summary cards (sum of assigned circuits' W) above the list and group rows by leg; hide hidden channels. Default (no assignments) = flat list (unchanged).

- [ ] Implement; verify merge preserves other settings keys; `npm run build --workspace @g5000/web` → clean. Commit `feat(anchor): Emporia leg-assignment config + L1/L2/240V grouping`.

## Task 9: Docs + full gate

**Files:** Modify `CLAUDE.md` (env gates: `EMPORIA_EMAIL`, `EMPORIA_PASSWORD`, `EMPORIA_SIM=1`, `EMPORIA_POLL_S=15`; a line in the `/anchor` section that AC Loads/History come from the Emporia Vue 3 via its cloud API, sim under `EMPORIA_SIM`). Modify the spec Status → "Implemented (sim-verified; live Emporia pending account password + hardware)".

- [ ] Run `npm run typecheck`, `npm run build`, `npm test` (expect baseline only + new emporia tests green; name any non-baseline failure), `npm run lint` (run `npm run format` if it fails). Fix any real failure. Commit `docs(emporia): env gates + /anchor docs; mark spec implemented`.
- [ ] Manual wire-up review of `/anchor` AC tab against the Ingenuity screenshots with `EMPORIA_SIM=1`.

---

## Self-Review

**Spec coverage:** core types+registry (T1); transform kWh→W + split (T2); SRP client + endpoints + token cache (T3); registry+sim+poller+boot+history-provider (T4); 3 API routes (T5); AC Loads tab + systems line (T6); AC History (T7); leg config + grouping (T8); docs+gate (T9). Offline/degradation → registry markStale + route offline shells (T4/T5/T6). Read-only, not-on-bus, never-block-boot → T4. ✅

**Placeholder scan:** logic tasks (1–5) carry full test/impl code; UI tasks (6–8) specify data source, behavior, the pattern to mirror (SolarTab / Ingenuity screenshots), and acceptance. The Cognito Node-compat check (T3 step 4) is a named de-risk, not a gap.

**Type consistency:** `EmporiaSnapshot`/`EmporiaCircuit`/`EmporiaDevice`/`EmporiaRegistry`/`EmporiaScale`/`EmporiaHistoryFn` defined in T1, consumed unchanged in T2–T7; `deriveSnapshot(devices, usagesRaw, scale, now)` + `usageToWatts(usageKwh, scale, multiplier)` signatures stable across tasks.

## Execution Handoff

Per project convention (user global CLAUDE.md), proceed directly with **superpowers:subagent-driven-development** — no inline-vs-subagent prompt.
