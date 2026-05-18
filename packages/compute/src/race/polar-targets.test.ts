import { describe, it, expect } from 'vitest';
import { Bus, Channels } from '@g5000/core';
import type { PolarTable } from '@g5000/db';
import { startPolarTargetsPredicate } from './polar-targets.js';

const POLAR: PolarTable = {
  twsBins: [4, 8, 12, 16, 20],
  twaBins: [0, 0.5, 1.0, 1.57, 2.0, 2.5, 3.0],
  boatSpeed: [
    [0, 1, 2, 2.5, 2.3, 1.8, 0.5],
    [0, 2, 3.5, 4, 3.7, 3, 1],
    [0, 3, 5, 5.8, 5.3, 4.4, 1.5],
    [0, 4, 6, 7, 6.4, 5.3, 1.8],
    [0, 5, 7, 8, 7.4, 6.1, 2.0],
  ],
};

describe('startPolarTargetsPredicate', () => {
  it('publishes targetSpeed / targetTwa / percentPolar when wind + bsp present', async () => {
    const bus = new Bus();
    const polarRef = { current: POLAR as PolarTable | null };
    const dispose = startPolarTargetsPredicate(bus, polarRef);
    const published: Record<string, number> = {};
    bus.subscribe('race.**', (s) => {
      if (s.value.kind === 'scalar') published[s.channel] = s.value.value;
    });
    const now = BigInt(Date.now()) * 1_000_000n;
    bus.publish({ channel: Channels.Wind.TrueSpeed, t_ns: now, value: { kind: 'scalar', value: 8 }, source: 'test' });
    bus.publish({ channel: Channels.Wind.TrueAngle, t_ns: now, value: { kind: 'scalar', value: 0.7 }, source: 'test' });
    bus.publish({ channel: Channels.Boat.SpeedWater, t_ns: now, value: { kind: 'scalar', value: 3 }, source: 'test' });
    // Allow the pipeline to react.
    await new Promise((r) => setTimeout(r, 5));
    expect(published[Channels.Race.TargetSpeed]).toBeGreaterThan(0);
    expect(published[Channels.Race.TargetTwa]).toBeGreaterThan(0);
    expect(published[Channels.Race.PercentPolar]).toBeGreaterThan(0);
    dispose.dispose();
  });

  it('does not publish when wind is missing', async () => {
    const bus = new Bus();
    const polarRef = { current: POLAR as PolarTable | null };
    const dispose = startPolarTargetsPredicate(bus, polarRef);
    const published: string[] = [];
    bus.subscribe('race.**', (s) => published.push(s.channel));
    const now = BigInt(Date.now()) * 1_000_000n;
    // Only BSP, no wind.
    bus.publish({ channel: Channels.Boat.SpeedWater, t_ns: now, value: { kind: 'scalar', value: 3 }, source: 'test' });
    await new Promise((r) => setTimeout(r, 5));
    expect(published).toEqual([]);
    dispose.dispose();
  });

  it('does not publish when polarRef.current is null', async () => {
    const bus = new Bus();
    const polarRef: { current: PolarTable | null } = { current: null };
    const dispose = startPolarTargetsPredicate(bus, polarRef);
    const published: string[] = [];
    bus.subscribe('race.**', (s) => published.push(s.channel));
    const now = BigInt(Date.now()) * 1_000_000n;
    bus.publish({ channel: Channels.Wind.TrueSpeed, t_ns: now, value: { kind: 'scalar', value: 8 }, source: 'test' });
    bus.publish({ channel: Channels.Wind.TrueAngle, t_ns: now, value: { kind: 'scalar', value: 0.7 }, source: 'test' });
    bus.publish({ channel: Channels.Boat.SpeedWater, t_ns: now, value: { kind: 'scalar', value: 3 }, source: 'test' });
    await new Promise((r) => setTimeout(r, 5));
    expect(published).toEqual([]);
    dispose.dispose();
  });
});
