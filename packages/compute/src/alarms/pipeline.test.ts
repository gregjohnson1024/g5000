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
