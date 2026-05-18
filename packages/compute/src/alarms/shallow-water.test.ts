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
