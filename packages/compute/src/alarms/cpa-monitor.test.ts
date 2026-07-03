import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Bus, createAlarmsRegistry, Channels } from '@g5000/core';
import type { AlarmsRegistry, AisTarget, AisTargetsRegistry } from '@g5000/core';
import { DEFAULT_ALARMS_CONFIG, DEFAULT_AIS_ALARM_CONFIG } from '@g5000/db';
import type { AlarmsConfig, AisAlarmConfig } from '@g5000/db';
import { startCpaMonitor } from './cpa-monitor.js';

function scalarSample(channel: string, value: number) {
  return {
    channel,
    t_ns: BigInt(Date.now()) * 1_000_000n,
    value: { kind: 'scalar' as const, value },
    source: 'test',
  };
}

function geoSample(channel: string, lat: number, lon: number) {
  return {
    channel,
    t_ns: BigInt(Date.now()) * 1_000_000n,
    value: { kind: 'geo' as const, value: { lat, lon } },
    source: 'test',
  };
}

/** Minimal fake registry — only `all()` matters to the monitor. */
function fakeTargets(targets: AisTarget[]): AisTargetsRegistry {
  return {
    all: () => targets,
    get: (mmsi) => targets.find((t) => t.mmsi === mmsi),
    upsert: () => {},
    evictStale: () => 0,
    clear: () => {},
  };
}

function target(overrides: Partial<AisTarget> & { mmsi: number }): AisTarget {
  return {
    vesselClass: 'A',
    lastSeenMs: Date.now(),
    ...overrides,
  };
}

describe('cpa monitor predicate', () => {
  let bus: Bus;
  let registry: AlarmsRegistry;
  let configRef: { current: AlarmsConfig };
  let aisConfig: AisAlarmConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00Z'));
    bus = new Bus();
    registry = createAlarmsRegistry();
    configRef = { current: structuredClone(DEFAULT_ALARMS_CONFIG) };
    aisConfig = { ...DEFAULT_AIS_ALARM_CONFIG }; // enabled, 1852 m, 600 s
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function start(targets: AisTarget[]) {
    return startCpaMonitor(bus, registry, configRef, {
      getAisAlarmConfig: () => aisConfig,
      getTargets: () => fakeTargets(targets),
    });
  }

  /** Own boat: stationary at the origin, pointing north. */
  function publishOwn() {
    bus.publish(geoSample(Channels.Nav.Position, 0, 0));
    bus.publish(scalarSample(Channels.Nav.Cog, 0));
    bus.publish(scalarSample(Channels.Nav.Sog, 0));
  }

  it('fires CRITICAL for a converging target with TCPA < 300 s', () => {
    // 1000 m due north, heading due south at 5 m/s → CPA 0 m, TCPA 200 s.
    const { dispose } = start([
      target({ mmsi: 111, name: 'Runner', lat: 1000 / 111_320, lon: 0, cog: Math.PI, sog: 5 }),
    ]);
    publishOwn();
    vi.advanceTimersByTime(2100);
    const active = registry.active();
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe('ais-cpa');
    expect(active[0]?.severity).toBe('CRITICAL');
    expect(active[0]?.label).toMatch(/^CPA 0\.0 nm in \d+ min$/);
    expect(active[0]?.context).toMatchObject({ mmsi: 111, name: 'Runner', threats: 1 });
    dispose();
  });

  it('fires WARN for a converging target with TCPA >= 300 s', () => {
    // 2000 m due north, heading due south at 5 m/s → CPA 0 m, TCPA 400 s.
    const { dispose } = start([
      target({ mmsi: 222, lat: 2000 / 111_320, lon: 0, cog: Math.PI, sog: 5 }),
    ]);
    publishOwn();
    vi.advanceTimersByTime(2100);
    expect(registry.active()).toHaveLength(1);
    expect(registry.active()[0]?.severity).toBe('WARN');
    dispose();
  });

  it('clears when the target diverges', () => {
    const tgt = target({ mmsi: 333, lat: 1000 / 111_320, lon: 0, cog: Math.PI, sog: 5 });
    const { dispose } = start([tgt]);
    publishOwn();
    vi.advanceTimersByTime(2100);
    expect(registry.active()).toHaveLength(1);
    // Same target turns around: heading due north, opening → TCPA negative.
    tgt.cog = 0;
    tgt.lastSeenMs = Date.now();
    publishOwn();
    vi.advanceTimersByTime(2100);
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('ignores targets with a stale fix', () => {
    const tgt = target({ mmsi: 444, lat: 1000 / 111_320, lon: 0, cog: Math.PI, sog: 5 });
    tgt.lastSeenMs = Date.now() - 120_000; // 2 min old
    const { dispose } = start([tgt]);
    publishOwn();
    vi.advanceTimersByTime(2100);
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('ignores targets missing SOG/COG', () => {
    const { dispose } = start([
      target({ mmsi: 555, lat: 1000 / 111_320, lon: 0, sog: 5 }), // no cog
      target({ mmsi: 556, lat: 1000 / 111_320, lon: 0, cog: Math.PI }), // no sog
    ]);
    publishOwn();
    vi.advanceTimersByTime(2100);
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('never fires when the alarms-config gate is off', () => {
    configRef.current.enabled['ais-cpa'] = false;
    const { dispose } = start([
      target({ mmsi: 666, lat: 1000 / 111_320, lon: 0, cog: Math.PI, sog: 5 }),
    ]);
    publishOwn();
    vi.advanceTimersByTime(10_000);
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('never fires when the AIS alarm config is disabled', () => {
    aisConfig = { ...aisConfig, enabled: false };
    const { dispose } = start([
      target({ mmsi: 777, lat: 1000 / 111_320, lon: 0, cog: Math.PI, sog: 5 }),
    ]);
    publishOwn();
    vi.advanceTimersByTime(10_000);
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('does not fire without a fresh own-boat vector', () => {
    const { dispose } = start([
      target({ mmsi: 888, lat: 1000 / 111_320, lon: 0, cog: Math.PI, sog: 5 }),
    ]);
    // No own position/cog/sog published at all.
    vi.advanceTimersByTime(10_000);
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('does not re-fire every tick after the user acks a persisting threat', () => {
    const { dispose } = start([
      target({ mmsi: 999, lat: 2000 / 111_320, lon: 0, cog: Math.PI, sog: 5 }),
    ]);
    publishOwn();
    vi.advanceTimersByTime(2100);
    expect(registry.active()).toHaveLength(1);
    registry.ack('ais-cpa');
    publishOwn();
    vi.advanceTimersByTime(4200);
    expect(registry.active()).toHaveLength(0);
    dispose();
  });
});
