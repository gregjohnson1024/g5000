# At-Anchor Dashboard + Victron Cerbo Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated `/anchor` "at anchor" monitoring dashboard (Ingenuity-faithful layout in g5000's dark theme), fed by existing instrument/tide/forecast data, new Open-Meteo weather, and a new read-only Victron Venus OS (Cerbo) MQTT driver for battery/solar/tanks/temperatures.

**Architecture:** Two subsystems. (B) A Victron MQTT driver in `@g5000/bridge` reads the Cerbo's local FlashMQ broker (TCP 1883), maintains a `VictronRegistry` singleton (mirroring the AIS-targets registry) exposed at `GET /api/victron/state`, and publishes headline scalars to the `Bus`; a deterministic simulator lets it run off-boat. (A) A `/anchor` Next.js page composes panels (depth/position/AIS/wind/anchor/systems) and a slide-up drawer of sub-tabs (forecast/tides/radar/sky/solar), reusing existing hooks/APIs and adding pure client libs + Open-Meteo routes.

**Tech Stack:** TypeScript (ESM, strict), Node ≥22, npm workspaces, RxJS bus, Drizzle/better-sqlite3 ConfigStore, Next.js 16 App Router + React 19 + Tailwind 4, Vitest (`pool: 'forks'`), `mqtt` (new), `suncalc` (new), Open-Meteo (fetch, no dep).

## Global Constraints

- **ESM `.js` import extensions** in `packages/{core,db,bridge,compute}` and `apps/g5000`; **extensionless** imports in `packages/web`. (Turbopack can't resolve `.js` in web.)
- **Prettier:** 100 cols, single quotes, trailing commas all, 2-space.
- **Units:** metric display (metres, °C); wind/gusts in **knots** (convert from m/s at render); powers **W**, energy **kWh**, voltage **V**, current **A**; lat/lon compact DMM (`33 42.232n 66 25.240w`); all UI times UTC. Internal storage/channels stay SI.
- **Process singletons live on `globalThis`** (`__g5000_*__`); registries follow the AIS pattern (interface + get/set in `@g5000/core`, impl in `@g5000/bridge`).
- **Never gate MapLibre `addSource`/`addLayer` on `map.isStyleLoaded()`** (only the anchor mini-map uses canvas/SVG, not MapLibre — so this mostly won't apply, but note it if any real map is added).
- **Driver failure must never block boot** or trip the systemd watchdog — reconnect with backoff, degrade to "offline".
- **Victron driver is READ-ONLY** for v1 (no `W/` writes).
- **Test baseline:** the known-environmental failures in CLAUDE.md (coastline, ConfigStore-dependent web route tests, wgrib2) are the accepted red baseline; any _other_ failing test is a regression.
- **`npm run typecheck` does NOT typecheck `packages/web` `.tsx`** — before considering web work done, run `npm run build --workspace @g5000/web`.
- Spec: `docs/superpowers/specs/2026-07-04-anchor-dashboard-design.md`.

---

## File Structure

**Part B — Victron driver**

- `packages/core/src/victron-state.ts` — `VictronSnapshot`/`VictronRegistry` types + `get/setSharedVictron` (globalThis).
- `packages/core/src/channels.ts` — add `Electrical.*` scalar channels.
- `packages/bridge/src/victron/topics.ts` — pure `parseTopic`/`applyMessage`/`deriveSnapshot`.
- `packages/bridge/src/victron/registry.ts` — `createVictronRegistry()` (mirrors ais registry).
- `packages/bridge/src/victron/publisher.ts` — snapshot → bus scalar samples.
- `packages/bridge/src/victron/mqtt-driver.ts` — `startVictronMqttDriver()` (connect/discover/keepalive/subscribe/reconnect).
- `packages/bridge/src/victron/sim.ts` — `startVictronSim()` deterministic simulator.
- `packages/bridge/src/index.ts` — re-export the above.
- `apps/g5000/src/victron.ts` — `startVictron()` wiring (env gates, registry, driver-or-sim, teardown).
- `apps/g5000/src/index.ts` — call `startVictron()`.
- `packages/web/src/app/api/victron/state/route.ts` — `GET` registry snapshot.

**Part A — Dashboard UI**

- `packages/web/src/app/anchor/page.tsx` — shell (top zone grid + drawer).
- `packages/web/src/app/anchor/panels/{DepthPanel,PositionPanel,NearbyVesselsPanel,WindDial,AnchorWatchPanel,TodayNowPanel,SystemsPanel}.tsx`
- `packages/web/src/app/anchor/tabs/{ForecastGraphTab,ForecastTableTab,TidesTab,RadarTab,SkyTab,SolarTab}.tsx`
- `packages/web/src/lib/{sky,gust,rode-scope,nearby-vessels,depth-offset,weather-dto}.ts` (+ co-located tests)
- `packages/web/src/app/api/weather/{current,forecast}/route.ts`
- `packages/web/src/app/Navbar.tsx` — add `/anchor` tab.
- `packages/web/src/app/settings/page.tsx` — add anchor-dashboard section (via `/api/settings` blob).

---

## PHASE B1 — Victron driver core (pure, TDD)

### Task 1: Victron types + registry singleton (`@g5000/core`)

**Files:**

- Create: `packages/core/src/victron-state.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './victron-state.js';`)

**Interfaces:**

- Produces:
  - `interface VictronSnapshot` (below)
  - `interface VictronRegistry { update(topic: string, payloadJson: string): void; snapshot(): VictronSnapshot; markStale(): void; connected(): boolean; setConnected(v: boolean): void; clear(): void; }`
  - `function getSharedVictron(): VictronRegistry | undefined`
  - `function setSharedVictron(r: VictronRegistry): void`

- [ ] **Step 1: Write the file** (no test needed — pure type/accessor module, mirrors `ais-targets.ts`)

```ts
// packages/core/src/victron-state.ts
export interface VictronCharger {
  id: string; // "solarcharger/279"
  name: string;
  power: number; // W
  voltage: number; // V
  current: number; // A
  state: string; // "Bulk" | "Float" | ...
  yieldTodayKwh: number;
  dayMaxPower: number; // W
}
export interface VictronTank {
  id: string;
  fluidType: string; // "Fuel" | "Fresh water" | "Waste" | ...
  level: number; // 0..1 fraction
  capacityL: number | null;
}
export interface VictronTemperature {
  id: string;
  name: string;
  celsius: number;
}
export interface VictronSnapshot {
  connected: boolean;
  updatedAt: number; // epoch ms of last message applied
  battery: {
    soc: number | null; // %
    voltage: number | null; // V
    current: number | null; // A (signed: + charge, - discharge)
    power: number | null; // W
    temperatureC: number | null;
    timeToGoS: number | null; // seconds to empty/full, if provided
  };
  solar: { totalPower: number | null; chargers: VictronCharger[] };
  dc: { power: number | null };
  ac: { inputPower: number | null; outputPower: number | null; consumptionPower: number | null };
  tanks: VictronTank[];
  temperatures: VictronTemperature[];
  generator: { state: string | null; runtimeH: number | null };
}

export interface VictronRegistry {
  /** Apply one MQTT message (topic + JSON payload string `{"value":…}`). */
  update(topic: string, payloadJson: string): void;
  /** Curated snapshot for the UI. */
  snapshot(): VictronSnapshot;
  /** Mark the feed stale (driver disconnected) — snapshot().connected → false. */
  markStale(): void;
  connected(): boolean;
  setConnected(v: boolean): void;
  clear(): void;
}

declare const globalThis: { __g5000_victron__?: VictronRegistry };

export function getSharedVictron(): VictronRegistry | undefined {
  return globalThis.__g5000_victron__;
}
export function setSharedVictron(r: VictronRegistry): void {
  globalThis.__g5000_victron__ = r;
}
```

- [ ] **Step 2: Add the export** to `packages/core/src/index.ts` (after the `ais-targets.js` line):

```ts
export * from './victron-state.js';
```

- [ ] **Step 3: Build core**

Run: `npx tsc -b packages/core`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/victron-state.ts packages/core/src/index.ts
git commit -m "feat(victron): snapshot/registry types + shared-singleton accessors"
```

---

### Task 2: Topic parser + snapshot deriver (`@g5000/bridge`, pure, TDD)

**Files:**

- Create: `packages/bridge/src/victron/topics.ts`
- Test: `packages/bridge/src/victron/topics.test.ts`

**Interfaces:**

- Consumes: `VictronSnapshot` from `@g5000/core`.
- Produces:
  - `interface RawVictronState { byKey: Map<string, number | string | null> }` — key = `"service/instance/path"`.
  - `function parseTopic(topic: string): { service: string; instance: string; path: string } | null` — expects `N/<portal>/<service>/<instance>/<path>`, returns null otherwise.
  - `function applyMessage(state: RawVictronState, topic: string, payloadJson: string): void` — parses `{"value":…}`, stores under `service/instance/path`; ignores non-`N/` topics and unparseable payloads.
  - `function deriveSnapshot(state: RawVictronState, now: number, connected: boolean): VictronSnapshot`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/bridge/src/victron/topics.test.ts
import { describe, it, expect } from 'vitest';
import { parseTopic, applyMessage, deriveSnapshot, type RawVictronState } from './topics.js';

const PORTAL = 'c0619ab58146';
const N = (svc: string) => `N/${PORTAL}/${svc}`;

function feed(pairs: Array<[string, unknown]>): RawVictronState {
  const state: RawVictronState = { byKey: new Map() };
  for (const [topic, value] of pairs) applyMessage(state, topic, JSON.stringify({ value }));
  return state;
}

describe('parseTopic', () => {
  it('parses a value topic into service/instance/path', () => {
    expect(parseTopic(`N/${PORTAL}/battery/512/Dc/0/Voltage`)).toEqual({
      service: 'battery',
      instance: '512',
      path: 'Dc/0/Voltage',
    });
  });
  it('returns null for non-N topics', () => {
    expect(parseTopic(`R/${PORTAL}/keepalive`)).toBeNull();
    expect(parseTopic('garbage')).toBeNull();
  });
});

describe('applyMessage + deriveSnapshot', () => {
  it('derives battery/solar/tanks/temps from system + device services', () => {
    const state = feed([
      [`${N('system')}/0/Dc/Battery/Soc`, 68],
      [`${N('system')}/0/Dc/Battery/Voltage`, 26.73],
      [`${N('system')}/0/Dc/Battery/Current`, 5.0],
      [`${N('system')}/0/Dc/Battery/Power`, 133],
      [`${N('system')}/0/Dc/Pv/Power`, 1946],
      [`${N('system')}/0/Ac/Consumption/L1/Power`, 843],
      [`${N('solarcharger')}/279/Dc/0/Voltage`, 26.8],
      [`${N('solarcharger')}/279/Dc/0/Current`, 18.5],
      [`${N('solarcharger')}/279/Yield/Power`, 507],
      [`${N('solarcharger')}/279/State`, 3],
      [`${N('tank')}/20/Level`, 63],
      [`${N('tank')}/20/FluidType`, 1],
      [`${N('tank')}/20/Capacity`, 0.6],
      [`${N('temperature')}/24/Temperature`, 25.0],
      [`${N('temperature')}/24/CustomName`, 'Cockpit'],
    ]);
    const snap = deriveSnapshot(state, 1_000, true);
    expect(snap.battery.soc).toBe(68);
    expect(snap.battery.power).toBe(133);
    expect(snap.solar.totalPower).toBe(1946);
    expect(snap.solar.chargers[0]?.power).toBe(507);
    expect(snap.tanks[0]?.level).toBeCloseTo(0.63, 5); // Victron Level is a percentage → fraction
    expect(snap.temperatures[0]).toMatchObject({ name: 'Cockpit', celsius: 25 });
    expect(snap.connected).toBe(true);
    expect(snap.updatedAt).toBe(1_000);
  });

  it('ignores non-N topics and malformed payloads', () => {
    const state: RawVictronState = { byKey: new Map() };
    applyMessage(state, `R/${PORTAL}/keepalive`, '');
    applyMessage(state, `${N('battery')}/512/Dc/0/Voltage`, 'not json');
    expect(state.byKey.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/bridge/src/victron/topics.test.ts`
Expected: FAIL — module `./topics.js` not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/bridge/src/victron/topics.ts
import type { VictronSnapshot, VictronCharger, VictronTank, VictronTemperature } from '@g5000/core';

export interface RawVictronState {
  byKey: Map<string, number | string | null>;
}

export function parseTopic(
  topic: string,
): { service: string; instance: string; path: string } | null {
  const parts = topic.split('/');
  // N / <portal> / <service> / <instance> / <path…>
  if (parts.length < 5 || parts[0] !== 'N') return null;
  const service = parts[2]!;
  const instance = parts[3]!;
  const path = parts.slice(4).join('/');
  if (!service || !instance || !path) return null;
  return { service, instance, path };
}

export function applyMessage(state: RawVictronState, topic: string, payloadJson: string): void {
  const parsed = parseTopic(topic);
  if (!parsed) return;
  let value: number | string | null;
  try {
    const obj = JSON.parse(payloadJson) as { value?: unknown };
    if (!obj || typeof obj !== 'object' || !('value' in obj)) return;
    const v = obj.value;
    if (v !== null && typeof v !== 'number' && typeof v !== 'string') return;
    value = v as number | string | null;
  } catch {
    return;
  }
  state.byKey.set(`${parsed.service}/${parsed.instance}/${parsed.path}`, value);
}

const num = (state: RawVictronState, key: string): number | null => {
  const v = state.byKey.get(key);
  return typeof v === 'number' ? v : null;
};
const str = (state: RawVictronState, key: string): string | null => {
  const v = state.byKey.get(key);
  return typeof v === 'string' ? v : v === null ? null : String(v);
};

// Victron numeric enums → labels (partial; unknowns fall back to the number).
const CHARGER_STATE: Record<number, string> = {
  0: 'Off',
  3: 'Bulk',
  4: 'Absorption',
  5: 'Float',
  7: 'Equalize',
  245: 'Wake-up',
  252: 'ESS',
};
const FLUID_TYPE: Record<number, string> = {
  0: 'Fuel',
  1: 'Fresh water',
  2: 'Waste water',
  3: 'Live well',
  4: 'Oil',
  5: 'Black water',
};

function instancesFor(state: RawVictronState, service: string): string[] {
  const seen = new Set<string>();
  for (const key of state.byKey.keys()) {
    const [svc, inst] = key.split('/');
    if (svc === service && inst) seen.add(inst);
  }
  return [...seen].sort();
}

export function deriveSnapshot(
  state: RawVictronState,
  now: number,
  connected: boolean,
): VictronSnapshot {
  const chargers: VictronCharger[] = instancesFor(state, 'solarcharger').map((inst) => {
    const p = `solarcharger/${inst}`;
    const stateNum = num(state, `${p}/State`);
    return {
      id: p,
      name: str(state, `${p}/CustomName`) ?? str(state, `${p}/ProductName`) ?? `MPPT ${inst}`,
      power: num(state, `${p}/Yield/Power`) ?? 0,
      voltage: num(state, `${p}/Dc/0/Voltage`) ?? 0,
      current: num(state, `${p}/Dc/0/Current`) ?? 0,
      state: stateNum !== null ? (CHARGER_STATE[stateNum] ?? String(stateNum)) : '—',
      yieldTodayKwh: num(state, `${p}/History/Daily/0/Yield`) ?? 0,
      dayMaxPower: num(state, `${p}/History/Daily/0/MaxPower`) ?? 0,
    };
  });
  const tanks: VictronTank[] = instancesFor(state, 'tank').map((inst) => {
    const p = `tank/${inst}`;
    const lvl = num(state, `${p}/Level`);
    const ft = num(state, `${p}/FluidType`);
    const capM3 = num(state, `${p}/Capacity`);
    return {
      id: p,
      fluidType: ft !== null ? (FLUID_TYPE[ft] ?? String(ft)) : '—',
      level: lvl !== null ? lvl / 100 : 0, // Victron Level is a percentage
      capacityL: capM3 !== null ? capM3 * 1000 : null,
    };
  });
  const temperatures: VictronTemperature[] = instancesFor(state, 'temperature').map((inst) => {
    const p = `temperature/${inst}`;
    return {
      id: p,
      name: str(state, `${p}/CustomName`) ?? `Temp ${inst}`,
      celsius: num(state, `${p}/Temperature`) ?? 0,
    };
  });

  return {
    connected,
    updatedAt: now,
    battery: {
      soc: num(state, 'system/0/Dc/Battery/Soc'),
      voltage: num(state, 'system/0/Dc/Battery/Voltage'),
      current: num(state, 'system/0/Dc/Battery/Current'),
      power: num(state, 'system/0/Dc/Battery/Power'),
      temperatureC: num(state, 'system/0/Dc/Battery/Temperature'),
      timeToGoS: num(state, 'system/0/Dc/Battery/TimeToGo'),
    },
    solar: { totalPower: num(state, 'system/0/Dc/Pv/Power'), chargers },
    dc: { power: num(state, 'system/0/Dc/System/Power') },
    ac: {
      inputPower: num(state, 'system/0/Ac/ActiveIn/L1/Power'),
      outputPower: num(state, 'system/0/Ac/Consumption/L1/Power'),
      consumptionPower: num(state, 'system/0/Ac/Consumption/L1/Power'),
    },
    tanks,
    temperatures,
    generator: {
      state: str(state, 'generator/0/State'),
      runtimeH: num(state, 'generator/0/Runtime'),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/bridge/src/victron/topics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/victron/topics.ts packages/bridge/src/victron/topics.test.ts
git commit -m "feat(victron): MQTT topic parser + snapshot deriver"
```

---

### Task 3: Registry impl + bus publisher (`@g5000/bridge`)

**Files:**

- Create: `packages/bridge/src/victron/registry.ts`
- Create: `packages/bridge/src/victron/publisher.ts`
- Test: `packages/bridge/src/victron/publisher.test.ts`
- Modify: `packages/core/src/channels.ts` (add channels)
- Modify: `packages/bridge/src/index.ts` (re-exports)

**Interfaces:**

- Consumes: `RawVictronState`, `applyMessage`, `deriveSnapshot`, `VictronRegistry`, `Bus`, `Channels`.
- Produces:
  - `function createVictronRegistry(): VictronRegistry` (idempotent shared singleton; mirrors `createAisTargetsRegistry`).
  - `function publishVictronToBus(bus: Bus, snap: VictronSnapshot, source?: string): void`.

- [ ] **Step 1: Add channels** to `packages/core/src/channels.ts` — extend the existing `Electrical` block:

```ts
  Electrical: {
    BatteryVoltage: 'electrical.battery.voltage',
    BatterySoc: 'electrical.battery.soc',
    BatteryCurrent: 'electrical.battery.current',
    BatteryPower: 'electrical.battery.power',
    DcPower: 'electrical.dc.power',
    AcInputPower: 'electrical.ac.input.power',
    AcOutputPower: 'electrical.ac.output.power',
    SolarPower: 'electrical.solar.power',
  },
```

Run `npx tsc -b packages/core` — expect no errors.

- [ ] **Step 2: Write the registry** (`packages/bridge/src/victron/registry.ts`)

```ts
import { getSharedVictron, setSharedVictron, type VictronRegistry } from '@g5000/core';
import { applyMessage, deriveSnapshot, type RawVictronState } from './topics.js';

/** Idempotent shared Victron registry (mirrors createAisTargetsRegistry). */
export function createVictronRegistry(): VictronRegistry {
  const existing = getSharedVictron();
  if (existing) return existing;

  const state: RawVictronState = { byKey: new Map() };
  let connected = false;
  let lastMs = 0;

  const registry: VictronRegistry = {
    update: (topic, payloadJson) => {
      applyMessage(state, topic, payloadJson);
      lastMs = Date.now();
    },
    snapshot: () => deriveSnapshot(state, lastMs, connected),
    markStale: () => {
      connected = false;
    },
    connected: () => connected,
    setConnected: (v) => {
      connected = v;
    },
    clear: () => {
      state.byKey.clear();
      connected = false;
      lastMs = 0;
    },
  };
  setSharedVictron(registry);
  return registry;
}
```

- [ ] **Step 3: Write the failing publisher test** (`packages/bridge/src/victron/publisher.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { Bus, Channels, type JsonSafeSample } from '@g5000/core';
import { publishVictronToBus } from './publisher.js';

describe('publishVictronToBus', () => {
  it('publishes headline scalars, skipping null fields', () => {
    const bus = new Bus();
    const seen = new Map<string, JsonSafeSample>();
    bus.subscribe('electrical.**', (ch, s) => seen.set(ch, s));
    publishVictronToBus(bus, {
      connected: true,
      updatedAt: 1,
      battery: {
        soc: 68,
        voltage: 26.7,
        current: 5,
        power: 133,
        temperatureC: null,
        timeToGoS: null,
      },
      solar: { totalPower: 1946, chargers: [] },
      dc: { power: null },
      ac: { inputPower: null, outputPower: 1000, consumptionPower: 1000 },
      tanks: [],
      temperatures: [],
      generator: { state: null, runtimeH: null },
    });
    const val = (ch: string) =>
      seen.get(ch)?.value.kind === 'scalar'
        ? (seen.get(ch)!.value as { value: number }).value
        : undefined;
    expect(val(Channels.Electrical.BatterySoc)).toBe(68);
    expect(val(Channels.Electrical.SolarPower)).toBe(1946);
    expect(val(Channels.Electrical.AcOutputPower)).toBe(1000);
    expect(seen.has(Channels.Electrical.DcPower)).toBe(false); // null skipped
  });
});
```

- [ ] **Step 4: Run — expect FAIL** (`./publisher.js` missing)

Run: `npx vitest run packages/bridge/src/victron/publisher.test.ts`

- [ ] **Step 5: Write the publisher** (`packages/bridge/src/victron/publisher.ts`)

```ts
import { Channels, type Bus, type VictronSnapshot } from '@g5000/core';

const SOURCE = 'victron';

export function publishVictronToBus(bus: Bus, snap: VictronSnapshot, source = SOURCE): void {
  const emit = (channel: string, value: number | null): void => {
    if (value === null) return;
    bus.publish({
      channel,
      source,
      t_ms: snap.updatedAt,
      value: { kind: 'scalar', value },
    });
  };
  emit(Channels.Electrical.BatterySoc, snap.battery.soc);
  emit(Channels.Electrical.BatteryVoltage, snap.battery.voltage);
  emit(Channels.Electrical.BatteryCurrent, snap.battery.current);
  emit(Channels.Electrical.BatteryPower, snap.battery.power);
  emit(Channels.Electrical.DcPower, snap.dc.power);
  emit(Channels.Electrical.AcInputPower, snap.ac.inputPower);
  emit(Channels.Electrical.AcOutputPower, snap.ac.outputPower);
  emit(Channels.Electrical.SolarPower, snap.solar.totalPower);
}
```

> **Note:** confirm the exact `bus.publish({...})` sample shape against `packages/bridge/src/channel-mapper.ts` (how it constructs samples) and `Bus` in `packages/core/src/bus.ts` before finalizing — match the existing `Sample`/`JsonSafeSample` construction used there (field names `channel`/`source`/`t_ms`/`value`). Adjust the test's `value.kind === 'scalar'` access if the codebase uses a different scalar wrapper.

- [ ] **Step 6: Run — expect PASS**

- [ ] **Step 7: Re-export** from `packages/bridge/src/index.ts`:

```ts
export { createVictronRegistry } from './victron/registry.js';
export { publishVictronToBus } from './victron/publisher.js';
export { startVictronMqttDriver } from './victron/mqtt-driver.js'; // added in Task 5
export { startVictronSim } from './victron/sim.js'; // added in Task 6
```

(Add the driver/sim exports now as forward references only if the files exist; otherwise add them in Tasks 5/6. To keep the build green, add each export line in the task that creates its file.)

- [ ] **Step 8: Build + commit**

```bash
npx tsc -b packages/core packages/bridge
git add packages/core/src/channels.ts packages/bridge/src/victron/registry.ts packages/bridge/src/victron/publisher.ts packages/bridge/src/victron/publisher.test.ts packages/bridge/src/index.ts
git commit -m "feat(victron): shared registry + bus publisher + electrical channels"
```

---

### Task 4: MQTT driver (connect / discover / keepalive / subscribe / reconnect)

**Files:**

- Create: `packages/bridge/src/victron/mqtt-driver.ts`
- Test: `packages/bridge/src/victron/mqtt-driver.test.ts`
- Modify: `packages/bridge/package.json` (add `"mqtt": "^5"`), then `npm install`
- Modify: `packages/bridge/src/index.ts` (export `startVictronMqttDriver`)

**Interfaces:**

- Consumes: `mqtt` package, `VictronRegistry`, `Bus`, `publishVictronToBus`.
- Produces:
  - `interface VictronDriverOpts { host: string; port?: number; portalId?: string; registry: VictronRegistry; bus: Bus; publishIntervalMs?: number; keepaliveMs?: number; connect?: MqttConnectFn; }`
  - `type MqttConnectFn = (url: string) => MqttLike` (injectable for tests).
  - `interface MqttLike { on(ev: string, cb: (...a: any[]) => void): void; subscribe(topic: string): void; publish(topic: string, payload: string): void; end(): void; }`
  - `function startVictronMqttDriver(opts: VictronDriverOpts): () => void` (returns teardown).

**Design notes (implement to these):**

- On `connect`: `setConnected(true)`, subscribe `N/+/system/0/Serial` to learn the portal id if not provided, then subscribe `N/<portalId>/#`, publish `R/<portalId>/keepalive` (empty) once, and start a **30 s** keepalive timer publishing `R/<portalId>/keepalive` with `{"keepalive-options":["suppress-republish"]}`.
- On `message(topic,payload)`: if portal id still unknown and topic matches `N/<id>/system/0/Serial`, capture `<id>` and do the subscribe+keepalive bootstrap. Otherwise `registry.update(topic, payload.toString())`.
- A **publish timer** (default 1 s) calls `publishVictronToBus(bus, registry.snapshot())` so headline channels stay fresh without publishing on every message.
- On `close`/`error`: `registry.markStale()`, clear timers, and let `mqtt`'s built-in reconnect handle backoff (or reconnect manually if the injected client doesn't).
- Teardown: clear timers, `client.end()`, `registry.markStale()`.

- [ ] **Step 1: Add dep**

```bash
cd packages/bridge && npm install mqtt@^5 && cd ../..
```

Expected: `mqtt` added to `packages/bridge/package.json` dependencies; root `package-lock.json` updated.

- [ ] **Step 2: Write the failing test** (injected fake client — no network)

```ts
// packages/bridge/src/victron/mqtt-driver.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Bus } from '@g5000/core';
import { createVictronRegistry } from './registry.js';
import { startVictronMqttDriver, type MqttLike } from './mqtt-driver.js';
import { setSharedVictron } from '@g5000/core';

function fakeClient() {
  const handlers = new Map<string, (...a: any[]) => void>();
  const published: Array<[string, string]> = [];
  const subscribed: string[] = [];
  const client: MqttLike & { emit: (ev: string, ...a: any[]) => void } = {
    on: (ev, cb) => handlers.set(ev, cb),
    subscribe: (t) => subscribed.push(t),
    publish: (t, p) => published.push([t, p]),
    end: () => {},
    emit: (ev, ...a) => handlers.get(ev)?.(...a),
  };
  return { client, published, subscribed };
}

describe('startVictronMqttDriver', () => {
  beforeEach(() => {
    setSharedVictron(undefined as never);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('discovers the portal id, subscribes, and starts a 30s keepalive', () => {
    const { client, published, subscribed } = fakeClient();
    const bus = new Bus();
    const registry = createVictronRegistry();
    const stop = startVictronMqttDriver({
      host: 'x',
      registry,
      bus,
      connect: () => client,
    });
    client.emit('connect');
    // Learns portal id from a Serial topic:
    client.emit(
      'message',
      'N/abc123/system/0/Serial',
      Buffer.from(JSON.stringify({ value: 'abc123' })),
    );
    expect(subscribed).toContain('N/abc123/#');
    expect(published.some(([t]) => t === 'R/abc123/keepalive')).toBe(true);
    published.length = 0;
    vi.advanceTimersByTime(30_000);
    const ka = published.find(([t]) => t === 'R/abc123/keepalive');
    expect(ka).toBeTruthy();
    expect(ka![1]).toContain('suppress-republish');
    stop();
  });

  it('feeds instrument messages into the registry snapshot', () => {
    const { client } = fakeClient();
    const registry = createVictronRegistry();
    startVictronMqttDriver({
      host: 'x',
      portalId: 'p',
      registry,
      bus: new Bus(),
      connect: () => client,
    });
    client.emit('connect');
    client.emit(
      'message',
      'N/p/system/0/Dc/Battery/Soc',
      Buffer.from(JSON.stringify({ value: 55 })),
    );
    expect(registry.snapshot().battery.soc).toBe(55);
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (`./mqtt-driver.js` missing)

- [ ] **Step 4: Implement** `packages/bridge/src/victron/mqtt-driver.ts` per the Design notes above. Use `import mqtt from 'mqtt'` for the default `connect` (`(url) => mqtt.connect(url, { reconnectPeriod: 5000 })`), but allow `opts.connect` to override. Guard all timers in the teardown.

- [ ] **Step 5: Run — expect PASS.** Then `npx tsc -b packages/bridge` (expect clean).

- [ ] **Step 6: Export + commit**

```bash
git add packages/bridge/src/victron/mqtt-driver.ts packages/bridge/src/victron/mqtt-driver.test.ts packages/bridge/src/index.ts packages/bridge/package.json package-lock.json
git commit -m "feat(victron): MQTT driver (portal discovery, keepalive, resilience)"
```

---

### Task 5: Deterministic simulator

**Files:**

- Create: `packages/bridge/src/victron/sim.ts`
- Test: `packages/bridge/src/victron/sim.test.ts`
- Modify: `packages/bridge/src/index.ts` (export `startVictronSim`)

**Interfaces:**

- Produces:
  - `interface VictronSimOpts { registry: VictronRegistry; bus: Bus; tickMs?: number; now?: () => number; }`
  - `function startVictronSim(opts: VictronSimOpts): () => void`
  - `function simSnapshotAt(tSec: number): Array<[string, unknown]>` — pure helper returning `[topic, value]` pairs for a given time (used by the tick and the test).

**Design notes:** `simSnapshotAt(tSec)` produces realistic values — a solar day-curve (bell over ~06:00–18:00), SoC that tracks it, per-MPPT (5 chargers, e.g. instances 279..283) splitting the total, a couple of tanks and temperatures, AC/DC loads. Deterministic: **no `Date.now()`/`Math.random()`** — derive everything from `tSec` (e.g. `Math.sin`). Portal is a constant `'sim'`; topics are `N/sim/<service>/<inst>/<path>` fed through `registry.update`. The tick calls `simSnapshotAt(now()/1000)`, feeds all pairs, `setConnected(true)`, and `publishVictronToBus`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/bridge/src/victron/sim.test.ts
import { describe, it, expect } from 'vitest';
import { simSnapshotAt } from './sim.js';

describe('simSnapshotAt', () => {
  it('is deterministic for a fixed time', () => {
    const a = simSnapshotAt(12 * 3600); // local noon-ish
    const b = simSnapshotAt(12 * 3600);
    expect(a).toEqual(b);
  });
  it('produces more solar at midday than midnight', () => {
    const at = (t: number) =>
      Number(simSnapshotAt(t).find(([topic]) => topic.endsWith('system/0/Dc/Pv/Power'))?.[1] ?? 0);
    expect(at(12 * 3600)).toBeGreaterThan(at(0));
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `sim.ts`** per Design notes.
- [ ] **Step 4: Run — expect PASS.** `npx tsc -b packages/bridge`.
- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/victron/sim.ts packages/bridge/src/victron/sim.test.ts packages/bridge/src/index.ts
git commit -m "feat(victron): deterministic off-boat simulator"
```

---

### Task 6: Wire into app boot + `GET /api/victron/state`

**Files:**

- Create: `apps/g5000/src/victron.ts`
- Modify: `apps/g5000/src/index.ts` (call `startVictron`)
- Create: `packages/web/src/app/api/victron/state/route.ts`

**Interfaces:**

- Consumes: `createVictronRegistry`, `startVictronMqttDriver`, `startVictronSim`, `Bus`, env vars.
- Produces: `function startVictron(bus: Bus): () => void` (teardown).

- [ ] **Step 1: Write `apps/g5000/src/victron.ts`**

```ts
import type { Bus } from '@g5000/core';
import { createVictronRegistry, startVictronMqttDriver, startVictronSim } from '@g5000/bridge';

/**
 * Start the Victron subsystem. Live driver when VICTRON_MQTT_HOST is set
 * (and not 'none'); deterministic simulator under VICTRON_SIM=1 or DEMO_MODE=1;
 * otherwise the registry exists but stays empty (UI shows "Cerbo offline").
 * Never throws — a Cerbo that's off must not affect boot.
 */
export function startVictron(bus: Bus): () => void {
  const registry = createVictronRegistry();
  const host = process.env.VICTRON_MQTT_HOST;
  const sim = process.env.VICTRON_SIM === '1' || process.env.DEMO_MODE === '1';
  try {
    if (host && host !== 'none') {
      const stop = startVictronMqttDriver({
        host,
        port: Number(process.env.VICTRON_MQTT_PORT ?? 1883),
        portalId: process.env.VICTRON_PORTAL_ID,
        registry,
        bus,
      });
      // eslint-disable-next-line no-console
      console.log(`[g5000] victron driver online (mqtt://${host})`);
      return stop;
    }
    if (sim) {
      const stop = startVictronSim({ registry, bus });
      // eslint-disable-next-line no-console
      console.log('[g5000] victron simulator online');
      return stop;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[g5000] victron start failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return () => {};
}
```

- [ ] **Step 2: Call it in `apps/g5000/src/index.ts`** — after the AIS registry block (~line 136), add:

```ts
import { startVictron } from './victron.js'; // top with the other imports
```

```ts
// Victron Venus OS (Cerbo) — battery/solar/tanks/temps via MQTT (or sim).
const stopVictron = startVictron(bus);
teardown.push(async () => stopVictron());
```

- [ ] **Step 3: Write the API route** `packages/web/src/app/api/victron/state/route.ts`

```ts
import { getSharedVictron } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET → the current Victron snapshot, or an offline shell when no driver is wired. */
export async function GET(): Promise<Response> {
  const reg = getSharedVictron();
  if (!reg) {
    return Response.json({ connected: false, offline: true }, { status: 200 });
  }
  return Response.json(reg.snapshot());
}
```

- [ ] **Step 4: Build the app + verify manually**

```bash
npx tsc -b packages/core packages/bridge
cd apps/g5000 && npm run build && cd ../..
```

Then, in one terminal: `VICTRON_SIM=1 SKIP_BRIDGE=1 npm run dev --workspace @g5000/app` (or full dev), and:

```bash
curl -s localhost:3000/api/victron/state | head
```

Expected: JSON with `"connected":true`, non-null `battery.soc`, `solar.totalPower`, ≥1 charger.

- [ ] **Step 5: Commit**

```bash
git add apps/g5000/src/victron.ts apps/g5000/src/index.ts packages/web/src/app/api/victron/state/route.ts
git commit -m "feat(victron): wire driver/sim into boot + GET /api/victron/state"
```

**✅ Phase B checkpoint:** the Victron subsystem is complete and verifiable off-boat via the simulator.

---

## PHASE A1 — Dashboard shell

### Task 7: `/anchor` page shell + drawer + navbar tab

**Files:**

- Create: `packages/web/src/app/anchor/page.tsx`
- Create: `packages/web/src/app/anchor/drawer.tsx` (drawer container + tab bar)
- Modify: `packages/web/src/app/Navbar.tsx` (add `{ href: '/anchor', label: 'Anchor' }` to `TOP_LEVEL`, after `/chart`)

**Interfaces:**

- Produces: default-exported `AnchorPage` client component. Drawer state (`open tab | null`) persisted in `localStorage['anchor:drawer']`.

**Design notes:** g5000 dark theme (match existing pages' Tailwind classes — read `packages/web/src/app/helm/page.tsx` for the class vocabulary). Top zone = CSS grid (`grid grid-cols-…`) of placeholder panel cards. Drawer = fixed bottom bar with tab buttons (`Forecast · Table · Tides · Radar · Sky · Solar`); clicking a tab expands a panel above the bar; a chevron/again-click collapses. Use `useSse()` at the page level and thread the `channels` map to panels via props (avoid one EventSource per panel).

- [ ] **Step 1: Build the shell** with placeholder panels (`<div>Depth</div>` etc.) and a working drawer (empty tab bodies). Add the navbar entry.
- [ ] **Step 2: Verify** — `npm run build --workspace @g5000/web` compiles; `npm run dev` → `/anchor` renders the grid; clicking a tab opens/closes the drawer; the selected tab survives reload.
- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/anchor/page.tsx packages/web/src/app/anchor/drawer.tsx packages/web/src/app/Navbar.tsx
git commit -m "feat(anchor): page shell, slide-up drawer, navbar tab"
```

---

## PHASE A2 — Pure client libs (TDD)

Each lib is a pure function with a co-located `*.test.ts`. Follow the same 5-step TDD cycle (write failing test → run fail → implement → run pass → commit). Full test+impl code below.

### Task 8: `lib/rode-scope.ts`

**Files:** Create `packages/web/src/lib/rode-scope.ts` + `rode-scope.test.ts`.

```ts
// rode-scope.test.ts
import { describe, it, expect } from 'vitest';
import { computeScope } from './rode-scope';
describe('computeScope', () => {
  it('scope = rode / (depth + bowHeight)', () => {
    const r = computeScope({ chainCounter: 122, droopDeduct: 5, depthM: 12.5, bowHeightM: 1.7 });
    expect(r.rode).toBe(117);
    expect(r.totalPlusBow).toBeCloseTo(14.2, 5);
    expect(r.scope).toBeCloseTo(117 / 14.2, 4);
  });
  it('returns null scope when depth+bow is zero', () => {
    expect(
      computeScope({ chainCounter: 30, droopDeduct: 0, depthM: 0, bowHeightM: 0 }).scope,
    ).toBeNull();
  });
});
```

```ts
// rode-scope.ts
export interface ScopeInput {
  chainCounter: number;
  droopDeduct: number;
  depthM: number;
  bowHeightM: number;
}
export interface ScopeResult {
  rode: number;
  totalPlusBow: number;
  scope: number | null;
}
export function computeScope(i: ScopeInput): ScopeResult {
  const rode = Math.max(0, i.chainCounter - i.droopDeduct);
  const totalPlusBow = i.depthM + i.bowHeightM;
  return { rode, totalPlusBow, scope: totalPlusBow > 0 ? rode / totalPlusBow : null };
}
```

Commit: `feat(anchor): rode/scope calculator`.

### Task 9: `lib/depth-offset.ts`

**Files:** Create `packages/web/src/lib/depth-offset.ts` + test.

```ts
// depth-offset.test.ts
import { describe, it, expect } from 'vitest';
import { deriveDepths } from './depth-offset';
describe('deriveDepths', () => {
  it('raw only when no offsets', () => {
    expect(deriveDepths(6.3, {})).toEqual({ sounderM: 6.3, underKeelM: null, totalM: null });
  });
  it('adds under-keel and total when offsets set', () => {
    const d = deriveDepths(6.3, { keelBelowTransducerM: 0.3, transducerToWaterlineM: 0.5 });
    expect(d.underKeelM).toBeCloseTo(6.0, 5);
    expect(d.totalM).toBeCloseTo(6.8, 5);
  });
});
```

```ts
// depth-offset.ts
export interface DepthOffsets {
  keelBelowTransducerM?: number;
  transducerToWaterlineM?: number;
}
export interface Depths {
  sounderM: number;
  underKeelM: number | null;
  totalM: number | null;
}
export function deriveDepths(sounderM: number, o: DepthOffsets): Depths {
  return {
    sounderM,
    underKeelM: o.keelBelowTransducerM != null ? sounderM - o.keelBelowTransducerM : null,
    totalM: o.transducerToWaterlineM != null ? sounderM + o.transducerToWaterlineM : null,
  };
}
```

Commit: `feat(anchor): depth-offset math`.

### Task 10: `lib/gust.ts`

**Files:** Create `packages/web/src/lib/gust.ts` + `gust.test.ts` (test the pure `rollingMax`; the `useGust` hook is thin and untested).

```ts
// gust.test.ts
import { describe, it, expect } from 'vitest';
import { rollingMax } from './gust';
describe('rollingMax', () => {
  it('returns the max value within the window', () => {
    const s = [
      { t: 0, v: 10 },
      { t: 1000, v: 21 },
      { t: 2000, v: 15 },
    ];
    expect(rollingMax(s, 5000, 2000)).toBe(21);
  });
  it('excludes samples older than the window', () => {
    const s = [
      { t: 0, v: 30 },
      { t: 60_000, v: 12 },
    ];
    expect(rollingMax(s, 10_000, 60_000)).toBe(12);
  });
  it('returns null for an empty window', () => {
    expect(rollingMax([], 1000, 0)).toBeNull();
  });
});
```

```ts
// gust.ts
import { useChannelHistory } from '../hooks/use-channel-history';

export interface TV {
  t: number;
  v: number;
}
export function rollingMax(samples: TV[], windowMs: number, now: number): number | null {
  let max: number | null = null;
  for (const s of samples) {
    if (s.t >= now - windowMs && (max === null || s.v > max)) max = s.v;
  }
  return max;
}

/** Rolling gust (max) over a channel's history, in the channel's own units. */
export function useGust(channel: string, windowMs: number): number | null {
  const hist = useChannelHistory(channel, windowMs); // confirm signature vs hooks/use-channel-history.ts
  const samples = hist.history.map((h) => ({ t: h.t_ms, v: h.value }));
  return rollingMax(samples, windowMs, Date.now());
}
```

> Confirm `useChannelHistory`'s actual return shape (`.history` element fields) against `packages/web/src/hooks/use-channel-history.ts` and adapt the `.map` — the `rollingMax` test is the contract that must pass regardless.

Commit: `feat(anchor): rolling-max gust helper + hook`.

### Task 11: `lib/nearby-vessels.ts`

**Files:** Create `packages/web/src/lib/nearby-vessels.ts` + test.

```ts
// nearby-vessels.test.ts
import { describe, it, expect } from 'vitest';
import { rankVessels } from './nearby-vessels';
const own = { lat: 25.4859, lon: -76.6372 };
describe('rankVessels', () => {
  it('computes range + age and sorts nearest-first', () => {
    const now = 100_000;
    const ranked = rankVessels(
      [
        { mmsi: 1, name: 'FAR', lat: 25.5, lon: -76.63, lastSeenMs: now - 5000 },
        { mmsi: 2, name: 'NEAR', lat: 25.486, lon: -76.637, lastSeenMs: now - 1000 },
      ] as never,
      own,
      now,
    );
    expect(ranked[0]?.name).toBe('NEAR');
    expect(ranked[0]?.rangeM).toBeLessThan(ranked[1]!.rangeM);
    expect(ranked[0]?.ageMs).toBe(1000);
  });
  it('returns range null when own fix missing', () => {
    const ranked = rankVessels(
      [{ mmsi: 1, name: 'X', lat: 25.5, lon: -76.6, lastSeenMs: 0 }] as never,
      null,
      0,
    );
    expect(ranked[0]?.rangeM).toBeNull();
  });
});
```

```ts
// nearby-vessels.ts
import type { AisTarget } from '@g5000/core';
export interface RankedVessel {
  mmsi: number;
  name: string | null;
  rangeM: number | null;
  ageMs: number;
}
const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRad(b.lat - a.lat),
    dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
export function rankVessels(
  targets: AisTarget[],
  own: { lat: number; lon: number } | null,
  now: number,
): RankedVessel[] {
  return targets
    .map((t) => ({
      mmsi: t.mmsi,
      name: t.name ?? null,
      rangeM:
        own && t.lat != null && t.lon != null ? haversineM(own, { lat: t.lat, lon: t.lon }) : null,
      ageMs: now - t.lastSeenMs,
    }))
    .sort((a, b) => (a.rangeM ?? Infinity) - (b.rangeM ?? Infinity));
}
```

Commit: `feat(anchor): nearby-vessels ranking`.

### Task 12: `lib/sky.ts` (suncalc)

**Files:** Create `packages/web/src/lib/sky.ts` + `sky.test.ts`. Add dep: `cd packages/web && npm install suncalc && npm install -D @types/suncalc && cd ../..`.

```ts
// sky.test.ts
import { describe, it, expect } from 'vitest';
import { computeSky } from './sky';
describe('computeSky', () => {
  it('returns sunrise before sunset and a moon phase 0..1', () => {
    const s = computeSky(25.4859, -76.6372, new Date('2026-04-22T12:00:00Z'));
    expect(s.sunrise.getTime()).toBeLessThan(s.sunset.getTime());
    expect(s.moon.phase).toBeGreaterThanOrEqual(0);
    expect(s.moon.phase).toBeLessThanOrEqual(1);
    expect(s.dayLengthMs).toBeGreaterThan(0);
  });
});
```

```ts
// sky.ts
import SunCalc from 'suncalc';
export interface SkyInfo {
  sunrise: Date;
  sunset: Date;
  civilDawn: Date;
  civilDusk: Date;
  nauticalDawn: Date;
  nauticalDusk: Date;
  astroDawn: Date;
  astroDusk: Date;
  dayLengthMs: number;
  moon: { phase: number; illumination: number; rise: Date | null; set: Date | null };
}
export function computeSky(lat: number, lon: number, date: Date): SkyInfo {
  const t = SunCalc.getTimes(date, lat, lon);
  const illum = SunCalc.getMoonIllumination(date);
  const moonT = SunCalc.getMoonTimes(date, lat, lon);
  return {
    sunrise: t.sunrise,
    sunset: t.sunset,
    civilDawn: t.dawn,
    civilDusk: t.dusk,
    nauticalDawn: t.nauticalDawn,
    nauticalDusk: t.nauticalDusk,
    astroDawn: t.nightEnd,
    astroDusk: t.night,
    dayLengthMs: t.sunset.getTime() - t.sunrise.getTime(),
    moon: {
      phase: illum.phase,
      illumination: illum.fraction,
      rise: moonT.rise ?? null,
      set: moonT.set ?? null,
    },
  };
}
```

Commit: `feat(anchor): sky/astro (suncalc)`. Also add `suncalc` to `packages/web/next.config.ts` `serverExternalPackages`? **No** — it's a client-side pure lib; leave it bundled.

---

## PHASE A3 — Instrument panels

> These are visual React components; they are **not** unit-tested (per the spec). Each task: implement the component reading its data, verify visually against the screenshots via `npm run dev`, then `npm run build --workspace @g5000/web` before commit. Reuse the DMM formatter already in the codebase — grep `formatDmm`/`toDmm` in `packages/web/src` and reuse it; if none, add `packages/web/src/lib/dmm.ts` with a small tested formatter.

### Task 13: DepthPanel + PositionPanel

**Files:** Create `packages/web/src/app/anchor/panels/DepthPanel.tsx`, `PositionPanel.tsx`. Props: `{ channels: ReadonlyMap<string, JsonSafeSample>; offsets: DepthOffsets }`.

- `DepthPanel`: read `nav.depth` scalar; `deriveDepths`; big number + "UNDER KEEL"/"total depth" sub-lines when offsets set, else single `DEPTH` label.
- `PositionPanel`: read `nav.gps.position` (lat/lon) → DMM; heading from `boat.heading.magnetic`/`.true` (whichever present) as `NNN° <cardinal>`.
  Verify vs screenshots; commit `feat(anchor): depth + position panels`.

### Task 14: NearbyVesselsPanel

**Files:** Create `panels/NearbyVesselsPanel.tsx`. Polls `/api/ais/targets` every 3 s (mirror `AisTargets.tsx`'s poll), reads own fix from `channels.get('nav.gps.position')`, `rankVessels`, renders a list (name, range in m/NM, age "25s ago"). Fade rows with `ageMs > 60_000`. Empty state "No vessels nearby". Commit `feat(anchor): nearby-vessels panel`.

### Task 15: WindDial

**Files:** Create `panels/WindDial.tsx`. SVG compass, course-up: outer ring with N/E/S/W + tick labels rotated by `-heading`; a wind barb at AWA; center shows big AWS in **kts** (convert m/s→kts ×1.94384) + `PORT/STARBOARD <n>°`. Footer: gusts via `useGust('wind.apparent.speed', 600_000)` and `…, 3_600_000)`, shown in kts. Props: `{ channels }`. Reference the tick/label math against any existing compass code; keep it a standalone SVG. Verify vs screenshots; commit `feat(anchor): apparent-wind course-up dial with gusts`.

### Task 16: AnchorWatchPanel + RodeScopeCalc

**Files:** Create `panels/AnchorWatchPanel.tsx`.

- Poll `GET /api/alarms/anchor` every 2 s (mirror `AnchorWatchLayer.tsx`). Compute distance/bearing from `channels['nav.gps.position']` → `anchor.anchorPoint ?? anchor.point` (reuse the haversine + `destPoint` already in `AnchorWatchLayer.tsx`; extract shared geometry to `packages/web/src/lib/geo.ts` if cleaner).
- Mini plan-view: a small `<svg>`/`<canvas>` (NOT MapLibre) drawing the drag circle, anchor marker, boat dot, rode line — north-up, scaled to `radiusM`.
- Controls: **Drop here (use GPS)** → `POST /api/alarms/anchor {action:'drop'}`; **Clear** → `{action:'weigh'}`; radius field (existing). Match the anchor API request shape used elsewhere (verify against `packages/web/src/app/api/alarms/anchor/route.ts`).
- Embed `RodeScopeCalc`: inputs chain-counter (localStorage `anchor:chainCounter`), droop-deduct + bow-height (from anchor-dashboard config, Task 24; default 0 until then), depth from `nav.depth`; show `computeScope` result (rode / total+bow / scope).
  Verify vs screenshots; commit `feat(anchor): anchor-watch panel + rode/scope calc`.

---

## PHASE A4 — Open-Meteo weather

### Task 17: Weather DTO + fetch lib (TDD) + routes

**Files:**

- Create: `packages/web/src/lib/weather-dto.ts` + `weather-dto.test.ts` (pure parse: raw Open-Meteo JSON → `WeatherCurrent`/`WeatherForecast`).
- Create: `packages/web/src/app/api/weather/current/route.ts`, `packages/web/src/app/api/weather/forecast/route.ts`.
- Create: `packages/web/src/lib/weather-cache.ts` (memory + disk cache under `~/.g5000-router/weather-cache`, TTL + last-good fallback) — mirror the tile-proxy disk-cache pattern in `packages/web/src/app/api/sat-tiles/[z]/[x]/[y]/route.ts`.

**Interfaces:**

- `interface WeatherCurrent { tempC, apparentC, condition, precipProb, windKn, gustKn, humidity, uv, pressure, updatedAt }`
- `interface WeatherForecast { hourly: HourPoint[]; daily: DayPoint[]; fetchedAt: number }`
- `parseCurrent(raw): WeatherCurrent`, `parseForecast(raw): WeatherForecast`.

- [ ] TDD `weather-dto` with a small captured Open-Meteo JSON fixture (embed a trimmed real response — call `https://api.open-meteo.com/v1/forecast?latitude=25.49&longitude=-76.64&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_gusts_10m&hourly=temperature_2m,precipitation_probability,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,uv_index,pressure_msl&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&wind_speed_unit=kn&timezone=UTC` once, paste a trimmed body as the fixture). Assert unit conversions (Open-Meteo returns wind in kn via `wind_speed_unit=kn`; temp in °C default).
- [ ] Routes: read lat/lon from query (`?lat=&lon=`) or the anchor-dashboard `weatherPin`/last fix; call Open-Meteo server-side; cache; on upstream failure return last-good with a `stale: true` flag; `runtime='nodejs'`, `dynamic='force-dynamic'`.
- [ ] Verify: `curl 'localhost:3000/api/weather/current?lat=25.49&lon=-76.64'` returns a `WeatherCurrent`.
- [ ] Commit `feat(anchor): Open-Meteo weather DTO, cache, and routes`.

### Task 18: TodayNowPanel + Forecast tabs

**Files:** Create `panels/TodayNowPanel.tsx`, `tabs/ForecastGraphTab.tsx`, `tabs/ForecastTableTab.tsx`.

- `TodayNowPanel`: `WeatherCurrent` (temp, condition, wind, precip) + tide-now. **Tide-now:** call the same tide data the `TidesTab` uses (Task 20) — reuse `@g5000/tide` `interpolateHeight(events, Date.now())` and next HW/LW from `/api/tide/events`. Show "—" when no station.
- `ForecastGraphTab`: meteogram from `WeatherForecast.hourly` — temp line, precip bars, wind line, day/night bands from `computeSky`. Use a lightweight SVG or the charting approach already used in `packages/web` (grep for existing chart components, e.g. the tide curve, and match).
- `ForecastTableTab`: hourly heatmap table (temp/wind/gust/dir/cloud/precip%/humidity/UV/pressure), color-scaled cells.
  Verify vs screenshots; `npm run build --workspace @g5000/web`; commit `feat(anchor): today-now + forecast graph/table`.

---

## PHASE A5 — Victron UI + remaining tabs

### Task 19: SystemsPanel + Tanks + Temperatures + SolarTab

**Files:** Create `panels/SystemsPanel.tsx` (+ Tanks/Temps as sibling cards or sub-components) and `tabs/SolarTab.tsx`.

- Poll `GET /api/victron/state` every 2 s. When `connected === false`/`offline`, render "Cerbo offline" (not zeros).
- `SystemsPanel`: SoC % + charge/discharge (A/W with sign→"CHARGING +28.8A +770W"), solar total W, AC out/in, DC power, time-to-go (from `battery.timeToGoS`). Tanks: bar gauges (level %, fluid type, colour by type). Temperatures: labelled °C list.
- `SolarTab`: per-charger cards (`snapshot.solar.chargers`) with V/I/P, state, day-max, yield-today; a system-total figure. (Curves are optional; a bar/number layout is acceptable for v1 since we have no per-charger history channel yet — note this in a comment.)
  Verify against the sim (`VICTRON_SIM=1`); commit `feat(anchor): systems/tanks/temps panels + solar tab`.

### Task 20: TidesTab + SkyTab + RadarTab

**Files:** Create `tabs/TidesTab.tsx`, `tabs/SkyTab.tsx`, `tabs/RadarTab.tsx`.

- `TidesTab`: reuse the `/tide` page's data hooks/lib — station picker (`/api/tide/stations`), events (`/api/tide/events`), current height (`interpolateHeight`), next HW/LW, and a curve (reuse or mirror the `/tide` page's chart). Respect the `canadianTideCurrents` gate + empty state, same as `/tide`.
- `SkyTab`: render `computeSky(lat, lon, now)` — sun rise/set + civil/nautical/astro twilight, day length, moon phase + illumination + upcoming phases (compute phase dates by scanning `SunCalc.getMoonIllumination` forward day-by-day for the next new/first/full/last).
- `RadarTab`: Windy embed `<iframe src="https://embed.windy.com/embed2.html?lat=…&lon=…&overlay=radar…">` centred on the fix; show a "no connection" placeholder when `navigator.onLine === false`.
  Verify; `npm run build --workspace @g5000/web`; commit `feat(anchor): tides, sky, radar tabs`.

---

## PHASE A6 — Config + finalize

### Task 21: Anchor-dashboard settings (bow height, droop, depth offsets, weather pin)

**Files:**

- Modify: `packages/web/src/app/settings/page.tsx` — add an "Anchor dashboard" section editing `settings.anchorDashboard` via the existing `GET/PUT /api/settings` file blob (see `packages/web/src/app/api/settings/route.ts`). Fields: `bowHeightM`, `droopDeductM`, `depthOffsets.{keelBelowTransducerM,transducerToWaterlineM}`, `weatherPin` (or "follow live fix").
- Modify: `panels/DepthPanel.tsx`, `panels/AnchorWatchPanel.tsx` (RodeScopeCalc), weather routes/panel to read `anchorDashboard` config (fetch `/api/settings`, use `settings.anchorDashboard ?? {}`).

- [ ] Implement the settings section + wire the three consumers to read the blob.
- [ ] Verify: setting bow height/offsets changes the DepthPanel and scope readouts; persists across reload.
- [ ] Commit `feat(anchor): anchor-dashboard settings (offsets, bow height, weather pin)`.

### Task 22: Docs, full build, and wire-up review

**Files:** Modify `CLAUDE.md` (add the `VICTRON_*` env gates to the Env-var gates list; add an "Anchor page (`/anchor`)" subsection describing the layout + drawer, mirroring the Chart-page section); modify the spec's Status to "Implemented (sim-verified; live Cerbo pending)".

- [ ] Add the env-var gate docs:
  - `VICTRON_MQTT_HOST=none` (default off; set to the Cerbo host e.g. `192.168.1.129`)
  - `VICTRON_MQTT_PORT=1883`, `VICTRON_SIM=1`, `VICTRON_PORTAL_ID` (optional override).
- [ ] Run the full gate:

```bash
npm run typecheck
npm run build            # includes next build (web) — the real web typecheck
npm test                 # expect ~baseline failures only (CLAUDE.md); new tests green
npm run lint
```

- [ ] Manual wire-up review of `/anchor` against the eleven screenshots (with `VICTRON_SIM=1`): top-zone panels populated, drawer tabs all render, "Cerbo offline" path works when the sim is off.
- [ ] Commit `docs(anchor): env gates + /anchor page docs; mark spec implemented`.

---

## Self-Review

**1. Spec coverage:**

- Dashboard shell + drawer → Task 7. ✅
- Depth/Position/NearbyVessels/WindDial+gust/AnchorWatch+RodeScope → Tasks 8–16. ✅
- Today&Now + Forecast Graph/Table (Open-Meteo) → Tasks 17–18. ✅
- Systems/Tanks/Temps + Solar tab (Victron) → Task 19. ✅
- Tides (reuse) / Sky (suncalc) / Radar (Windy) → Task 20. ✅
- Victron driver: types+registry (T1,T3), parser (T2), driver (T4), sim (T5), boot+API (T6). ✅
- Channels (electrical.\*) → Task 3. ✅
- Config (anchorDashboard) + settings → Task 21. ✅
- Env gates + docs → Task 22. ✅
- Metric units / knots / DMM → Global Constraints + panels. ✅
- Offline degradation (weather cache, Cerbo offline, radar no-conn) → Tasks 17,19,20. ✅
- Non-goals (Emporia, writes, VRM/Modbus) → not built. ✅

**2. Placeholder scan:** logic tasks (1–12, 17) carry full test+impl code; UI tasks (13–16, 18–22) specify files, data source, behavior, pattern-to-mirror, and acceptance — the deliberate "follow existing pattern" references (AisTargets, AnchorWatchLayer, sat-tiles cache, tide page) are pointers to real code, not hand-waving. Two explicit "confirm signature against <file>" notes (bus.publish sample shape; useChannelHistory return) are verification steps, not gaps.

**3. Type consistency:** `VictronSnapshot`/`VictronRegistry` defined in T1, consumed unchanged in T2/T3/T4/T6/T19. `computeScope`/`deriveDepths`/`rollingMax`/`rankVessels`/`computeSky` signatures defined once and consumed by their panels. `Channels.Electrical.*` names defined in T3 match the publisher + API. Consistent.

## Execution Handoff

Per project convention (user global CLAUDE.md), proceed directly with **superpowers:subagent-driven-development** — no inline-vs-subagent prompt.
