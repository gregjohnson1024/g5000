import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Bus, Channels, createRaceState } from '@g5000/core';
import type { PolarTable } from '@g5000/db';
import { startRaceComputePipeline } from './index.js';

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

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('race pipeline integration', () => {
  it('publishes race.line.* once line is pinged and position publishes', async () => {
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    const bus = new Bus();
    const rs = createRaceState();
    rs.mutate((d) => {
      d.line.port = { lat: 41.5, lon: -71.3, pingedAt: '2026-05-18T11:59:00Z' };
      d.line.stbd = { lat: 41.5, lon: -71.29, pingedAt: '2026-05-18T11:59:00Z' };
      d.line.preStartSide = 'port';
    });
    const polarRef = { current: POLAR as PolarTable | null };
    const wpRef = { current: new Map() };
    const handle = startRaceComputePipeline(bus, rs, polarRef, { current: null }, wpRef, {
      current: 1,
    });

    const seen: Record<string, number> = {};
    bus.subscribe('race.**', (s) => {
      if (s.value.kind === 'scalar') seen[s.channel] = s.value.value;
    });

    const t = BigInt(Date.now()) * 1_000_000n;
    bus.publish({
      channel: Channels.Nav.Position,
      t_ns: t,
      value: { kind: 'geo', value: { lat: 41.49, lon: -71.295 } },
      source: 'test',
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(seen[Channels.Race.LineDistanceToLine]).toBeDefined();
    expect(seen[Channels.Race.LineDistancePort]).toBeGreaterThan(0);
    expect(seen[Channels.Race.LineDistanceStbd]).toBeGreaterThan(0);

    handle.dispose();
  });

  it('publishes race.vmc when active mark + position are set', async () => {
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    const bus = new Bus();
    const rs = createRaceState();
    rs.mutate((d) => {
      d.activeMarkWaypointId = 'wp-1';
    });
    const wpRef = { current: new Map([['wp-1', { lat: 41.6, lon: -71.295 }]]) };
    const handle = startRaceComputePipeline(bus, rs, { current: null }, { current: null }, wpRef, {
      current: 1,
    });
    const seen: Record<string, number> = {};
    bus.subscribe('race.**', (s) => {
      if (s.value.kind === 'scalar') seen[s.channel] = s.value.value;
    });
    const t = BigInt(Date.now()) * 1_000_000n;
    bus.publish({
      channel: Channels.Nav.Position,
      t_ns: t,
      value: { kind: 'geo', value: { lat: 41.5, lon: -71.3 } },
      source: 'test',
    });
    bus.publish({
      channel: Channels.Nav.Cog,
      t_ns: t,
      value: { kind: 'scalar', value: 0 },
      source: 'test',
    });
    bus.publish({
      channel: Channels.Nav.Sog,
      t_ns: t,
      value: { kind: 'scalar', value: 5 },
      source: 'test',
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(seen[Channels.Race.Vmc]).toBeDefined();
    handle.dispose();
  });

  it('does not publish wind-dependent channels when wind is silent', async () => {
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    const bus = new Bus();
    const rs = createRaceState();
    const handle = startRaceComputePipeline(
      bus,
      rs,
      { current: null },
      { current: null },
      {
        current: new Map(),
      },
      { current: 1 },
    );
    const seen: string[] = [];
    bus.subscribe('race.**', (s) => seen.push(s.channel));
    const t = BigInt(Date.now()) * 1_000_000n;
    bus.publish({
      channel: Channels.Nav.Position,
      t_ns: t,
      value: { kind: 'geo', value: { lat: 41.5, lon: -71.3 } },
      source: 'test',
    });
    bus.publish({
      channel: Channels.Nav.Sog,
      t_ns: t,
      value: { kind: 'scalar', value: 5 },
      source: 'test',
    });
    bus.publish({
      channel: Channels.Nav.Cog,
      t_ns: t,
      value: { kind: 'scalar', value: 0 },
      source: 'test',
    });
    await vi.advanceTimersByTimeAsync(20);
    // No wind, no bias / targets / laylines / wind-shift.
    expect(seen).not.toContain(Channels.Race.LineBias);
    expect(seen).not.toContain(Channels.Race.TargetSpeed);
    expect(seen).not.toContain(Channels.Race.LaylinePort);
    expect(seen).not.toContain(Channels.Race.WindShiftBias);
    handle.dispose();
  });
});
