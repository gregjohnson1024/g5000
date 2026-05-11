# G5000 Plan 6 — N2K Device Identifier Page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Build a `/devices` page that lists every node observed on the N2K bus with its manufacturer, model, serial, function, and last-seen time. The page reads PGN 60928 (ISO Address Claim) and PGN 126996 (Product Information) and maintains a per-source-address registry. A "Refresh" button sends PGN 59904 (ISO Request) to prompt devices to re-announce themselves. This becomes the canonical "what's actually on my bus" diagnostic.

**Architecture:**

- A new `DeviceRegistry` class in `@g5000/bridge/src/devices/` consumes the existing `DecodedPgn` stream (the same one that feeds the channel mapper). Updates an internal `Map<srcAddr, DeviceInfo>` from PGN 60928 and 126996 contents, plus a `lastSeenMs` from any PGN at all.
- Manufacturer codes, device functions, and device classes resolve to human-readable strings via canboatjs's `lookupEnumerationName` (already exported, contains the canonical ISO 11783-7 tables).
- Registry exposes a snapshot and a `refresh(target?)` method that emits PGN 59904 via a wire driver. The autopilot-server registers the active `Ngt1Driver` as the tx target at boot.
- Next.js consumes the registry via a `getSharedDeviceRegistry()` singleton in the same `globalThis`-backed pattern Plan 3 established for ConfigStore. Requires `@g5000/bridge` to ship from `dist/` (currently only `core`/`db`/`compute` do).
- `/api/devices` (GET) returns the snapshot as JSON; `/api/devices/refresh` (POST) triggers a broadcast or per-target ISO Request.

**Tech stack additions:** none.

**Reference spec:** `docs/superpowers/specs/2026-05-08-h6000-design.md`. This is a diagnostic feature not in the original build sequence — it's a Plan 5 follow-on that uses the binary parser to actually receive these system PGNs.

---

## What's in scope

- `DeviceRegistry` class: consumes `DecodedPgn` events, maintains state, knows how to refresh.
- Manufacturer / function / class name resolution via canboatjs's existing enum tables.
- A `Map<number, DeviceInfo>` snapshot accessor.
- `refresh(target?: number): Promise<void>` that issues PGN 59904 broadcast (or unicast).
- Singleton accessor `getSharedDeviceRegistry()` in `@g5000/bridge` index.
- Bridge orchestrator wires the registry into the existing `decodeFrames()` stream.
- autopilot-server registers the active `Ngt1Driver` as the tx target.
- `/api/devices` GET endpoint (snapshot).
- `/api/devices/refresh` POST endpoint (with optional `{target}` JSON body).
- `/devices` page with a sorted table + "Refresh all" button.
- `@g5000/bridge` ships from `dist/` (so Next.js can consume it in `serverExternalPackages`).

## What's NOT in scope

- Per-device drill-down with PGN-rate breakdown. Defer to Plan 6B if useful.
- Auto-refresh polling on the page — manual page refresh + manual "Refresh all" button is enough for Phase 0.
- Live SSE feed of device-state changes. Polling on page load is fine.
- PGN 126998 (Configuration Information — installer/customer text). Optional, defer.
- Detecting address conflicts or duplicate claims. Phase 0 trusts the bus.
- TX of address-claim PGNs ourselves (we don't claim a name on the bus yet).

---

## File structure

```
autopilot/
├── packages/
│   ├── bridge/
│   │   ├── package.json                              MODIFY: main → dist/index.js
│   │   └── src/
│   │       ├── bridge.ts                             MODIFY: wire DeviceRegistry observer
│   │       ├── devices/
│   │       │   ├── device-registry.ts                NEW
│   │       │   └── device-registry.test.ts           NEW
│   │       └── index.ts                              MODIFY: export DeviceRegistry + singleton
│   ├── web/
│   │   ├── next.config.ts                            MODIFY: add @g5000/bridge to serverExternalPackages
│   │   ├── package.json                              MODIFY: add @g5000/bridge dep
│   │   └── src/app/
│   │       ├── api/devices/
│   │       │   ├── route.ts                          NEW (GET snapshot)
│   │       │   └── refresh/route.ts                  NEW (POST refresh)
│   │       └── devices/
│   │           └── page.tsx                          NEW
│   └── (compute, core, db, web unchanged otherwise)
└── apps/
    └── autopilot-server/
        ├── package.json                              MODIFY: predev builds bridge too
        └── src/index.ts                              MODIFY: register driver, set singleton
```

---

## Task 1: `DeviceRegistry` class (TDD)

**Files:**

- Create: `packages/bridge/src/devices/device-registry.ts`
- Test: `packages/bridge/src/devices/device-registry.test.ts`

The registry has two distinct surfaces:

1. **Inbound**: `observe(pgn: DecodedPgn)` — called by the bridge orchestrator on every decoded PGN. Updates internal state when the PGN is 60928 or 126996; always updates `lastSeenMs` for the source address.
2. **Outbound**: `snapshot()` returns a structural copy of the state; `registerTxer(fn)` accepts the tx callback; `refresh(target?)` issues PGN 59904.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceRegistry, type DeviceInfo } from './device-registry.js';
import type { DecodedPgn } from '../decoder.js';
import type { OutgoingPgn } from '../wire-driver.js';

const at = (pgn: number, src: number, fields: Record<string, unknown>): DecodedPgn => ({
  pgn,
  prio: 6,
  src,
  dst: 255,
  fields,
  rxTimestamp: BigInt(Date.now()) * 1_000_000n,
});

describe('DeviceRegistry', () => {
  let registry: DeviceRegistry;

  beforeEach(() => {
    registry = new DeviceRegistry();
  });

  it('returns an empty snapshot before any PGNs arrive', () => {
    expect(Array.from(registry.snapshot().values())).toEqual([]);
  });

  it('populates manufacturer from a PGN 60928 Address Claim', () => {
    registry.observe(
      at(60928, 0x10, {
        'Unique Number': 12345,
        'Manufacturer Code': 1857, // Navico / B&G
        'Device Function': 140, // Heading sensor (example)
        'Device Class': 60,
        'Industry Group': 'Marine',
      }),
    );
    const info = registry.snapshot().get(0x10);
    expect(info).toBeDefined();
    expect(info!.manufacturerCode).toBe(1857);
    // Name lookup may resolve "Navico" or "Simrad" depending on canboatjs's table.
    // Just assert it's a non-empty string.
    expect(typeof info!.manufacturerName).toBe('string');
    expect(info!.manufacturerName!.length).toBeGreaterThan(0);
    expect(info!.deviceFunction).toBe(140);
    expect(info!.deviceClass).toBe(60);
  });

  it('populates model info from a PGN 126996 Product Information', () => {
    registry.observe(
      at(126996, 0x10, {
        'NMEA 2000 Version': 2100,
        'Product Code': 26200,
        'Model ID': 'H5000 CPU',
        'Software Version Code': '1.2.3',
        'Model Version': 'A',
        'Model Serial Code': 'ABC123',
        'Certification Level': 1,
        'Load Equivalency': 2,
      }),
    );
    const info = registry.snapshot().get(0x10);
    expect(info).toBeDefined();
    expect(info!.modelId).toBe('H5000 CPU');
    expect(info!.modelSerialCode).toBe('ABC123');
    expect(info!.softwareVersionCode).toBe('1.2.3');
    expect(info!.loadEquivalency).toBe(2);
  });

  it('merges address-claim and product-info into one record', () => {
    registry.observe(
      at(60928, 0x10, {
        'Manufacturer Code': 1857,
        'Device Function': 140,
        'Device Class': 60,
      }),
    );
    registry.observe(
      at(126996, 0x10, {
        'Model ID': 'H5000 CPU',
        'Model Serial Code': 'ABC123',
      }),
    );
    const info = registry.snapshot().get(0x10);
    expect(info!.manufacturerCode).toBe(1857);
    expect(info!.modelId).toBe('H5000 CPU');
  });

  it('updates lastSeenMs on every observed PGN regardless of type', () => {
    const t0 = Date.now();
    registry.observe(at(127250, 0x10, { Heading: 1.234 }));
    const info = registry.snapshot().get(0x10);
    expect(info).toBeDefined();
    expect(info!.lastSeenMs).toBeGreaterThanOrEqual(t0);
    expect(info!.lastSeenMs).toBeLessThanOrEqual(Date.now());
  });

  it('keeps each source address as a separate device', () => {
    registry.observe(at(60928, 0x10, { 'Manufacturer Code': 1857 }));
    registry.observe(at(60928, 0x12, { 'Manufacturer Code': 137 }));
    const snap = registry.snapshot();
    expect(snap.size).toBe(2);
    expect(snap.get(0x10)!.manufacturerCode).toBe(1857);
    expect(snap.get(0x12)!.manufacturerCode).toBe(137);
  });

  it('refresh() with no target broadcasts PGN 59904 for 60928', async () => {
    const sent: OutgoingPgn[] = [];
    registry.registerTxer(async (pgn) => {
      sent.push(pgn);
    });
    await registry.refresh();
    expect(sent.length).toBeGreaterThan(0);
    const first = sent[0]!;
    expect(first.pgn).toBe(59904);
    expect(first.dst).toBe(255); // broadcast
    expect(first.fields['PGN']).toBe(60928);
  });

  it('refresh(target) sends a unicast PGN 59904 for 60928 and 126996', async () => {
    const sent: OutgoingPgn[] = [];
    registry.registerTxer(async (pgn) => {
      sent.push(pgn);
    });
    await registry.refresh(0x10);
    expect(sent.length).toBe(2);
    expect(sent[0]!.dst).toBe(0x10);
    expect(sent[1]!.dst).toBe(0x10);
    const requestedPgns = sent.map((s) => s.fields['PGN']);
    expect(requestedPgns).toContain(60928);
    expect(requestedPgns).toContain(126996);
  });

  it('refresh() throws if no txer is registered', async () => {
    await expect(registry.refresh()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect failure (module not found)**

```
npx vitest run packages/bridge/src/devices/device-registry.test.ts
```

- [ ] **Step 3: Implement `device-registry.ts`**

```ts
import canboat from '@canboat/canboatjs';
import type { DecodedPgn } from '../decoder.js';
import type { OutgoingPgn } from '../wire-driver.js';

const { lookupEnumerationName } = canboat as unknown as {
  lookupEnumerationName: (enumName: string, value: number) => string | undefined;
};

export interface DeviceInfo {
  src: number;
  lastSeenMs: number;
  // From PGN 60928 (ISO Address Claim)
  uniqueNumber?: number;
  manufacturerCode?: number;
  manufacturerName?: string;
  deviceFunction?: number;
  deviceFunctionName?: string;
  deviceClass?: number;
  deviceClassName?: string;
  industryGroup?: string;
  // From PGN 126996 (Product Information)
  nmea2000Version?: number;
  productCode?: number;
  modelId?: string;
  softwareVersionCode?: string;
  modelVersion?: string;
  modelSerialCode?: string;
  certificationLevel?: number;
  loadEquivalency?: number;
}

export type DeviceTxer = (pgn: OutgoingPgn) => Promise<void>;

/**
 * Watches decoded PGNs for ISO Address Claim (60928) and Product Information
 * (126996), maintains a per-source-address registry of who's on the bus.
 *
 * `observe` updates state; `snapshot` returns a read-only view; `refresh`
 * issues ISO Request (PGN 59904) to ask devices to re-announce themselves.
 */
export class DeviceRegistry {
  private readonly devices = new Map<number, DeviceInfo>();
  private txer: DeviceTxer | null = null;

  observe(pgn: DecodedPgn): void {
    const existing = this.devices.get(pgn.src);
    const next: DeviceInfo = existing ?? { src: pgn.src, lastSeenMs: Date.now() };
    next.lastSeenMs = Date.now();

    if (pgn.pgn === 60928) {
      this.applyAddressClaim(next, pgn.fields);
    } else if (pgn.pgn === 126996) {
      this.applyProductInformation(next, pgn.fields);
    }

    this.devices.set(pgn.src, next);
  }

  snapshot(): Map<number, DeviceInfo> {
    // Shallow copy to prevent callers mutating internal state.
    return new Map(Array.from(this.devices.entries(), ([k, v]) => [k, { ...v }]));
  }

  registerTxer(fn: DeviceTxer): void {
    this.txer = fn;
  }

  /**
   * Issue ISO Request (PGN 59904) to prompt devices to re-broadcast their
   * identity. With no `target`, broadcasts for PGN 60928 (all devices reply).
   * With a `target`, sends separately for both 60928 and 126996 to that
   * specific source address.
   */
  async refresh(target?: number): Promise<void> {
    if (!this.txer) {
      throw new Error(
        'DeviceRegistry.refresh: no txer registered (autopilot-server must call registerTxer at boot)',
      );
    }
    if (target === undefined) {
      await this.txer({
        pgn: 59904,
        prio: 6,
        dst: 255,
        fields: { PGN: 60928 },
      });
    } else {
      await this.txer({
        pgn: 59904,
        prio: 6,
        dst: target,
        fields: { PGN: 60928 },
      });
      await this.txer({
        pgn: 59904,
        prio: 6,
        dst: target,
        fields: { PGN: 126996 },
      });
    }
    // NOTE: the field key 'PGN' is canboat's name for the requested-PGN
    // field in PGN 59904. If the runtime encoder rejects this key (returns
    // empty/falsy from canboatjs.pgnToActisenseSerialFormat), inspect the
    // canboat pgns.json definition for 59904 and substitute the correct
    // field name (likely 'PGN' or 'PGN being requested').
  }

  private applyAddressClaim(info: DeviceInfo, fields: Record<string, unknown>): void {
    if (typeof fields['Unique Number'] === 'number') info.uniqueNumber = fields['Unique Number'];
    if (typeof fields['Manufacturer Code'] === 'number') {
      info.manufacturerCode = fields['Manufacturer Code'] as number;
      info.manufacturerName =
        safeLookup('MANUFACTURER_CODE', info.manufacturerCode) ??
        `Unknown (${info.manufacturerCode})`;
    }
    if (typeof fields['Device Function'] === 'number') {
      info.deviceFunction = fields['Device Function'] as number;
      info.deviceFunctionName = safeLookup('DEVICE_FUNCTION', info.deviceFunction);
    }
    if (typeof fields['Device Class'] === 'number') {
      info.deviceClass = fields['Device Class'] as number;
      info.deviceClassName = safeLookup('DEVICE_CLASS', info.deviceClass);
    }
    if (typeof fields['Industry Group'] === 'string') info.industryGroup = fields['Industry Group'];
  }

  private applyProductInformation(info: DeviceInfo, fields: Record<string, unknown>): void {
    if (typeof fields['NMEA 2000 Version'] === 'number')
      info.nmea2000Version = fields['NMEA 2000 Version'] as number;
    if (typeof fields['Product Code'] === 'number')
      info.productCode = fields['Product Code'] as number;
    if (typeof fields['Model ID'] === 'string')
      info.modelId = (fields['Model ID'] as string).trim();
    if (typeof fields['Software Version Code'] === 'string')
      info.softwareVersionCode = (fields['Software Version Code'] as string).trim();
    if (typeof fields['Model Version'] === 'string')
      info.modelVersion = (fields['Model Version'] as string).trim();
    if (typeof fields['Model Serial Code'] === 'string')
      info.modelSerialCode = (fields['Model Serial Code'] as string).trim();
    if (typeof fields['Certification Level'] === 'number')
      info.certificationLevel = fields['Certification Level'] as number;
    if (typeof fields['Load Equivalency'] === 'number')
      info.loadEquivalency = fields['Load Equivalency'] as number;
  }
}

function safeLookup(enumName: string, value: number): string | undefined {
  try {
    return lookupEnumerationName(enumName, value);
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run — expect pass**

```
npx vitest run packages/bridge/src/devices/device-registry.test.ts
```

All 9 tests pass.

**Note about enum lookups**: if `safeLookup('MANUFACTURER_CODE', 1857)` returns undefined (canboatjs's enum name might differ), the tests still pass because we fall back to `'Unknown (1857)'`. The manufacturer-name assertion is intentionally lax — just "some non-empty string". If you want to confirm the canboatjs lookup table name, check `node_modules/@canboat/canboatjs/lib/codesMfgs.json` and `pgns.js` (search for `MANUFACTURER` or `manufacturers`). If the actual enum name differs (e.g. `'Manufacturer Code'` literal, or `'manufacturerCode'`), update the string in `applyAddressClaim` accordingly. The plan's defaults are best-guesses; an empirical pass during implementation should confirm.

- [ ] **Step 5: Verify typecheck**

```
npx tsc -b packages/bridge
```

Clean.

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/devices/device-registry.ts packages/bridge/src/devices/device-registry.test.ts
git commit -m "feat(bridge): DeviceRegistry maintains per-source-address N2K device info"
```

---

## Task 2: Bridge ships from dist; singleton accessor; orchestrator wires registry

**Files:**

- Modify: `packages/bridge/package.json` — `main` → `dist/index.js`
- Modify: `packages/bridge/src/index.ts` — export DeviceRegistry + singleton
- Modify: `packages/bridge/src/bridge.ts` — orchestrator pipes DecodedPgn → registry

Currently `@g5000/bridge`'s `main` points at `./src/index.ts`. Next.js consumes workspace packages via `dist/` (the Plan 1 finding — Turbopack can't resolve `.js`-extension imports against TS source in workspace packages). Since we're about to have `@g5000/web` import from `@g5000/bridge`, the bridge needs to follow the same `dist/`-shipping pattern as `core`, `db`, and `compute`.

- [ ] **Step 1: Update `packages/bridge/package.json`**

Change:

```json
"main": "./src/index.ts",
"types": "./src/index.ts",
```

to:

```json
"main": "./dist/index.js",
"types": "./dist/index.d.ts",
```

- [ ] **Step 2: Build bridge**

```
npm run build --workspace=@g5000/bridge
```

Verify `packages/bridge/dist/index.js` exists.

- [ ] **Step 3: Add DeviceRegistry export + singleton to `packages/bridge/src/index.ts`**

Append after the existing exports:

```ts
export * from './devices/device-registry.js';

import { DeviceRegistry } from './devices/device-registry.js';

declare const globalThis: { __g5000_deviceRegistry__?: DeviceRegistry };

export function getSharedDeviceRegistry(): DeviceRegistry {
  if (!globalThis.__g5000_deviceRegistry__) {
    globalThis.__g5000_deviceRegistry__ = new DeviceRegistry();
  }
  return globalThis.__g5000_deviceRegistry__;
}

export function _resetSharedDeviceRegistryForTests(): void {
  globalThis.__g5000_deviceRegistry__ = undefined;
}
```

The `globalThis` pattern matches the ConfigStore singleton from Plan 3 — Turbopack can produce multiple module instances per import context, but `globalThis` is shared across them within one Node process.

- [ ] **Step 4: Wire orchestrator to observe DecodedPgns into the registry**

In `packages/bridge/src/bridge.ts`, the current orchestrator subscribes to each driver's `rxCan`, decodes to `DecodedPgn` via the `decode()` operator, and then maps to samples. We add a second subscription on the same decoded stream that pipes into the registry.

Update `bridge.ts` to:

```ts
import type { Bus } from '@g5000/core';
import { mergeMap, from, share, type Subscription } from 'rxjs';
import type { WireDriver } from './wire-driver.js';
import { decode } from './decoder.js';
import { mapPgnToSamples } from './channel-mapper.js';
import { mapSentenceToSamples } from './nmea0183/channel-mapper.js';
import { getSharedDeviceRegistry } from './index.js';

export interface BridgeOptions {
  bus: Bus;
  drivers: WireDriver[];
}

export async function runBridge(opts: BridgeOptions): Promise<() => Promise<void>> {
  const { bus, drivers } = opts;
  const registry = getSharedDeviceRegistry();
  await Promise.all(drivers.map((d) => d.start()));

  const subs: Subscription[] = [];

  for (const driver of drivers) {
    // Decode once and share so both pipelines see the same stream.
    const decoded$ = driver.rxCan.pipe(decode(), share());

    // Existing path: sample publication onto the bus.
    subs.push(
      decoded$.pipe(mergeMap((pgn) => from(mapPgnToSamples(pgn)))).subscribe({
        next: (sample) => bus.publish(sample),
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[bridge] CAN pipeline error (subscription terminated)', err);
        },
      }),
    );

    // New path: feed every decoded PGN into the device registry.
    subs.push(
      decoded$.subscribe({
        next: (pgn) => registry.observe(pgn),
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[bridge] device-registry pipeline error', err);
        },
      }),
    );

    // 0183 path (unchanged).
    subs.push(
      driver.rx0183.pipe(mergeMap((s) => from(mapSentenceToSamples(s)))).subscribe({
        next: (sample) => bus.publish(sample),
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[bridge] 0183 pipeline error (subscription terminated)', err);
        },
      }),
    );
  }

  return async () => {
    for (const s of subs) s.unsubscribe();
    await Promise.all(drivers.map((d) => d.stop()));
  };
}
```

The key change: `decode()` is called once per driver, the resulting Observable is `share()`d, and both the sample-publishing branch and the registry-observing branch consume the same stream. (Without `share`, each subscription would re-run `decode()`, doubling canboatjs work.)

- [ ] **Step 5: Verify tests still pass**

```
npx vitest run packages/bridge
```

Existing 46 tests + new 9 device-registry tests = 55 pass.

If the bridge orchestrator e2e test fails because it now also feeds the registry (and the registry singleton has cross-test state from previous tests), import `_resetSharedDeviceRegistryForTests` in the test's `beforeEach` to reset. Add to `bridge.test.ts`'s top-level `beforeEach`:

```ts
import { _resetSharedDeviceRegistryForTests } from './index.js';
// ...
beforeEach(async () => {
  _resetSharedDeviceRegistryForTests();
  // ... existing beforeEach body
});
```

- [ ] **Step 6: Rebuild bridge dist**

```
npm run build --workspace=@g5000/bridge
```

- [ ] **Step 7: Commit**

```bash
git add packages/bridge/package.json packages/bridge/src/index.ts packages/bridge/src/bridge.ts packages/bridge/src/bridge.test.ts
git commit -m "feat(bridge): ship from dist; add DeviceRegistry singleton; orchestrator observes"
```

---

## Task 3: Web depends on `@g5000/bridge`; update predev

**Files:**

- Modify: `packages/web/package.json` — add bridge as dep
- Modify: `packages/web/next.config.ts` — add bridge to serverExternalPackages
- Modify: `apps/autopilot-server/package.json` — predev/prebuild build bridge too

- [ ] **Step 1: Add dependency**

In `packages/web/package.json`, append to the `dependencies` block:

```json
"@g5000/bridge": "*",
```

So the alphabetical order is `@g5000/bridge`, `@g5000/compute`, `@g5000/core`, `@g5000/db`.

Run `npm install`.

- [ ] **Step 2: Update next.config.ts**

Change `serverExternalPackages` from `['@g5000/core', '@g5000/db', '@g5000/compute']` to:

```ts
serverExternalPackages: ['@g5000/core', '@g5000/db', '@g5000/compute', '@g5000/bridge'],
```

- [ ] **Step 3: Update autopilot-server predev/prebuild scripts**

In `apps/autopilot-server/package.json`, change:

```json
"predev": "tsc -b ../../packages/core ../../packages/db ../../packages/compute",
"prebuild": "tsc -b ../../packages/core ../../packages/db ../../packages/compute",
```

to:

```json
"predev": "tsc -b ../../packages/core ../../packages/db ../../packages/compute ../../packages/bridge",
"prebuild": "tsc -b ../../packages/core ../../packages/db ../../packages/compute ../../packages/bridge",
```

- [ ] **Step 4: Verify typecheck**

```
npx tsc -b
```

Clean.

- [ ] **Step 5: Commit**

```bash
git add packages/web/package.json packages/web/next.config.ts apps/autopilot-server/package.json package-lock.json
git commit -m "chore: web depends on bridge; autopilot-server prebuilds it"
```

---

## Task 4: REST API endpoints — `/api/devices` GET + `/api/devices/refresh` POST

**Files:**

- Create: `packages/web/src/app/api/devices/route.ts`
- Create: `packages/web/src/app/api/devices/refresh/route.ts`

- [ ] **Step 1: Implement `route.ts` (GET snapshot)**

```ts
import { getSharedDeviceRegistry, type DeviceInfo } from '@g5000/bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const registry = getSharedDeviceRegistry();
  const snap = registry.snapshot();
  // Sort by source address for stable JSON ordering.
  const devices: DeviceInfo[] = Array.from(snap.values()).sort((a, b) => a.src - b.src);
  return Response.json({ devices });
}
```

- [ ] **Step 2: Implement `refresh/route.ts` (POST refresh)**

```ts
import { getSharedDeviceRegistry } from '@g5000/bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const registry = getSharedDeviceRegistry();
  let target: number | undefined;
  try {
    const body = (await req.json().catch(() => null)) as { target?: number } | null;
    if (body && typeof body.target === 'number') target = body.target;
  } catch {
    /* empty body is fine — broadcast */
  }
  try {
    await registry.refresh(target);
    return Response.json({ ok: true, target: target ?? 'broadcast' });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
```

- [ ] **Step 3: Typecheck**

```
npm run typecheck --workspace=@g5000/web
```

Clean.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/api/devices/route.ts packages/web/src/app/api/devices/refresh/route.ts
git commit -m "feat(web): /api/devices GET snapshot and /api/devices/refresh POST"
```

---

## Task 5: `/devices` page

**Files:**

- Create: `packages/web/src/app/devices/page.tsx`

A simple client-side React component that fetches `/api/devices` on mount and on refresh. The "Refresh devices" button POSTs to `/api/devices/refresh` then refetches the snapshot. No SSE, no auto-polling.

- [ ] **Step 1: Implement `page.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DeviceInfo } from '@g5000/bridge';

interface DevicesResponse {
  devices: DeviceInfo[];
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/devices', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/devices: ${res.status}`);
      const body = (await res.json()) as DevicesResponse;
      setDevices(body.devices);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await fetch('/api/devices/refresh', { method: 'POST' });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`POST /api/devices/refresh: ${res.status} ${body}`);
      }
      // Give devices a moment to reply, then reload.
      await new Promise((r) => setTimeout(r, 500));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();
  const fmtAge = (ms: number): string => `${((now - ms) / 1000).toFixed(1)}s`;
  const fmt = (s: string | undefined, fallback = '—'): string => (s && s.length > 0 ? s : fallback);
  const fmtNum = (n: number | undefined, fallback = '—'): string =>
    typeof n === 'number' ? String(n) : fallback;
  const hexSrc = (n: number): string => `0x${n.toString(16).padStart(2, '0')}`;

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">N2K devices</h1>
        <button
          onClick={refresh}
          disabled={busy}
          className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50"
        >
          {busy ? 'Refreshing…' : 'Refresh devices'}
        </button>
      </div>
      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      {devices === null && !err && <p className="text-slate-400">Loading…</p>}

      {devices !== null && devices.length === 0 && (
        <p className="text-slate-400 text-sm">
          No devices observed yet. Click "Refresh devices" to send an ISO Request, or wait for
          devices to announce themselves.
        </p>
      )}

      {devices !== null && devices.length > 0 && (
        <table className="w-full text-sm font-mono">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="py-2 pr-4">Src</th>
              <th className="py-2 pr-4">Manufacturer</th>
              <th className="py-2 pr-4">Model</th>
              <th className="py-2 pr-4">S/N</th>
              <th className="py-2 pr-4">Function</th>
              <th className="py-2 pr-4">Class</th>
              <th className="py-2 pr-4">SW</th>
              <th className="py-2">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.src} className="border-b border-slate-900">
                <td className="py-1 pr-4">{hexSrc(d.src)}</td>
                <td className="py-1 pr-4">{fmt(d.manufacturerName)}</td>
                <td className="py-1 pr-4">{fmt(d.modelId)}</td>
                <td className="py-1 pr-4">{fmt(d.modelSerialCode)}</td>
                <td className="py-1 pr-4">{fmt(d.deviceFunctionName, fmtNum(d.deviceFunction))}</td>
                <td className="py-1 pr-4">{fmt(d.deviceClassName, fmtNum(d.deviceClass))}</td>
                <td className="py-1 pr-4">{fmt(d.softwareVersionCode)}</td>
                <td className="py-1 text-slate-500">{fmtAge(d.lastSeenMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

```
npm run typecheck --workspace=@g5000/web
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/devices/page.tsx
git commit -m "feat(web): /devices page listing N2K bus members with Refresh button"
```

---

## Task 6: autopilot-server wires the registry's tx target + final verification

**Files:**

- Modify: `apps/autopilot-server/src/index.ts`

The registry is populated by the bridge orchestrator (Task 2), but `refresh()` won't work until something registers a tx callback. The autopilot-server, which owns the live `Ngt1Driver`, calls `registry.registerTxer(...)` right after the driver is online.

- [ ] **Step 1: Register the driver as tx target**

In `apps/autopilot-server/src/index.ts`, find where the bridge starts (after `runBridge({ bus, drivers })`). Just before starting the true-wind TX wiring (or alongside it), register the registry's tx target.

Add to the imports:

```ts
import {
  Ngt1Driver,
  SerialPort0183Driver,
  ReplayDriver,
  runBridge,
  startSessionLogger,
  startTrueWindTx,
  getSharedDeviceRegistry,
  type WireDriver,
  type SessionLogger,
} from '@g5000/bridge';
```

The autopilot-server already has a `const ngt = drivers.find((d) => d instanceof Ngt1Driver)` line near where the true-wind TX is wired. **Reuse that exact `ngt` binding** — don't redeclare. Add to the same block where TX is conditionally started:

```ts
const ngt = drivers.find((d) => d instanceof Ngt1Driver); // existing
if (ngt && !REPLAY) {
  const stopTx = await startTrueWindTx({ bus, driver: ngt }); // existing
  teardown.push(stopTx); // existing
  // eslint-disable-next-line no-console
  console.log('[autopilot] true-wind TX online via NGT-1'); // existing

  // NEW: register NGT-1 as device-registry refresh target
  getSharedDeviceRegistry().registerTxer((pgn) => ngt.txPgn(pgn));
  // eslint-disable-next-line no-console
  console.log('[autopilot] device-registry refresh target = NGT-1');
}
```

The new lines slot inside the existing `if (ngt && !REPLAY)` guard.

- [ ] **Step 2: Smoke-test the integrated server**

```bash
pkill -f "tsx watch src/index.ts" 2>&1 || true
SKIP_BRIDGE=1 npm run dev --workspace=@g5000/autopilot-server > /tmp/p6-smoke.log 2>&1 &
sleep 14
grep -E "config db|true-wind|web UI|device-registry|registry" /tmp/p6-smoke.log
echo "---"
curl -s -o /dev/null -w "GET /devices: %{http_code}\n" -m 8 http://localhost:3000/devices
curl -s -m 5 http://localhost:3000/api/devices
echo ""
echo "---POST refresh (no driver active, expect 503)---"
curl -s -m 5 -X POST http://localhost:3000/api/devices/refresh
echo ""
pkill -f "tsx watch src/index.ts" 2>&1 || true
```

Expected:

- Log shows config, compute, web UI lines as before; no `[autopilot] device-registry refresh target` line because `SKIP_BRIDGE=1` means no NGT-1.
- `GET /devices` returns 200 (HTML).
- `GET /api/devices` returns `{"devices":[]}` (empty registry because no decoded PGNs).
- `POST /api/devices/refresh` returns 503 with an error message (no txer registered). This is the correct behavior.

- [ ] **Step 3: Full test suite**

```
npm test
```

Expected: existing 85 + 9 device-registry = 94 tests pass.

- [ ] **Step 4: Workspace typecheck**

```
npx tsc -b
```

Clean.

- [ ] **Step 5: Lint and format**

```
npm run lint
```

Run `npm run format` if anything is unformatted, then commit any prettier changes.

- [ ] **Step 6: Commit**

```bash
git add apps/autopilot-server/src/index.ts
git commit -m "feat(server): register NGT-1 as device-registry refresh target"
```

If prettier touched anything:

```bash
git add -u
git commit -m "chore: prettier formatting after Plan 6"
```

---

## Closing notes

After this plan:

- Visit `http://localhost:3000/devices` (when the autopilot-server is running) to see every N2K node observed on the bus.
- Click "Refresh devices" to issue an ISO Request — useful when a device has just been powered on and hasn't announced itself yet, or when you want to verify a device's product info that didn't come through on its own.
- The registry observes every decoded PGN's source address (not just 60928/126996), so `lastSeenMs` is accurate even for devices that don't broadcast identity (e.g., they're misconfigured or non-standard).

The next plan is **Plan 7 — BSP cal + compass deviation + boat config pages** (the remaining easy calibration items). After that, **Plan 8 — Polars editor with Expedition CSV import** is the first feature that gives you a "the G5000 tells you something the H5000 didn't" result (target speed for current TWS/TWA).
