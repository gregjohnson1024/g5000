import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Bus, type Sample } from '@g5000/core';
import { ConfigStore, DEFAULT_POLARS } from '@g5000/db';
import { startPolarPipeline } from './pipeline.js';

const sample = (channel: string, value: number, t_ns = 1n): Sample => ({
  channel,
  t_ns,
  value: { kind: 'scalar', value },
  source: 'test',
});

describe('startPolarPipeline', () => {
  let dir: string;
  let store: ConfigStore;
  let bus: Bus;
  let stop: () => Promise<void>;
  let received: Sample[];

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'g5000-polar-'));
    store = await ConfigStore.open(path.join(dir, 'config.db'));
    bus = new Bus();
    received = [];
    bus.subscribe('performance.**', (s) => received.push(s));
    stop = await startPolarPipeline({
      bus,
      configStore: store,
      staleAfterMs: 60_000,
    });
  });

  afterEach(async () => {
    await stop();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('publishes performance.target.{boatSpeed,vmg,twaUpwind,twaDownwind} when all inputs are present', async () => {
    const now = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample('wind.true.speed', 8, now)); // 8 m/s TWS
    bus.publish(sample('wind.true.angle', Math.PI / 4, now)); // 45° TWA
    bus.publish(sample('boat.speed.water', 5.5, now));

    await new Promise((r) => setTimeout(r, 30));

    const channels = new Set(received.map((s) => s.channel));
    expect(channels.has('performance.target.boatSpeed')).toBe(true);
    expect(channels.has('performance.target.vmg')).toBe(true);
    expect(channels.has('performance.target.twaUpwind')).toBe(true);
    expect(channels.has('performance.target.twaDownwind')).toBe(true);
    expect(channels.has('performance.vmg')).toBe(true);
    expect(channels.has('performance.percentPolar')).toBe(true);
  });

  it('emits percentPolar = actual/target × 100 (rough)', async () => {
    const now = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample('wind.true.speed', 8, now));
    bus.publish(sample('wind.true.angle', Math.PI / 2, now)); // 90° TWA
    bus.publish(sample('boat.speed.water', 7, now)); // boat speed 7 m/s

    await new Promise((r) => setTimeout(r, 30));

    const pp = received.find((s) => s.channel === 'performance.percentPolar');
    expect(pp).toBeDefined();
    if (pp && pp.value.kind === 'scalar') {
      // For TWS=8 m/s, TWA=90°, default cat polar → about 7.0 m/s. Boat at
      // 7.0 → ~100%. Don't pin exact value; just sanity-check range.
      expect(pp.value.value).toBeGreaterThan(50);
      expect(pp.value.value).toBeLessThan(200);
    }
  });

  it('does not emit when any required input is missing', async () => {
    const now = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample('wind.true.speed', 8, now));
    // No TWA, no BSP.
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(0);
  });

  it('recomputes when the polar table changes', async () => {
    const now = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample('wind.true.speed', 8, now));
    bus.publish(sample('wind.true.angle', Math.PI / 4, now));
    bus.publish(sample('boat.speed.water', 5, now));
    await new Promise((r) => setTimeout(r, 30));
    const initial = received.length;
    expect(initial).toBeGreaterThan(0);

    // Zero out the polar — target should drop to 0, percentPolar should
    // become a finite degenerate value (we expect 0 or undefined). We just
    // assert the pipeline RE-fires.
    //
    // v3 ConfigStore: no setPolars(); instead write a new revision and let
    // activePolar$ resolve the newest (boatId, activeMode) revision.
    const polar = await firstValueFromBehavior(store.polars$);
    const wardrobe = await firstValueFromBehavior(store.sails$);
    await store.createRevision({
      id: `01HZEROEDIT${Date.now().toString(36).toUpperCase()}`,
      boatId: wardrobe.boatId,
      sailConfigId: 'unused-in-v3',
      mode: wardrobe.activeMode,
      parentRevisionId: null,
      createdAt: Math.floor(Date.now() / 1000) + 1,
      lineage: { kind: 'manual_edit' },
      table: {
        ...polar,
        boatSpeed: polar.boatSpeed.map((row) => row.map(() => 0)),
      },
    });
    const now2 = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample('boat.speed.water', 5.01, now2));
    await new Promise((r) => setTimeout(r, 30));
    expect(received.length).toBeGreaterThan(initial);
  });
});

import { firstValueFrom } from 'rxjs';
const firstValueFromBehavior = firstValueFrom;

describe('startPolarPipeline + revision swap', () => {
  it('publishes a new target boatspeed after a newer revision is written', async () => {
    const dbPath = path.join(tmpdir(), `poly-pipe-swap-${Date.now()}-${Math.random()}.db`);
    const store = await ConfigStore.open(dbPath);
    const bus = new Bus();
    const stop = await startPolarPipeline({ bus, configStore: store });

    // Capture target boatspeed emissions.
    const targets: number[] = [];
    const unsub = bus.subscribe('performance.target.boatSpeed', (s) => {
      if (s.value.kind === 'scalar') targets.push(s.value.value);
    });

    // Drive the pipeline with all three required inputs against the default polar.
    const t0 = BigInt(Date.now()) * 1_000_000n;
    bus.publish({
      channel: 'wind.true.speed',
      t_ns: t0,
      value: { kind: 'scalar', value: 5, unit: 'm/s' },
      source: 'test',
    });
    bus.publish({
      channel: 'wind.true.angle',
      t_ns: t0,
      value: { kind: 'scalar', value: Math.PI / 2, unit: 'rad' },
      source: 'test',
    });
    bus.publish({
      channel: 'boat.speed.water',
      t_ns: t0,
      value: { kind: 'scalar', value: 3, unit: 'm/s' },
      source: 'test',
    });

    await new Promise((r) => setImmediate(r));

    const baselineTarget = targets[targets.length - 1];
    expect(baselineTarget).toBeDefined();
    expect(baselineTarget!).toBeGreaterThan(0);

    // v3 ConfigStore: write a new 2× revision; activePolar$ resolves to the
    // newest revision for (boatId, activeMode), so it becomes active
    // automatically.
    const wardrobe = await firstValueFrom(store.sails$);
    const twoX = {
      ...DEFAULT_POLARS,
      boatSpeed: DEFAULT_POLARS.boatSpeed.map((row) => row.map((v) => v * 2)),
    };
    const revId = '01HABCDEFGHJKMNPQRSTVWXYZB';
    await store.createRevision({
      id: revId,
      boatId: wardrobe.boatId,
      sailConfigId: 'unused-in-v3',
      mode: wardrobe.activeMode,
      parentRevisionId: null,
      createdAt: Math.floor(Date.now() / 1000) + 10,
      lineage: { kind: 'manual_edit' },
      table: twoX,
    });

    // Re-publish a sample so the pipeline recomputes against the swapped polar.
    const t1 = BigInt(Date.now()) * 1_000_000n;
    bus.publish({
      channel: 'boat.speed.water',
      t_ns: t1,
      value: { kind: 'scalar', value: 3, unit: 'm/s' },
      source: 'test',
    });
    await new Promise((r) => setImmediate(r));

    const swappedTarget = targets[targets.length - 1];
    expect(swappedTarget).toBeDefined();
    // Target should have ~doubled after the 2× polar swap.
    expect(swappedTarget!).toBeCloseTo(baselineTarget! * 2, 5);

    unsub();
    await stop();
    await store.close();
  });
});
