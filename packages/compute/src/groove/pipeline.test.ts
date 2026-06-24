import { describe, it, expect, afterEach } from 'vitest';
import {
  Bus,
  Channels,
  setSharedSourcePriority,
  _resetSharedSourcePriorityForTests,
} from '@g5000/core';
import type { Sample } from '@g5000/core';
import { DEFAULT_GROOVE_SETTINGS } from '@g5000/db';
import { startGrooveComputePipeline } from './pipeline.js';

const DEG = Math.PI / 180;
const KN = 0.514444;

function scalar(channel: string, value: number, t: number, source = 'test'): Sample {
  return { channel, t_ns: BigInt(Math.round(t * 1e9)), value: { kind: 'scalar', value }, source };
}
function enumSample(channel: string, value: string, t: number): Sample {
  return {
    channel,
    t_ns: BigInt(Math.round(t * 1e9)),
    value: { kind: 'enum', value },
    source: 'test',
  };
}

afterEach(() => {
  _resetSharedSourcePriorityForTests();
});

describe('groove pipeline', () => {
  it('publishes point-of-sail and groove metrics on a steady beat', () => {
    const bus = new Bus();
    const settingsRef = { current: { ...DEFAULT_GROOVE_SETTINGS } };
    const handle = startGrooveComputePipeline(bus, settingsRef);

    const seen = new Map<string, Sample>();
    bus.subscribe('groove.**', (s) => seen.set(s.channel, s));
    bus.subscribe('boat.**', (s) => seen.set(s.channel, s));

    for (let i = 0; i < 20; i++) {
      const t = i * 0.5;
      bus.publish(scalar(Channels.Race.TargetTwa, 42 * DEG, t));
      bus.publish(scalar(Channels.Race.TargetSpeed, 6, t));
      bus.publish(scalar(Channels.Wind.TrueSpeed, 10 * KN, t));
      bus.publish(scalar(Channels.Boat.SpeedWater, 6, t));
      bus.publish(scalar(Channels.Motion.Heel, 0.1, t));
      bus.publish(scalar(Channels.Wind.TrueAngle, 44 * DEG, t));
    }

    expect(seen.get(Channels.Groove.PointOfSail)?.value).toEqual({ kind: 'enum', value: 'upwind' });
    expect(seen.get(Channels.Groove.InGroove)?.value).toEqual({ kind: 'enum', value: 'in' });
    const tig = seen.get(Channels.Groove.TimeInGroove)?.value;
    expect(tig?.kind).toBe('scalar');
    if (tig?.kind === 'scalar') expect(tig.value).toBeGreaterThan(90);
    const eff = seen.get(Channels.Groove.VmgEfficiency)?.value;
    if (eff?.kind === 'scalar') expect(eff.value).toBeGreaterThan(95);
    expect(seen.has(Channels.Boat.Leeway)).toBe(true);

    handle.dispose();
  });

  it('suppresses sailing metrics and reports not-sailing under engine', () => {
    const bus = new Bus();
    const settingsRef = { current: { ...DEFAULT_GROOVE_SETTINGS } };
    const handle = startGrooveComputePipeline(bus, settingsRef);
    const seen = new Map<string, Sample>();
    bus.subscribe('groove.**', (s) => seen.set(s.channel, s));

    for (let i = 0; i < 5; i++) {
      const t = i;
      bus.publish(scalar(Channels.Race.TargetTwa, 42 * DEG, t));
      bus.publish(scalar(Channels.Race.TargetSpeed, 6, t));
      bus.publish(scalar(Channels.Wind.TrueSpeed, 1 * KN, t));
      bus.publish(scalar(Channels.Boat.SpeedWater, 6, t));
      bus.publish(scalar(Channels.Wind.TrueAngle, 44 * DEG, t));
    }
    expect(seen.get(Channels.Groove.PointOfSail)?.value).toEqual({
      kind: 'enum',
      value: 'not-sailing',
    });
    expect(seen.has(Channels.Groove.TimeInGroove)).toBe(false);
    expect(seen.has(Channels.Groove.VmgEfficiency)).toBe(false);
    handle.dispose();
  });

  it('flags helmSource autopilot when an active mode is present', () => {
    const bus = new Bus();
    const settingsRef = { current: { ...DEFAULT_GROOVE_SETTINGS } };
    const handle = startGrooveComputePipeline(bus, settingsRef);
    const seen = new Map<string, Sample>();
    bus.subscribe('groove.**', (s) => seen.set(s.channel, s));

    bus.publish(enumSample(Channels.Autopilot.Mode, 'Heading Control', 0));
    bus.publish(scalar(Channels.Race.TargetTwa, 42 * DEG, 0.1));
    bus.publish(scalar(Channels.Race.TargetSpeed, 6, 0.1));
    bus.publish(scalar(Channels.Wind.TrueSpeed, 10 * KN, 0.1));
    bus.publish(scalar(Channels.Boat.SpeedWater, 6, 0.1));
    bus.publish(scalar(Channels.Wind.TrueAngle, 44 * DEG, 0.1));

    expect(seen.get(Channels.Groove.HelmSource)?.value).toEqual({
      kind: 'enum',
      value: 'autopilot',
    });
    handle.dispose();
  });

  it('honours source priority on boat.speed.water (ignores a lower-priority source)', () => {
    // Only srcA wins on boat speed; srcB must be dropped before it reaches the
    // pipeline's `latest.bsp`. Groove.Vmg = bsp * cos(twa), so the published VMG
    // reveals which speed source the pipeline actually consumed.
    setSharedSourcePriority([
      { channelPattern: Channels.Boat.SpeedWater, sources: ['srcA'], freshnessSeconds: 60 },
    ]);

    const bus = new Bus();
    const settingsRef = { current: { ...DEFAULT_GROOVE_SETTINGS } };
    const handle = startGrooveComputePipeline(bus, settingsRef);

    const seen = new Map<string, Sample>();
    bus.subscribe('groove.**', (s) => seen.set(s.channel, s));

    const twa = 44 * DEG;
    const bspA = 6; // priority source's boat speed (m/s)
    const bspB = 2; // a contradictory lower-priority source

    for (let i = 0; i < 20; i++) {
      const t = i * 0.5;
      bus.publish(scalar(Channels.Race.TargetTwa, 42 * DEG, t));
      bus.publish(scalar(Channels.Race.TargetSpeed, 6, t));
      bus.publish(scalar(Channels.Wind.TrueSpeed, 10 * KN, t));
      // srcB is published but must be ignored (not in the priority rule).
      bus.publish(scalar(Channels.Boat.SpeedWater, bspB, t, 'srcB'));
      bus.publish(scalar(Channels.Boat.SpeedWater, bspA, t, 'srcA'));
      bus.publish(scalar(Channels.Wind.TrueAngle, twa, t));
    }

    const vmg = seen.get(Channels.Groove.Vmg)?.value;
    expect(vmg?.kind).toBe('scalar');
    if (vmg?.kind === 'scalar') {
      // Should reflect srcA (bspA * cos(twa)), not srcB.
      expect(vmg.value).toBeCloseTo(bspA * Math.cos(twa), 6);
      expect(vmg.value).not.toBeCloseTo(bspB * Math.cos(twa), 3);
    }

    handle.dispose();
  });
});
