import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  it('fires a non-sticky WARN when boat drifts outside radius after arming', () => {
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
    expect(active[0]?.severity).toBe('WARN');
    expect(active[0]?.sticky).toBe(false);
    expect(active[0]?.label).toMatch(/^Anchor drag \d+ m$/);
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

  it('uses anchorPoint (resolved anchor position) over point when present', () => {
    configRef.current.thresholds.anchor = {
      armed: true,
      point: { lat: 32.3, lon: -64.8 },
      anchorPoint: { lat: 32.305, lon: -64.8 }, // actual anchor ~555 m north of drop
      droppedAt: '2026-05-18T12:00:00Z',
      radiusM: 50,
    };
    dispose = startAnchorWatchPredicate(bus, registry, configRef).dispose;
    // Boat right next to the resolved anchor — inside 50 m of anchorPoint,
    // even though it is ~555 m from the drop position.
    bus.publish(geoSample(32.3051, -64.8));
    expect(registry.active()).toHaveLength(0);
    dispose();
  });

  it('breaches on sector exit even inside the radius', () => {
    configRef.current.thresholds.anchor = {
      armed: true,
      point: { lat: 32.3, lon: -64.8 },
      droppedAt: '2026-05-18T12:00:00Z',
      radiusM: 200,
      coneDeg: 90,
      coneCenterDeg: 180, // boat expected south of the anchor
    };
    dispose = startAnchorWatchPredicate(bus, registry, configRef).dispose;
    // ~111 m NORTH of the anchor: inside 200 m but outside the south sector.
    bus.publish(geoSample(32.301, -64.8));
    const active = registry.active();
    expect(active).toHaveLength(1);
    expect(active[0]?.severity).toBe('WARN');
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

describe('anchor-watch two-stage escalation', () => {
  let bus: Bus;
  let registry: AlarmsRegistry;
  let configRef: { current: AlarmsConfig };
  let dispose: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-26T12:00:00Z'));
    bus = new Bus();
    registry = createAlarmsRegistry();
    configRef = { current: structuredClone(DEFAULT_ALARMS_CONFIG) };
    configRef.current.thresholds.anchor = {
      armed: true,
      point: { lat: 32.3, lon: -64.8 },
      droppedAt: '2026-06-26T11:00:00Z',
      radiusM: 50,
      escalateAfterS: 30,
    };
    dispose = startAnchorWatchPredicate(bus, registry, configRef).dispose;
  });

  afterEach(() => {
    dispose();
    vi.useRealTimers();
    _resetSharedSourcePriorityForTests();
  });

  const breachSample = () => geoSample(32.305, -64.8); // ~555 m out
  const insideSample = () => geoSample(32.3001, -64.8); // ~11 m in

  it('escalates a persistent unacked WARN to sticky CRITICAL after escalateAfterS', () => {
    bus.publish(breachSample());
    expect(registry.active()[0]?.severity).toBe('WARN');
    expect(registry.active()[0]?.sticky).toBe(false);

    // Still breached but before the escalation deadline: stays WARN.
    vi.advanceTimersByTime(15_000);
    bus.publish(breachSample());
    expect(registry.active()[0]?.severity).toBe('WARN');

    // Past the deadline: cleared and re-fired as sticky CRITICAL.
    vi.advanceTimersByTime(16_000);
    bus.publish(breachSample());
    const active = registry.active();
    expect(active).toHaveLength(1);
    expect(active[0]?.severity).toBe('CRITICAL');
    expect(active[0]?.sticky).toBe(true);
    expect(active[0]?.context?.escalated).toBe(true);
    expect(active[0]?.ackedAt).toBeNull(); // a fresh fire, not a refresh of the WARN
  });

  it('ack during the WARN stage prevents escalation', () => {
    bus.publish(breachSample());
    expect(registry.active()[0]?.severity).toBe('WARN');
    registry.ack('anchor-watch');
    expect(registry.active()).toHaveLength(0);

    vi.advanceTimersByTime(60_000);
    bus.publish(breachSample());
    expect(registry.active()).toHaveLength(0);
    expect(registry.get('anchor-watch')?.severity).toBe('WARN'); // never escalated
  });

  it('re-entering the zone resets the cycle: a later breach starts at WARN again', () => {
    bus.publish(breachSample());
    vi.advanceTimersByTime(31_000);
    bus.publish(breachSample());
    expect(registry.active()[0]?.severity).toBe('CRITICAL');
    registry.ack('anchor-watch');

    bus.publish(insideSample()); // condition clears, stage resets
    vi.advanceTimersByTime(5_000);
    bus.publish(breachSample());
    const active = registry.active();
    expect(active).toHaveLength(1);
    expect(active[0]?.severity).toBe('WARN');
    expect(active[0]?.sticky).toBe(false);
  });

  it('sticky CRITICAL survives re-entering the zone until acked', () => {
    bus.publish(breachSample());
    vi.advanceTimersByTime(31_000);
    bus.publish(breachSample());
    expect(registry.active()[0]?.severity).toBe('CRITICAL');

    bus.publish(insideSample()); // cleared, but sticky keeps it active
    expect(registry.active()).toHaveLength(1);
    registry.ack('anchor-watch');
    expect(registry.active()).toHaveLength(0);
  });
});
