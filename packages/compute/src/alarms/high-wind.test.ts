import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Bus, createAlarmsRegistry, type AlarmsRegistry } from '@g5000/core';
import { DEFAULT_ALARMS_CONFIG, type AlarmsConfig } from '@g5000/db';
import { startHighWindPredicate } from './high-wind.js';

const KN_TO_MS = 0.514444;

function twsSample(kn: number) {
  return {
    channel: 'wind.true.speed',
    t_ns: BigInt(Date.now()) * 1_000_000n,
    value: { kind: 'scalar' as const, value: kn * KN_TO_MS },
    source: 'test',
  };
}

describe('high-wind predicate', () => {
  let bus: Bus;
  let registry: AlarmsRegistry;
  let configRef: { current: AlarmsConfig };

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new Bus();
    registry = createAlarmsRegistry();
    configRef = { current: structuredClone(DEFAULT_ALARMS_CONFIG) };
    configRef.current.enabled['high-wind'] = true;
    configRef.current.thresholds.highWind = { thresholdKn: 30, holdMs: 60000 };
  });

  it('fires WARN with observed TWS after holdMs above threshold', () => {
    const { dispose } = startHighWindPredicate(bus, registry, configRef);
    bus.publish(twsSample(34.2));
    expect(registry.active()).toHaveLength(0); // hold not elapsed
    vi.advanceTimersByTime(61_000);
    const active = registry.active();
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe('high-wind');
    expect(active[0]?.severity).toBe('WARN');
    expect(active[0]?.label).toBe('High wind 34.2 kn');
    expect(active[0]?.context).toMatchObject({ thresholdKn: 30 });
    expect(active[0]?.context?.twsKn).toBeCloseTo(34.2, 1);
    dispose();
  });

  it('does not fire below threshold', () => {
    const { dispose } = startHighWindPredicate(bus, registry, configRef);
    bus.publish(twsSample(28));
    vi.advanceTimersByTime(120_000);
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('cancels the pending fire when TWS dips below threshold before holdMs', () => {
    const { dispose } = startHighWindPredicate(bus, registry, configRef);
    bus.publish(twsSample(35));
    vi.advanceTimersByTime(30_000);
    bus.publish(twsSample(29)); // sustain broken (in the hysteresis band)
    vi.advanceTimersByTime(120_000);
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('clears with hysteresis: stays active in the 90%..100% band, clears below 90%', () => {
    const { dispose } = startHighWindPredicate(bus, registry, configRef);
    bus.publish(twsSample(35));
    vi.advanceTimersByTime(61_000);
    expect(registry.active()).toHaveLength(1);

    bus.publish(twsSample(28)); // 93% of threshold — inside the band
    expect(registry.active()).toHaveLength(1);

    bus.publish(twsSample(26)); // 87% — below 0.9 * 30 = 27
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('does nothing when disabled (the default)', () => {
    configRef.current.enabled['high-wind'] = false;
    const { dispose } = startHighWindPredicate(bus, registry, configRef);
    bus.publish(twsSample(50));
    vi.advanceTimersByTime(120_000);
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('is disabled by default in DEFAULT_ALARMS_CONFIG', () => {
    expect(DEFAULT_ALARMS_CONFIG.enabled['high-wind']).toBe(false);
  });
});
