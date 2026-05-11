# G5000 Phase 0a — Bridge & Channel Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the workspace, NGT-1 driver, N2K decoder, channel mapper, and a Next.js channel-inspector page, so that an engineer can plug an NGT-1 into a real N2K bus and see decoded PGN values streaming live in a browser.

**Architecture:** npm-workspaces monorepo. Three packages (`core`, `bridge`, `web`) and one app (`autopilot-server`) that composes them in a single Node process. `core` defines types and an in-process RxJS pub/sub bus. `bridge` reads NGT-1 binary, decodes PGNs via canboatjs, maps decoded fields to hierarchical channel names, and publishes onto the bus. `web` is a Next.js app whose SSE route subscribes to the bus and streams to a `/inspect` page. `autopilot-server` boots the bridge, then starts Next.js with a custom server so both run in one process.

**Tech Stack:**

- Node.js 22 LTS, TypeScript 5.7
- npm workspaces (no Turbo/pnpm to keep bootstrap minimal)
- `rxjs@^7` for the bus
- `serialport@^12` for NGT-1 USB
- `@canboat/canboatjs@^2` for Actisense binary parsing + PGN decode (canboat database)
- `vitest@^2` for tests
- `next@^16`, React 19, Tailwind CSS v4 for the web UI
- `prettier`, `tsx` for tooling

**Reference spec:** `docs/superpowers/specs/2026-05-08-g5000-design.md`. This plan implements build-sequence steps 1–5 plus 10–11 (workspace, core types, NGT-1 driver, decoder, mapper, bridge, Next.js + SSE + `/inspect`). Steps 6–9 (0183, IMU, persistence, replay) and 12+ (compute, calibration, autopilot) are out of scope and will land in subsequent plans.

---

## Out-of-scope for this plan (deliberately)

- 0183 input, IMU input, persistence/replay
- Compute pipelines (true wind, polars, leeway, laylines)
- Calibration tables and editors
- N2K transmit (this plan is read-only on the bus)
- Autopilot integration
- Boat config editor, polars editor, all calibration wizards
- Drizzle / `config.db` (not needed yet — added in a later plan)
- Auth on the web UI (Phase 0 binds to LAN; auth is a later concern)

---

## File structure

```
autopilot/
├── .gitignore                    (already exists; will be extended)
├── .prettierrc.json              NEW
├── .editorconfig                 NEW
├── package.json                  NEW (root, workspaces)
├── tsconfig.base.json            NEW (shared compiler options)
├── vitest.config.ts              NEW (workspace-aware vitest)
├── packages/
│   ├── core/
│   │   ├── package.json          NEW
│   │   ├── tsconfig.json         NEW
│   │   └── src/
│   │       ├── types.ts          NEW: Sample, ChannelValue, SourceTag
│   │       ├── channels.ts       NEW: channel name constants
│   │       ├── bus.ts            NEW: RxJS pub/sub bus
│   │       ├── bus.test.ts       NEW
│   │       └── index.ts          NEW (barrel)
│   ├── bridge/
│   │   ├── package.json          NEW
│   │   ├── tsconfig.json         NEW
│   │   └── src/
│   │       ├── wire-driver.ts    NEW: WireDriver interface, RawCanFrame
│   │       ├── ngt-driver.ts     NEW: Ngt1Driver impl
│   │       ├── ngt-driver.test.ts NEW
│   │       ├── decoder.ts        NEW: N2K decoder via canboatjs
│   │       ├── decoder.test.ts   NEW
│   │       ├── channel-mapper.ts NEW: PGN field → channel mapping
│   │       ├── channel-mapper.test.ts NEW
│   │       ├── bridge.ts         NEW: pipeline orchestrator
│   │       ├── bridge.test.ts    NEW
│   │       └── index.ts          NEW
│   └── web/
│       ├── package.json          NEW
│       ├── next.config.ts        NEW
│       ├── tsconfig.json         NEW
│       ├── postcss.config.mjs    NEW
│       └── src/app/
│           ├── layout.tsx        NEW
│           ├── globals.css       NEW (Tailwind v4 import)
│           ├── page.tsx          NEW (status placeholder)
│           ├── api/stream/
│           │   └── route.ts      NEW (SSE handler)
│           └── inspect/
│               └── page.tsx      NEW (channel inspector)
└── apps/
    └── autopilot-server/
        ├── package.json          NEW
        ├── tsconfig.json         NEW
        └── src/
            └── index.ts          NEW (entry point)
```

---

## Task 1: Workspace bootstrap

**Files:**

- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.prettierrc.json`
- Create: `.editorconfig`
- Create: `vitest.config.ts`
- Modify: `.gitignore` (extend with workspace-specific ignores)

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "autopilot",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "prettier --check .",
    "format": "prettier --write .",
    "typecheck": "tsc -b"
  },
  "devDependencies": {
    "@types/node": "^22",
    "prettier": "^3.4",
    "tsx": "^4",
    "typescript": "^5.7",
    "vitest": "^2"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "forceConsistentCasingInFileNames": true,
    "incremental": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Create `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 4: Create `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    coverage: { provider: 'v8' },
    pool: 'forks',
  },
});
```

- [ ] **Step 6: Extend `.gitignore`**

Append to existing `.gitignore`:

```
# Build artifacts
*.tsbuildinfo
packages/*/dist/
apps/*/dist/

# Coverage
coverage/

# Next.js
.next/
out/
```

- [ ] **Step 7: Install root dev dependencies**

Run: `npm install`
Expected: completes without errors; creates `node_modules/`, `package-lock.json`.

- [ ] **Step 8: Verify TypeScript and Vitest are installed**

Run: `npx tsc --version && npx vitest --version`
Expected: prints both versions, no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.base.json .prettierrc.json .editorconfig vitest.config.ts .gitignore package-lock.json
git commit -m "chore: bootstrap npm workspaces with TypeScript, prettier, vitest"
```

---

## Task 2: Install runtime dependencies and verify canboatjs

**Files:** root `package.json` will be modified by `npm install`.

- [ ] **Step 1: Install core runtime deps at workspace root**

Run:

```bash
npm install rxjs@^7 serialport@^12 @canboat/canboatjs@^2
```

Expected: completes; `package-lock.json` updated; `rxjs`, `serialport`, `@canboat/canboatjs` appear under root `dependencies`. Note: workspaces will reference these via root resolution; we'll formalize per-package deps in their own `package.json` files in later tasks.

- [ ] **Step 2: Verify canboatjs imports and decodes a sample PGN**

Create a one-off smoke-test script `/tmp/smoke-canboat.mjs` to confirm the API shape before relying on it. **Do not commit this file.**

```js
// /tmp/smoke-canboat.mjs
import canboat from '@canboat/canboatjs';

console.log('canboatjs exports:', Object.keys(canboat));

// FromPgn parses canboat's "Actisense ASCII" line format:
//   "<timestamp>,<prio>,<pgn>,<src>,<dst>,<len>,<hex bytes>"
// Example: a wind PGN 130306 frame from a real bus
const sampleLine = '2024-01-01-12:00:00.000,2,130306,17,255,8,a0,16,02,fe,7f,ff,fa,fa';

const { FromPgn } = canboat;
const parser = new FromPgn();
parser.on('pgn', (pgn) => {
  console.log('decoded:', JSON.stringify(pgn.fields, null, 2));
});
parser.parseString(sampleLine);
```

Run: `node /tmp/smoke-canboat.mjs`
Expected: prints `decoded: { ... }` with at least `Wind Speed`, `Wind Angle`, `Reference` fields. If `parseString` doesn't exist, try `parse(sampleLine)` — the canboatjs README is authoritative if the API has shifted.

- [ ] **Step 3: Document the canboatjs version in the repo**

Run: `npm ls @canboat/canboatjs --depth=0`
Note the resolved version. If it's noticeably below `^2`, update this plan's tech-stack section to reflect what landed.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add runtime deps (rxjs, serialport, canboatjs)"
```

---

## Task 3: `core` package — types and channel constants

**Files:**

- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/channels.ts`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@g5000/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "rxjs": "^7"
  },
  "devDependencies": {
    "@types/node": "^22",
    "typescript": "^5.7",
    "vitest": "^2"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts"]
}
```

- [ ] **Step 3: Create `packages/core/src/types.ts`**

```ts
/**
 * Hierarchical channel name (e.g. "wind.apparent.angle"). Stored as a string
 * so wildcards/patterns are easy; constants live in channels.ts.
 */
export type Channel = string;

/** Sample value variants. Extend as new channel types appear. */
export type ChannelValue =
  | { kind: 'scalar'; value: number; unit?: string }
  | { kind: 'vec3'; value: [number, number, number] }
  | { kind: 'quat'; value: [number, number, number, number] } // x, y, z, w
  | { kind: 'geo'; value: { lat: number; lon: number } }
  | { kind: 'enum'; value: string };

export type SourceTag = string; // e.g. "n2k:127250@dev0x10", "0183:port1"

export interface Sample {
  channel: Channel;
  /** Nanoseconds since Unix epoch. BigInt to avoid Number precision loss. */
  t_ns: bigint;
  value: ChannelValue;
  source: SourceTag;
}
```

- [ ] **Step 4: Create `packages/core/src/channels.ts`**

```ts
/**
 * Canonical channel-name constants. Add new channels here as features land;
 * the channel-mapper imports from this file so name changes refactor cleanly.
 */
export const Channels = {
  Wind: {
    ApparentAngle: 'wind.apparent.angle',
    ApparentSpeed: 'wind.apparent.speed',
    TrueAngle: 'wind.true.angle',
    TrueSpeed: 'wind.true.speed',
    TrueDirection: 'wind.true.direction',
  },
  Boat: {
    SpeedWater: 'boat.speed.water',
    HeadingMagnetic: 'boat.heading.magnetic',
    HeadingTrue: 'boat.heading.true',
    RudderAngle: 'boat.rudder.angle',
  },
  Nav: {
    Position: 'nav.gps.position',
    Cog: 'nav.gps.cog',
    Sog: 'nav.gps.sog',
    Depth: 'nav.depth',
  },
  Motion: {
    Heel: 'motion.heel',
    Pitch: 'motion.pitch',
    Yaw: 'motion.yaw',
  },
} as const;
```

- [ ] **Step 5: Create `packages/core/src/index.ts` (barrel)**

```ts
export * from './types.js';
export * from './channels.js';
export * from './bus.js';
```

(Note: `./bus.js` doesn't exist yet — Task 4 creates it. The barrel resolves once Task 4 lands.)

- [ ] **Step 6: Run typecheck (will fail on missing bus.ts)**

Run: `npx tsc -b packages/core`
Expected: error about missing `./bus.js`. This is fine — Task 4 fixes it. Defer the typecheck verification to Task 4's completion.

- [ ] **Step 7: Commit**

```bash
git add packages/core/package.json packages/core/tsconfig.json packages/core/src/types.ts packages/core/src/channels.ts packages/core/src/index.ts
git commit -m "feat(core): add Sample/Channel types and channel constants"
```

---

## Task 4: `core` Bus implementation (TDD)

**Files:**

- Test: `packages/core/src/bus.test.ts`
- Create: `packages/core/src/bus.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/bus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Bus } from './bus.js';
import type { Sample } from './types.js';

const sample = (channel: string, n: number): Sample => ({
  channel,
  t_ns: BigInt(Date.now()) * 1_000_000n,
  value: { kind: 'scalar', value: n },
  source: 'test',
});

describe('Bus', () => {
  it('delivers samples to exact-channel subscribers', () => {
    const bus = new Bus();
    const received: Sample[] = [];
    bus.subscribe('wind.apparent.angle', (s) => received.push(s));
    bus.publish(sample('wind.apparent.angle', 42));
    expect(received).toHaveLength(1);
    expect(received[0]?.value).toEqual({ kind: 'scalar', value: 42 });
  });

  it('does not deliver samples on other channels', () => {
    const bus = new Bus();
    const received: Sample[] = [];
    bus.subscribe('wind.apparent.angle', (s) => received.push(s));
    bus.publish(sample('boat.speed.water', 7));
    expect(received).toHaveLength(0);
  });

  it('supports wildcard subscriptions with **', () => {
    const bus = new Bus();
    const received: string[] = [];
    bus.subscribe('wind.**', (s) => received.push(s.channel));
    bus.publish(sample('wind.apparent.angle', 1));
    bus.publish(sample('wind.true.speed', 2));
    bus.publish(sample('boat.speed.water', 3));
    expect(received).toEqual(['wind.apparent.angle', 'wind.true.speed']);
  });

  it('supports single-level wildcard with *', () => {
    const bus = new Bus();
    const received: string[] = [];
    bus.subscribe('wind.*.angle', (s) => received.push(s.channel));
    bus.publish(sample('wind.apparent.angle', 1));
    bus.publish(sample('wind.true.angle', 2));
    bus.publish(sample('wind.apparent.speed', 3));
    expect(received).toEqual(['wind.apparent.angle', 'wind.true.angle']);
  });

  it('returns an unsubscribe function', () => {
    const bus = new Bus();
    const received: Sample[] = [];
    const unsub = bus.subscribe('wind.**', (s) => received.push(s));
    bus.publish(sample('wind.apparent.angle', 1));
    unsub();
    bus.publish(sample('wind.apparent.angle', 2));
    expect(received).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test — expect failure (Bus not defined)**

Run: `npx vitest run packages/core/src/bus.test.ts`
Expected: FAIL with `Cannot find module './bus.js'` or similar.

- [ ] **Step 3: Implement `packages/core/src/bus.ts`**

```ts
import { Subject } from 'rxjs';
import type { Sample, Channel } from './types.js';

/**
 * In-process pub/sub for sailing data.
 *
 * Subscriptions accept a channel name or pattern:
 *   - exact:        "wind.apparent.angle"
 *   - one segment:  "wind.*.angle"          (any single dot-separated token)
 *   - many:         "wind.**"               (any number of trailing tokens)
 *
 * Implementation: a single RxJS Subject<Sample> with per-subscriber filtering.
 * Sufficient for our scale (≤ a few thousand samples/sec, dozens of
 * subscribers).
 */
export class Bus {
  private readonly subject = new Subject<Sample>();

  publish(sample: Sample): void {
    this.subject.next(sample);
  }

  subscribe(pattern: Channel, handler: (sample: Sample) => void): () => void {
    const matcher = compilePattern(pattern);
    const sub = this.subject.subscribe((sample) => {
      if (matcher(sample.channel)) handler(sample);
    });
    return () => sub.unsubscribe();
  }
}

/**
 * Compile a channel pattern into a predicate. Patterns use dots as segment
 * separators, `*` matches any single segment, `**` matches any number of
 * trailing segments (must appear last).
 */
function compilePattern(pattern: string): (channel: string) => boolean {
  if (!pattern.includes('*')) {
    return (ch) => ch === pattern;
  }
  const segs = pattern.split('.');
  const trailingDoubleStar = segs[segs.length - 1] === '**';
  const fixed = trailingDoubleStar ? segs.slice(0, -1) : segs;
  return (ch) => {
    const chSegs = ch.split('.');
    if (trailingDoubleStar) {
      if (chSegs.length < fixed.length) return false;
    } else if (chSegs.length !== fixed.length) {
      return false;
    }
    for (let i = 0; i < fixed.length; i++) {
      const f = fixed[i];
      const c = chSegs[i];
      if (f === '*') continue;
      if (f !== c) return false;
    }
    return true;
  };
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `npx vitest run packages/core/src/bus.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Verify the core package typechecks**

Run: `npx tsc -b packages/core`
Expected: clean exit (no errors).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/bus.ts packages/core/src/bus.test.ts
git commit -m "feat(core): add RxJS-backed Bus with pattern subscriptions"
```

---

## Task 5: `bridge` package — WireDriver interface and Ngt1Driver (TDD)

**Files:**

- Create: `packages/bridge/package.json`
- Create: `packages/bridge/tsconfig.json`
- Create: `packages/bridge/src/wire-driver.ts`
- Create: `packages/bridge/src/ngt-driver.ts`
- Test: `packages/bridge/src/ngt-driver.test.ts`

- [ ] **Step 1: Create `packages/bridge/package.json`**

```json
{
  "name": "@g5000/bridge",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@g5000/core": "*",
    "@canboat/canboatjs": "^2",
    "rxjs": "^7",
    "serialport": "^12"
  },
  "devDependencies": {
    "@types/node": "^22",
    "typescript": "^5.7",
    "vitest": "^2"
  }
}
```

- [ ] **Step 2: Create `packages/bridge/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 3: Re-run `npm install` to wire workspace symlinks**

Run: `npm install`
Expected: creates `node_modules/@g5000/core` symlink to `packages/core`.

- [ ] **Step 4: Create `packages/bridge/src/wire-driver.ts`**

```ts
import type { Observable } from 'rxjs';

/**
 * A raw extended-frame CAN message. The driver layer emits these unmodified;
 * fast-packet reassembly happens above the driver in the decoder layer. This
 * keeps the contract identical between Phase 0 (NGT-1) and Phase 1 (custom MCU).
 */
export interface RawCanFrame {
  /** 29-bit extended CAN identifier (priority + PGN + source addr packed). */
  id: number;
  /** Always true for N2K (J1939 uses 29-bit IDs). */
  ext: true;
  /** Up to 8 data bytes. */
  data: Uint8Array;
  /** Capture time on the host, ns since Unix epoch. */
  rxTimestamp: bigint;
}

export interface DriverHealth {
  connected: boolean;
  bytesPerSecond: number;
  framesPerSecond: number;
  errorCount: number;
}

/**
 * Phase-stable driver contract. Phase 0 implementations: Ngt1Driver,
 * SerialPort0183Driver, Bno085Driver. Phase 1: a single McuDriver.
 *
 * Observables are hot — subscribers receive only frames produced AFTER they
 * subscribe. Drivers must not buffer input.
 */
export interface WireDriver {
  rxCan: Observable<RawCanFrame>;
  txCan(frame: RawCanFrame): Promise<void>;
  health: Observable<DriverHealth>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

- [ ] **Step 5: Write the failing tests for `Ngt1Driver`**

`packages/bridge/src/ngt-driver.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { Ngt1Driver, type Ngt1Source } from './ngt-driver.js';

/**
 * A minimal in-memory Ngt1Source: the driver accepts any object that emits
 * 'data' Buffer events. We emit pre-recorded canboat ASCII lines, which is
 * the simplest form Ngt1Driver must understand.
 */
class MemorySource implements Ngt1Source {
  private listener: ((chunk: Buffer) => void) | null = null;
  on(event: 'data', cb: (chunk: Buffer) => void): this {
    if (event === 'data') this.listener = cb;
    return this;
  }
  off(): this {
    this.listener = null;
    return this;
  }
  emit(text: string): void {
    this.listener?.(Buffer.from(text, 'utf8'));
  }
}

describe('Ngt1Driver', () => {
  let source: MemorySource;
  let driver: Ngt1Driver;

  beforeEach(async () => {
    source = new MemorySource();
    driver = new Ngt1Driver({ source });
    await driver.start();
  });

  it('parses an Actisense ASCII wind-PGN line into a RawCanFrame', async () => {
    // PGN 130306 (wind), prio 2, src 17, dst 255, 8-byte payload.
    const line = '2024-01-01-12:00:00.000,2,130306,17,255,8,a0,16,02,fe,7f,ff,fa,fa\n';
    const framePromise = firstValueFrom(driver.rxCan);
    source.emit(line);
    const frame = await framePromise;
    expect(frame.ext).toBe(true);
    expect(frame.data).toBeInstanceOf(Uint8Array);
    expect(frame.data.length).toBe(8);
    // ID encodes prio (3 bits) + PGN (17 bits) + source (8 bits).
    // For PGN 130306 with prio 2 and src 17: see J1939 packing.
    expect(frame.id).toBeGreaterThan(0);
    expect(frame.rxTimestamp).toBeTypeOf('bigint');
  });

  it('emits one frame per line', async () => {
    const lines = [
      '2024-01-01-12:00:00.000,2,130306,17,255,8,a0,16,02,fe,7f,ff,fa,fa\n',
      '2024-01-01-12:00:00.100,2,128259,17,255,8,a0,01,00,00,00,00,ff,ff\n',
      '2024-01-01-12:00:00.200,3,127250,17,255,8,a0,01,d0,07,ff,ff,fc,ff\n',
    ];
    const collected = firstValueFrom(driver.rxCan.pipe(take(3), toArray()));
    for (const l of lines) source.emit(l);
    const frames = await collected;
    expect(frames).toHaveLength(3);
  });
});
```

- [ ] **Step 6: Run tests — expect failure (Ngt1Driver not defined)**

Run: `npx vitest run packages/bridge/src/ngt-driver.test.ts`
Expected: FAIL with `Cannot find module './ngt-driver.js'`.

- [ ] **Step 7: Implement `packages/bridge/src/ngt-driver.ts`**

```ts
import { Subject, type Observable, BehaviorSubject } from 'rxjs';
import type { RawCanFrame, WireDriver, DriverHealth } from './wire-driver.js';

/**
 * Anything that emits 'data' Buffer events. The serialport SerialPort class
 * matches this shape; a test harness can substitute a fake.
 */
export interface Ngt1Source {
  on(event: 'data', cb: (chunk: Buffer) => void): this;
  off(event: 'data', cb: (chunk: Buffer) => void): this;
}

export interface Ngt1DriverOptions {
  source: Ngt1Source;
}

/**
 * Reads canboat-style Actisense ASCII lines from the underlying source and
 * emits one RawCanFrame per parsed line.
 *
 * Why ASCII not binary: the canboatjs binary parser path requires more
 * setup (escape-byte unwrapping, message framing) and the NGT-1 firmware
 * supports an "ASCII out" mode via the canboat actisense-serial preamble.
 * We can swap to binary later if we drop canboat-actisense in favour of
 * raw NGT-1 framing — wire-driver.ts is the seam.
 */
export class Ngt1Driver implements WireDriver {
  readonly rxCan: Observable<RawCanFrame>;
  readonly health: Observable<DriverHealth>;

  private readonly rxSubject = new Subject<RawCanFrame>();
  private readonly healthSubject = new BehaviorSubject<DriverHealth>({
    connected: false,
    bytesPerSecond: 0,
    framesPerSecond: 0,
    errorCount: 0,
  });
  private readonly source: Ngt1Source;
  private buffer = '';
  private dataHandler = this.onData.bind(this);

  constructor(opts: Ngt1DriverOptions) {
    this.source = opts.source;
    this.rxCan = this.rxSubject.asObservable();
    this.health = this.healthSubject.asObservable();
  }

  async start(): Promise<void> {
    this.source.on('data', this.dataHandler);
    this.healthSubject.next({ ...this.healthSubject.value, connected: true });
  }

  async stop(): Promise<void> {
    this.source.off('data', this.dataHandler);
    this.healthSubject.next({ ...this.healthSubject.value, connected: false });
  }

  async txCan(_frame: RawCanFrame): Promise<void> {
    // TX support arrives in a later plan (Phase 0a milestone is read-only).
    throw new Error('Ngt1Driver.txCan not implemented in Phase 0a');
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line.length === 0) continue;
      try {
        const frame = parseActisenseLine(line);
        if (frame) this.rxSubject.next(frame);
      } catch (err) {
        const h = this.healthSubject.value;
        this.healthSubject.next({ ...h, errorCount: h.errorCount + 1 });
      }
    }
  }
}

/**
 * Parse one canboat-style Actisense ASCII line.
 *
 * Format: <iso-ish timestamp>,<prio>,<pgn>,<src>,<dst>,<len>,<hex>,<hex>,...
 *
 * We construct the 29-bit CAN ID per J1939: bits 26-28 are priority,
 * bits 8-25 hold the PGN with PF/PS handling, bits 0-7 hold source address.
 */
export function parseActisenseLine(line: string): RawCanFrame | null {
  const parts = line.split(',');
  if (parts.length < 7) return null;
  const [, prioStr, pgnStr, srcStr, , lenStr, ...hex] = parts;
  if (!prioStr || !pgnStr || !srcStr || !lenStr) return null;
  const prio = Number(prioStr);
  const pgn = Number(pgnStr);
  const src = Number(srcStr);
  const len = Number(lenStr);
  if (!Number.isFinite(prio) || !Number.isFinite(pgn) || !Number.isFinite(src)) {
    return null;
  }
  const data = new Uint8Array(len);
  for (let i = 0; i < len && i < hex.length; i++) {
    const byte = hex[i];
    if (byte === undefined) continue;
    data[i] = parseInt(byte, 16);
  }
  const id = encodeJ1939Id(prio, pgn, src);
  return {
    id,
    ext: true,
    data,
    rxTimestamp: BigInt(Date.now()) * 1_000_000n,
  };
}

/**
 * Pack priority (3 bits) + PGN (J1939 PDU1/PDU2 rules) + source address
 * (8 bits) into a 29-bit CAN identifier.
 *
 * For PDU1 messages (PF < 240), the destination address sits in the PS
 * (bits 8-15) and is replaced by 255 in the canonical PGN. For PDU2 (PF >= 240)
 * the PS is the group extension and is part of the PGN.
 *
 * For our purposes (read-only at this layer; broadcast-style PGNs only),
 * encoding with destination = 255 is sufficient.
 */
function encodeJ1939Id(prio: number, pgn: number, src: number): number {
  const pf = (pgn >> 8) & 0xff;
  const dp_pgn =
    pf < 240
      ? // PDU1: PS field carries destination addr; we use 255 (broadcast).
        ((pgn & 0x3ff00) | 0xff) & 0x3ffff
      : // PDU2: PS is part of the canonical PGN.
        pgn & 0x3ffff;
  return ((prio & 0x7) << 26) | (dp_pgn << 8) | (src & 0xff);
}
```

- [ ] **Step 8: Run tests — expect pass**

Run: `npx vitest run packages/bridge/src/ngt-driver.test.ts`
Expected: both tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/bridge/package.json packages/bridge/tsconfig.json packages/bridge/src/wire-driver.ts packages/bridge/src/ngt-driver.ts packages/bridge/src/ngt-driver.test.ts package-lock.json
git commit -m "feat(bridge): add WireDriver interface and Ngt1Driver with ASCII parser"
```

---

## Task 6: N2K decoder via canboatjs (TDD)

**Files:**

- Test: `packages/bridge/src/decoder.test.ts`
- Create: `packages/bridge/src/decoder.ts`

The decoder takes `RawCanFrame`s and produces canboat-decoded "PGN objects" with the original CAN ID's PGN extracted and the data bytes parsed via canboat's database.

- [ ] **Step 1: Write the failing test**

`packages/bridge/src/decoder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { decodeFrames, type DecodedPgn } from './decoder.js';
import { parseActisenseLine } from './ngt-driver.js';

describe('decodeFrames', () => {
  it('decodes a wind PGN 130306 from a raw CAN frame', async () => {
    const line = '2024-01-01-12:00:00.000,2,130306,17,255,8,a0,16,02,fe,7f,ff,fa,fa';
    const frame = parseActisenseLine(line);
    expect(frame).toBeTruthy();
    const decoded = await firstValueFrom(decodeFrames(of(frame!)));
    expect(decoded.pgn).toBe(130306);
    expect(decoded.src).toBe(17);
    expect(decoded.fields).toBeDefined();
    // canboat exposes wind speed and angle; field names may vary slightly,
    // but at least one of these is present:
    const fieldKeys = Object.keys(decoded.fields);
    expect(fieldKeys.some((k) => ['Wind Speed', 'Wind Angle', 'Reference'].includes(k))).toBe(true);
  });

  it('emits one DecodedPgn per single-frame input', async () => {
    const lines = [
      '2024-01-01-12:00:00.000,2,130306,17,255,8,a0,16,02,fe,7f,ff,fa,fa',
      '2024-01-01-12:00:00.100,2,128259,17,255,8,a0,01,00,00,00,00,ff,ff',
    ];
    const frames = lines.map(parseActisenseLine).filter((f) => f !== null);
    const result: DecodedPgn[] = [];
    await new Promise<void>((resolve) => {
      decodeFrames(of(...frames)).subscribe({
        next: (p) => result.push(p),
        complete: resolve,
      });
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.map((r) => r.pgn).sort()).toContain(130306);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npx vitest run packages/bridge/src/decoder.test.ts`
Expected: FAIL with `Cannot find module './decoder.js'`.

- [ ] **Step 3: Implement `packages/bridge/src/decoder.ts`**

```ts
import { Observable, type OperatorFunction } from 'rxjs';
import canboat from '@canboat/canboatjs';
import type { RawCanFrame } from './wire-driver.js';

const { FromPgn } = canboat as unknown as {
  FromPgn: new () => {
    on(event: 'pgn', cb: (pgn: CanboatPgn) => void): void;
    parseString(line: string): void;
  };
};

interface CanboatPgn {
  pgn: number;
  prio: number;
  src: number;
  dst: number;
  timestamp?: string;
  fields: Record<string, unknown>;
}

export interface DecodedPgn {
  pgn: number;
  prio: number;
  src: number;
  dst: number;
  fields: Record<string, unknown>;
  /** Receive timestamp from the upstream RawCanFrame. */
  rxTimestamp: bigint;
}

/**
 * Decode an Observable of RawCanFrames into DecodedPgns by feeding canboatjs.
 *
 * Implementation note: canboatjs's parser is line-oriented (Actisense ASCII).
 * We re-emit each frame as a synthetic ASCII line so canboatjs can do its
 * fast-packet reassembly and field extraction in one place. This means we
 * pay a string round-trip per frame, but at <1000 frames/sec on a CM5 this
 * is in the noise.
 */
export function decodeFrames(frames$: Observable<RawCanFrame>): Observable<DecodedPgn> {
  return new Observable<DecodedPgn>((subscriber) => {
    const parser = new FromPgn();
    const pendingTimestamps = new Map<number, bigint>(); // pgn → most-recent rxTimestamp
    parser.on('pgn', (pgn) => {
      const ts = pendingTimestamps.get(pgn.pgn) ?? 0n;
      subscriber.next({
        pgn: pgn.pgn,
        prio: pgn.prio,
        src: pgn.src,
        dst: pgn.dst,
        fields: pgn.fields,
        rxTimestamp: ts,
      });
    });
    const sub = frames$.subscribe({
      next: (frame) => {
        const pgn = pgnFromCanId(frame.id);
        const src = frame.id & 0xff;
        const prio = (frame.id >> 26) & 0x7;
        pendingTimestamps.set(pgn, frame.rxTimestamp);
        const hex = Array.from(frame.data, (b) => b.toString(16).padStart(2, '0'));
        const line = `${new Date().toISOString()},${prio},${pgn},${src},255,${frame.data.length},${hex.join(',')}`;
        parser.parseString(line);
      },
      error: (e) => subscriber.error(e),
      complete: () => subscriber.complete(),
    });
    return () => sub.unsubscribe();
  });
}

export const decode = (): OperatorFunction<RawCanFrame, DecodedPgn> => {
  return (frames$) => decodeFrames(frames$);
};

/**
 * Extract the PGN from a 29-bit J1939 identifier. Mirror of encodeJ1939Id
 * in ngt-driver.ts.
 */
function pgnFromCanId(id: number): number {
  const pf = (id >> 16) & 0xff;
  const ps = (id >> 8) & 0xff;
  if (pf < 240) {
    // PDU1: PGN excludes the destination byte (PS).
    return (pf << 8) & 0xffff00;
  }
  // PDU2: PS is part of the PGN.
  return ((pf << 8) | ps) & 0x3ffff;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run packages/bridge/src/decoder.test.ts`
Expected: both tests pass.

- [ ] **Step 5: If `parseString` doesn't exist on FromPgn, adjust**

If the test fails with "parser.parseString is not a function", check `node_modules/@canboat/canboatjs/lib/fromPgn.js`. The method may be named `parse` or the entry may need a different import path. Substitute the correct call. (Common alternatives: `parser.parse(line)`, `parser.parser.parseString(line)`.) Re-run tests.

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/decoder.ts packages/bridge/src/decoder.test.ts
git commit -m "feat(bridge): decode RawCanFrames to canboat PGNs"
```

---

## Task 7: Channel mapper (TDD)

**Files:**

- Test: `packages/bridge/src/channel-mapper.test.ts`
- Create: `packages/bridge/src/channel-mapper.ts`

Maps decoded PGN field values to channel-name samples. Phase 0a starts with three PGNs (wind 130306, water speed 128259, heading 127250). Adding more is one entry per PGN.

- [ ] **Step 1: Write the failing test**

`packages/bridge/src/channel-mapper.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapPgnToSamples } from './channel-mapper.js';
import type { DecodedPgn } from './decoder.js';
import { Channels } from '@g5000/core';

const make = (pgn: number, fields: Record<string, unknown>): DecodedPgn => ({
  pgn,
  prio: 2,
  src: 17,
  dst: 255,
  fields,
  rxTimestamp: 1_700_000_000_000_000_000n,
});

describe('mapPgnToSamples', () => {
  it('maps PGN 130306 wind fields to apparent angle and speed', () => {
    const decoded = make(130306, {
      'Wind Speed': 5.2,
      'Wind Angle': 0.785, // radians (~45°)
      Reference: 'Apparent',
    });
    const samples = mapPgnToSamples(decoded);
    const channels = samples.map((s) => s.channel);
    expect(channels).toContain(Channels.Wind.ApparentSpeed);
    expect(channels).toContain(Channels.Wind.ApparentAngle);
    const angle = samples.find((s) => s.channel === Channels.Wind.ApparentAngle);
    expect(angle?.value).toEqual({
      kind: 'scalar',
      value: 0.785,
      unit: 'rad',
    });
  });

  it('maps PGN 130306 wind with True reference to true.angle/speed', () => {
    const decoded = make(130306, {
      'Wind Speed': 7.5,
      'Wind Angle': 1.05,
      Reference: 'True (boat referenced)',
    });
    const samples = mapPgnToSamples(decoded);
    const channels = samples.map((s) => s.channel);
    expect(channels).toContain(Channels.Wind.TrueAngle);
    expect(channels).toContain(Channels.Wind.TrueSpeed);
  });

  it('maps PGN 128259 to boat.speed.water', () => {
    const decoded = make(128259, { 'Speed Water Referenced': 3.4 });
    const samples = mapPgnToSamples(decoded);
    expect(samples.map((s) => s.channel)).toEqual([Channels.Boat.SpeedWater]);
    expect(samples[0]?.value).toEqual({
      kind: 'scalar',
      value: 3.4,
      unit: 'm/s',
    });
  });

  it('maps PGN 127250 magnetic heading to boat.heading.magnetic', () => {
    const decoded = make(127250, {
      Heading: 1.234,
      Reference: 'Magnetic',
    });
    const samples = mapPgnToSamples(decoded);
    expect(samples.map((s) => s.channel)).toEqual([Channels.Boat.HeadingMagnetic]);
  });

  it('returns empty array for unknown PGN', () => {
    const decoded = make(999999, { irrelevant: 1 });
    expect(mapPgnToSamples(decoded)).toEqual([]);
  });

  it('tags samples with a source identifying the PGN and source addr', () => {
    const decoded = make(128259, { 'Speed Water Referenced': 3.4 });
    const samples = mapPgnToSamples(decoded);
    expect(samples[0]?.source).toBe('n2k:128259@0x11');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npx vitest run packages/bridge/src/channel-mapper.test.ts`
Expected: FAIL with `Cannot find module './channel-mapper.js'`.

- [ ] **Step 3: Implement `packages/bridge/src/channel-mapper.ts`**

```ts
import { Channels, type Sample, type ChannelValue } from '@g5000/core';
import type { DecodedPgn } from './decoder.js';

type MapperFn = (pgn: DecodedPgn) => Sample[];

const scalar = (value: number, unit?: string): ChannelValue => ({
  kind: 'scalar',
  value,
  unit,
});

const sourceTag = (pgn: DecodedPgn): string =>
  `n2k:${pgn.pgn}@0x${pgn.src.toString(16).padStart(2, '0')}`;

const mappers: Record<number, MapperFn> = {
  // PGN 130306 — wind data (apparent or true reference).
  130306: (pgn) => {
    const ref = String(pgn.fields['Reference'] ?? '');
    const speed = pgn.fields['Wind Speed'];
    const angle = pgn.fields['Wind Angle'];
    const isApparent = ref === 'Apparent';
    const speedChan = isApparent ? Channels.Wind.ApparentSpeed : Channels.Wind.TrueSpeed;
    const angleChan = isApparent ? Channels.Wind.ApparentAngle : Channels.Wind.TrueAngle;
    const out: Sample[] = [];
    if (typeof speed === 'number') {
      out.push({
        channel: speedChan,
        t_ns: pgn.rxTimestamp,
        value: scalar(speed, 'm/s'),
        source: sourceTag(pgn),
      });
    }
    if (typeof angle === 'number') {
      out.push({
        channel: angleChan,
        t_ns: pgn.rxTimestamp,
        value: scalar(angle, 'rad'),
        source: sourceTag(pgn),
      });
    }
    return out;
  },

  // PGN 128259 — boat speed through water.
  128259: (pgn) => {
    const v = pgn.fields['Speed Water Referenced'];
    if (typeof v !== 'number') return [];
    return [
      {
        channel: Channels.Boat.SpeedWater,
        t_ns: pgn.rxTimestamp,
        value: scalar(v, 'm/s'),
        source: sourceTag(pgn),
      },
    ];
  },

  // PGN 127250 — vessel heading.
  127250: (pgn) => {
    const ref = String(pgn.fields['Reference'] ?? '');
    const v = pgn.fields['Heading'];
    if (typeof v !== 'number') return [];
    const channel = ref === 'True' ? Channels.Boat.HeadingTrue : Channels.Boat.HeadingMagnetic;
    return [
      {
        channel,
        t_ns: pgn.rxTimestamp,
        value: scalar(v, 'rad'),
        source: sourceTag(pgn),
      },
    ];
  },
};

export function mapPgnToSamples(pgn: DecodedPgn): Sample[] {
  const fn = mappers[pgn.pgn];
  return fn ? fn(pgn) : [];
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run packages/bridge/src/channel-mapper.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/channel-mapper.ts packages/bridge/src/channel-mapper.test.ts
git commit -m "feat(bridge): add channel mapper for wind, speed, heading PGNs"
```

---

## Task 8: Bridge orchestrator (TDD)

**Files:**

- Test: `packages/bridge/src/bridge.test.ts`
- Create: `packages/bridge/src/bridge.ts`
- Create: `packages/bridge/src/index.ts`

The bridge composes driver → decoder → mapper → bus. It also exposes a way to wire any `WireDriver`, so future drivers (0183, IMU, MCU) can plug in without changing this file's wiring.

- [ ] **Step 1: Write the failing test**

`packages/bridge/src/bridge.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Bus, Channels, type Sample } from '@g5000/core';
import { runBridge } from './bridge.js';
import { Ngt1Driver, type Ngt1Source } from './ngt-driver.js';

class MemorySource implements Ngt1Source {
  private listener: ((c: Buffer) => void) | null = null;
  on(event: 'data', cb: (c: Buffer) => void) {
    if (event === 'data') this.listener = cb;
    return this;
  }
  off() {
    this.listener = null;
    return this;
  }
  emit(text: string) {
    this.listener?.(Buffer.from(text, 'utf8'));
  }
}

describe('runBridge', () => {
  let bus: Bus;
  let source: MemorySource;
  let driver: Ngt1Driver;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    bus = new Bus();
    source = new MemorySource();
    driver = new Ngt1Driver({ source });
    stop = await runBridge({ bus, drivers: [driver] });
  });

  it('publishes wind samples to the bus when an NGT-1 line arrives', async () => {
    const received: Sample[] = [];
    bus.subscribe('wind.**', (s) => received.push(s));

    source.emit('2024-01-01-12:00:00.000,2,130306,17,255,8,a0,16,02,fe,7f,ff,fa,fa\n');

    // Allow the RxJS chain to settle.
    await new Promise((r) => setTimeout(r, 10));

    expect(received.length).toBeGreaterThan(0);
    const channels = new Set(received.map((s) => s.channel));
    expect(
      channels.has(Channels.Wind.ApparentAngle) || channels.has(Channels.Wind.ApparentSpeed),
    ).toBe(true);

    await stop();
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npx vitest run packages/bridge/src/bridge.test.ts`
Expected: FAIL with `Cannot find module './bridge.js'`.

- [ ] **Step 3: Implement `packages/bridge/src/bridge.ts`**

```ts
import type { Bus } from '@g5000/core';
import { mergeMap, from, type Subscription } from 'rxjs';
import type { WireDriver } from './wire-driver.js';
import { decode } from './decoder.js';
import { mapPgnToSamples } from './channel-mapper.js';

export interface BridgeOptions {
  bus: Bus;
  drivers: WireDriver[];
}

/**
 * Wires each WireDriver's CAN stream through decode → mapPgnToSamples and
 * publishes the resulting Samples on the shared Bus. Returns a stop()
 * function that disconnects the drivers and unsubscribes the pipeline.
 */
export async function runBridge(opts: BridgeOptions): Promise<() => Promise<void>> {
  const { bus, drivers } = opts;
  await Promise.all(drivers.map((d) => d.start()));

  const subs: Subscription[] = drivers.map((driver) => {
    return driver.rxCan
      .pipe(
        decode(),
        mergeMap((pgn) => from(mapPgnToSamples(pgn))),
      )
      .subscribe({
        next: (sample) => bus.publish(sample),
        error: (err) => {
          // Errors should not kill the pipeline; log and continue.
          // eslint-disable-next-line no-console
          console.error('[bridge] pipeline error', err);
        },
      });
  });

  return async () => {
    for (const s of subs) s.unsubscribe();
    await Promise.all(drivers.map((d) => d.stop()));
  };
}
```

- [ ] **Step 4: Create `packages/bridge/src/index.ts`**

```ts
export * from './wire-driver.js';
export * from './ngt-driver.js';
export * from './decoder.js';
export * from './channel-mapper.js';
export * from './bridge.js';
```

- [ ] **Step 5: Run all bridge tests — expect pass**

Run: `npx vitest run packages/bridge`
Expected: all bridge tests pass (ngt-driver, decoder, channel-mapper, bridge).

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/bridge.ts packages/bridge/src/bridge.test.ts packages/bridge/src/index.ts
git commit -m "feat(bridge): orchestrator wires driver to decoder to mapper to bus"
```

---

## Task 9: `apps/autopilot-server` entry that opens a real serial port

**Files:**

- Create: `apps/autopilot-server/package.json`
- Create: `apps/autopilot-server/tsconfig.json`
- Create: `apps/autopilot-server/src/index.ts`

This is the runnable Node entry that opens `/dev/ttyUSB0` (or whatever the NGT-1 enumerates as) and prints decoded samples to stdout. **No web UI yet** — that lands in Task 12.

- [ ] **Step 1: Create `apps/autopilot-server/package.json`**

```json
{
  "name": "@g5000/autopilot-server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc -b",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@g5000/bridge": "*",
    "@g5000/core": "*",
    "rxjs": "^7",
    "serialport": "^12"
  },
  "devDependencies": {
    "@types/node": "^22",
    "tsx": "^4",
    "typescript": "^5.7"
  }
}
```

- [ ] **Step 2: Create `apps/autopilot-server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts"],
  "references": [{ "path": "../../packages/core" }, { "path": "../../packages/bridge" }]
}
```

- [ ] **Step 3: Implement `apps/autopilot-server/src/index.ts`**

```ts
import { SerialPort } from 'serialport';
import { Bus } from '@g5000/core';
import { Ngt1Driver, runBridge } from '@g5000/bridge';

const SERIAL_PATH = process.env.NGT1_PATH ?? '/dev/ttyUSB0';
const BAUD_RATE = Number(process.env.NGT1_BAUD ?? 115200);

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[autopilot] opening ${SERIAL_PATH} @ ${BAUD_RATE}`);

  const port = new SerialPort({
    path: SERIAL_PATH,
    baudRate: BAUD_RATE,
    autoOpen: false,
  });

  await new Promise<void>((resolve, reject) => {
    port.open((err) => (err ? reject(err) : resolve()));
  });

  const bus = new Bus();
  const driver = new Ngt1Driver({ source: port });
  const stop = await runBridge({ bus, drivers: [driver] });

  // Phase 0a: print every sample to stdout so we can confirm decode works.
  bus.subscribe('**', (s) => {
    // eslint-disable-next-line no-console
    console.log(
      `[${new Date(Number(s.t_ns / 1_000_000n)).toISOString()}] ${s.channel} = ${JSON.stringify(s.value)} (src=${s.source})`,
    );
  });

  const shutdown = async () => {
    // eslint-disable-next-line no-console
    console.log('[autopilot] shutting down');
    await stop();
    port.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[autopilot] fatal', err);
  process.exit(1);
});
```

- [ ] **Step 4: Reinstall to wire workspace symlinks**

Run: `npm install`
Expected: `node_modules/@g5000/autopilot-server` exists; symlinks to `@g5000/bridge` and `@g5000/core` resolve.

- [ ] **Step 5: Smoke-test the entry without an NGT-1**

Run: `NGT1_PATH=/dev/null npx tsx apps/autopilot-server/src/index.ts`
Expected: exits with an error (`/dev/null` is not a serial device) — proves the binary boots, parses options, and reaches the open() call. Manually verify in the boat later by setting `NGT1_PATH` to the real device path.

- [ ] **Step 6: Commit**

```bash
git add apps/autopilot-server/package.json apps/autopilot-server/tsconfig.json apps/autopilot-server/src/index.ts package-lock.json
git commit -m "feat(server): autopilot-server entry that opens NGT-1 and prints samples"
```

---

## Task 10: `web` package — Next.js skeleton with Tailwind v4

**Files:**

- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/next.config.ts`
- Create: `packages/web/postcss.config.mjs`
- Create: `packages/web/src/app/layout.tsx`
- Create: `packages/web/src/app/page.tsx`
- Create: `packages/web/src/app/globals.css`

- [ ] **Step 1: Create `packages/web/package.json`**

```json
{
  "name": "@g5000/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@g5000/core": "*",
    "next": "^16",
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "tailwindcss": "^4",
    "typescript": "^5.7"
  }
}
```

- [ ] **Step 2: Create `packages/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 3: Create `packages/web/next.config.ts`**

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Allow consuming the bus singleton from a parent process when integrated
    // via custom server in Task 12.
    externalDir: true,
  },
};

export default config;
```

- [ ] **Step 4: Create `packages/web/postcss.config.mjs`**

```js
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
```

- [ ] **Step 5: Create `packages/web/src/app/globals.css`**

```css
@import 'tailwindcss';

:root {
  color-scheme: dark;
}

body {
  background: #0b0e14;
  color: #cdd6f4;
  font-family:
    ui-sans-serif,
    system-ui,
    -apple-system,
    sans-serif;
}
```

- [ ] **Step 6: Create `packages/web/src/app/layout.tsx`**

```tsx
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'G5000',
  description: 'Performance instrument processor',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Create `packages/web/src/app/page.tsx`**

```tsx
export default function Home() {
  return (
    <main className="p-6 space-y-2">
      <h1 className="text-2xl font-semibold">G5000</h1>
      <p className="text-slate-400">
        Performance instrument processor. See{' '}
        <a className="underline" href="/inspect">
          /inspect
        </a>{' '}
        for live channel data.
      </p>
    </main>
  );
}
```

- [ ] **Step 8: Install web deps and verify the dev server boots**

Run: `npm install`
Then: `npm run dev --workspace=@g5000/web`
Expected: Next.js prints `Local: http://localhost:3000`, no errors. `Ctrl+C` to stop. Visit the URL in a browser to confirm the home page renders. (This step is manual — the agent should pause until the user confirms the dev server boots, then continue.)

- [ ] **Step 9: Commit**

```bash
git add packages/web/package.json packages/web/tsconfig.json packages/web/next.config.ts packages/web/postcss.config.mjs packages/web/src/app/layout.tsx packages/web/src/app/page.tsx packages/web/src/app/globals.css package-lock.json
git commit -m "feat(web): Next.js skeleton with Tailwind v4"
```

---

## Task 11: Bus singleton in `core` and SSE route handler in `web`

**Files:**

- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/bus-singleton.ts`
- Create: `packages/web/src/app/api/stream/route.ts`

The web Route Handlers need access to the same Bus instance the bridge populates. We export a `getSharedBus()` singleton from `core` that any module in the same Node process can import.

- [ ] **Step 1: Create `packages/core/src/bus-singleton.ts`**

```ts
import { Bus } from './bus.js';

let instance: Bus | null = null;

/**
 * Returns the process-wide shared Bus, creating it lazily.
 *
 * In Phase 0a everything runs in one Node process: the autopilot-server
 * starts the bridge (which publishes to this bus) and serves Next.js
 * Route Handlers (which subscribe to this bus). Tests should construct
 * their own `new Bus()` and never call this function.
 */
export function getSharedBus(): Bus {
  if (!instance) instance = new Bus();
  return instance;
}

/** Test helper — resets the singleton. Do not call in production code. */
export function _resetSharedBusForTests(): void {
  instance = null;
}
```

- [ ] **Step 2: Update `packages/core/src/index.ts`**

```ts
export * from './types.js';
export * from './channels.js';
export * from './bus.js';
export * from './bus-singleton.js';
```

- [ ] **Step 3: Create `packages/web/src/app/api/stream/route.ts`**

```ts
import { getSharedBus } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/stream — Server-Sent Events feed of every Sample published to
 * the shared bus.
 *
 * Throttling: we batch up to 50 ms of samples per channel and emit at most
 * one update per channel per batch. This caps fan-out to ~20 Hz per channel,
 * which is plenty for a UI inspector.
 */
export async function GET(req: Request): Promise<Response> {
  const bus = getSharedBus();
  const encoder = new TextEncoder();
  const BATCH_MS = 50;

  const stream = new ReadableStream({
    start(controller) {
      const latest = new Map<string, unknown>();
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const flush = (): void => {
        flushTimer = null;
        if (latest.size === 0) return;
        for (const [channel, sample] of latest) {
          const payload = JSON.stringify({ channel, sample });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        }
        latest.clear();
      };

      const unsub = bus.subscribe('**', (sample) => {
        latest.set(sample.channel, sample);
        if (flushTimer === null) flushTimer = setTimeout(flush, BATCH_MS);
      });

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      }, 15_000);

      // Initial comment so the connection establishes immediately.
      controller.enqueue(encoder.encode(`: connected\n\n`));

      req.signal.addEventListener('abort', () => {
        unsub();
        clearInterval(heartbeat);
        if (flushTimer) clearTimeout(flushTimer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
```

- [ ] **Step 4: Smoke-test the SSE route via curl**

Start dev server: `npm run dev --workspace=@g5000/web`

In another terminal, with a sample published manually (we don't yet have the bridge wired into Next.js dev — that's Task 12), at least verify the endpoint responds with the right headers and the initial `: connected` comment:

```
curl -N http://localhost:3000/api/stream
```

Expected: header includes `content-type: text/event-stream`; body shows `: connected` after a moment. Periodic `: heartbeat` lines arrive every 15 s. Sample data won't appear until Task 12 wires the bridge into the same process. Stop with `Ctrl+C`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/bus-singleton.ts packages/core/src/index.ts packages/web/src/app/api/stream/route.ts
git commit -m "feat(web): SSE route streaming shared bus samples"
```

---

## Task 12: `/inspect` page

**Files:**

- Create: `packages/web/src/app/inspect/page.tsx`

A simple table of every channel's most recent sample, updated live via the SSE feed.

- [ ] **Step 1: Implement `packages/web/src/app/inspect/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { Sample } from '@g5000/core';

interface ChannelEntry {
  sample: Sample;
  receivedAtMs: number;
}

function formatValue(s: Sample): string {
  switch (s.value.kind) {
    case 'scalar':
      return s.value.unit
        ? `${s.value.value.toFixed(3)} ${s.value.unit}`
        : s.value.value.toFixed(3);
    case 'vec3':
      return `[${s.value.value.map((n) => n.toFixed(3)).join(', ')}]`;
    case 'quat':
      return `q[${s.value.value.map((n) => n.toFixed(3)).join(', ')}]`;
    case 'geo':
      return `${s.value.value.lat.toFixed(5)}, ${s.value.value.lon.toFixed(5)}`;
    case 'enum':
      return s.value.value;
  }
}

export default function InspectPage() {
  const [channels, setChannels] = useState<Map<string, ChannelEntry>>(new Map());

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (ev) => {
      try {
        const { channel, sample } = JSON.parse(ev.data) as {
          channel: string;
          sample: Sample;
        };
        setChannels((prev) => {
          const next = new Map(prev);
          next.set(channel, { sample, receivedAtMs: Date.now() });
          return next;
        });
      } catch {
        /* ignore malformed payloads */
      }
    };
    es.onerror = () => {
      /* EventSource auto-reconnects; nothing to do here */
    };
    return () => es.close();
  }, []);

  const sorted = Array.from(channels.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Channel inspector</h1>
      <p className="text-slate-400 mb-4 text-sm">
        Live channels published on the bus. {sorted.length} active.
      </p>
      <table className="w-full text-sm font-mono">
        <thead>
          <tr className="text-left text-slate-400 border-b border-slate-800">
            <th className="py-2 pr-4">Channel</th>
            <th className="py-2 pr-4">Value</th>
            <th className="py-2 pr-4">Source</th>
            <th className="py-2">Age</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(([channel, entry]) => (
            <tr key={channel} className="border-b border-slate-900">
              <td className="py-1 pr-4">{channel}</td>
              <td className="py-1 pr-4">{formatValue(entry.sample)}</td>
              <td className="py-1 pr-4 text-slate-500">{entry.sample.source}</td>
              <td className="py-1 text-slate-500">
                {((Date.now() - entry.receivedAtMs) / 1000).toFixed(1)}s
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-slate-500">
                Waiting for samples…
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: Manual smoke test**

Start the dev server: `npm run dev --workspace=@g5000/web`. Visit `http://localhost:3000/inspect`. Expected: the page loads, shows "Waiting for samples…" — at this point the bridge isn't connected to the same process, so no data flows. We fix that in Task 13.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/inspect/page.tsx
git commit -m "feat(web): /inspect page with live channel table"
```

---

## Task 13: Single-process integration — autopilot-server boots Next.js

**Files:**

- Modify: `apps/autopilot-server/package.json` (add `next` dep)
- Modify: `apps/autopilot-server/src/index.ts`

Next.js can be started programmatically via its `next()` factory and a custom Node `http.Server`. This is documented at https://nextjs.org/docs/app/guides/custom-server. We boot the bridge (publishing to the shared bus singleton), then start Next pointing at the `@g5000/web` package directory, both in the same process.

- [ ] **Step 1: Update `apps/autopilot-server/package.json`**

Replace its dependencies block with:

```json
"dependencies": {
  "@g5000/bridge": "*",
  "@g5000/core": "*",
  "@g5000/web": "*",
  "next": "^16",
  "react": "^19",
  "react-dom": "^19",
  "rxjs": "^7",
  "serialport": "^12"
}
```

- [ ] **Step 2: Reinstall**

Run: `npm install`
Expected: `node_modules/next` is available under `apps/autopilot-server`.

- [ ] **Step 3: Replace `apps/autopilot-server/src/index.ts`**

```ts
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import next from 'next';
import { SerialPort } from 'serialport';
import { getSharedBus } from '@g5000/core';
import { Ngt1Driver, runBridge } from '@g5000/bridge';

const SERIAL_PATH = process.env.NGT1_PATH ?? '/dev/ttyUSB0';
const BAUD_RATE = Number(process.env.NGT1_BAUD ?? 115200);
const HTTP_PORT = Number(process.env.PORT ?? 3000);
const DEV = process.env.NODE_ENV !== 'production';

async function main(): Promise<void> {
  const bus = getSharedBus();

  // 1. Start bridge if a real serial port exists. Otherwise log and continue
  //    so the web UI is still usable (showing zero channels, useful for
  //    shoreside development).
  const skipBridge = process.env.SKIP_BRIDGE === '1';
  let stopBridge: (() => Promise<void>) | null = null;
  if (!skipBridge) {
    try {
      const port = new SerialPort({
        path: SERIAL_PATH,
        baudRate: BAUD_RATE,
        autoOpen: false,
      });
      await new Promise<void>((resolve, reject) => {
        port.open((err) => (err ? reject(err) : resolve()));
      });
      const driver = new Ngt1Driver({ source: port });
      stopBridge = await runBridge({ bus, drivers: [driver] });
      // eslint-disable-next-line no-console
      console.log(`[autopilot] bridge online via ${SERIAL_PATH}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[autopilot] bridge offline (${err instanceof Error ? err.message : String(err)}); web UI will be empty until a serial device is available`,
      );
    }
  }

  // 2. Start Next.js pointing at the @g5000/web package directory.
  const webDir = path.resolve(fileURLToPath(import.meta.url), '../../../../packages/web');
  const app = next({ dev: DEV, dir: webDir });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = http.createServer((req, res) => {
    void handle(req, res);
  });
  server.listen(HTTP_PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[autopilot] web UI on http://0.0.0.0:${HTTP_PORT}`);
  });

  // 3. Graceful shutdown.
  const shutdown = async () => {
    // eslint-disable-next-line no-console
    console.log('[autopilot] shutting down');
    server.close();
    if (stopBridge) await stopBridge();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[autopilot] fatal', err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the unified server in dev mode without an NGT-1**

Run: `SKIP_BRIDGE=1 npm run dev --workspace=@g5000/autopilot-server`
Expected: Next.js prints "ready" on http://localhost:3000; bridge is skipped. Visit `/inspect` — it should show "Waiting for samples…". Stop with `Ctrl+C`.

- [ ] **Step 5: Run the unified server with the bridge attempting a real serial open**

If you have an NGT-1 attached:

- Identify its device path: `ls /dev/tty.usbserial-* /dev/ttyUSB*` (paths vary by OS).
- Run: `NGT1_PATH=/dev/tty.usbserial-XXXX npm run dev --workspace=@g5000/autopilot-server`
- Expected: `[autopilot] bridge online via …`; `/inspect` shows live PGN-derived channels populated by real bus traffic.

If no NGT-1 is available, this step is deferred to first boat-side test.

- [ ] **Step 6: Commit**

```bash
git add apps/autopilot-server/package.json apps/autopilot-server/src/index.ts package-lock.json
git commit -m "feat(server): single-process autopilot-server hosting bridge and Next.js"
```

---

## Closing checks

- [ ] **Run the full test suite from the repo root**

Run: `npm test`
Expected: all package test suites pass.

- [ ] **Run typecheck across the monorepo**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Final commit pointer**

The repo now ends Phase 0a with:

- a working `npm run dev --workspace=@g5000/autopilot-server` that boots a single-process server,
- decoded PGN samples streaming on the bus when an NGT-1 is connected,
- `/inspect` showing live channel values in a browser,
- `/api/stream` SSE feed available for any future web view to subscribe to.

The next plan picks up at spec build-sequence step 6 (NMEA 0183 input + decoder), then 7 (IMU), 8 (persistence), and 9 (replay).
