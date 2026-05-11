# G5000 Sessions Browser + Replay Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `.jsonl.gz` session logger and `ReplayDriver` first-class user-visible features: a `/sessions` page that lists, summarises, downloads, and replays recorded sessions, with a navbar chip that always shows the current source mode (live / demo / replay).

**Architecture:** A new `SourceModeController` singleton owns the active wire driver (live NGT-1, demo injector, or replay) and can swap between them at runtime. Replay reuses the existing `ReplayDriver` and `runBridge` plumbing. Web reaches the controller through Next.js route handlers that share the same Node process via the existing `globalThis` singleton pattern. TX is gated off during replay.

**Tech Stack:** Existing — npm workspaces, TypeScript, RxJS, Next.js 16, Tailwind, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-11-g5000-sessions-and-replay-design.md`

---

## Pre-flight (controller-side context the subagents will need)

- The shared bus singleton lives at `packages/core/src/bus-singleton.ts` (`getSharedBus()`).
- The ConfigStore singleton lives at `packages/db/src/config-store.ts` (`getSharedConfigStore()` / `setSharedConfigStore()`).
- The `Bus` pattern: `globalThis.__g5000_<name>__ = instance` — survives Turbopack module duplication.
- `runBridge({ bus, drivers })` from `@g5000/bridge` returns a `() => Promise<void>` teardown. It wires drivers' `rxCan`/`rx0183` through the decoder + channel mappers to the bus.
- Workspace packages ship `dist/`; after editing source you must `npm run build --workspace=@g5000/<pkg>` for the autopilot-server and Next routes to see the change.
- Local TSX imports use no `.js` extension; workspace-package imports likewise no extension.
- `serverExternalPackages` in `packages/web/next.config.ts` includes `@g5000/core`, `@g5000/db`, `@g5000/compute`, `@g5000/bridge`, `@canboat/canboatjs`. Any new workspace package consumed from Next routes must be added here.

---

### Task 1: Session-summary scanner (pure module)

**Files:**
- Create: `packages/bridge/src/persistence/session-summary.ts`
- Create: `packages/bridge/src/persistence/session-summary.test.ts`
- Modify: `packages/bridge/src/index.ts` (add re-exports)

**Why:** The `/api/sessions` route needs cheap directory listings, and `/api/sessions/[id]` needs a one-shot scan that returns counts and time range. Putting it in the bridge package keeps the file-format knowledge with the writer.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/bridge/src/persistence/session-summary.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Subject, BehaviorSubject } from 'rxjs';
import { startSessionLogger } from './session-logger.js';
import { listSessions, summarizeSession } from './session-summary.js';
import type { RawCanFrame, Raw0183Sentence, WireDriver } from '../wire-driver.js';

function fakeDriver(): {
  driver: WireDriver;
  pushCan: (f: RawCanFrame) => void;
  pushOt: (s: Raw0183Sentence) => void;
} {
  const can = new Subject<RawCanFrame>();
  const ot = new Subject<Raw0183Sentence>();
  const health = new BehaviorSubject({
    connected: true,
    bytesPerSecond: 0,
    framesPerSecond: 0,
    errorCount: 0,
  });
  return {
    driver: {
      rxCan: can.asObservable(),
      rx0183: ot.asObservable(),
      health: health.asObservable(),
      txCan: async () => {},
      tx0183: async () => {},
    } as unknown as WireDriver,
    pushCan: (f) => can.next(f),
    pushOt: (s) => ot.next(s),
  };
}

describe('session-summary', () => {
  it('lists sessions with id, size, mtime, and parsed header startedAt', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'g5000-sess-'));
    try {
      const { driver, pushCan } = fakeDriver();
      const logger = await startSessionLogger({
        drivers: [driver],
        dir,
        sessionId: '2026-05-11T12-00-00',
      });
      pushCan({ id: 0x18eeff01, ext: true, data: new Uint8Array([1, 2, 3]), rxTimestamp: 1n });
      await new Promise((r) => setTimeout(r, 5));
      await logger.close();

      const list = await listSessions(dir);
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe('2026-05-11T12-00-00');
      expect(list[0]!.sizeBytes).toBeGreaterThan(0);
      expect(list[0]!.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('summarizes a session: counts by kind, duration, first/last timestamps', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'g5000-sess-'));
    try {
      const { driver, pushCan, pushOt } = fakeDriver();
      const logger = await startSessionLogger({
        drivers: [driver],
        dir,
        sessionId: 'fixture',
      });
      pushCan({ id: 0x18eeff01, ext: true, data: new Uint8Array([1]), rxTimestamp: 1_000_000n });
      pushCan({ id: 0x18eeff01, ext: true, data: new Uint8Array([2]), rxTimestamp: 2_000_000n });
      pushOt({ text: '$GPGGA,...', port: 1, rxTimestamp: 3_500_000n });
      await new Promise((r) => setTimeout(r, 5));
      await logger.close();

      const summary = await summarizeSession(path.join(dir, 'fixture.jsonl.gz'));
      expect(summary.id).toBe('fixture');
      expect(summary.canLines).toBe(2);
      expect(summary.otLines).toBe(1);
      expect(summary.firstEventNs).toBe('1000000');
      expect(summary.lastEventNs).toBe('3500000');
      expect(summary.durationMs).toBe(Math.round((3_500_000 - 1_000_000) / 1_000_000));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('listSessions returns empty array for nonexistent dir', async () => {
    const list = await listSessions('/tmp/definitely-not-a-real-dir-' + Date.now());
    expect(list).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- --reporter=basic --run packages/bridge/src/persistence/session-summary.test.ts`
Expected: 3 failures — module not found.

- [ ] **Step 3: Implement the module**

```ts
// packages/bridge/src/persistence/session-summary.ts
import { readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import path from 'node:path';

const EXT = '.jsonl.gz';

export interface SessionInfo {
  id: string;
  sizeBytes: number;
  mtime: string;
  startedAt?: string;
}

export interface SessionSummary extends SessionInfo {
  canLines: number;
  otLines: number;
  durationMs: number;
  firstEventNs?: string;
  lastEventNs?: string;
}

export async function listSessions(dir: string): Promise<SessionInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const files = entries.filter((e) => e.endsWith(EXT));
  const out: SessionInfo[] = [];
  for (const f of files) {
    const full = path.join(dir, f);
    const st = await stat(full);
    out.push({
      id: f.slice(0, -EXT.length),
      sizeBytes: st.size,
      mtime: st.mtime.toISOString(),
      startedAt: await readHeaderStartedAt(full),
    });
  }
  out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return out;
}

async function readHeaderStartedAt(filePath: string): Promise<string | undefined> {
  const lines = openLineReader(filePath);
  try {
    for await (const raw of lines) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { kind?: string; startedAt?: string };
        if (parsed.kind === 'header') return parsed.startedAt;
      } catch {
        return undefined;
      }
      return undefined;
    }
  } finally {
    lines.close();
  }
  return undefined;
}

export async function summarizeSession(filePath: string): Promise<SessionSummary> {
  const st = await stat(filePath);
  const base = path.basename(filePath);
  if (!base.endsWith(EXT)) {
    throw new Error(`Not a session file: ${filePath}`);
  }
  const id = base.slice(0, -EXT.length);

  let canLines = 0;
  let otLines = 0;
  let firstNs: bigint | undefined;
  let lastNs: bigint | undefined;
  let startedAt: string | undefined;

  const lines = openLineReader(filePath);
  try {
    for await (const raw of lines) {
      if (!raw) continue;
      let parsed: { kind?: string; t_ns?: string; startedAt?: string };
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (parsed.kind === 'header') {
        startedAt = parsed.startedAt;
        continue;
      }
      if (parsed.kind === 'can') canLines += 1;
      else if (parsed.kind === '0183') otLines += 1;
      else continue;
      if (parsed.t_ns) {
        const ns = BigInt(parsed.t_ns);
        if (firstNs === undefined) firstNs = ns;
        lastNs = ns;
      }
    }
  } finally {
    lines.close();
  }

  const durationMs =
    firstNs !== undefined && lastNs !== undefined
      ? Math.round(Number((lastNs - firstNs) / 1_000_000n))
      : 0;

  return {
    id,
    sizeBytes: st.size,
    mtime: st.mtime.toISOString(),
    startedAt,
    canLines,
    otLines,
    durationMs,
    firstEventNs: firstNs?.toString(),
    lastEventNs: lastNs?.toString(),
  };
}

function openLineReader(filePath: string) {
  const file = createReadStream(filePath);
  const gunzip = createGunzip();
  return createInterface({ input: file.pipe(gunzip) });
}
```

- [ ] **Step 4: Re-export from package index**

In `packages/bridge/src/index.ts`, add:

```ts
export {
  listSessions,
  summarizeSession,
  type SessionInfo,
  type SessionSummary,
} from './persistence/session-summary.js';
```

- [ ] **Step 5: Run tests to confirm green**

Run: `npm test -- --reporter=basic --run packages/bridge/src/persistence/session-summary.test.ts`
Expected: 3 pass.

- [ ] **Step 6: Build the package**

Run: `npm run build --workspace=@g5000/bridge`
Expected: clean exit.

- [ ] **Step 7: Commit**

```bash
git add packages/bridge/src/persistence/session-summary.ts \
        packages/bridge/src/persistence/session-summary.test.ts \
        packages/bridge/src/index.ts \
        packages/bridge/dist/
git commit -m "feat(bridge): session-summary scanner (listSessions, summarizeSession)"
```

---

### Task 2: SourceMode types + controller + index.ts wiring

**Files:**
- Create: `packages/core/src/source-mode.ts` (types + globalThis accessor)
- Modify: `packages/core/src/index.ts` (re-export source-mode)
- Create: `apps/autopilot-server/src/source-mode-controller.ts` (factory)
- Create: `apps/autopilot-server/src/source-mode-controller.test.ts`
- Modify: `apps/autopilot-server/src/index.ts`

**Why:** Web routes need to reach the controller. The TYPES and the `globalThis`-backed accessor live in `@g5000/core` (already in `serverExternalPackages` — Turbopack won't double-instantiate it). The factory stays in autopilot-server because it depends on bridge internals.

The controller must also be able to stop and restart the base (live/demo) source — otherwise demo + replay both publish to the bus simultaneously. So it exposes a `setBaseSource({ teardown, restart? })` hook that `index.ts` populates at boot.

- [ ] **Step 1: Create source-mode types + accessor in @g5000/core**

```ts
// packages/core/src/source-mode.ts
export type SourceMode = 'live' | 'demo' | 'replay';
export type PaceMode = 'realtime' | 'asap';
export type ReplayPhase = 'running' | 'finished' | 'error';

export interface SourceModeStatus {
  mode: SourceMode;
  sessionId?: string;
  paceMode?: PaceMode;
  phase?: ReplayPhase;
  startedAt?: string;
  errorMessage?: string;
}

export interface BaseSourceHandle {
  /** Tear down the currently-running base source. */
  teardown: () => Promise<void>;
  /**
   * Re-arm the base source after a replay ends. Optional — when omitted,
   * `stopReplay()` cannot restore the previous source and the user must
   * restart the server to get live/demo back. Recommended for demo mode
   * (cheap to restart), optional for live mode (NGT-1 reopen can fail).
   */
  restart?: () => Promise<BaseSourceHandle>;
}

export interface SourceModeController {
  getStatus(): SourceModeStatus;
  setLiveOrDemo(mode: 'live' | 'demo'): void;
  setBaseSource(handle: BaseSourceHandle | null): void;
  startReplay(args: { sessionId: string; paceMode: PaceMode }): Promise<void>;
  stopReplay(): Promise<void>;
}

declare const globalThis: { __g5000_sourceMode__?: SourceModeController };

export function getSourceModeController(): SourceModeController | undefined {
  return globalThis.__g5000_sourceMode__;
}

export function setSourceModeController(c: SourceModeController): void {
  globalThis.__g5000_sourceMode__ = c;
}

export function _resetSourceModeControllerForTests(): void {
  globalThis.__g5000_sourceMode__ = undefined;
}
```

- [ ] **Step 2: Re-export from `@g5000/core` index**

Append to `packages/core/src/index.ts`:

```ts
export * from './source-mode.js';
```

- [ ] **Step 3: Build core**

```
npm run build --workspace=@g5000/core
```

Expected: clean exit.

- [ ] **Step 4: Write the failing test for the controller**

```ts
// apps/autopilot-server/src/source-mode-controller.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Subject, BehaviorSubject } from 'rxjs';
import { Bus, _resetSourceModeControllerForTests } from '@g5000/core';
import { startSessionLogger } from '@g5000/bridge';
import type { RawCanFrame, Raw0183Sentence, WireDriver } from '@g5000/bridge';
import { createSourceModeController } from './source-mode-controller.js';

function fakeDriver(): WireDriver {
  return {
    rxCan: new Subject<RawCanFrame>().asObservable(),
    rx0183: new Subject<Raw0183Sentence>().asObservable(),
    health: new BehaviorSubject({
      connected: true,
      bytesPerSecond: 0,
      framesPerSecond: 0,
      errorCount: 0,
    }).asObservable(),
    txCan: async () => {},
    tx0183: async () => {},
  } as unknown as WireDriver;
}

describe('SourceModeController', () => {
  beforeEach(() => _resetSourceModeControllerForTests());

  it('defaults to live mode', () => {
    const c = createSourceModeController({ bus: new Bus(), sessionsDir: '/tmp' });
    expect(c.getStatus().mode).toBe('live');
  });

  it('reports demo mode when setLiveOrDemo("demo") is called', () => {
    const c = createSourceModeController({ bus: new Bus(), sessionsDir: '/tmp' });
    c.setLiveOrDemo('demo');
    expect(c.getStatus().mode).toBe('demo');
  });

  it('startReplay tears down base source then starts replay; stopReplay restarts it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'g5000-srcmode-'));
    try {
      const driver = fakeDriver();
      const logger = await startSessionLogger({
        drivers: [driver],
        dir,
        sessionId: 'fixture',
      });
      await logger.close();

      let baseRunning = false;
      const makeBaseHandle = () => {
        baseRunning = true;
        return {
          teardown: async () => {
            baseRunning = false;
          },
          restart: async () => makeBaseHandle(),
        };
      };
      const c = createSourceModeController({ bus: new Bus(), sessionsDir: dir });
      c.setLiveOrDemo('demo');
      c.setBaseSource(makeBaseHandle());
      expect(baseRunning).toBe(true);

      await c.startReplay({ sessionId: 'fixture', paceMode: 'asap' });
      expect(c.getStatus().mode).toBe('replay');
      expect(c.getStatus().sessionId).toBe('fixture');
      expect(baseRunning).toBe(false); // base torn down for the duration of replay

      await c.stopReplay();
      expect(c.getStatus().mode).toBe('demo');
      expect(baseRunning).toBe(true); // base restarted
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('stopReplay without a restart-capable base leaves base down', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'g5000-srcmode-'));
    try {
      const driver = fakeDriver();
      const logger = await startSessionLogger({
        drivers: [driver],
        dir,
        sessionId: 'fixture',
      });
      await logger.close();

      let baseRunning = true;
      const c = createSourceModeController({ bus: new Bus(), sessionsDir: dir });
      c.setLiveOrDemo('live');
      c.setBaseSource({
        teardown: async () => {
          baseRunning = false;
        },
        // no restart — simulates the live-mode case
      });

      await c.startReplay({ sessionId: 'fixture', paceMode: 'asap' });
      expect(baseRunning).toBe(false);
      await c.stopReplay();
      expect(c.getStatus().mode).toBe('live');
      expect(baseRunning).toBe(false); // cannot restart without restart fn
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('startReplay refuses a missing session', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'g5000-srcmode-'));
    try {
      const c = createSourceModeController({ bus: new Bus(), sessionsDir: dir });
      await expect(
        c.startReplay({ sessionId: 'nope', paceMode: 'asap' }),
      ).rejects.toThrow(/not found/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a second startReplay while one is running', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'g5000-srcmode-'));
    try {
      const driver = fakeDriver();
      const logger = await startSessionLogger({ drivers: [driver], dir, sessionId: 'f1' });
      await logger.close();
      const logger2 = await startSessionLogger({ drivers: [driver], dir, sessionId: 'f2' });
      await logger2.close();

      const c = createSourceModeController({ bus: new Bus(), sessionsDir: dir });
      await c.startReplay({ sessionId: 'f1', paceMode: 'asap' });
      await expect(
        c.startReplay({ sessionId: 'f2', paceMode: 'asap' }),
      ).rejects.toThrow(/already/i);
      await c.stopReplay();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 5: Run the test to confirm it fails**

Run: `npm test -- --reporter=basic --run apps/autopilot-server/src/source-mode-controller.test.ts`
Expected: failures — module not found.

- [ ] **Step 6: Implement the controller factory**

```ts
// apps/autopilot-server/src/source-mode-controller.ts
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Bus } from '@g5000/core';
import {
  setSourceModeController,
  getSourceModeController,
  type SourceModeController,
  type SourceModeStatus,
  type BaseSourceHandle,
} from '@g5000/core';
import { ReplayDriver, runBridge } from '@g5000/bridge';

export interface CreateOptions {
  bus: Bus;
  sessionsDir: string;
}

export function createSourceModeController(opts: CreateOptions): SourceModeController {
  const existing = getSourceModeController();
  if (existing) return existing;

  let baseMode: 'live' | 'demo' = 'live';
  let status: SourceModeStatus = { mode: 'live' };
  let baseHandle: BaseSourceHandle | null = null;
  let activeReplayTeardown: (() => Promise<void>) | null = null;

  const controller: SourceModeController = {
    getStatus: () => ({ ...status }),
    setLiveOrDemo: (mode) => {
      baseMode = mode;
      if (status.mode !== 'replay') {
        status = { mode };
      }
    },
    setBaseSource: (handle) => {
      baseHandle = handle;
    },
    async startReplay({ sessionId, paceMode }) {
      if (status.mode === 'replay') {
        throw new Error(`replay already running for "${status.sessionId}"`);
      }
      const filePath = path.join(opts.sessionsDir, `${sessionId}.jsonl.gz`);
      if (!existsSync(filePath)) {
        throw new Error(`session "${sessionId}" not found in ${opts.sessionsDir}`);
      }

      // Tear down the base source so it doesn't double-publish onto the bus.
      if (baseHandle) {
        const prev = baseHandle;
        baseHandle = null;
        await prev.teardown();
        // Stash the restart fn (if any) on the controller via closure.
        // We re-arm on stopReplay.
        (controller as unknown as { __prevRestart?: () => Promise<BaseSourceHandle> }).__prevRestart =
          prev.restart;
      }

      const driver = new ReplayDriver({ filePath, mode: paceMode });
      const stopBridge = await runBridge({ bus: opts.bus, drivers: [driver] });
      await driver.start();
      activeReplayTeardown = async () => {
        await driver.stop();
        await stopBridge();
      };
      status = {
        mode: 'replay',
        sessionId,
        paceMode,
        phase: 'running',
        startedAt: new Date().toISOString(),
      };
    },
    async stopReplay() {
      if (activeReplayTeardown) {
        const t = activeReplayTeardown;
        activeReplayTeardown = null;
        try {
          await t();
        } catch (err) {
          status = {
            mode: baseMode,
            errorMessage: err instanceof Error ? err.message : String(err),
          };
          return;
        }
      }
      // Re-arm the base source if a restart fn was stashed.
      const prevRestart = (controller as unknown as {
        __prevRestart?: () => Promise<BaseSourceHandle>;
      }).__prevRestart;
      if (prevRestart) {
        try {
          baseHandle = await prevRestart();
        } catch (err) {
          status = {
            mode: baseMode,
            errorMessage: `base restart failed: ${err instanceof Error ? err.message : String(err)}`,
          };
          return;
        }
      }
      (controller as unknown as { __prevRestart?: unknown }).__prevRestart = undefined;
      status = { mode: baseMode };
    },
  };

  setSourceModeController(controller);
  return controller;
}
```

- [ ] **Step 7: Run the test to confirm green**

Run: `npm test -- --reporter=basic --run apps/autopilot-server/src/source-mode-controller.test.ts`
Expected: 5 pass.

- [ ] **Step 8: Wire into index.ts startup**

Edit `apps/autopilot-server/src/index.ts`. The wiring has three responsibilities:

1. Build the controller right after `getSharedBus()` (so route handlers can hit it even before the bridge is wired).
2. Tell the controller the base-mode (live or demo).
3. Once the base source is up (live bridge or demo injector), register a `BaseSourceHandle` so the controller can tear it down when entering replay and re-arm it on exit.

Concretely, at the top of `main()`, after `const bus = getSharedBus();`:

```ts
const sessionsDir = SESSION_LOG_DIR ?? path.join(dataDir, 'sessions');
await mkdir(sessionsDir, { recursive: true });
const sourceModeController = createSourceModeController({ bus, sessionsDir });
sourceModeController.setLiveOrDemo(DEMO_MODE ? 'demo' : 'live');
console.log(
  `[autopilot] source mode: ${sourceModeController.getStatus().mode} (sessions dir: ${sessionsDir})`,
);
```

Add the import at the top:

```ts
import { createSourceModeController } from './source-mode-controller.js';
import type { BaseSourceHandle } from '@g5000/core';
```

Then, where the demo injector is started, build a `BaseSourceHandle` with a `restart` factory:

```ts
if (DEMO_MODE) {
  const makeDemoHandle = (): BaseSourceHandle => {
    const stopDemo = startDemoInjector(bus);
    return {
      teardown: async () => stopDemo(),
      restart: async () => makeDemoHandle(),
    };
  };
  const handle = makeDemoHandle();
  sourceModeController.setBaseSource(handle);
  teardown.push(handle.teardown);
  console.log('[autopilot] DEMO_MODE on — synthetic samples publishing to the bus');
} else {
  // ...existing true-wind pipeline block...
}
```

For live mode, register a teardown-only handle (no restart — re-opening the NGT-1 mid-process is fragile):

```ts
// In the live path, after `if (drivers.length > 0) { const stop = await runBridge(...); }`:
if (!DEMO_MODE && drivers.length > 0) {
  sourceModeController.setBaseSource({
    teardown: async () => {
      // The runBridge teardown already ran via the `teardown` array;
      // here we just unregister so stopReplay() doesn't try to call it again.
    },
  });
}
```

Note: The `runBridge` teardown is already stored in the `teardown` array for shutdown. Hooking it from the controller would cause it to be called twice on shutdown. Simplest approach: replace the bridge teardown push so that the controller owns the live-bridge teardown, and the SIGINT handler asks the controller to stop replay first if active, otherwise calls bridge teardown directly.

If that's too disruptive to the existing shutdown flow, leave live-mode `restart` unset and accept that live → replay → stop replay leaves the bus quiet until the user restarts. Document this in the page UI.

- [ ] **Step 9: Type-check + tests**

Run: `npx tsc -b && npm test -- --reporter=basic --run`
Expected: clean exit, all tests green.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/source-mode.ts \
        packages/core/src/index.ts \
        packages/core/dist/ \
        apps/autopilot-server/src/source-mode-controller.ts \
        apps/autopilot-server/src/source-mode-controller.test.ts \
        apps/autopilot-server/src/index.ts
git commit -m "feat(core,server): SourceModeController with base-source teardown/restart"
```

---

### Task 3: TX gating during replay

**Files:**
- Modify: `packages/bridge/src/tx/true-wind-tx.ts`
- Modify: `packages/bridge/src/tx/true-wind-tx.test.ts`

**Why:** During a replay we must not push synthesised PGN 130306 onto a real N2K bus. The cleanest gate is at the TX subscriber: check the source-mode controller right before transmitting.

- [ ] **Step 1: Read the current TX implementation**

```bash
sed -n '1,200p' packages/bridge/src/tx/true-wind-tx.ts
```

Note the existing subscribe-and-transmit shape so the patch is minimal.

- [ ] **Step 2: Add a `shouldTransmit` predicate to `StartTrueWindTxOptions`**

Modify the `StartTrueWindTxOptions` interface in `packages/bridge/src/tx/true-wind-tx.ts` to accept an optional predicate, defaulting to "always transmit":

```ts
export interface StartTrueWindTxOptions {
  bus: Bus;
  driver: { txPgn: (pgn: OutgoingPgn) => Promise<void> };
  /** If provided and returns false, the TX call is skipped. */
  shouldTransmit?: () => boolean;
}
```

Inside the subscriber that calls `driver.txPgn(...)`, gate the call:

```ts
if (opts.shouldTransmit && !opts.shouldTransmit()) return;
await opts.driver.txPgn(pgn);
```

- [ ] **Step 3: Add a test for the gate**

Append to `packages/bridge/src/tx/true-wind-tx.test.ts`:

```ts
describe('startTrueWindTx — shouldTransmit gate', () => {
  it('skips TX when shouldTransmit() returns false', async () => {
    const bus = new Bus();
    const txCalls: OutgoingPgn[] = [];
    const stop = await startTrueWindTx({
      bus,
      driver: { txPgn: async (p) => { txCalls.push(p); } },
      shouldTransmit: () => false,
    });
    bus.publish({
      channel: Channels.Wind.TrueCalibrated.Direction,
      t_ms: Date.now(),
      value: { kind: 'scalar', value: 1.234, unit: 'rad' },
      source: 'computed:true_wind',
    });
    bus.publish({
      channel: Channels.Wind.TrueCalibrated.Speed,
      t_ms: Date.now(),
      value: { kind: 'scalar', value: 5.0, unit: 'm/s' },
      source: 'computed:true_wind',
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(txCalls).toHaveLength(0);
    await stop();
  });
});
```

(Imports `Bus`, `Channels`, `OutgoingPgn`, `startTrueWindTx` already present at the top of the file — confirm with `grep` and add any missing ones.)

- [ ] **Step 4: Run tests**

```
npm test -- --reporter=basic --run packages/bridge/src/tx/true-wind-tx.test.ts
```

Expected: existing tests pass + new test passes.

- [ ] **Step 5: Wire the gate at the call site in index.ts**

In `apps/autopilot-server/src/index.ts`, change the `startTrueWindTx` call to pass `shouldTransmit`:

```ts
const stopTx = await startTrueWindTx({
  bus,
  driver: ngt,
  shouldTransmit: () => sourceModeController.getStatus().mode !== 'replay',
});
```

(`sourceModeController` was constructed in Task 2.)

- [ ] **Step 6: Build and test**

```
npm run build --workspace=@g5000/bridge && npx tsc -b && npm test -- --run
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/bridge/src/tx/true-wind-tx.ts \
        packages/bridge/src/tx/true-wind-tx.test.ts \
        packages/bridge/dist/ \
        apps/autopilot-server/src/index.ts
git commit -m "feat(bridge,server): gate true-wind TX with shouldTransmit; skip during replay"
```

---

### Task 4: Sessions REST API routes (list, summary, download, delete)

**Files:**
- Create: `packages/web/src/app/api/sessions/route.ts`
- Create: `packages/web/src/app/api/sessions/[id]/route.ts`
- Create: `packages/web/src/app/api/sessions/[id]/download/route.ts`

**Why:** Backing endpoints for the `/sessions` page. Use the helpers from Task 1.

The sessions directory comes from the same env var (`SESSION_LOG_DIR`) or default (`./data/sessions`) used at boot. Centralise the resolution.

- [ ] **Step 1: Create a small helper for sessions-dir resolution**

```ts
// packages/web/src/app/api/sessions/dir.ts
import path from 'node:path';
export function sessionsDir(): string {
  return (
    process.env.SESSION_LOG_DIR ??
    path.resolve(process.cwd(), '..', 'autopilot-server', 'data', 'sessions')
  );
}
```

Note: when Next.js is hosted by `apps/autopilot-server` the CWD is the autopilot-server workspace, so `data/sessions` resolves there. The `path.resolve` is a fallback when running `next dev` standalone from `packages/web`.

- [ ] **Step 2: Implement `GET /api/sessions`**

```ts
// packages/web/src/app/api/sessions/route.ts
import { listSessions } from '@g5000/bridge';
import { sessionsDir } from './dir.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const sessions = await listSessions(sessionsDir());
  return Response.json({ sessions });
}
```

- [ ] **Step 3: Implement `GET /api/sessions/[id]` (summary) and `DELETE`**

```ts
// packages/web/src/app/api/sessions/[id]/route.ts
import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { summarizeSession } from '@g5000/bridge';
import { sessionsDir } from '../dir.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

function safePath(id: string): string {
  if (id.includes('/') || id.includes('..') || id.length === 0) {
    throw new Error('invalid session id');
  }
  return path.join(sessionsDir(), `${id}.jsonl.gz`);
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  try {
    const summary = await summarizeSession(safePath(id));
    return Response.json(summary);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  try {
    await unlink(safePath(id));
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }
}
```

- [ ] **Step 4: Implement `GET /api/sessions/[id]/download`**

```ts
// packages/web/src/app/api/sessions/[id]/download/route.ts
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { sessionsDir } from '../../dir.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

function safePath(id: string): string {
  if (id.includes('/') || id.includes('..') || id.length === 0) {
    throw new Error('invalid session id');
  }
  return path.join(sessionsDir(), `${id}.jsonl.gz`);
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  let filePath: string;
  try {
    filePath = safePath(id);
    await stat(filePath);
  } catch {
    return new Response('not found', { status: 404 });
  }
  // ReadableStream from a node stream; cast through `unknown` because Node's
  // type defs accept NodeReadable here but the lib.dom type is narrower.
  const stream = createReadStream(filePath) as unknown as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${id}.jsonl.gz"`,
    },
  });
}
```

- [ ] **Step 5: Smoke-test the routes**

After rebuilding the bridge dist (Task 1 already did this) and restarting in DEMO_MODE:

```bash
curl -s http://localhost:3000/api/sessions | head -c 500
```

Expected: a JSON object with a `sessions` array (possibly empty if `data/sessions/` is empty).

If empty, drop a tiny fixture file and re-test:

```bash
mkdir -p apps/autopilot-server/data/sessions
node -e "
  const { startSessionLogger } = require('./packages/bridge/dist/index.js');
  const { Subject, BehaviorSubject } = require('rxjs');
  (async () => {
    const can = new Subject(), ot = new Subject();
    const health = new BehaviorSubject({ connected: true, bytesPerSecond:0, framesPerSecond:0, errorCount:0 });
    const drv = { rxCan: can.asObservable(), rx0183: ot.asObservable(), health: health.asObservable(), txCan: async()=>{}, tx0183: async()=>{} };
    const lg = await startSessionLogger({ drivers:[drv], dir:'apps/autopilot-server/data/sessions', sessionId:'fixture-' + Date.now() });
    can.next({ id: 0x18eeff01, ext:true, data: new Uint8Array([1,2]), rxTimestamp: 1n });
    await new Promise(r=>setTimeout(r,10));
    await lg.close();
  })();
"
curl -s http://localhost:3000/api/sessions
```

Expected: the fixture appears in the list.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/api/sessions/
git commit -m "feat(web): /api/sessions REST surface (list, summary, download, delete)"
```

---

### Task 5: Replay control + source-mode REST API routes

**Files:**
- Create: `packages/web/src/app/api/replay/start/route.ts`
- Create: `packages/web/src/app/api/replay/stop/route.ts`
- Create: `packages/web/src/app/api/replay/status/route.ts`
- Create: `packages/web/src/app/api/source-mode/route.ts`
- Delete: `packages/web/src/app/api/dev/demo/route.ts` (superseded)

**Why:** Web routes need to read and command the controller from Task 2. They import `getSourceModeController` from `@g5000/core` — already in `serverExternalPackages`, so Turbopack uses the same module instance as the autopilot-server and both reach the same `globalThis.__g5000_sourceMode__` slot.

- [ ] **Step 1: Implement `GET /api/source-mode`**

```ts
// packages/web/src/app/api/source-mode/route.ts
import { getSourceModeController } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const c = getSourceModeController();
  if (!c) {
    return Response.json(
      { error: 'SourceModeController not initialised — server is not running' },
      { status: 503 },
    );
  }
  return Response.json(c.getStatus());
}
```

- [ ] **Step 2: Implement `POST /api/replay/start`**

```ts
// packages/web/src/app/api/replay/start/route.ts
import { getSourceModeController } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface StartBody {
  sessionId: string;
  paceMode: 'realtime' | 'asap';
}

export async function POST(req: Request): Promise<Response> {
  const c = getSourceModeController();
  if (!c) {
    return Response.json({ error: 'SourceModeController not initialised' }, { status: 503 });
  }
  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body.sessionId || !body.paceMode) {
    return Response.json({ error: 'sessionId and paceMode required' }, { status: 400 });
  }
  if (body.paceMode !== 'realtime' && body.paceMode !== 'asap') {
    return Response.json({ error: 'paceMode must be realtime or asap' }, { status: 400 });
  }
  try {
    await c.startReplay(body);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
  return Response.json(c.getStatus());
}
```

- [ ] **Step 3: Implement `POST /api/replay/stop` and `GET /api/replay/status`**

```ts
// packages/web/src/app/api/replay/stop/route.ts
import { getSourceModeController } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  const c = getSourceModeController();
  if (!c) {
    return Response.json({ error: 'SourceModeController not initialised' }, { status: 503 });
  }
  await c.stopReplay();
  return Response.json(c.getStatus());
}
```

```ts
// packages/web/src/app/api/replay/status/route.ts
import { getSourceModeController } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const c = getSourceModeController();
  if (!c) {
    return Response.json({ error: 'SourceModeController not initialised' }, { status: 503 });
  }
  return Response.json(c.getStatus());
}
```

- [ ] **Step 4: Delete the now-unused demo route**

```bash
rm packages/web/src/app/api/dev/demo/route.ts
```

- [ ] **Step 5: Smoke-test**

Restart server in DEMO_MODE.

```bash
curl -s http://localhost:3000/api/source-mode
# expect: {"mode":"demo"}

curl -s -X POST http://localhost:3000/api/replay/start \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"<id-from-list>","paceMode":"asap"}'
# expect: status JSON with mode=replay

curl -s http://localhost:3000/api/source-mode
# expect: {"mode":"replay","sessionId":"...",...}

curl -s -X POST http://localhost:3000/api/replay/stop
# expect: {"mode":"demo"}
```

If `getSourceModeController()` returns undefined inside the route handler, the controller import got duplicated by Turbopack. Verify `@g5000/core` is still in `packages/web/next.config.ts`'s `serverExternalPackages` and that the route imports from `@g5000/core` (NOT relative). The Bus + ConfigStore singletons survive Turbopack the same way; the source-mode controller MUST use the same `@g5000/core`-hosted globalThis slot to stay coherent.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/api/replay/ \
        packages/web/src/app/api/source-mode/
git rm packages/web/src/app/api/dev/demo/route.ts
git commit -m "feat(web): replay control + source-mode REST endpoints"
```

---

### Task 6: `/sessions` page

**Files:**
- Create: `packages/web/src/app/sessions/page.tsx`

**Why:** User-facing UI to list, summarise, download, replay, and delete sessions.

- [ ] **Step 1: Implement the page**

```tsx
// packages/web/src/app/sessions/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';

interface SessionInfo {
  id: string;
  sizeBytes: number;
  mtime: string;
  startedAt?: string;
}

interface SessionSummary extends SessionInfo {
  canLines: number;
  otLines: number;
  durationMs: number;
}

interface ReplayStatus {
  mode: 'live' | 'demo' | 'replay';
  sessionId?: string;
  paceMode?: 'realtime' | 'asap';
  phase?: 'running' | 'finished' | 'error';
  errorMessage?: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [summaries, setSummaries] = useState<Record<string, SessionSummary>>({});
  const [status, setStatus] = useState<ReplayStatus>({ mode: 'live' });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch('/api/sessions');
    const j = (await r.json()) as { sessions: SessionInfo[] };
    setSessions(j.sessions);
  }, []);

  const pollStatus = useCallback(async () => {
    const r = await fetch('/api/source-mode');
    const j = (await r.json()) as ReplayStatus;
    setStatus(j);
  }, []);

  useEffect(() => {
    void refresh();
    void pollStatus();
    const id = setInterval(pollStatus, 1000);
    return () => clearInterval(id);
  }, [refresh, pollStatus]);

  const summarise = useCallback(async (sessionId: string) => {
    const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (!r.ok) return;
    const s = (await r.json()) as SessionSummary;
    setSummaries((prev) => ({ ...prev, [sessionId]: s }));
  }, []);

  const startReplay = useCallback(
    async (sessionId: string, paceMode: 'realtime' | 'asap') => {
      setErrorMessage(null);
      const r = await fetch('/api/replay/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, paceMode }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(j.error ?? `HTTP ${r.status}`);
      }
      await pollStatus();
    },
    [pollStatus],
  );

  const stopReplay = useCallback(async () => {
    await fetch('/api/replay/stop', { method: 'POST' });
    await pollStatus();
  }, [pollStatus]);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!confirm(`Delete session "${sessionId}"?`)) return;
      await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      await refresh();
    },
    [refresh],
  );

  const replaying = status.mode === 'replay';

  return (
    <main className="p-6 max-w-6xl mx-auto text-slate-100">
      <h1 className="text-2xl font-semibold mb-4">Sessions</h1>

      {/* Status banner */}
      <div
        className={`mb-6 p-3 rounded font-mono text-sm ${
          status.mode === 'live'
            ? 'bg-emerald-900/40 border border-emerald-800'
            : status.mode === 'demo'
              ? 'bg-amber-900/40 border border-amber-800'
              : 'bg-purple-900/40 border border-purple-800'
        }`}
      >
        Source mode: <b className="uppercase">{status.mode}</b>
        {replaying && (
          <>
            {' — '}replaying <code>{status.sessionId}</code> ({status.paceMode}){' — '}
            <button
              type="button"
              onClick={stopReplay}
              className="ml-2 px-2 py-0.5 rounded bg-slate-200 text-slate-900 font-medium hover:bg-slate-100"
            >
              Stop
            </button>
          </>
        )}
      </div>

      {errorMessage && (
        <div className="mb-4 p-2 bg-red-900/40 border border-red-700 rounded text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      <table className="w-full text-sm font-mono border-collapse">
        <thead>
          <tr className="text-slate-400 border-b border-slate-700">
            <th className="text-left py-2 pr-3">Session ID</th>
            <th className="text-left py-2 pr-3">Started</th>
            <th className="text-right py-2 pr-3">Size</th>
            <th className="text-right py-2 pr-3">Samples</th>
            <th className="text-right py-2 pr-3">Duration</th>
            <th className="text-right py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sessions.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-slate-500">
                No sessions yet. Run the server with{' '}
                <code>SESSION_LOG_DIR=./data/sessions</code> to start recording.
              </td>
            </tr>
          )}
          {sessions.map((s) => {
            const summary = summaries[s.id];
            return (
              <tr
                key={s.id}
                className="border-b border-slate-800 hover:bg-slate-900/40"
                onMouseEnter={() => {
                  if (!summary) void summarise(s.id);
                }}
              >
                <td className="py-2 pr-3">{s.id}</td>
                <td className="py-2 pr-3 text-slate-300">
                  {s.startedAt ?? s.mtime.slice(0, 19).replace('T', ' ')}
                </td>
                <td className="py-2 pr-3 text-right">{formatBytes(s.sizeBytes)}</td>
                <td className="py-2 pr-3 text-right text-slate-300">
                  {summary
                    ? `${summary.canLines} can / ${summary.otLines} 0183`
                    : '…'}
                </td>
                <td className="py-2 pr-3 text-right text-slate-300">
                  {summary ? formatDuration(summary.durationMs) : '…'}
                </td>
                <td className="py-2 text-right space-x-1">
                  <a
                    href={`/api/sessions/${encodeURIComponent(s.id)}/download`}
                    className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs"
                  >
                    Download
                  </a>
                  <button
                    type="button"
                    disabled={replaying}
                    onClick={() => startReplay(s.id, 'realtime')}
                    className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-xs disabled:opacity-40"
                  >
                    Replay 1×
                  </button>
                  <button
                    type="button"
                    disabled={replaying}
                    onClick={() => startReplay(s.id, 'asap')}
                    className="px-2 py-1 rounded bg-emerald-900 hover:bg-emerald-800 text-xs disabled:opacity-40"
                  >
                    Replay fast
                  </button>
                  <button
                    type="button"
                    disabled={replaying}
                    onClick={() => deleteSession(s.id)}
                    className="px-2 py-1 rounded bg-red-900 hover:bg-red-800 text-xs disabled:opacity-40"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: Build and smoke-test**

Restart in DEMO_MODE. Browse `http://localhost:3000/sessions`. Expect the table to render. With a fixture file present (created in Task 4 Step 5), expect a row with download/replay/delete actions.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/sessions/
git commit -m "feat(web): /sessions page — list, summarise, download, replay, delete"
```

---

### Task 7: Navbar tri-state source-mode chip + `/sessions` nav entry

**Files:**
- Modify: `packages/web/src/app/Navbar.tsx`

**Why:** The chip becomes the always-visible signal of "what is driving the bus right now". Also add a Sessions link to the nav.

- [ ] **Step 1: Modify the Navbar**

Replace the contents of `packages/web/src/app/Navbar.tsx` with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
}

const ITEMS: NavItem[] = [
  { href: '/helm', label: 'Helm' },
  { href: '/polars', label: 'Polars' },
  { href: '/sails', label: 'Sails' },
  { href: '/calibration/wind', label: 'Wind cal' },
  { href: '/calibration/bsp', label: 'BSP cal' },
  { href: '/calibration/compass', label: 'Compass' },
  { href: '/boat', label: 'Boat' },
  { href: '/autopilot', label: 'Autopilot' },
  { href: '/devices', label: 'Devices' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/inspect', label: 'Inspect' },
];

interface SourceModeStatus {
  mode: 'live' | 'demo' | 'replay';
  sessionId?: string;
}

const CHIP_STYLES: Record<SourceModeStatus['mode'], string> = {
  live: 'bg-emerald-700 text-emerald-100',
  demo: 'bg-amber-600 text-amber-100',
  replay: 'bg-purple-700 text-purple-100',
};

export function Navbar() {
  const pathname = usePathname();
  const [status, setStatus] = useState<SourceModeStatus>({ mode: 'live' });

  useEffect(() => {
    const poll = () => {
      fetch('/api/source-mode')
        .then((r) => r.json())
        .then(setStatus)
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <nav className="bg-slate-950 border-b border-slate-800 px-4 py-2 flex items-center gap-1 flex-wrap text-sm">
      <a href="/" className="font-semibold text-slate-100 mr-3">
        G5000
      </a>
      {ITEMS.map((it) => {
        const active = pathname === it.href || pathname?.startsWith(it.href + '/');
        return (
          <a
            key={it.href}
            href={it.href}
            className={`px-2 py-1 rounded ${
              active
                ? 'bg-amber-600 text-slate-900 font-medium'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {it.label}
          </a>
        );
      })}
      <a
        href="/sessions"
        className={`ml-auto px-2 py-1 rounded text-xs font-mono ${CHIP_STYLES[status.mode]}`}
        title={
          status.mode === 'replay'
            ? `Replaying ${status.sessionId ?? '(unknown)'}`
            : `Source mode: ${status.mode}`
        }
      >
        {status.mode === 'replay'
          ? `REPLAY: ${status.sessionId ?? ''}`
          : status.mode.toUpperCase()}
      </a>
    </nav>
  );
}
```

- [ ] **Step 2: Build and smoke-test**

Reload the browser. Expect to see:
- A new "Sessions" entry in the nav.
- An amber `DEMO` chip on the right when `DEMO_MODE=1`.
- The chip turns purple `REPLAY: <id>` when a replay is active, and green `LIVE` when neither.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/Navbar.tsx
git commit -m "feat(web): navbar tri-state source-mode chip + /sessions link"
```

---

### Task 8: End-to-end verification + final commit

**Files:**
- Create: `packages/bridge/src/persistence/replay-roundtrip.test.ts` (real-PGN integration test)

**Why:** The browser walkthrough is necessary but not sufficient — DEMO_MODE doesn't drive raw CAN frames into the session logger, so a captured-in-demo log replays as silence. We need a unit test that exercises the full `record → ReplayDriver → decoder → bus` path with a real PGN 130306 frame so we have machine-verified evidence the replay path works. The browser walkthrough then verifies just the swap UX.

- [ ] **Step 1: Write the real-PGN replay round-trip test**

```ts
// packages/bridge/src/persistence/replay-roundtrip.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeN2KActisense } from '@canboat/canboatjs/lib/n2k-actisense.js';
import { Bus, Channels, type Sample } from '@g5000/core';
import { Ngt1Driver, type Ngt1Source } from '../ngt-driver.js';
import { runBridge } from '../bridge.js';
import { startSessionLogger } from './session-logger.js';
import { ReplayDriver } from './replay-driver.js';
import { _resetSharedDeviceRegistryForTests } from '../index.js';

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
  emit(buf: Buffer) {
    this.listener?.(buf);
  }
}

describe('session-record → replay round-trip with a real PGN 130306', () => {
  it('records real CAN frames and replays them into the same channels', async () => {
    _resetSharedDeviceRegistryForTests();

    const dir = await mkdtemp(path.join(tmpdir(), 'g5000-roundtrip-'));
    try {
      // -- Record --
      const bus1 = new Bus();
      const source = new MemorySource();
      const driver = new Ngt1Driver({ source });
      const stopBridge1 = await runBridge({ bus: bus1, drivers: [driver] });
      const logger = await startSessionLogger({
        drivers: [driver],
        dir,
        sessionId: 'roundtrip',
      });

      // Same PGN 130306 payload as bridge.test.ts: SID+Speed+Angle+Reference.
      const windPayload = Buffer.from([0xa0, 0x16, 0x02, 0xfe, 0x7f, 0x02, 0xfa, 0xfa]);
      const frame = encodeN2KActisense({
        pgn: 130306,
        data: windPayload,
        prio: 2,
        src: 17,
        dst: 255,
      });
      source.emit(frame);
      await new Promise((r) => setTimeout(r, 30));
      await logger.close();
      await stopBridge1();

      // -- Replay --
      _resetSharedDeviceRegistryForTests();
      const bus2 = new Bus();
      const filePath = path.join(dir, 'roundtrip.jsonl.gz');
      const replayDriver = new ReplayDriver({ filePath, mode: 'asap' });
      const stopBridge2 = await runBridge({ bus: bus2, drivers: [replayDriver] });
      const received: Sample[] = [];
      bus2.subscribe('wind.**', (s) => received.push(s));
      await replayDriver.start();
      // Drain.
      await new Promise((r) => setTimeout(r, 100));

      const channels = new Set(received.map((s) => s.channel));
      expect(channels.has(Channels.Wind.ApparentAngle)).toBe(true);
      expect(channels.has(Channels.Wind.ApparentSpeed)).toBe(true);

      await replayDriver.stop();
      await stopBridge2();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test**

```
npm test -- --reporter=basic --run packages/bridge/src/persistence/replay-roundtrip.test.ts
```

Expected: 1 pass.

- [ ] **Step 3: Full test suite + type-check**

```
npm test -- --reporter=basic --run
npx tsc -b
```

Expected: all green.

- [ ] **Step 4: Browser walkthrough**

Boot the server in DEMO_MODE with the session logger pointing at the test data dir, run for ~5 s, and SIGINT to flush:

```bash
SESSION_LOG_DIR=apps/autopilot-server/data/sessions \
  DEMO_MODE=1 SKIP_BRIDGE=1 \
  npm run dev --workspace=@g5000/autopilot-server > /tmp/g5000-sess-test.log 2>&1 &
sleep 5
pkill -INT -f "tsx watch src/index.ts"
sleep 1
ls -1 apps/autopilot-server/data/sessions/
```

(That log will be header-only because the demo injector doesn't push raw CAN frames — see the integration test above for the proof that real captures replay correctly. To produce a useful demo fixture, the round-trip test's setup can be lifted into a script — out of scope here.)

For the browser walkthrough use the fixture committed by the round-trip test pattern. Or, easier: copy the file the round-trip test wrote (a tmpdir cleanup nukes it; instead run the encode-and-record block as a one-shot node script):

```bash
node --import tsx -e "
  const { encodeN2KActisense } = require('@canboat/canboatjs/lib/n2k-actisense.js');
  const { Bus } = require('./packages/core/dist/index.js');
  const { Ngt1Driver, runBridge, startSessionLogger, _resetSharedDeviceRegistryForTests } = require('./packages/bridge/dist/index.js');
  class Mem { constructor(){this.l=null}; on(e,c){if(e==='data')this.l=c; return this} off(){this.l=null; return this} emit(b){this.l?.(b)} }
  (async () => {
    _resetSharedDeviceRegistryForTests();
    const bus = new Bus();
    const source = new Mem();
    const driver = new Ngt1Driver({ source });
    const stop = await runBridge({ bus, drivers: [driver] });
    const dir = 'apps/autopilot-server/data/sessions';
    require('node:fs').mkdirSync(dir, { recursive: true });
    const logger = await startSessionLogger({ drivers:[driver], dir, sessionId:'browser-fixture-'+Date.now() });
    const payload = Buffer.from([0xa0,0x16,0x02,0xfe,0x7f,0x02,0xfa,0xfa]);
    for (let i=0;i<10;i++) {
      const f = encodeN2KActisense({ pgn:130306, data:payload, prio:2, src:17, dst:255 });
      source.emit(f);
      await new Promise(r => setTimeout(r, 100));
    }
    await logger.close();
    await stop();
    console.log('wrote browser-fixture');
  })();
"
```

Now restart in DEMO_MODE and visit:

- `/sessions` — confirm the table renders, the browser-fixture row appears, hover triggers a summary lookup, "Replay 1×" starts a replay.
- `/inspect` while a replay is active — confirm `wind.apparent.*` channels show new samples with the replay's source tag.
- `/helm` — tiles should update from the replayed wind values.
- Navbar — chip flips to purple `REPLAY: <id>`; clicking stops the replay.

Stop the replay → chip returns to amber `DEMO` (because the controller calls the demo restart factory from Task 2).

- [ ] **Step 5: Final commit**

```bash
git add packages/bridge/src/persistence/replay-roundtrip.test.ts
git commit -m "test(bridge): end-to-end record → replay round-trip with real PGN 130306"
```

---

## Self-review checklist (controller runs before dispatching)

- [x] Every task has explicit Files / Steps with exact code (no TBDs).
- [x] Each task ends with a commit step using the exact file paths it touched.
- [x] Type names match across tasks: `SessionInfo`, `SessionSummary`, `SourceModeStatus`, `ReplayStatus` collapsed to `SourceModeStatus` (one type, used everywhere).
- [x] `getSourceModeController()` is the canonical accessor; tests use `_resetSourceModeControllerForTests`.
- [x] TX gating uses `shouldTransmit?: () => boolean` (Task 3) and is wired at the call site (Task 3 step 5).
- [x] Spec requirements §4.1–§4.5 all covered by a task.
- [x] Caching mentioned in spec §4.3 is deferred — not required at first pass; lazy on-hover summary in the UI is enough.

## Execution handoff

Use **superpowers:subagent-driven-development** (per user's standing override).
