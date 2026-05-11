import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { firstValueFrom } from 'rxjs';
import { Bus, Channels, type Sample } from '@g5000/core';
import { ConfigStore } from '@g5000/db';
import { startTrueWindPipeline } from './pipeline.js';

const sample = (channel: string, value: number, t_ns = 1n): Sample => ({
  channel,
  t_ns,
  value: { kind: 'scalar', value },
  source: 'test',
});

describe('startTrueWindPipeline', () => {
  let dir: string;
  let store: ConfigStore;
  let bus: Bus;
  let stop: () => Promise<void>;
  let received: Sample[];

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'g5000-pipeline-'));
    store = await ConfigStore.open(path.join(dir, 'config.db'));
    bus = new Bus();
    received = [];
    bus.subscribe('wind.true.calibrated.**', (s) => received.push(s));
    stop = await startTrueWindPipeline({
      bus,
      configStore: store,
      // Use a generous staleness window so test timestamps don't fail.
      staleAfterMs: 60_000,
    });
  });

  afterEach(async () => {
    await stop();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('publishes wind.true.calibrated.{angle,speed,direction} when all inputs are present', async () => {
    const now_ns = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample(Channels.Wind.ApparentSpeed, 5, now_ns));
    bus.publish(sample(Channels.Wind.ApparentAngle, 0, now_ns));
    bus.publish(sample(Channels.Boat.SpeedWater, 3, now_ns));
    bus.publish(sample(Channels.Boat.HeadingMagnetic, 0, now_ns));

    await new Promise((r) => setTimeout(r, 30));

    const channels = new Set(received.map((s) => s.channel));
    expect(channels.has('wind.true.calibrated.speed')).toBe(true);
    expect(channels.has('wind.true.calibrated.angle')).toBe(true);
    expect(channels.has('wind.true.calibrated.direction')).toBe(true);
  });

  it('does not emit when only one input is present', async () => {
    const now_ns = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample(Channels.Wind.ApparentSpeed, 5, now_ns));
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(0);
  });

  it('recomputes when the cal table changes', async () => {
    const now_ns = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample(Channels.Wind.ApparentSpeed, 5, now_ns));
    bus.publish(sample(Channels.Wind.ApparentAngle, 0, now_ns));
    bus.publish(sample(Channels.Boat.SpeedWater, 3, now_ns));
    bus.publish(sample(Channels.Boat.HeadingMagnetic, 0, now_ns));
    await new Promise((r) => setTimeout(r, 30));
    const initialCount = received.length;
    expect(initialCount).toBeGreaterThan(0);

    // Change the cal table and re-publish one input to trigger a tick.
    const cal = await firstValueFrom(store.awsAwaCal$);
    const cal2 = {
      ...cal,
      angleCorrection: cal.angleCorrection.map((row) => row.map(() => 0.1)),
    };
    await store.setAwsAwaCal(cal2);
    const now2_ns = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample(Channels.Wind.ApparentSpeed, 5.01, now2_ns));
    await new Promise((r) => setTimeout(r, 30));
    expect(received.length).toBeGreaterThan(initialCount);
  });

  it('drops a tick when an input is older than the staleness threshold', async () => {
    // Stop the pipeline started in beforeEach and start a new one with a
    // tight 100ms staleness window.
    await stop();
    received.length = 0;
    stop = await startTrueWindPipeline({
      bus,
      configStore: store,
      staleAfterMs: 100,
    });

    // Old timestamps (1 second ago).
    const old_ns = (BigInt(Date.now()) - 1000n) * 1_000_000n;
    bus.publish(sample(Channels.Wind.ApparentSpeed, 5, old_ns));
    bus.publish(sample(Channels.Wind.ApparentAngle, 0, old_ns));
    bus.publish(sample(Channels.Boat.SpeedWater, 3, old_ns));
    bus.publish(sample(Channels.Boat.HeadingMagnetic, 0, old_ns));
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(0);
  });
});
