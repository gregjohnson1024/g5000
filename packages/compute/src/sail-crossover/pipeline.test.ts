import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { _resetSharedBusForTests, getSharedBus, type Sample } from '@g5000/core';
import {
  DEFAULT_WARDROBE_SETTINGS,
  type PolarTable,
  type SailWardrobe,
  type WardrobeSettings,
} from '@g5000/db';
import { startSailRecommendationPipeline, type SailRecommendation } from './pipeline.js';

const KN_TO_MS = 0.514444;
const DEG_TO_RAD = Math.PI / 180;

function flatPolar(speedKn: number): PolarTable {
  const speedMs = speedKn * KN_TO_MS;
  return {
    twsBins: [0, 5, 10, 15, 20, 25, 30].map((k) => k * KN_TO_MS),
    twaBins: [30, 60, 90, 120, 150, 180].map((d) => d * DEG_TO_RAD),
    boatSpeed: [0, 5, 10, 15, 20, 25, 30].map(() => [
      speedMs,
      speedMs,
      speedMs,
      speedMs,
      speedMs,
      speedMs,
    ]),
  };
}

// Minimal stub matching the surface our pipeline needs from ConfigStore.
function makeStubStore(wardrobe: SailWardrobe, settings: WardrobeSettings) {
  return {
    sails$: new BehaviorSubject<SailWardrobe>(wardrobe),
    wardrobeSettings$: new BehaviorSubject<WardrobeSettings>(settings),
  };
}

describe('startSailRecommendationPipeline', () => {
  beforeEach(() => {
    _resetSharedBusForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function pubWind(twsKn: number, twaDeg: number): void {
    const bus = getSharedBus();
    const now_ns = BigInt(Date.now()) * 1_000_000n;
    const speedSample: Sample = {
      channel: 'wind.true.speed',
      value: { kind: 'scalar', value: twsKn * KN_TO_MS, unit: 'm/s' },
      source: 'test',
      t_ns: now_ns,
    };
    const angleSample: Sample = {
      channel: 'wind.true.angle',
      value: { kind: 'scalar', value: twaDeg * DEG_TO_RAD, unit: 'rad' },
      source: 'test',
      t_ns: now_ns,
    };
    bus.publish(speedSample);
    bus.publish(angleSample);
  }

  it('publishes the faster config as the winner', async () => {
    const w: SailWardrobe = {
      configs: [
        { id: 'slow', name: 'Slow', polar: flatPolar(3) },
        { id: 'fast', name: 'Fast', polar: flatPolar(7) },
      ],
      activeConfigId: 'slow',
    };
    const store = makeStubStore(w, DEFAULT_WARDROBE_SETTINGS);
    const bus = getSharedBus();
    const seen: SailRecommendation[] = [];
    const unsub = bus.subscribe('wardrobe.recommendation', (s) => {
      seen.push(s.value as unknown as SailRecommendation);
    });
    const stop = await startSailRecommendationPipeline({
      bus,
      configStore: store as never,
    });
    pubWind(12, 90);
    vi.advanceTimersByTime(600); // past auditTime(500)
    expect(seen.length).toBeGreaterThan(0);
    const r = seen[seen.length - 1]!;
    expect(r.recommendedConfigId).toBe('fast');
    expect(r.activeConfigId).toBe('slow');
    expect(r.shouldChange).toBe(true);
    unsub();
    await stop();
  });

  it('does not flag shouldChange below hysteresis threshold', async () => {
    const w: SailWardrobe = {
      configs: [
        { id: 'a', name: 'A', polar: flatPolar(6.0) },
        { id: 'b', name: 'B', polar: flatPolar(6.1) }, // 1.7% gap, under default 3%
      ],
      activeConfigId: 'a',
    };
    const store = makeStubStore(w, DEFAULT_WARDROBE_SETTINGS);
    const bus = getSharedBus();
    const seen: SailRecommendation[] = [];
    const unsub = bus.subscribe('wardrobe.recommendation', (s) => {
      seen.push(s.value as unknown as SailRecommendation);
    });
    const stop = await startSailRecommendationPipeline({
      bus,
      configStore: store as never,
    });
    pubWind(12, 90);
    vi.advanceTimersByTime(600);
    const r = seen[seen.length - 1]!;
    expect(r.recommendedConfigId).toBe('b');
    expect(r.shouldChange).toBe(false);
    unsub();
    await stop();
  });

  it('marks stale after 30 s of no wind', async () => {
    const w: SailWardrobe = {
      configs: [{ id: 'only', name: 'Only', polar: flatPolar(5) }],
      activeConfigId: 'only',
    };
    const store = makeStubStore(w, DEFAULT_WARDROBE_SETTINGS);
    const bus = getSharedBus();
    const seen: SailRecommendation[] = [];
    const unsub = bus.subscribe('wardrobe.recommendation', (s) => {
      seen.push(s.value as unknown as SailRecommendation);
    });
    const stop = await startSailRecommendationPipeline({
      bus,
      configStore: store as never,
    });
    pubWind(10, 90);
    vi.advanceTimersByTime(600);
    expect(seen.at(-1)?.stale).toBe(false);
    vi.advanceTimersByTime(31_000); // past 30 s stale window
    expect(seen.at(-1)?.stale).toBe(true);
    unsub();
    await stop();
  });

  it('returns a clean teardown', async () => {
    const w: SailWardrobe = {
      configs: [{ id: 'only', name: 'Only', polar: flatPolar(5) }],
      activeConfigId: 'only',
    };
    const store = makeStubStore(w, DEFAULT_WARDROBE_SETTINGS);
    const bus = getSharedBus();
    const stop = await startSailRecommendationPipeline({
      bus,
      configStore: store as never,
    });
    await expect(stop()).resolves.toBeUndefined();
  });
});
