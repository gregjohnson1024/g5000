import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import type { CrossoverMap, CrossoverSettings, PolarTable, SailWardrobe } from '@g5000/db';
import type { Sample } from '@g5000/core';
import { Bus, Channels } from '@g5000/core';
import { DEFAULT_CROSSOVER_MAP, DEFAULT_CROSSOVER_SETTINGS, DEFAULT_POLARS } from '@g5000/db';
import { startSailCrossoverPipeline, type SailRecommendation } from './pipeline.js';

interface FakeStore {
  activePolar$: BehaviorSubject<PolarTable>;
  sails$: BehaviorSubject<SailWardrobe>;
  crossoverMap$: BehaviorSubject<CrossoverMap>;
  crossoverSettings$: BehaviorSubject<CrossoverSettings>;
}

function wardrobe(activeConfigId: string, configs: string[] = ['a', 'b', 'c']): SailWardrobe {
  return {
    boatId: 'sula',
    activeConfigId,
    activeMode: 'default',
    configs: configs.map((id) => ({ id, name: id, modes: {} })),
  };
}

function fakeStore(overrides: Partial<FakeStore> = {}): FakeStore {
  return {
    activePolar$: new BehaviorSubject(DEFAULT_POLARS),
    sails$: new BehaviorSubject(wardrobe('a')),
    crossoverMap$: new BehaviorSubject(DEFAULT_CROSSOVER_MAP),
    crossoverSettings$: new BehaviorSubject(DEFAULT_CROSSOVER_SETTINGS),
    ...overrides,
  };
}

function makeSample(channel: string, value: number, tMs: number): Sample {
  return {
    channel,
    source: 'test',
    t_ns: BigInt(tMs) * 1_000_000n,
    value: { kind: 'scalar', value },
  };
}

describe('startSailCrossoverPipeline', () => {
  it('does not publish when there is no wind sample', () => {
    const bus = new Bus();
    const store = fakeStore();
    const stop = startSailCrossoverPipeline({ bus, store } as never);
    const received: Sample[] = [];
    const unsub = bus.subscribe(Channels.SAIL_RECOMMENDATION, (s) => received.push(s));
    expect(received).toHaveLength(0);
    stop();
    unsub();
  });

  it('publishes recommendation at the current (TWS, TWA) cell when the map is filled', () => {
    const bus = new Bus();
    const store = fakeStore({
      crossoverMap$: new BehaviorSubject<CrossoverMap>({
        boatId: 'sula',
        mode: 'default',
        cells: { '4,4': 'b' }, // TWS bin 4 ≈ 14 kn, TWA bin 4 = 90°
        updatedAt: 0,
      }),
    });
    const stop = startSailCrossoverPipeline({ bus, store } as never);
    const received: SailRecommendation[] = [];
    const unsub = bus.subscribe(Channels.SAIL_RECOMMENDATION, (s) =>
      received.push(s.value as SailRecommendation),
    );

    const tws = DEFAULT_POLARS.twsBins[4]!;
    const twa = DEFAULT_POLARS.twaBins[4]!;
    bus.publish(makeSample('wind.true.speed', tws, 1_000_000));
    bus.publish(makeSample('wind.true.angle', twa, 1_000_000));

    expect(received.length).toBeGreaterThan(0);
    const last = received[received.length - 1]!;
    expect(last.recommendedConfigId).toBe('b');
    expect(last.activeConfigId).toBe('a');
    expect(last.cellTwsIdx).toBe(4);
    expect(last.cellTwaIdx).toBe(4);
    expect(last.stableSeconds).toBe(DEFAULT_CROSSOVER_SETTINGS.recommendationStableSeconds);
    expect(last.enteredAt).toBeGreaterThan(0);

    stop();
    unsub();
  });

  it('keeps enteredAt stable while the recommendation stays the same', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const bus = new Bus();
    const store = fakeStore({
      crossoverMap$: new BehaviorSubject<CrossoverMap>({
        boatId: 'sula',
        mode: 'default',
        cells: { '4,4': 'b', '5,4': 'b' }, // both nearby cells recommend 'b'
        updatedAt: 0,
      }),
    });
    const stop = startSailCrossoverPipeline({ bus, store } as never);
    const received: SailRecommendation[] = [];
    const unsub = bus.subscribe(Channels.SAIL_RECOMMENDATION, (s) =>
      received.push(s.value as SailRecommendation),
    );

    bus.publish(makeSample('wind.true.speed', DEFAULT_POLARS.twsBins[4]!, 1_700_000_000_000));
    bus.publish(makeSample('wind.true.angle', DEFAULT_POLARS.twaBins[4]!, 1_700_000_000_000));
    const firstEntered = received[received.length - 1]!.enteredAt;

    vi.setSystemTime(1_700_000_000_000 + 60_000);
    // Bump wind so the pipeline re-emits, but still maps to a cell where 'b' wins.
    bus.publish(
      makeSample('wind.true.speed', DEFAULT_POLARS.twsBins[5]!, 1_700_000_000_000 + 60_000),
    );
    const lastEntered = received[received.length - 1]!.enteredAt;
    expect(lastEntered).toBe(firstEntered);

    stop();
    unsub();
    vi.useRealTimers();
  });

  it('resets enteredAt when the recommended config changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const bus = new Bus();
    const store = fakeStore({
      crossoverMap$: new BehaviorSubject<CrossoverMap>({
        boatId: 'sula',
        mode: 'default',
        cells: { '4,4': 'b', '6,4': 'c' },
        updatedAt: 0,
      }),
    });
    const stop = startSailCrossoverPipeline({ bus, store } as never);
    const received: SailRecommendation[] = [];
    const unsub = bus.subscribe(Channels.SAIL_RECOMMENDATION, (s) =>
      received.push(s.value as SailRecommendation),
    );

    bus.publish(makeSample('wind.true.speed', DEFAULT_POLARS.twsBins[4]!, 1_700_000_000_000));
    bus.publish(makeSample('wind.true.angle', DEFAULT_POLARS.twaBins[4]!, 1_700_000_000_000));
    const firstEntered = received[received.length - 1]!.enteredAt;
    expect(received[received.length - 1]!.recommendedConfigId).toBe('b');

    vi.setSystemTime(1_700_000_000_000 + 60_000);
    bus.publish(
      makeSample('wind.true.speed', DEFAULT_POLARS.twsBins[6]!, 1_700_000_000_000 + 60_000),
    );
    expect(received[received.length - 1]!.recommendedConfigId).toBe('c');
    expect(received[received.length - 1]!.enteredAt).toBeGreaterThan(firstEntered);

    stop();
    unsub();
    vi.useRealTimers();
  });
});
