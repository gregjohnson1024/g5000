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
    bus.publish(scalarSample('nav.gps.sog', 4)); // ~7.8 kn
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
