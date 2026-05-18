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
