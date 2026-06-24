import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Bus } from '@g5000/core';
import { createAlarmsRegistry, type AlarmsRegistry } from '@g5000/core';
import { setSharedSourcePriority, _resetSharedSourcePriorityForTests } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';
import { DEFAULT_ALARMS_CONFIG } from '@g5000/db';
import { startAnchorWatchPredicate } from './anchor-watch.js';

function geoSample(lat: number, lon: number, source = 'test') {
  return {
    channel: 'nav.gps.position',
    t_ns: BigInt(Date.now()) * 1_000_000n,
    value: { kind: 'geo' as const, value: { lat, lon } },
    source,
  };
}

describe('anchor-watch predicate', () => {
  let bus: Bus;
  let registry: AlarmsRegistry;
  let configRef: { current: AlarmsConfig };
  let dispose: () => void;

  beforeEach(() => {
    bus = new Bus();
    registry = createAlarmsRegistry();
    configRef = { current: structuredClone(DEFAULT_ALARMS_CONFIG) };
  });

  afterEach(() => {
    _resetSharedSourcePriorityForTests();
  });

  it('does not fire when not armed', () => {
    dispose = startAnchorWatchPredicate(bus, registry, configRef).dispose;
    bus.publish(geoSample(32.3, -64.8));
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('fires when boat drifts outside radius after arming', () => {
    configRef.current.thresholds.anchor = {
      armed: true,
      point: { lat: 32.3, lon: -64.8 },
      droppedAt: '2026-05-18T12:00:00Z',
      radiusM: 50,
    };
    dispose = startAnchorWatchPredicate(bus, registry, configRef).dispose;
    // 0.005 deg lat ≈ 555 m — well outside 50 m
    bus.publish(geoSample(32.305, -64.8));
    const active = registry.active();
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe('anchor-watch');
    expect(active[0]?.sticky).toBe(true);
    dispose();
  });

  it('does not fire when inside radius', () => {
    configRef.current.thresholds.anchor = {
      armed: true,
      point: { lat: 32.3, lon: -64.8 },
      droppedAt: '2026-05-18T12:00:00Z',
      radiusM: 50,
    };
    dispose = startAnchorWatchPredicate(bus, registry, configRef).dispose;
    // 0.0001 deg lat ≈ 11 m — inside 50 m
    bus.publish(geoSample(32.3001, -64.8));
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('does nothing when disabled in config', () => {
    configRef.current.enabled['anchor-watch'] = false;
    configRef.current.thresholds.anchor = {
      armed: true,
      point: { lat: 32.3, lon: -64.8 },
      droppedAt: '2026-05-18T12:00:00Z',
      radiusM: 50,
    };
    dispose = startAnchorWatchPredicate(bus, registry, configRef).dispose;
    bus.publish(geoSample(32.305, -64.8));
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('honours source priority — only the pinned source drives the alarm', () => {
    setSharedSourcePriority([
      { channelPattern: 'nav.gps.position', sources: ['gpsA'], freshnessSeconds: 60 },
    ]);
    configRef.current.thresholds.anchor = {
      armed: true,
      point: { lat: 32.3, lon: -64.8 },
      droppedAt: '2026-05-18T12:00:00Z',
      radiusM: 50,
    };
    dispose = startAnchorWatchPredicate(bus, registry, configRef).dispose;

    // A non-priority source reporting a drift must be ignored.
    bus.publish(geoSample(32.305, -64.8, 'gpsB')); // ~555 m out, but not the winner
    expect(registry.active()).toHaveLength(0);

    // The pinned source inside the radius keeps it clear.
    bus.publish(geoSample(32.3001, -64.8, 'gpsA')); // ~11 m in
    expect(registry.active()).toHaveLength(0);

    // The pinned source drifting outside the radius fires.
    bus.publish(geoSample(32.305, -64.8, 'gpsA'));
    expect(registry.active()).toHaveLength(1);
    expect(registry.active()[0]?.id).toBe('anchor-watch');
    dispose();
  });
});
