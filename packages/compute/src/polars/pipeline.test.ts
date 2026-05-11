import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Bus, type Sample } from '@g5000/core';
import { ConfigStore } from '@g5000/db';
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
    bus.publish(sample('wind.true.calibrated.speed', 8, now)); // 8 m/s TWS
    bus.publish(sample('wind.true.calibrated.angle', Math.PI / 4, now)); // 45° TWA
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
    bus.publish(sample('wind.true.calibrated.speed', 8, now));
    bus.publish(sample('wind.true.calibrated.angle', Math.PI / 2, now)); // 90° TWA
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
    bus.publish(sample('wind.true.calibrated.speed', 8, now));
    // No TWA, no BSP.
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(0);
  });

  it('recomputes when the polar table changes', async () => {
    const now = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample('wind.true.calibrated.speed', 8, now));
    bus.publish(sample('wind.true.calibrated.angle', Math.PI / 4, now));
    bus.publish(sample('boat.speed.water', 5, now));
    await new Promise((r) => setTimeout(r, 30));
    const initial = received.length;
    expect(initial).toBeGreaterThan(0);

    // Zero out the polar — target should drop to 0, percentPolar should
    // become a finite degenerate value (we expect 0 or undefined). We just
    // assert the pipeline RE-fires.
    const polar = await firstValueFromBehavior(store.polars$);
    await store.setPolars({
      ...polar,
      boatSpeed: polar.boatSpeed.map((row) => row.map(() => 0)),
    });
    const now2 = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample('boat.speed.water', 5.01, now2));
    await new Promise((r) => setTimeout(r, 30));
    expect(received.length).toBeGreaterThan(initial);
  });
});

import { firstValueFrom } from 'rxjs';
const firstValueFromBehavior = firstValueFrom;
