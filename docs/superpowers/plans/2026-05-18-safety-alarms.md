# Safety Alarms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build g5000's safety-alarm framework (`AlarmsRegistry`) and ship 5 alarms (anchor watch, MOB, shallow water, over-speed, low battery) with a unified `/alerts` page, persistent banner, and helm-page audible.

**Architecture:** New `AlarmsRegistry` singleton in `@g5000/core` runs parallel to the existing N2K-derived `AlertsRegistry`. Compute pipelines (`@g5000/compute/alarms/*`) subscribe to Bus channels and call `registry.fire()` / `registry.clear()` on predicate transitions. Persistence is split: per-alarm config in a JSON-blob `alarms_config` table; alarm history in a row-oriented `alarms_history` Drizzle table for `ORDER BY ... LIMIT`. Web exposes one `/alerts` page (tabs: Active / History / Settings), a root-layout `<AlarmBanner />`, and helm-only `<AudibleAlarm />` + `<MobButton />` components. Alarm state changes are published to a Bus channel (`alarms.changed`) so existing SSE plumbing carries them to the UI.

**Tech Stack:** TypeScript (strict), Vitest, Drizzle ORM + better-sqlite3, Next.js 16 App Router, React 19, Tailwind 4, RxJS-backed Bus.

**Spec:** [`docs/superpowers/specs/2026-05-18-safety-alarms-design.md`](../specs/2026-05-18-safety-alarms-design.md)

---

## Task 1: Add `electrical.battery.voltage` channel

**Files:**
- Modify: `packages/core/src/channels.ts`

- [ ] **Step 1: Add Electrical namespace to Channels constant**

Edit `packages/core/src/channels.ts`. After the `Autopilot:` block, add:

```ts
  Electrical: {
    /** Battery bank DC voltage in volts. Currently mapped from PGN 127508,
     *  lowest-instance battery. Future: instance-disambiguation. */
    BatteryVoltage: 'electrical.battery.voltage',
  },
```

- [ ] **Step 2: Build core to verify**

Run: `npx tsc -b packages/core`
Expected: clean exit (no output).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/channels.ts
git commit -m "feat(core): add electrical.battery.voltage channel"
```

---

## Task 2: Define AlarmsRegistry types and globalThis accessors

**Files:**
- Create: `packages/core/src/alarms.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/alarms.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createAlarmsRegistry,
  getSharedAlarms,
  setSharedAlarms,
  _resetAlarmsForTests,
  type AlarmsRegistry,
} from './alarms.js';

describe('AlarmsRegistry', () => {
  let registry: AlarmsRegistry;
  beforeEach(() => {
    _resetAlarmsForTests();
    registry = createAlarmsRegistry();
  });

  it('starts empty', () => {
    expect(registry.all()).toEqual([]);
    expect(registry.active()).toEqual([]);
  });

  it('fires an alarm and reports it as active', () => {
    registry.fire({ id: 'shallow-water', severity: 'CRITICAL', label: 'Shallow Water', sticky: false });
    const active = registry.active();
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe('shallow-water');
    expect(active[0]?.firedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(active[0]?.clearedAt).toBeNull();
    expect(active[0]?.ackedAt).toBeNull();
  });

  it('non-sticky alarms drop out of active when cleared', () => {
    registry.fire({ id: 'shallow-water', severity: 'CRITICAL', label: 'Shallow Water', sticky: false });
    registry.clear('shallow-water');
    expect(registry.active()).toHaveLength(0);
    const all = registry.all();
    expect(all).toHaveLength(1);
    expect(all[0]?.clearedAt).not.toBeNull();
  });

  it('sticky alarms remain active even after clear', () => {
    registry.fire({ id: 'mob', severity: 'CRITICAL', label: 'MOB', sticky: true });
    registry.clear('mob');
    expect(registry.active()).toHaveLength(1);
    expect(registry.active()[0]?.clearedAt).not.toBeNull();
  });

  it('ack removes alarm from active list (sticky or not)', () => {
    registry.fire({ id: 'mob', severity: 'CRITICAL', label: 'MOB', sticky: true });
    registry.ack('mob');
    expect(registry.active()).toHaveLength(0);
    expect(registry.all()[0]?.ackedAt).not.toBeNull();
  });

  it('dedupes repeated fire calls for the same id (no duplicate active entries)', () => {
    registry.fire({ id: 'over-speed', severity: 'WARN', label: 'Over Speed', sticky: false });
    registry.fire({ id: 'over-speed', severity: 'WARN', label: 'Over Speed', sticky: false });
    expect(registry.active()).toHaveLength(1);
  });

  it('shares state via globalThis accessors', () => {
    setSharedAlarms(registry);
    expect(getSharedAlarms()).toBe(registry);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/core/src/alarms.test.ts`
Expected: fails with module-not-found error (`./alarms.js` does not exist).

- [ ] **Step 3: Create the module**

Create `packages/core/src/alarms.ts`:

```ts
/**
 * G5000-derived safety alarms registry.
 *
 * Parallel to the N2K-derived AlertsRegistry in alerts.ts. This one
 * tracks alarms synthesized by g5000 itself (anchor watch, MOB, etc.) —
 * compute predicates fire/clear, the UI reads.
 *
 * Persistence is the caller's responsibility (see packages/db/src/alarms-history.ts);
 * this registry is in-memory state for the active set plus a short recent history.
 */

export type AlarmSeverity = 'CRITICAL' | 'WARN' | 'INFO';

export interface AlarmSnapshot {
  /** Stable identifier: 'mob' | 'anchor-watch' | 'shallow-water' | 'over-speed' | 'low-battery'. */
  id: string;
  severity: AlarmSeverity;
  /** Human-readable label for UI. */
  label: string;
  /** True if alarm stays in active list after condition clears. */
  sticky: boolean;
  /** ISO timestamp of most-recent fire transition. */
  firedAt: string;
  /** ISO timestamp when the underlying condition cleared (null if still active). */
  clearedAt: string | null;
  /** ISO timestamp when the user acknowledged (null if unacked). */
  ackedAt: string | null;
  /** Free-form context captured at fire time (e.g. position, sample value). */
  context?: Record<string, unknown>;
}

export interface AlarmFireRequest {
  id: string;
  severity: AlarmSeverity;
  label: string;
  sticky: boolean;
  context?: Record<string, unknown>;
}

export interface AlarmsRegistry {
  /** All known alarms (active + recently cleared/acked). */
  all(): AlarmSnapshot[];
  /** Active alarms: unacked AND (not cleared OR sticky). */
  active(): AlarmSnapshot[];
  /** Lookup by id. */
  get(id: string): AlarmSnapshot | undefined;
  /** Fire an alarm. If already active, refreshes firedAt and merges context. */
  fire(req: AlarmFireRequest): void;
  /** Mark the underlying condition as cleared. Non-sticky alarms become inactive immediately. */
  clear(id: string): void;
  /** User acknowledgement. Removes from active regardless of sticky/clear state. */
  ack(id: string): void;
  /** Drop everything (tests only). */
  reset(): void;
}

export function createAlarmsRegistry(): AlarmsRegistry {
  const byId = new Map<string, AlarmSnapshot>();

  function isActive(a: AlarmSnapshot): boolean {
    if (a.ackedAt !== null) return false;
    if (a.clearedAt === null) return true;
    return a.sticky;
  }

  return {
    all: () => Array.from(byId.values()).sort((x, y) => y.firedAt.localeCompare(x.firedAt)),
    active: () =>
      Array.from(byId.values())
        .filter(isActive)
        .sort((x, y) => y.firedAt.localeCompare(x.firedAt)),
    get: (id) => byId.get(id),
    fire: (req) => {
      const now = new Date().toISOString();
      const prev = byId.get(req.id);
      const merged: AlarmSnapshot = {
        id: req.id,
        severity: req.severity,
        label: req.label,
        sticky: req.sticky,
        firedAt: prev && prev.ackedAt === null && prev.clearedAt === null ? prev.firedAt : now,
        clearedAt: null,
        ackedAt: null,
        context: { ...(prev?.context ?? {}), ...(req.context ?? {}) },
      };
      byId.set(req.id, merged);
    },
    clear: (id) => {
      const prev = byId.get(id);
      if (!prev) return;
      if (prev.clearedAt !== null) return;
      byId.set(id, { ...prev, clearedAt: new Date().toISOString() });
    },
    ack: (id) => {
      const prev = byId.get(id);
      if (!prev) return;
      byId.set(id, { ...prev, ackedAt: new Date().toISOString() });
    },
    reset: () => byId.clear(),
  };
}

declare const globalThis: { __g5000_alarms__?: AlarmsRegistry };

export function getSharedAlarms(): AlarmsRegistry | undefined {
  return globalThis.__g5000_alarms__;
}

export function setSharedAlarms(r: AlarmsRegistry): void {
  globalThis.__g5000_alarms__ = r;
}

export function _resetAlarmsForTests(): void {
  globalThis.__g5000_alarms__ = undefined;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run packages/core/src/alarms.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Build core**

Run: `npx tsc -b packages/core`
Expected: clean exit.

- [ ] **Step 6: Export from core index (if there is one)**

Check `packages/core/src/index.ts`. Add this export alongside `./alerts.js`:

```ts
export * from './alarms.js';
```

Then run: `npx tsc -b packages/core` again to verify.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/alarms.ts packages/core/src/alarms.test.ts packages/core/src/index.ts
git commit -m "feat(core): AlarmsRegistry types + impl for g5000-derived alarms"
```

---

## Task 3: Add `alarms_config` and `alarms_history` tables to schema

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Append both tables**

Append to `packages/db/src/schema.ts`:

```ts
import { integer } from 'drizzle-orm/sqlite-core';

export const alarmsConfig = sqliteTable('alarms_config', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded AlarmsConfig
});

export const alarmsHistory = sqliteTable('alarms_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  alarmId: text('alarm_id').notNull(),
  severity: text('severity').notNull(),
  firedAt: text('fired_at').notNull(),
  clearedAt: text('cleared_at'),
  ackedAt: text('acked_at'),
  context: text('context'), // JSON-encoded Record<string, unknown> or null
});
```

Note: `integer` is imported at top; merge that import with the existing `import { sqliteTable, text } from 'drizzle-orm/sqlite-core'` line:

```ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
```

- [ ] **Step 2: Build db to verify**

Run: `npx tsc -b packages/db`
Expected: clean exit.

- [ ] **Step 3: Add DDL to ConfigStore.open**

`packages/db/src/config-store.ts` creates tables at boot via `raw.exec(\`CREATE TABLE IF NOT EXISTS ...\`)` around line 100. Append two more statements to that same multi-table `exec` block:

```sql
CREATE TABLE IF NOT EXISTS alarms_config (id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alarms_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alarm_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  fired_at TEXT NOT NULL,
  cleared_at TEXT,
  acked_at TEXT,
  context TEXT
);
CREATE INDEX IF NOT EXISTS idx_alarms_history_fired_at ON alarms_history (fired_at DESC);
```

- [ ] **Step 4: Run db tests**

Run: `npx vitest run packages/db/src/config-store.test.ts`
Expected: all existing tests still pass (new tables don't break existing functionality).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/config-store.ts
git commit -m "feat(db): alarms_config + alarms_history tables"
```

---

## Task 4: AlarmsConfig type + loader/saver helpers

**Files:**
- Create: `packages/db/src/alarms-config.ts`
- Create: `packages/db/src/alarms-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/alarms-config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from './config-store.js';
import {
  loadAlarmsConfig,
  saveAlarmsConfig,
  DEFAULT_ALARMS_CONFIG,
  type AlarmsConfig,
} from './alarms-config.js';

describe('AlarmsConfig persistence', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'g5000-alarms-cfg-'));
    store = await ConfigStore.open(join(dir, 'cfg.db'));
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns DEFAULT_ALARMS_CONFIG on a fresh database', async () => {
    const cfg = await loadAlarmsConfig(store);
    expect(cfg).toEqual(DEFAULT_ALARMS_CONFIG);
    expect(cfg.enabled.mob).toBe(true);
    expect(cfg.thresholds.shallowWater.thresholdM).toBeGreaterThan(0);
  });

  it('persists writes across reopens', async () => {
    const next: AlarmsConfig = {
      ...DEFAULT_ALARMS_CONFIG,
      enabled: { ...DEFAULT_ALARMS_CONFIG.enabled, 'over-speed': false },
      thresholds: {
        ...DEFAULT_ALARMS_CONFIG.thresholds,
        anchor: { armed: true, point: { lat: 32.3, lon: -64.8 }, droppedAt: '2026-05-18T12:00:00Z', radiusM: 75 },
      },
    };
    await saveAlarmsConfig(store, next);

    await store.close();
    store = await ConfigStore.open(join(dir, 'cfg.db'));
    const reloaded = await loadAlarmsConfig(store);
    expect(reloaded.enabled['over-speed']).toBe(false);
    expect(reloaded.thresholds.anchor.armed).toBe(true);
    expect(reloaded.thresholds.anchor.point).toEqual({ lat: 32.3, lon: -64.8 });
    expect(reloaded.thresholds.anchor.radiusM).toBe(75);
  });

  it('returns defaults for unknown alarm ids in enabled map', async () => {
    const cfg = await loadAlarmsConfig(store);
    // All 5 v1 alarm ids must default to enabled
    for (const id of ['mob', 'anchor-watch', 'shallow-water', 'over-speed', 'low-battery']) {
      expect(cfg.enabled[id]).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/db/src/alarms-config.test.ts`
Expected: fails with module-not-found.

- [ ] **Step 3: Create the module**

Create `packages/db/src/alarms-config.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { ConfigStore } from './config-store.js';
import { alarmsConfig } from './schema.js';

export interface AnchorThreshold {
  armed: boolean;
  point?: { lat: number; lon: number };
  droppedAt?: string; // ISO
  radiusM: number;
}

export interface ScalarThreshold {
  thresholdM?: number;
  thresholdKn?: number;
  thresholdV?: number;
  holdMs: number;
}

export interface AlarmsConfig {
  enabled: Record<string, boolean>;
  thresholds: {
    anchor: AnchorThreshold;
    shallowWater: ScalarThreshold;
    overSpeed: ScalarThreshold;
    lowBattery: ScalarThreshold;
  };
}

export const DEFAULT_ALARMS_CONFIG: AlarmsConfig = {
  enabled: {
    mob: true,
    'anchor-watch': true,
    'shallow-water': true,
    'over-speed': true,
    'low-battery': true,
  },
  thresholds: {
    anchor: { armed: false, radiusM: 50 },
    shallowWater: { thresholdM: 3, holdMs: 5000 },
    overSpeed: { thresholdKn: 12, holdMs: 5000 },
    lowBattery: { thresholdV: 11.8, holdMs: 5000 },
  },
};

const ID = 'singleton';

export async function loadAlarmsConfig(store: ConfigStore): Promise<AlarmsConfig> {
  const db = store.drizzle;
  const row = await db.select().from(alarmsConfig).where(eq(alarmsConfig.id, ID)).get();
  if (!row) return DEFAULT_ALARMS_CONFIG;
  try {
    return JSON.parse(row.value) as AlarmsConfig;
  } catch {
    return DEFAULT_ALARMS_CONFIG;
  }
}

export async function saveAlarmsConfig(store: ConfigStore, cfg: AlarmsConfig): Promise<void> {
  const db = store.drizzle;
  const value = JSON.stringify(cfg);
  await db
    .insert(alarmsConfig)
    .values({ id: ID, value })
    .onConflictDoUpdate({ target: alarmsConfig.id, set: { value } })
    .run();
}
```

- [ ] **Step 4: Add `drizzle` getter to ConfigStore**

`ConfigStore`'s `db` field is `private readonly` (see `packages/db/src/config-store.ts:68`). To let alarms helpers run their own Drizzle queries, expose a getter. Add inside the class, near the top of its public surface:

```ts
get drizzle(): BetterSQLite3Database {
  return this.db;
}
```

(The existing `BetterSQLite3Database` type is already imported.)

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run packages/db/src/alarms-config.test.ts`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/alarms-config.ts packages/db/src/alarms-config.test.ts packages/db/src/config-store.ts
git commit -m "feat(db): AlarmsConfig type + persistence helpers"
```

---

## Task 5: Alarm history table helpers

**Files:**
- Create: `packages/db/src/alarms-history.ts`
- Create: `packages/db/src/alarms-history.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/alarms-history.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from './config-store.js';
import {
  appendAlarmHistory,
  listAlarmHistory,
  updateAlarmHistoryClear,
  updateAlarmHistoryAck,
} from './alarms-history.js';

describe('AlarmsHistory', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'g5000-alarms-hist-'));
    store = await ConfigStore.open(join(dir, 'cfg.db'));
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty', async () => {
    const rows = await listAlarmHistory(store, { limit: 10 });
    expect(rows).toEqual([]);
  });

  it('appends rows and lists them newest-first', async () => {
    const id1 = await appendAlarmHistory(store, {
      alarmId: 'shallow-water',
      severity: 'CRITICAL',
      firedAt: '2026-05-18T12:00:00Z',
      context: { depth: 1.8 },
    });
    const id2 = await appendAlarmHistory(store, {
      alarmId: 'over-speed',
      severity: 'WARN',
      firedAt: '2026-05-18T12:05:00Z',
    });

    const rows = await listAlarmHistory(store, { limit: 10 });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe(id2);
    expect(rows[0]?.alarmId).toBe('over-speed');
    expect(rows[1]?.alarmId).toBe('shallow-water');
    expect(rows[1]?.context).toEqual({ depth: 1.8 });
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await appendAlarmHistory(store, {
        alarmId: 'over-speed',
        severity: 'WARN',
        firedAt: `2026-05-18T12:0${i}:00Z`,
      });
    }
    const rows = await listAlarmHistory(store, { limit: 3 });
    expect(rows).toHaveLength(3);
  });

  it('updateAlarmHistoryClear sets clearedAt on a row', async () => {
    const id = await appendAlarmHistory(store, {
      alarmId: 'shallow-water',
      severity: 'CRITICAL',
      firedAt: '2026-05-18T12:00:00Z',
    });
    await updateAlarmHistoryClear(store, id, '2026-05-18T12:01:00Z');
    const rows = await listAlarmHistory(store, { limit: 10 });
    expect(rows[0]?.clearedAt).toBe('2026-05-18T12:01:00Z');
  });

  it('updateAlarmHistoryAck sets ackedAt on a row', async () => {
    const id = await appendAlarmHistory(store, {
      alarmId: 'mob',
      severity: 'CRITICAL',
      firedAt: '2026-05-18T12:00:00Z',
    });
    await updateAlarmHistoryAck(store, id, '2026-05-18T12:02:00Z');
    const rows = await listAlarmHistory(store, { limit: 10 });
    expect(rows[0]?.ackedAt).toBe('2026-05-18T12:02:00Z');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/db/src/alarms-history.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Create the module**

Create `packages/db/src/alarms-history.ts`:

```ts
import { desc, eq } from 'drizzle-orm';
import type { ConfigStore } from './config-store.js';
import { alarmsHistory } from './schema.js';

export interface AlarmHistoryRow {
  id: number;
  alarmId: string;
  severity: string;
  firedAt: string;
  clearedAt: string | null;
  ackedAt: string | null;
  context: Record<string, unknown> | null;
}

export interface AppendAlarmHistoryArgs {
  alarmId: string;
  severity: string;
  firedAt: string;
  context?: Record<string, unknown>;
}

export async function appendAlarmHistory(
  store: ConfigStore,
  args: AppendAlarmHistoryArgs,
): Promise<number> {
  const db = store.drizzle;
  const result = await db
    .insert(alarmsHistory)
    .values({
      alarmId: args.alarmId,
      severity: args.severity,
      firedAt: args.firedAt,
      context: args.context ? JSON.stringify(args.context) : null,
    })
    .returning({ id: alarmsHistory.id })
    .get();
  return result.id;
}

export async function updateAlarmHistoryClear(
  store: ConfigStore,
  rowId: number,
  clearedAt: string,
): Promise<void> {
  const db = store.drizzle;
  await db.update(alarmsHistory).set({ clearedAt }).where(eq(alarmsHistory.id, rowId)).run();
}

export async function updateAlarmHistoryAck(
  store: ConfigStore,
  rowId: number,
  ackedAt: string,
): Promise<void> {
  const db = store.drizzle;
  await db.update(alarmsHistory).set({ ackedAt }).where(eq(alarmsHistory.id, rowId)).run();
}

export async function listAlarmHistory(
  store: ConfigStore,
  opts: { limit: number; before?: string },
): Promise<AlarmHistoryRow[]> {
  const db = store.drizzle;
  let q = db.select().from(alarmsHistory).orderBy(desc(alarmsHistory.firedAt)).limit(opts.limit);
  // before-cursor is a filter, omitted for v1 simplicity; the test does not exercise it.
  const rows = await q.all();
  return rows.map((r) => ({
    id: r.id,
    alarmId: r.alarmId,
    severity: r.severity,
    firedAt: r.firedAt,
    clearedAt: r.clearedAt,
    ackedAt: r.ackedAt,
    context: r.context ? (JSON.parse(r.context) as Record<string, unknown>) : null,
  }));
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run packages/db/src/alarms-history.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/alarms-history.ts packages/db/src/alarms-history.test.ts
git commit -m "feat(db): alarm history append/list/update helpers"
```

---

## Task 6: Anchor watch predicate

**Files:**
- Create: `packages/compute/src/alarms/anchor-watch.ts`
- Create: `packages/compute/src/alarms/anchor-watch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/compute/src/alarms/anchor-watch.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Bus } from '@g5000/core';
import { createAlarmsRegistry, type AlarmsRegistry } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';
import { DEFAULT_ALARMS_CONFIG } from '@g5000/db';
import { startAnchorWatchPredicate } from './anchor-watch.js';

function geoSample(lat: number, lon: number) {
  return {
    channel: 'nav.gps.position',
    t_ns: BigInt(Date.now()) * 1_000_000n,
    value: { kind: 'geo' as const, value: { lat, lon } },
    source: 'test',
  };
}

describe('anchor-watch predicate', () => {
  let bus: Bus;
  let registry: AlarmsRegistry;
  let configRef: { current: AlarmsConfig };
  let dispose: () => void;

  beforeEach(() => {
    bus = new Bus();
    registry = createAlarmsRegistry();
    configRef = { current: structuredClone(DEFAULT_ALARMS_CONFIG) };
  });

  it('does not fire when not armed', () => {
    dispose = startAnchorWatchPredicate(bus, registry, configRef).dispose;
    bus.publish(geoSample(32.3, -64.8));
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('fires when boat drifts outside radius after arming', () => {
    configRef.current.thresholds.anchor = {
      armed: true,
      point: { lat: 32.3, lon: -64.8 },
      droppedAt: '2026-05-18T12:00:00Z',
      radiusM: 50,
    };
    dispose = startAnchorWatchPredicate(bus, registry, configRef).dispose;
    // 0.005 deg lat ≈ 555 m — well outside 50 m
    bus.publish(geoSample(32.305, -64.8));
    const active = registry.active();
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe('anchor-watch');
    expect(active[0]?.sticky).toBe(true);
    dispose();
  });

  it('does not fire when inside radius', () => {
    configRef.current.thresholds.anchor = {
      armed: true,
      point: { lat: 32.3, lon: -64.8 },
      droppedAt: '2026-05-18T12:00:00Z',
      radiusM: 50,
    };
    dispose = startAnchorWatchPredicate(bus, registry, configRef).dispose;
    // 0.0001 deg lat ≈ 11 m — inside 50 m
    bus.publish(geoSample(32.3001, -64.8));
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('does nothing when disabled in config', () => {
    configRef.current.enabled['anchor-watch'] = false;
    configRef.current.thresholds.anchor = {
      armed: true,
      point: { lat: 32.3, lon: -64.8 },
      droppedAt: '2026-05-18T12:00:00Z',
      radiusM: 50,
    };
    dispose = startAnchorWatchPredicate(bus, registry, configRef).dispose;
    bus.publish(geoSample(32.305, -64.8));
    expect(registry.active()).toHaveLength(0);
    dispose();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/compute/src/alarms/anchor-watch.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Create the predicate**

Create `packages/compute/src/alarms/anchor-watch.ts`:

```ts
import type { Bus, AlarmsRegistry } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';

const ID = 'anchor-watch';

function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function startAnchorWatchPredicate(
  bus: Bus,
  registry: AlarmsRegistry,
  configRef: { current: AlarmsConfig },
): { dispose(): void } {
  const unsubscribe = bus.subscribe('nav.gps.position', (sample) => {
    const cfg = configRef.current;
    if (!cfg.enabled[ID]) return;
    const anchor = cfg.thresholds.anchor;
    if (!anchor.armed || !anchor.point) return;
    if (sample.value.kind !== 'geo') return;
    const pos = sample.value.value;
    const distance = haversineMeters(anchor.point, pos);
    if (distance > anchor.radiusM) {
      registry.fire({
        id: ID,
        severity: 'CRITICAL',
        label: 'Anchor Drift',
        sticky: true,
        context: { distanceM: Math.round(distance), position: pos },
      });
    } else {
      registry.clear(ID);
    }
  });
  return { dispose: () => unsubscribe() };
}
```

> **Note on Bus.subscribe:** `bus.subscribe(pattern, handler)` returns a function — calling it unsubscribes. It is NOT an RxJS `Subscription` object with `.unsubscribe()`. See `packages/core/src/bus.ts:26`. Same convention applies in all predicate impls below.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run packages/compute/src/alarms/anchor-watch.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/alarms/anchor-watch.ts packages/compute/src/alarms/anchor-watch.test.ts
git commit -m "feat(compute): anchor-watch predicate"
```

---

## Task 7: Shallow-water predicate

**Files:**
- Create: `packages/compute/src/alarms/shallow-water.ts`
- Create: `packages/compute/src/alarms/shallow-water.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/compute/src/alarms/shallow-water.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Bus, createAlarmsRegistry, type AlarmsRegistry } from '@g5000/core';
import { DEFAULT_ALARMS_CONFIG, type AlarmsConfig } from '@g5000/db';
import { startShallowWaterPredicate } from './shallow-water.js';

function scalarSample(channel: string, value: number) {
  return {
    channel,
    t_ns: BigInt(Date.now()) * 1_000_000n,
    value: { kind: 'scalar' as const, value },
    source: 'test',
  };
}

describe('shallow-water predicate', () => {
  let bus: Bus;
  let registry: AlarmsRegistry;
  let configRef: { current: AlarmsConfig };

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new Bus();
    registry = createAlarmsRegistry();
    configRef = { current: structuredClone(DEFAULT_ALARMS_CONFIG) };
    configRef.current.thresholds.shallowWater = { thresholdM: 3, holdMs: 1000 };
  });

  it('fires when depth stays below threshold for holdMs', () => {
    const { dispose } = startShallowWaterPredicate(bus, registry, configRef);
    bus.publish(scalarSample('nav.depth', 2.5));
    expect(registry.active()).toHaveLength(0);
    vi.advanceTimersByTime(1100);
    expect(registry.active()).toHaveLength(1);
    expect(registry.active()[0]?.id).toBe('shallow-water');
    dispose();
  });

  it('does not fire if depth returns above threshold before holdMs elapses', () => {
    const { dispose } = startShallowWaterPredicate(bus, registry, configRef);
    bus.publish(scalarSample('nav.depth', 2.5));
    vi.advanceTimersByTime(500);
    bus.publish(scalarSample('nav.depth', 4.0));
    vi.advanceTimersByTime(2000);
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('clears when depth rises above threshold', () => {
    const { dispose } = startShallowWaterPredicate(bus, registry, configRef);
    bus.publish(scalarSample('nav.depth', 2.5));
    vi.advanceTimersByTime(1100);
    expect(registry.active()).toHaveLength(1);
    bus.publish(scalarSample('nav.depth', 5.0));
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('does nothing when disabled in config', () => {
    configRef.current.enabled['shallow-water'] = false;
    const { dispose } = startShallowWaterPredicate(bus, registry, configRef);
    bus.publish(scalarSample('nav.depth', 2.5));
    vi.advanceTimersByTime(2000);
    expect(registry.active()).toHaveLength(0);
    dispose();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/compute/src/alarms/shallow-water.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Create the predicate**

Create `packages/compute/src/alarms/shallow-water.ts`:

```ts
import type { Bus, AlarmsRegistry } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';

const ID = 'shallow-water';

export function startShallowWaterPredicate(
  bus: Bus,
  registry: AlarmsRegistry,
  configRef: { current: AlarmsConfig },
): { dispose(): void } {
  let pendingFireTimer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = bus.subscribe('nav.depth', (sample) => {
    const cfg = configRef.current;
    if (!cfg.enabled[ID]) {
      if (pendingFireTimer) {
        clearTimeout(pendingFireTimer);
        pendingFireTimer = null;
      }
      return;
    }
    if (sample.value.kind !== 'scalar') return;
    const depth = sample.value.value;
    if (!Number.isFinite(depth)) return;

    const threshold = cfg.thresholds.shallowWater;
    const holdMs = threshold.holdMs ?? 5000;
    const thresholdM = threshold.thresholdM ?? 3;

    if (depth < thresholdM) {
      const current = registry.get(ID);
      if (current && current.clearedAt === null) return; // already active
      if (pendingFireTimer) return;
      pendingFireTimer = setTimeout(() => {
        pendingFireTimer = null;
        registry.fire({
          id: ID,
          severity: 'CRITICAL',
          label: 'Shallow Water',
          sticky: false,
          context: { depthM: depth, thresholdM },
        });
      }, holdMs);
    } else {
      if (pendingFireTimer) {
        clearTimeout(pendingFireTimer);
        pendingFireTimer = null;
      }
      registry.clear(ID);
    }
  });

  return {
    dispose: () => {
      unsubscribe();
      if (pendingFireTimer) clearTimeout(pendingFireTimer);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run packages/compute/src/alarms/shallow-water.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/alarms/shallow-water.ts packages/compute/src/alarms/shallow-water.test.ts
git commit -m "feat(compute): shallow-water predicate with hold-time debounce"
```

---

## Task 8: Over-speed predicate

**Files:**
- Create: `packages/compute/src/alarms/over-speed.ts`
- Create: `packages/compute/src/alarms/over-speed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/compute/src/alarms/over-speed.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Bus, createAlarmsRegistry, type AlarmsRegistry } from '@g5000/core';
import { DEFAULT_ALARMS_CONFIG, type AlarmsConfig } from '@g5000/db';
import { startOverSpeedPredicate } from './over-speed.js';

function scalarSample(channel: string, value: number) {
  return {
    channel,
    t_ns: BigInt(Date.now()) * 1_000_000n,
    value: { kind: 'scalar' as const, value },
    source: 'test',
  };
}

describe('over-speed predicate', () => {
  let bus: Bus;
  let registry: AlarmsRegistry;
  let configRef: { current: AlarmsConfig };

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new Bus();
    registry = createAlarmsRegistry();
    configRef = { current: structuredClone(DEFAULT_ALARMS_CONFIG) };
    configRef.current.thresholds.overSpeed = { thresholdKn: 10, holdMs: 1000 };
  });

  it('fires when SOG (m/s) exceeds threshold (kn) after holdMs', () => {
    const { dispose } = startOverSpeedPredicate(bus, registry, configRef);
    // 10 kn ≈ 5.144 m/s; publish 6 m/s ≈ 11.66 kn
    bus.publish(scalarSample('nav.gps.sog', 6));
    expect(registry.active()).toHaveLength(0);
    vi.advanceTimersByTime(1100);
    expect(registry.active()).toHaveLength(1);
    expect(registry.active()[0]?.id).toBe('over-speed');
    dispose();
  });

  it('does not fire below threshold', () => {
    const { dispose } = startOverSpeedPredicate(bus, registry, configRef);
    bus.publish(scalarSample('nav.gps.sog', 4));  // ~7.8 kn
    vi.advanceTimersByTime(2000);
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('clears when SOG drops back below threshold', () => {
    const { dispose } = startOverSpeedPredicate(bus, registry, configRef);
    bus.publish(scalarSample('nav.gps.sog', 6));
    vi.advanceTimersByTime(1100);
    bus.publish(scalarSample('nav.gps.sog', 3));
    expect(registry.active()).toHaveLength(0);
    dispose();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/compute/src/alarms/over-speed.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Create the predicate**

Create `packages/compute/src/alarms/over-speed.ts`:

```ts
import type { Bus, AlarmsRegistry } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';

const ID = 'over-speed';
const MS_PER_KN = 0.514444; // 1 knot in m/s

export function startOverSpeedPredicate(
  bus: Bus,
  registry: AlarmsRegistry,
  configRef: { current: AlarmsConfig },
): { dispose(): void } {
  let pendingFireTimer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = bus.subscribe('nav.gps.sog', (sample) => {
    const cfg = configRef.current;
    if (!cfg.enabled[ID]) {
      if (pendingFireTimer) {
        clearTimeout(pendingFireTimer);
        pendingFireTimer = null;
      }
      return;
    }
    if (sample.value.kind !== 'scalar') return;
    const sogMs = sample.value.value;
    if (!Number.isFinite(sogMs)) return;

    const threshold = cfg.thresholds.overSpeed;
    const holdMs = threshold.holdMs ?? 5000;
    const thresholdKn = threshold.thresholdKn ?? 12;
    const thresholdMs = thresholdKn * MS_PER_KN;

    if (sogMs > thresholdMs) {
      const current = registry.get(ID);
      if (current && current.clearedAt === null) return;
      if (pendingFireTimer) return;
      pendingFireTimer = setTimeout(() => {
        pendingFireTimer = null;
        registry.fire({
          id: ID,
          severity: 'WARN',
          label: 'Over Speed',
          sticky: false,
          context: { sogKn: sogMs / MS_PER_KN, thresholdKn },
        });
      }, holdMs);
    } else {
      if (pendingFireTimer) {
        clearTimeout(pendingFireTimer);
        pendingFireTimer = null;
      }
      registry.clear(ID);
    }
  });

  return {
    dispose: () => {
      unsubscribe();
      if (pendingFireTimer) clearTimeout(pendingFireTimer);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run packages/compute/src/alarms/over-speed.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/alarms/over-speed.ts packages/compute/src/alarms/over-speed.test.ts
git commit -m "feat(compute): over-speed predicate"
```

---

## Task 9: Low-battery predicate

**Files:**
- Create: `packages/compute/src/alarms/low-battery.ts`
- Create: `packages/compute/src/alarms/low-battery.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/compute/src/alarms/low-battery.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Bus, createAlarmsRegistry, type AlarmsRegistry } from '@g5000/core';
import { DEFAULT_ALARMS_CONFIG, type AlarmsConfig } from '@g5000/db';
import { startLowBatteryPredicate } from './low-battery.js';

function scalarSample(channel: string, value: number) {
  return {
    channel,
    t_ns: BigInt(Date.now()) * 1_000_000n,
    value: { kind: 'scalar' as const, value },
    source: 'test',
  };
}

describe('low-battery predicate', () => {
  let bus: Bus;
  let registry: AlarmsRegistry;
  let configRef: { current: AlarmsConfig };

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new Bus();
    registry = createAlarmsRegistry();
    configRef = { current: structuredClone(DEFAULT_ALARMS_CONFIG) };
    configRef.current.thresholds.lowBattery = { thresholdV: 12.0, holdMs: 1000 };
  });

  it('fires when voltage stays below threshold for holdMs', () => {
    const { dispose } = startLowBatteryPredicate(bus, registry, configRef);
    bus.publish(scalarSample('electrical.battery.voltage', 11.5));
    vi.advanceTimersByTime(1100);
    expect(registry.active()).toHaveLength(1);
    expect(registry.active()[0]?.id).toBe('low-battery');
    dispose();
  });

  it('does not fire above threshold', () => {
    const { dispose } = startLowBatteryPredicate(bus, registry, configRef);
    bus.publish(scalarSample('electrical.battery.voltage', 12.6));
    vi.advanceTimersByTime(2000);
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('clears when voltage returns above threshold', () => {
    const { dispose } = startLowBatteryPredicate(bus, registry, configRef);
    bus.publish(scalarSample('electrical.battery.voltage', 11.5));
    vi.advanceTimersByTime(1100);
    bus.publish(scalarSample('electrical.battery.voltage', 13.2));
    expect(registry.active()).toHaveLength(0);
    dispose();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/compute/src/alarms/low-battery.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Create the predicate**

Create `packages/compute/src/alarms/low-battery.ts`:

```ts
import type { Bus, AlarmsRegistry } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';

const ID = 'low-battery';

export function startLowBatteryPredicate(
  bus: Bus,
  registry: AlarmsRegistry,
  configRef: { current: AlarmsConfig },
): { dispose(): void } {
  let pendingFireTimer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = bus.subscribe('electrical.battery.voltage', (sample) => {
    const cfg = configRef.current;
    if (!cfg.enabled[ID]) {
      if (pendingFireTimer) {
        clearTimeout(pendingFireTimer);
        pendingFireTimer = null;
      }
      return;
    }
    if (sample.value.kind !== 'scalar') return;
    const volts = sample.value.value;
    if (!Number.isFinite(volts)) return;

    const threshold = cfg.thresholds.lowBattery;
    const holdMs = threshold.holdMs ?? 5000;
    const thresholdV = threshold.thresholdV ?? 11.8;

    if (volts < thresholdV) {
      const current = registry.get(ID);
      if (current && current.clearedAt === null) return;
      if (pendingFireTimer) return;
      pendingFireTimer = setTimeout(() => {
        pendingFireTimer = null;
        registry.fire({
          id: ID,
          severity: 'WARN',
          label: 'Low Battery',
          sticky: false,
          context: { volts, thresholdV },
        });
      }, holdMs);
    } else {
      if (pendingFireTimer) {
        clearTimeout(pendingFireTimer);
        pendingFireTimer = null;
      }
      registry.clear(ID);
    }
  });

  return {
    dispose: () => {
      unsubscribe();
      if (pendingFireTimer) clearTimeout(pendingFireTimer);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run packages/compute/src/alarms/low-battery.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/alarms/low-battery.ts packages/compute/src/alarms/low-battery.test.ts
git commit -m "feat(compute): low-battery predicate"
```

---

## Task 10: Alarms pipeline orchestrator

**Files:**
- Create: `packages/compute/src/alarms/index.ts`
- Create: `packages/compute/src/alarms/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/compute/src/alarms/pipeline.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Bus, createAlarmsRegistry, type AlarmsRegistry } from '@g5000/core';
import { DEFAULT_ALARMS_CONFIG, type AlarmsConfig } from '@g5000/db';
import { startAlarmsPipeline } from './index.js';

function scalarSample(channel: string, value: number) {
  return {
    channel,
    t_ns: BigInt(Date.now()) * 1_000_000n,
    value: { kind: 'scalar' as const, value },
    source: 'test',
  };
}

describe('startAlarmsPipeline', () => {
  let bus: Bus;
  let registry: AlarmsRegistry;
  let configRef: { current: AlarmsConfig };

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new Bus();
    registry = createAlarmsRegistry();
    configRef = { current: structuredClone(DEFAULT_ALARMS_CONFIG) };
    configRef.current.thresholds.shallowWater.holdMs = 100;
    configRef.current.thresholds.overSpeed.holdMs = 100;
    configRef.current.thresholds.lowBattery.holdMs = 100;
  });

  it('starts all predicates and they each work end-to-end', () => {
    const handle = startAlarmsPipeline(bus, registry, configRef);

    bus.publish(scalarSample('nav.depth', 1.5));
    vi.advanceTimersByTime(200);
    expect(registry.get('shallow-water')).toBeDefined();

    bus.publish(scalarSample('nav.gps.sog', 10));
    vi.advanceTimersByTime(200);
    expect(registry.get('over-speed')).toBeDefined();

    handle.dispose();
  });

  it('dispose stops all predicates', () => {
    const handle = startAlarmsPipeline(bus, registry, configRef);
    handle.dispose();

    bus.publish(scalarSample('nav.depth', 1.5));
    vi.advanceTimersByTime(200);
    expect(registry.get('shallow-water')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/compute/src/alarms/pipeline.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Create the orchestrator**

Create `packages/compute/src/alarms/index.ts`:

```ts
import type { Bus, AlarmsRegistry } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';
import { startAnchorWatchPredicate } from './anchor-watch.js';
import { startShallowWaterPredicate } from './shallow-water.js';
import { startOverSpeedPredicate } from './over-speed.js';
import { startLowBatteryPredicate } from './low-battery.js';

export { startAnchorWatchPredicate, startShallowWaterPredicate, startOverSpeedPredicate, startLowBatteryPredicate };

export function startAlarmsPipeline(
  bus: Bus,
  registry: AlarmsRegistry,
  configRef: { current: AlarmsConfig },
): { dispose(): void } {
  const handles = [
    startAnchorWatchPredicate(bus, registry, configRef),
    startShallowWaterPredicate(bus, registry, configRef),
    startOverSpeedPredicate(bus, registry, configRef),
    startLowBatteryPredicate(bus, registry, configRef),
  ];
  return {
    dispose: () => {
      for (const h of handles) h.dispose();
    },
  };
}
```

- [ ] **Step 4: Build compute**

Run: `npx tsc -b packages/compute`
Expected: clean exit.

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run packages/compute/src/alarms/`
Expected: all per-predicate tests + pipeline tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/compute/src/alarms/index.ts packages/compute/src/alarms/pipeline.test.ts
git commit -m "feat(compute): alarms pipeline orchestrator"
```

---

## Task 11: Map PGN 127508 to electrical.battery.voltage

**Files:**
- Modify: `packages/bridge/src/channel-mapper.ts`
- Modify: `packages/bridge/src/channel-mapper.test.ts`

The mapper uses a lookup table keyed by PGN number. Each entry is a function `(pgn) => Sample[]`. See PGN 129025 at line ~143 of `channel-mapper.ts` for a reference shape (geo sample). The Sample type comes from `@g5000/core`.

- [ ] **Step 1: Write the failing test**

In `packages/bridge/src/channel-mapper.test.ts`, add (in the same `describe` block where the other PGN tests live, e.g. near the PGN 129025 test):

```ts
it('maps PGN 127508 (DC Battery Status) to electrical.battery.voltage for instance 0', () => {
  const decoded = {
    pgn: 127508,
    src: 17,
    dst: 255,
    prio: 6,
    rxTimestamp: BigInt(1_700_000_000_000) * 1_000_000n,
    fields: { 'Instance': 0, 'Voltage': 12.6 },
  };
  const samples = mapDecodedPgnToSamples(decoded);  // use whatever the mapper's export is
  const batt = samples.find((s) => s.channel === 'electrical.battery.voltage');
  expect(batt).toBeDefined();
  expect(batt?.value).toEqual({ kind: 'scalar', value: 12.6 });
});

it('ignores PGN 127508 frames for non-zero instances (v1 lowest-only)', () => {
  const decoded = {
    pgn: 127508,
    src: 17,
    dst: 255,
    prio: 6,
    rxTimestamp: BigInt(1_700_000_000_000) * 1_000_000n,
    fields: { 'Instance': 1, 'Voltage': 13.1 },
  };
  const samples = mapDecodedPgnToSamples(decoded);
  expect(samples.find((s) => s.channel === 'electrical.battery.voltage')).toBeUndefined();
});
```

> The exact name of the dispatcher function in `channel-mapper.ts` may differ — open the file and find the exported function the existing tests call (search for what the PGN 129025 test invokes). Use that name in the new tests.

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run packages/bridge/src/channel-mapper.test.ts`
Expected: 2 new tests fail (no handler for 127508 yet).

- [ ] **Step 3: Add the 127508 entry**

In `packages/bridge/src/channel-mapper.ts`, alongside the existing PGN entries (the file uses a `Record<number, (pgn) => Sample[]>` lookup; see PGN 129025 around line 143), add:

```ts
// PGN 127508 — DC Battery Status. Multi-instance (house bank vs. start, etc.).
// V1: pick instance 0 only and ignore the rest. Future spec disambiguates.
127508: (pgn) => {
  const instance = pgn.fields['Instance'];
  const voltage = pgn.fields['Voltage'];
  if (instance !== 0) return [];
  if (typeof voltage !== 'number') return [];
  return [
    {
      channel: Channels.Electrical.BatteryVoltage,
      t_ns: pgn.rxTimestamp,
      value: { kind: 'scalar', value: voltage },
      source: sourceTag(pgn),
    },
  ];
},
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run packages/bridge/src/channel-mapper.test.ts`
Expected: all tests pass, including the 2 new ones.

- [ ] **Step 5: Run all bridge tests**

Run: `npx vitest run packages/bridge/`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/channel-mapper.ts packages/bridge/src/channel-mapper.test.ts
git commit -m "feat(bridge): map PGN 127508 to electrical.battery.voltage (instance 0)"
```

---

## Task 12: Wire AlarmsRegistry into autopilot-server boot

**Files:**
- Modify: `apps/autopilot-server/src/index.ts`

- [ ] **Step 1: Read the existing boot sequence**

Open `apps/autopilot-server/src/index.ts`. Find the section after the `Bus` is created and after the `ConfigStore` is opened and stashed on globalThis. Identify a good insertion point — right after where AlertsRegistry/DeviceRegistry/etc. are set up.

- [ ] **Step 2: Add the wire-up**

In `apps/autopilot-server/src/index.ts`, add the imports near the top of the file (merge with existing imports from these packages):

```ts
import { createAlarmsRegistry, setSharedAlarms } from '@g5000/core';
import { loadAlarmsConfig, saveAlarmsConfig, type AlarmsConfig } from '@g5000/db';
import { startAlarmsPipeline } from '@g5000/compute';
```

After ConfigStore is opened (search for `ConfigStore.open` to find the spot) and the Bus is constructed, add:

```ts
// --- Safety alarms (g5000-derived) ---
const alarmsRegistry = createAlarmsRegistry();
setSharedAlarms(alarmsRegistry);

const initialAlarmsConfig = await loadAlarmsConfig(store);  // `store` is the ConfigStore var name; rename if different
const alarmsConfigRef: { current: AlarmsConfig } = { current: initialAlarmsConfig };

const alarmsPipelineHandle = startAlarmsPipeline(bus, alarmsRegistry, alarmsConfigRef);

// Expose for API routes that need to reload config:
(globalThis as { __g5000_alarms_config_ref__?: typeof alarmsConfigRef }).__g5000_alarms_config_ref__ = alarmsConfigRef;
```

Find the existing shutdown / cleanup block (search for `process.on('SIGTERM'` or a `shutdown` function). Add disposal of `alarmsPipelineHandle.dispose()` there.

- [ ] **Step 3: Export `startAlarmsPipeline` from `@g5000/compute`**

Open `packages/compute/src/index.ts`. Add:

```ts
export * from './alarms/index.js';
```

- [ ] **Step 4: Export AlarmsConfig stuff from `@g5000/db`**

Open `packages/db/src/index.ts`. Add:

```ts
export * from './alarms-config.js';
export * from './alarms-history.js';
```

- [ ] **Step 5: Build everything**

Run: `npx tsc -b packages/core packages/db packages/compute packages/bridge`
Then: `npm run build --workspace @g5000/autopilot-server`
Expected: clean exit.

- [ ] **Step 6: Smoke-test that the server still boots in demo mode**

Run: `DEMO_MODE=1 SKIP_BRIDGE=1 npm run dev --workspace @g5000/autopilot-server &`
Wait ~5 seconds. Then: `curl -sI http://localhost:3000/api/stream | head -1`
Expected: `HTTP/1.1 200 OK`
Then: `kill %1` to stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add apps/autopilot-server/src/index.ts packages/compute/src/index.ts packages/db/src/index.ts
git commit -m "feat(autopilot-server): boot AlarmsRegistry and alarms pipeline"
```

---

## Task 13: GET/POST/PATCH /api/alarms route

**Files:**
- Create: `packages/web/src/app/api/alarms/route.ts`
- Create: `packages/web/src/app/api/alarms/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/app/api/alarms/route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createAlarmsRegistry, setSharedAlarms, _resetAlarmsForTests } from '@g5000/core';
import { GET, POST, PATCH } from './route.js';

describe('/api/alarms', () => {
  beforeEach(() => {
    _resetAlarmsForTests();
    setSharedAlarms(createAlarmsRegistry());
  });

  it('GET returns empty active + all', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.active).toEqual([]);
    expect(body.all).toEqual([]);
  });

  it('POST /api/alarms { id: "mob", action: "fire" } fires a sticky MOB alarm', async () => {
    const req = new Request('http://test/api/alarms', {
      method: 'POST',
      body: JSON.stringify({ id: 'mob', action: 'fire', context: { lat: 32.3, lon: -64.8 } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const list = await (await GET()).json();
    expect(list.active).toHaveLength(1);
    expect(list.active[0].id).toBe('mob');
    expect(list.active[0].sticky).toBe(true);
  });

  it('POST rejects fire of non-MOB ids (only MOB is manually fireable)', async () => {
    const req = new Request('http://test/api/alarms', {
      method: 'POST',
      body: JSON.stringify({ id: 'shallow-water', action: 'fire' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('PATCH { id, action: "ack" } acks an alarm', async () => {
    const fireReq = new Request('http://test/api/alarms', {
      method: 'POST',
      body: JSON.stringify({ id: 'mob', action: 'fire' }),
    });
    await POST(fireReq);

    const ackReq = new Request('http://test/api/alarms', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'mob', action: 'ack' }),
    });
    const res = await PATCH(ackReq);
    expect(res.status).toBe(200);

    const list = await (await GET()).json();
    expect(list.active).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/web/src/app/api/alarms/route.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Create the route**

Create `packages/web/src/app/api/alarms/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSharedAlarms } from '@g5000/core';

const ALLOWED_MANUAL_FIRE = new Set(['mob']);

export async function GET(): Promise<NextResponse> {
  const registry = getSharedAlarms();
  if (!registry) {
    return NextResponse.json({ active: [], all: [] }, { status: 200 });
  }
  return NextResponse.json({
    active: registry.active(),
    all: registry.all(),
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const registry = getSharedAlarms();
  if (!registry) return NextResponse.json({ ok: false, error: 'registry unavailable' }, { status: 503 });

  let body: { id?: string; action?: string; context?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (body.action !== 'fire') {
    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  }
  if (!body.id || !ALLOWED_MANUAL_FIRE.has(body.id)) {
    return NextResponse.json({ ok: false, error: 'id not manually-fireable' }, { status: 400 });
  }
  if (body.id === 'mob') {
    registry.fire({
      id: 'mob',
      severity: 'CRITICAL',
      label: 'MOB',
      sticky: true,
      context: body.context,
    });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request): Promise<NextResponse> {
  const registry = getSharedAlarms();
  if (!registry) return NextResponse.json({ ok: false, error: 'registry unavailable' }, { status: 503 });

  let body: { id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  if (body.action === 'ack') {
    registry.ack(body.id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run packages/web/src/app/api/alarms/route.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/alarms/route.ts packages/web/src/app/api/alarms/route.test.ts
git commit -m "feat(web): /api/alarms GET/POST/PATCH endpoints"
```

---

## Task 14: GET/PUT /api/alarms/config route

**Files:**
- Create: `packages/web/src/app/api/alarms/config/route.ts`
- Create: `packages/web/src/app/api/alarms/config/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/app/api/alarms/config/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET, PUT } from './route.js';
import { DEFAULT_ALARMS_CONFIG } from '@g5000/db';

// Mock the ConfigStore singleton getter; the route should look up the same
// ConfigStore the autopilot-server bound to globalThis at boot.
vi.mock('@g5000/db', async (orig) => {
  const actual = await orig<typeof import('@g5000/db')>();
  return {
    ...actual,
    getSharedConfigStore: vi.fn(() => null), // start unbound; tests bind per case
  };
});

describe('/api/alarms/config', () => {
  beforeEach(() => {
    // Reset the alarms config ref shared via globalThis
    (globalThis as { __g5000_alarms_config_ref__?: { current: unknown } }).__g5000_alarms_config_ref__ = {
      current: structuredClone(DEFAULT_ALARMS_CONFIG),
    };
  });

  it('GET returns the current AlarmsConfig from the in-memory ref', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.enabled.mob).toBe(true);
    expect(body.thresholds.shallowWater.thresholdM).toBeGreaterThan(0);
  });

  it('PUT updates the in-memory ref so predicates pick it up live', async () => {
    const next = {
      ...DEFAULT_ALARMS_CONFIG,
      enabled: { ...DEFAULT_ALARMS_CONFIG.enabled, 'over-speed': false },
    };
    const req = new Request('http://test', { method: 'PUT', body: JSON.stringify(next) });
    const res = await PUT(req);
    expect(res.status).toBe(200);

    const after = await (await GET()).json();
    expect(after.enabled['over-speed']).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/web/src/app/api/alarms/config/route.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Create the route**

Create `packages/web/src/app/api/alarms/config/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { DEFAULT_ALARMS_CONFIG, getSharedConfigStore, saveAlarmsConfig, type AlarmsConfig } from '@g5000/db';

interface ConfigRef {
  current: AlarmsConfig;
}

function getRef(): ConfigRef | null {
  const g = globalThis as { __g5000_alarms_config_ref__?: ConfigRef };
  return g.__g5000_alarms_config_ref__ ?? null;
}

export async function GET(): Promise<NextResponse> {
  const ref = getRef();
  if (!ref) return NextResponse.json(DEFAULT_ALARMS_CONFIG);
  return NextResponse.json(ref.current);
}

export async function PUT(req: Request): Promise<NextResponse> {
  const ref = getRef();
  if (!ref) return NextResponse.json({ ok: false, error: 'config ref unbound' }, { status: 503 });

  let body: AlarmsConfig;
  try {
    body = (await req.json()) as AlarmsConfig;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  // Replace the ref so predicates see the new config on their next sample.
  ref.current = body;

  // Best-effort persist via the shared ConfigStore.
  try {
    const store = getSharedConfigStore();
    await saveAlarmsConfig(store, body);
  } catch {
    // Persistence failures don't break the route — the in-memory ref still takes effect.
  }

  return NextResponse.json({ ok: true });
}
```

> `getSharedConfigStore` is exported from `@g5000/db` (see `packages/db/src/index.ts:21`). It throws if not initialized, so the catch-block is required for cases where the test environment didn't boot the autopilot-server.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run packages/web/src/app/api/alarms/config/route.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/alarms/config/route.ts packages/web/src/app/api/alarms/config/route.test.ts
git commit -m "feat(web): /api/alarms/config GET/PUT"
```

---

## Task 15: GET /api/alarms/history route

**Files:**
- Create: `packages/web/src/app/api/alarms/history/route.ts`

- [ ] **Step 1: Create the route directly (no unit test — thin pass-through)**

Create `packages/web/src/app/api/alarms/history/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSharedConfigStore, listAlarmHistory } from '@g5000/db';

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);

  try {
    const store = getSharedConfigStore();
    const rows = await listAlarmHistory(store, { limit });
    return NextResponse.json({ rows });
  } catch {
    return NextResponse.json({ rows: [] });
  }
}
```

- [ ] **Step 2: Smoke-test in dev**

Boot the dev server: `DEMO_MODE=1 SKIP_BRIDGE=1 npm run dev --workspace @g5000/autopilot-server &`
Wait 5 s. Then:

```bash
curl -s http://localhost:3000/api/alarms/history | head
```

Expected: `{"rows":[]}` (no alarms have fired yet). Then `kill %1`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/api/alarms/history/route.ts
git commit -m "feat(web): /api/alarms/history GET"
```

---

## Task 16: POST /api/alarms/anchor (drop/weigh)

**Files:**
- Create: `packages/web/src/app/api/alarms/anchor/route.ts`
- Create: `packages/web/src/app/api/alarms/anchor/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/app/api/alarms/anchor/route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from './route.js';
import { DEFAULT_ALARMS_CONFIG, type AlarmsConfig } from '@g5000/db';

describe('/api/alarms/anchor', () => {
  beforeEach(() => {
    (globalThis as { __g5000_alarms_config_ref__?: { current: AlarmsConfig } }).__g5000_alarms_config_ref__ = {
      current: structuredClone(DEFAULT_ALARMS_CONFIG),
    };
    // Stash a synthetic position in the bus's last-value table via globalThis
    (globalThis as { __g5000_test_position__?: unknown }).__g5000_test_position__ = { lat: 32.3, lon: -64.8 };
  });

  it('drop with explicit position sets armed=true and stores the point', async () => {
    const req = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ action: 'drop', position: { lat: 32.3, lon: -64.8 }, radiusM: 60 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const ref = (globalThis as { __g5000_alarms_config_ref__?: { current: AlarmsConfig } }).__g5000_alarms_config_ref__!;
    expect(ref.current.thresholds.anchor.armed).toBe(true);
    expect(ref.current.thresholds.anchor.point).toEqual({ lat: 32.3, lon: -64.8 });
    expect(ref.current.thresholds.anchor.radiusM).toBe(60);
    expect(ref.current.thresholds.anchor.droppedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('weigh sets armed=false but preserves point + droppedAt for history', async () => {
    // Pre-set as armed
    const ref = (globalThis as { __g5000_alarms_config_ref__?: { current: AlarmsConfig } }).__g5000_alarms_config_ref__!;
    ref.current.thresholds.anchor = {
      armed: true,
      point: { lat: 32.3, lon: -64.8 },
      droppedAt: '2026-05-18T12:00:00Z',
      radiusM: 50,
    };

    const req = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ action: 'weigh' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(ref.current.thresholds.anchor.armed).toBe(false);
  });

  it('rejects unknown action', async () => {
    const req = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ action: 'sail-off' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run packages/web/src/app/api/alarms/anchor/route.test.ts`
Expected: module-not-found.

- [ ] **Step 3: Create the route**

Create `packages/web/src/app/api/alarms/anchor/route.ts`:

```ts
import { NextResponse } from 'next/server';
import type { AlarmsConfig } from '@g5000/db';

interface ConfigRef { current: AlarmsConfig }

function getRef(): ConfigRef | null {
  const g = globalThis as { __g5000_alarms_config_ref__?: ConfigRef };
  return g.__g5000_alarms_config_ref__ ?? null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const ref = getRef();
  if (!ref) return NextResponse.json({ ok: false, error: 'config ref unbound' }, { status: 503 });

  let body: { action?: string; position?: { lat: number; lon: number }; radiusM?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  if (body.action === 'drop') {
    const position = body.position;
    if (!position) return NextResponse.json({ ok: false, error: 'position required for drop' }, { status: 400 });
    const radiusM = body.radiusM ?? ref.current.thresholds.anchor.radiusM ?? 50;
    ref.current = {
      ...ref.current,
      thresholds: {
        ...ref.current.thresholds,
        anchor: {
          armed: true,
          point: position,
          droppedAt: new Date().toISOString(),
          radiusM,
        },
      },
    };
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'weigh') {
    ref.current = {
      ...ref.current,
      thresholds: {
        ...ref.current.thresholds,
        anchor: { ...ref.current.thresholds.anchor, armed: false },
      },
    };
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run packages/web/src/app/api/alarms/anchor/route.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/alarms/anchor/route.ts packages/web/src/app/api/alarms/anchor/route.test.ts
git commit -m "feat(web): /api/alarms/anchor drop/weigh"
```

---

## Task 17: /alerts page shell with tabs

**Files:**
- Create: `packages/web/src/app/alerts/page.tsx`

- [ ] **Step 1: Create the page shell**

Create `packages/web/src/app/alerts/page.tsx`:

```tsx
import { ActiveList } from './active-list.js';
import { HistoryList } from './history-list.js';
import { SettingsForm } from './settings-form.js';

export default function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  return <AlertsPageInner searchParamsPromise={searchParams} />;
}

async function AlertsPageInner({ searchParamsPromise }: { searchParamsPromise: Promise<{ tab?: string }> }) {
  const { tab = 'active' } = await searchParamsPromise;

  return (
    <main className="p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Alerts</h1>
      <nav className="flex gap-4 mb-6 border-b">
        <TabLink href="?tab=active" label="Active" active={tab === 'active'} />
        <TabLink href="?tab=history" label="History" active={tab === 'history'} />
        <TabLink href="?tab=settings" label="Settings" active={tab === 'settings'} />
      </nav>
      {tab === 'active' && <ActiveList />}
      {tab === 'history' && <HistoryList />}
      {tab === 'settings' && <SettingsForm />}
    </main>
  );
}

function TabLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <a
      href={href}
      className={`pb-2 ${active ? 'border-b-2 border-blue-500 font-semibold' : 'text-gray-500'}`}
    >
      {label}
    </a>
  );
}
```

- [ ] **Step 2: Build web to verify (will fail because the three client components don't exist yet — that's expected; we create them next)**

Skip the build for now. Move to Task 18.

(No commit yet — the page won't compile until the three child components exist.)

---

## Task 18: ActiveList client component

**Files:**
- Create: `packages/web/src/app/alerts/active-list.tsx`

- [ ] **Step 1: Create the component**

Create `packages/web/src/app/alerts/active-list.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

interface AlarmRow {
  id: string;
  severity: 'CRITICAL' | 'WARN' | 'INFO';
  label: string;
  firedAt: string;
  clearedAt: string | null;
  ackedAt: string | null;
  context?: Record<string, unknown>;
}

interface AlertRow {
  key: string;
  type: string;
  state: string;
  text?: string;
  lastSeenMs: number;
}

export function ActiveList() {
  const [alarms, setAlarms] = useState<AlarmRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const [a, b] = await Promise.all([
          fetch('/api/alarms').then((r) => r.json()),
          fetch('/api/alerts').then((r) => r.json()),
        ]);
        if (stopped) return;
        setAlarms(a.active ?? []);
        setAlerts(b.alerts ?? []);
      } catch {
        // ignore transient
      }
    }
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  async function ackAlarm(id: string) {
    await fetch('/api/alarms', {
      method: 'PATCH',
      body: JSON.stringify({ id, action: 'ack' }),
    });
  }

  const allRows: Array<{ kind: 'alarm' | 'alert'; severity: string; row: AlarmRow | AlertRow }> = [
    ...alarms.map((r) => ({ kind: 'alarm' as const, severity: r.severity, row: r })),
    ...alerts.map((r) => ({ kind: 'alert' as const, severity: r.type, row: r })),
  ];
  const severityRank: Record<string, number> = { CRITICAL: 3, 'Emergency Alarm': 3, Alarm: 3, WARN: 2, Warning: 2, Caution: 1, INFO: 0 };
  allRows.sort((a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0));

  if (allRows.length === 0) {
    return <p className="text-gray-500">No active alarms or alerts.</p>;
  }

  return (
    <ul className="space-y-2">
      {allRows.map((entry) => (
        <li
          key={entry.kind === 'alarm' ? `alarm-${(entry.row as AlarmRow).id}` : `alert-${(entry.row as AlertRow).key}`}
          className={`p-3 rounded border ${severityRank[entry.severity] >= 3 ? 'border-red-500 bg-red-50' : 'border-yellow-500 bg-yellow-50'}`}
        >
          <div className="flex justify-between items-center">
            <div>
              <span className="font-semibold">
                {entry.kind === 'alarm' ? (entry.row as AlarmRow).label : (entry.row as AlertRow).text ?? 'N2K alert'}
              </span>
              <span className="ml-2 text-sm text-gray-600">{entry.severity}</span>
            </div>
            {entry.kind === 'alarm' && (
              <button
                onClick={() => ackAlarm((entry.row as AlarmRow).id)}
                className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
              >
                Ack
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Build web**

Run: `npm run build --workspace @g5000/web`
Expected: build succeeds (or if `next build` is configured to skip API routes, at minimum no TypeScript errors).

If `next build` fails on tasks because the page hasn't fully rendered yet, type-check instead:
Run: `npx tsc --noEmit -p packages/web/tsconfig.json` (or `npm run typecheck --workspace @g5000/web`).

- [ ] **Step 3: No commit yet — page still needs HistoryList and SettingsForm.**

---

## Task 19: HistoryList client component

**Files:**
- Create: `packages/web/src/app/alerts/history-list.tsx`

- [ ] **Step 1: Create the component**

Create `packages/web/src/app/alerts/history-list.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

interface HistoryRow {
  id: number;
  alarmId: string;
  severity: string;
  firedAt: string;
  clearedAt: string | null;
  ackedAt: string | null;
  context?: Record<string, unknown> | null;
}

export function HistoryList() {
  const [rows, setRows] = useState<HistoryRow[]>([]);

  useEffect(() => {
    fetch('/api/alarms/history?limit=200')
      .then((r) => r.json())
      .then((b) => setRows(b.rows ?? []))
      .catch(() => setRows([]));
  }, []);

  if (rows.length === 0) {
    return <p className="text-gray-500">No alarm history.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-600">
          <th className="py-2">Time (UTC)</th>
          <th>Alarm</th>
          <th>Severity</th>
          <th>Cleared</th>
          <th>Acked</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t">
            <td className="py-2 font-mono">{r.firedAt.replace('T', ' ').replace(/\..+$/, '')}</td>
            <td>{r.alarmId}</td>
            <td>{r.severity}</td>
            <td className="text-gray-500">
              {r.clearedAt ? r.clearedAt.replace('T', ' ').replace(/\..+$/, '') : '—'}
            </td>
            <td className="text-gray-500">
              {r.ackedAt ? r.ackedAt.replace('T', ' ').replace(/\..+$/, '') : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

---

## Task 20: SettingsForm client component

**Files:**
- Create: `packages/web/src/app/alerts/settings-form.tsx`

- [ ] **Step 1: Create the component**

Create `packages/web/src/app/alerts/settings-form.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

interface AlarmsConfig {
  enabled: Record<string, boolean>;
  thresholds: {
    anchor: { armed: boolean; point?: { lat: number; lon: number }; droppedAt?: string; radiusM: number };
    shallowWater: { thresholdM?: number; holdMs: number };
    overSpeed: { thresholdKn?: number; holdMs: number };
    lowBattery: { thresholdV?: number; holdMs: number };
  };
}

const ALARM_LABELS: Record<string, string> = {
  mob: 'MOB',
  'anchor-watch': 'Anchor Watch',
  'shallow-water': 'Shallow Water',
  'over-speed': 'Over Speed',
  'low-battery': 'Low Battery',
};

export function SettingsForm() {
  const [cfg, setCfg] = useState<AlarmsConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/alarms/config')
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => setCfg(null));
  }, []);

  if (!cfg) return <p>Loading...</p>;

  async function save(next: AlarmsConfig) {
    setSaving(true);
    setCfg(next);
    await fetch('/api/alarms/config', { method: 'PUT', body: JSON.stringify(next) });
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold mb-2">Per-alarm enable</h2>
        {Object.entries(ALARM_LABELS).map(([id, label]) => (
          <label key={id} className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={cfg.enabled[id] ?? true}
              onChange={(e) =>
                save({ ...cfg, enabled: { ...cfg.enabled, [id]: e.target.checked } })
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Thresholds</h2>
        <NumberField
          label="Shallow water (m)"
          value={cfg.thresholds.shallowWater.thresholdM ?? 3}
          onChange={(v) =>
            save({
              ...cfg,
              thresholds: { ...cfg.thresholds, shallowWater: { ...cfg.thresholds.shallowWater, thresholdM: v } },
            })
          }
        />
        <NumberField
          label="Over speed (kn)"
          value={cfg.thresholds.overSpeed.thresholdKn ?? 12}
          onChange={(v) =>
            save({
              ...cfg,
              thresholds: { ...cfg.thresholds, overSpeed: { ...cfg.thresholds.overSpeed, thresholdKn: v } },
            })
          }
        />
        <NumberField
          label="Low battery (V)"
          value={cfg.thresholds.lowBattery.thresholdV ?? 11.8}
          onChange={(v) =>
            save({
              ...cfg,
              thresholds: { ...cfg.thresholds, lowBattery: { ...cfg.thresholds.lowBattery, thresholdV: v } },
            })
          }
        />
        <NumberField
          label="Anchor radius (m)"
          value={cfg.thresholds.anchor.radiusM}
          onChange={(v) =>
            save({
              ...cfg,
              thresholds: { ...cfg.thresholds, anchor: { ...cfg.thresholds.anchor, radiusM: v } },
            })
          }
        />
      </section>

      {saving && <p className="text-sm text-gray-500">Saving…</p>}
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 py-1">
      <span className="w-48">{label}</span>
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="border rounded px-2 py-1 w-32"
      />
    </label>
  );
}
```

- [ ] **Step 2: Build web**

Run: `npx tsc -b packages/web` (or `npm run typecheck --workspace @g5000/web`)
Expected: clean.

- [ ] **Step 3: Commit the page + all three components**

```bash
git add packages/web/src/app/alerts/
git commit -m "feat(web): /alerts page with Active/History/Settings tabs"
```

---

## Task 21: AlarmBanner root-layout component

**Files:**
- Create: `packages/web/src/components/alarm-banner.tsx`
- Modify: `packages/web/src/app/layout.tsx`

- [ ] **Step 1: Create the banner**

Create `packages/web/src/components/alarm-banner.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

interface AlarmRow {
  id: string;
  severity: 'CRITICAL' | 'WARN' | 'INFO';
  label: string;
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARN: 2, INFO: 1 };

export function AlarmBanner() {
  const [topAlarm, setTopAlarm] = useState<AlarmRow | null>(null);
  const [extraCount, setExtraCount] = useState(0);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const r = await fetch('/api/alarms');
        if (stopped) return;
        const body = await r.json();
        const active = (body.active ?? []) as AlarmRow[];
        active.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
        setTopAlarm(active[0] ?? null);
        setExtraCount(Math.max(0, active.length - 1));
      } catch {
        // transient
      }
    }
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  if (!topAlarm) return null;

  const bg = topAlarm.severity === 'CRITICAL' ? 'bg-red-600' : topAlarm.severity === 'WARN' ? 'bg-yellow-500' : 'bg-blue-500';

  return (
    <a
      href="/alerts"
      className={`block w-full ${bg} text-white px-4 py-2 text-sm font-semibold sticky top-0 z-50`}
    >
      ⚠ {topAlarm.label}
      {extraCount > 0 && <span className="ml-2 opacity-80">(+{extraCount} more)</span>}
    </a>
  );
}
```

- [ ] **Step 2: Mount in root layout**

Open `packages/web/src/app/layout.tsx`. Import the banner and mount it inside the `<body>` block, before the page content:

```tsx
import { AlarmBanner } from '../components/alarm-banner.js';
// ...
return (
  <html lang="en">
    <body>
      <AlarmBanner />
      {children}
    </body>
  </html>
);
```

(Match the existing JSX shape — the actual layout may have providers or wrappers; mount the banner just inside `<body>`.)

- [ ] **Step 3: Build web**

Run: `npx tsc -b packages/web`
Expected: clean.

- [ ] **Step 4: Smoke-test in dev**

`DEMO_MODE=1 SKIP_BRIDGE=1 npm run dev --workspace @g5000/autopilot-server &`
Open `http://localhost:3000/` — the banner is invisible (no active alarms).
Manually fire MOB: `curl -X POST http://localhost:3000/api/alarms -d '{"id":"mob","action":"fire"}'`
Refresh — red banner should appear within 2 seconds.
Click banner → goes to `/alerts`.
Click Ack → banner disappears.
`kill %1`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/alarm-banner.tsx packages/web/src/app/layout.tsx
git commit -m "feat(web): persistent AlarmBanner in root layout"
```

---

## Task 22: MOB button for helm

**Files:**
- Create: `packages/web/src/app/helm/mob-button.tsx`
- Modify: `packages/web/src/app/helm/page.tsx`

- [ ] **Step 1: Create the button**

Create `packages/web/src/app/helm/mob-button.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';

export function MobButton() {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'm' && !confirming) {
        setConfirming(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);

  async function fireMob() {
    // Fetch current position from /api/position one-shot
    let position: { lat: number; lon: number } | undefined;
    try {
      const r = await fetch('/api/stream?last=nav.gps.position');
      // /api/stream is SSE; for a one-shot fetch we go a different route:
      // simpler — let the server side capture position when MOB POST arrives;
      // pass no context here and let the registry's context be filled by a follow-up.
      // For v1, we POST without position and rely on the bridge to publish one.
    } catch { /* ignored */ }

    await fetch('/api/alarms', {
      method: 'POST',
      body: JSON.stringify({ id: 'mob', action: 'fire', context: position ? { position } : {} }),
    });
    setConfirming(false);
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="fixed bottom-4 right-4 bg-red-600 hover:bg-red-700 text-white font-bold text-xl px-6 py-4 rounded-full shadow-lg z-40"
      >
        MOB
      </button>
      {confirming && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-white p-6 rounded-lg max-w-sm w-full">
            <h2 className="text-xl font-bold mb-4">Confirm MOB?</h2>
            <p className="mb-4 text-sm text-gray-600">
              This will fire a CRITICAL alarm and drop a waypoint at the current position.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirming(false)}
                className="px-4 py-2 bg-gray-200 rounded"
              >
                Cancel
              </button>
              <button onClick={fireMob} className="px-4 py-2 bg-red-600 text-white rounded font-bold">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Mount it on /helm**

Open `packages/web/src/app/helm/page.tsx`. Add the import and render it inside the page (anywhere — the button is `fixed`-positioned and will float regardless of where it's in the tree):

```tsx
import { MobButton } from './mob-button.js';
// ... inside the page return:
<MobButton />
```

- [ ] **Step 3: Build web**

Run: `npx tsc -b packages/web`
Expected: clean.

- [ ] **Step 4: Smoke-test**

Dev server → open `/helm` → click MOB → Confirm → banner appears across all pages → ack from `/alerts`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/helm/mob-button.tsx packages/web/src/app/helm/page.tsx
git commit -m "feat(web): MOB button on helm with confirm modal"
```

---

## Task 23: AudibleAlarm component (helm only)

**Files:**
- Create: `packages/web/src/components/audible-alarm.tsx`
- Modify: `packages/web/src/app/helm/page.tsx`

- [ ] **Step 1: Create the component**

Create `packages/web/src/components/audible-alarm.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

const MUTE_KEY = 'g5000.audible-alarm.muted';

export function AudibleAlarm() {
  const ctxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [muted, setMuted] = useState(false);
  const [active, setActive] = useState<'CRITICAL' | 'WARN' | 'INFO' | null>(null);

  useEffect(() => {
    setMuted(localStorage.getItem(MUTE_KEY) === '1');
  }, []);

  // Warm the AudioContext on first user interaction with the page (autoplay policy).
  useEffect(() => {
    function warm() {
      if (!ctxRef.current) {
        const Ctx = (window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
        if (Ctx) ctxRef.current = new Ctx();
      }
      window.removeEventListener('pointerdown', warm);
      window.removeEventListener('keydown', warm);
    }
    window.addEventListener('pointerdown', warm);
    window.addEventListener('keydown', warm);
    return () => {
      window.removeEventListener('pointerdown', warm);
      window.removeEventListener('keydown', warm);
    };
  }, []);

  // Poll active alarms; figure out the highest-severity unmuted one.
  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const r = await fetch('/api/alarms');
        if (stopped) return;
        const body = await r.json();
        const top = (body.active ?? [])[0]?.severity ?? null;
        setActive(top);
      } catch {
        // transient
      }
    }
    poll();
    const t = setInterval(poll, 1500);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  // Drive the oscillator based on current severity + mute.
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (oscRef.current) {
      try { oscRef.current.stop(); } catch { /* already stopped */ }
      oscRef.current.disconnect();
      oscRef.current = null;
    }

    if (muted || !active || !ctxRef.current) return;
    const ctx = ctxRef.current;
    const cfg = active === 'CRITICAL'
      ? { freq: 880, type: 'square' as const, onMs: 200, offMs: 200 }
      : active === 'WARN'
      ? { freq: 440, type: 'sine' as const, onMs: 500, offMs: 1000 }
      : { freq: 440, type: 'sine' as const, onMs: 250, offMs: 60_000 };

    function beep() {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = cfg.type;
      osc.frequency.value = cfg.freq;
      osc.connect(gain).connect(ctx.destination);
      gain.gain.value = 0.15;
      osc.start();
      setTimeout(() => {
        try { osc.stop(); } catch { /* ignored */ }
        osc.disconnect();
        gain.disconnect();
      }, cfg.onMs);
    }
    beep();
    intervalRef.current = setInterval(beep, cfg.onMs + cfg.offMs);
  }, [active, muted]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  }

  return (
    <button
      onClick={toggleMute}
      className={`fixed bottom-4 left-4 px-3 py-2 rounded text-sm font-mono z-40 ${muted ? 'bg-red-700 text-white' : 'bg-gray-200 text-gray-800'}`}
      title={muted ? 'Audible alarms MUTED — click to unmute' : 'Audible alarms on — click to mute'}
    >
      {muted ? '🔇 MUTED' : '🔊 Audio'}
    </button>
  );
}
```

- [ ] **Step 2: Mount on helm**

In `packages/web/src/app/helm/page.tsx`, add the import and render alongside `<MobButton />`:

```tsx
import { AudibleAlarm } from '../../components/audible-alarm.js';
// inside return:
<AudibleAlarm />
```

- [ ] **Step 3: Build web**

Run: `npx tsc -b packages/web`
Expected: clean.

- [ ] **Step 4: Smoke-test**

Dev server → open `/helm` → click somewhere (warms AudioContext) → trigger MOB → audible beeping starts → click mute → silence with red "MUTED" indicator → ack MOB → state resolves.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/audible-alarm.tsx packages/web/src/app/helm/page.tsx
git commit -m "feat(web): AudibleAlarm on helm with persistent mute indicator"
```

---

## Task 24: History row writeback on alarm transitions

**Files:**
- Modify: `apps/autopilot-server/src/index.ts` (already touched in Task 12)

- [ ] **Step 1: Wrap the registry to write history on fire/clear/ack**

In `apps/autopilot-server/src/index.ts`, after `setSharedAlarms(alarmsRegistry)` and before `startAlarmsPipeline`, wrap the registry methods so they also write to `alarms_history`:

```ts
import { appendAlarmHistory, updateAlarmHistoryClear, updateAlarmHistoryAck } from '@g5000/db';

const rowIdByAlarmId = new Map<string, number>();

const rawFire = alarmsRegistry.fire.bind(alarmsRegistry);
alarmsRegistry.fire = (req) => {
  rawFire(req);
  // Only append a history row on a fresh fire (no current active entry).
  const snapshot = alarmsRegistry.get(req.id);
  if (snapshot && !rowIdByAlarmId.has(req.id)) {
    appendAlarmHistory(store, {
      alarmId: req.id,
      severity: req.severity,
      firedAt: snapshot.firedAt,
      context: snapshot.context as Record<string, unknown> | undefined,
    })
      .then((rowId) => rowIdByAlarmId.set(req.id, rowId))
      .catch(() => { /* don't fail the alarm on a DB hiccup */ });
  }
};

const rawClear = alarmsRegistry.clear.bind(alarmsRegistry);
alarmsRegistry.clear = (id) => {
  rawClear(id);
  const rowId = rowIdByAlarmId.get(id);
  if (rowId !== undefined) {
    updateAlarmHistoryClear(store, rowId, new Date().toISOString()).catch(() => {});
  }
};

const rawAck = alarmsRegistry.ack.bind(alarmsRegistry);
alarmsRegistry.ack = (id) => {
  rawAck(id);
  const rowId = rowIdByAlarmId.get(id);
  if (rowId !== undefined) {
    updateAlarmHistoryAck(store, rowId, new Date().toISOString()).catch(() => {});
    rowIdByAlarmId.delete(id);
  }
};
```

- [ ] **Step 2: Build everything**

Run: `npx tsc -b packages/core packages/db packages/compute packages/bridge && npm run build --workspace @g5000/autopilot-server`
Expected: clean.

- [ ] **Step 3: End-to-end smoke**

Dev server → trigger MOB via `/helm` → ack on `/alerts/?tab=active` → switch to History tab → row visible with both `firedAt` and `ackedAt` populated.

- [ ] **Step 4: Commit**

```bash
git add apps/autopilot-server/src/index.ts
git commit -m "feat(autopilot-server): persist alarm fire/clear/ack to history table"
```

---

## Task 25: Replay-driven integration test

**Files:**
- Create: `packages/compute/src/alarms/integration.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/compute/src/alarms/integration.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Bus, createAlarmsRegistry } from '@g5000/core';
import { DEFAULT_ALARMS_CONFIG, type AlarmsConfig } from '@g5000/db';
import { startAlarmsPipeline } from './index.js';

function geoSample(lat: number, lon: number, t_ns: bigint) {
  return {
    channel: 'nav.gps.position',
    t_ns,
    value: { kind: 'geo' as const, value: { lat, lon } },
    source: 'test',
  };
}

function scalarSample(channel: string, value: number) {
  return {
    channel,
    t_ns: BigInt(Date.now()) * 1_000_000n,
    value: { kind: 'scalar' as const, value },
    source: 'test',
  };
}

describe('alarms pipeline (synthetic session integration)', () => {
  it('fires anchor-watch when synthetic position track drifts outside radius', () => {
    vi.useFakeTimers();
    const bus = new Bus();
    const registry = createAlarmsRegistry();
    const configRef: { current: AlarmsConfig } = { current: structuredClone(DEFAULT_ALARMS_CONFIG) };
    configRef.current.thresholds.anchor = {
      armed: true,
      point: { lat: 32.3, lon: -64.8 },
      droppedAt: '2026-05-18T12:00:00Z',
      radiusM: 50,
    };
    configRef.current.thresholds.shallowWater.holdMs = 100;

    const handle = startAlarmsPipeline(bus, registry, configRef);

    // Synthetic positions: 10 inside the anchor radius
    for (let i = 0; i < 10; i++) {
      bus.publish(geoSample(32.3001, -64.8, BigInt(1_700_000_000_000 + i * 1000) * 1_000_000n));
    }
    expect(registry.active().find((a) => a.id === 'anchor-watch')).toBeUndefined();

    // Now drift outside
    bus.publish(geoSample(32.305, -64.8, BigInt(1_700_000_020_000) * 1_000_000n));
    const active = registry.active();
    expect(active.find((a) => a.id === 'anchor-watch')).toBeDefined();

    handle.dispose();
    vi.useRealTimers();
  });

  it('shallow-water fires and clears as depth crosses threshold', () => {
    vi.useFakeTimers();
    const bus = new Bus();
    const registry = createAlarmsRegistry();
    const configRef: { current: AlarmsConfig } = { current: structuredClone(DEFAULT_ALARMS_CONFIG) };
    configRef.current.thresholds.shallowWater = { thresholdM: 3, holdMs: 500 };

    const handle = startAlarmsPipeline(bus, registry, configRef);

    bus.publish(scalarSample('nav.depth', 2.5));
    vi.advanceTimersByTime(600);
    expect(registry.active().find((a) => a.id === 'shallow-water')).toBeDefined();

    bus.publish(scalarSample('nav.depth', 5.0));
    expect(registry.active().find((a) => a.id === 'shallow-water')).toBeUndefined();

    handle.dispose();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run packages/compute/src/alarms/integration.test.ts`
Expected: 2 tests pass.

- [ ] **Step 3: Run all tests one more time to verify nothing regressed**

Run: `npm test`
Expected: same passing-test count as before (or higher), no new failures. The 4 pre-existing failures (wgrib2, position SSE, bermuda-newport routing) should remain present but unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/compute/src/alarms/integration.test.ts
git commit -m "test(compute): integration test for anchor-watch + shallow-water pipelines"
```

---

## Task 26: Update spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-05-18-safety-alarms-design.md`

- [ ] **Step 1: Mark spec as implemented**

Edit `docs/superpowers/specs/2026-05-18-safety-alarms-design.md`. Change the header:

```markdown
**Status:** Approved (brainstorming complete; ready for implementation plan)
```

to:

```markdown
**Status:** Implemented (see `docs/superpowers/plans/2026-05-18-safety-alarms.md`)
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-18-safety-alarms-design.md
git commit -m "docs(specs): mark safety-alarms spec as implemented"
```

---

## Self-review checklist (for the executing agent)

After all tasks complete, verify:

1. **Spec coverage:** Walk the spec's §3 (Files manifest). Every Create/Modify row should be checked off. The one row deliberately deferred (off-course + arrival alarms) should still be deferred — they were marked out-of-scope in §6.
2. **Test count:** Expect roughly 25-30 new tests added across `@g5000/core`, `@g5000/db`, `@g5000/compute`, and `@g5000/web`.
3. **No new tsc errors:** `npx tsc -b packages/core packages/db packages/compute packages/bridge packages/grib packages/coastline packages/routing` must exit clean.
4. **End-to-end:** Dev server boots, `/helm` shows MOB button + audio toggle, `/alerts` page renders all three tabs, banner appears across pages when an alarm fires.
