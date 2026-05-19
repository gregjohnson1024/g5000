import { describe, it, expect, vi } from 'vitest';
import { Bus, createAlarmsRegistry } from '@g5000/core';
import { DEFAULT_ALARMS_CONFIG, type AlarmsConfig } from '@g5000/db';
import { startAlarmsPipeline } from './index.js';

function geoSample(lat: number, lon: number, t_ns: bigint) {
  return {
    channel: 'nav.gps.position',
    t_ns,
    value: { kind: 'geo' as const, value: { lat, lon } },
    source: 'test',
  };
}

function scalarSample(channel: string, value: number) {
  return {
    channel,
    t_ns: BigInt(Date.now()) * 1_000_000n,
    value: { kind: 'scalar' as const, value },
    source: 'test',
  };
}

describe('alarms pipeline (synthetic session integration)', () => {
  it('fires anchor-watch when synthetic position track drifts outside radius', () => {
    vi.useFakeTimers();
    const bus = new Bus();
    const registry = createAlarmsRegistry();
    const configRef: { current: AlarmsConfig } = {
      current: structuredClone(DEFAULT_ALARMS_CONFIG),
    };
    configRef.current.thresholds.anchor = {
      armed: true,
      point: { lat: 32.3, lon: -64.8 },
      droppedAt: '2026-05-18T12:00:00Z',
      radiusM: 50,
    };
    configRef.current.thresholds.shallowWater.holdMs = 100;

    const handle = startAlarmsPipeline(bus, registry, configRef);

    // Synthetic positions: 10 inside the anchor radius
    for (let i = 0; i < 10; i++) {
      bus.publish(geoSample(32.3001, -64.8, BigInt(1_700_000_000_000 + i * 1000) * 1_000_000n));
    }
    expect(registry.active().find((a) => a.id === 'anchor-watch')).toBeUndefined();

    // Now drift outside
    bus.publish(geoSample(32.305, -64.8, BigInt(1_700_000_020_000) * 1_000_000n));
    const active = registry.active();
    expect(active.find((a) => a.id === 'anchor-watch')).toBeDefined();

    handle.dispose();
    vi.useRealTimers();
  });

  it('shallow-water fires and clears as depth crosses threshold', () => {
    vi.useFakeTimers();
    const bus = new Bus();
    const registry = createAlarmsRegistry();
    const configRef: { current: AlarmsConfig } = {
      current: structuredClone(DEFAULT_ALARMS_CONFIG),
    };
    configRef.current.thresholds.shallowWater = { thresholdM: 3, holdMs: 500 };

    const handle = startAlarmsPipeline(bus, registry, configRef);

    bus.publish(scalarSample('nav.depth', 2.5));
    vi.advanceTimersByTime(600);
    expect(registry.active().find((a) => a.id === 'shallow-water')).toBeDefined();

    bus.publish(scalarSample('nav.depth', 5.0));
    expect(registry.active().find((a) => a.id === 'shallow-water')).toBeUndefined();

    handle.dispose();
    vi.useRealTimers();
  });
});
