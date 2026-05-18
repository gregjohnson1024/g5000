import { Bus, Channels } from '@g5000/core';
import type { PolarTable } from '@g5000/db';
import { interpolatePolarSpeed, optimalTwaForVmg } from '../polars/math.js';

interface Latest {
  tws?: number;
  twa?: number;
  bsp?: number;
}

export function startPolarTargetsPredicate(
  bus: Bus,
  polarRef: { current: PolarTable | null },
): { dispose(): void } {
  const latest: Latest = {};
  const unsubs: Array<() => void> = [];

  function tick(t_ns: bigint): void {
    if (latest.tws === undefined || latest.twa === undefined) return;
    const polar = polarRef.current;
    if (!polar) return;
    const twaAbs = Math.abs(latest.twa);
    const tbs = interpolatePolarSpeed(polar, latest.tws, twaAbs);
    const direction: 'upwind' | 'downwind' = twaAbs < Math.PI / 2 ? 'upwind' : 'downwind';
    const tTwa = optimalTwaForVmg(polar, latest.tws, direction);
    bus.publish({
      channel: Channels.Race.TargetSpeed,
      t_ns,
      value: { kind: 'scalar', value: tbs, unit: 'm/s' },
      source: 'race/polar-targets',
    });
    bus.publish({
      channel: Channels.Race.TargetTwa,
      t_ns,
      value: { kind: 'scalar', value: tTwa, unit: 'rad' },
      source: 'race/polar-targets',
    });
    if (latest.bsp !== undefined && tbs > 0) {
      bus.publish({
        channel: Channels.Race.PercentPolar,
        t_ns,
        value: { kind: 'scalar', value: (latest.bsp / tbs) * 100, unit: '%' },
        source: 'race/polar-targets',
      });
    }
  }

  unsubs.push(
    bus.subscribe(Channels.Wind.TrueSpeed, (s) => {
      if (s.value.kind === 'scalar') {
        latest.tws = s.value.value;
        tick(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Wind.TrueAngle, (s) => {
      if (s.value.kind === 'scalar') {
        latest.twa = s.value.value;
        tick(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Boat.SpeedWater, (s) => {
      if (s.value.kind === 'scalar') {
        latest.bsp = s.value.value;
        tick(s.t_ns);
      }
    }),
  );

  return {
    dispose: () => {
      for (const u of unsubs) u();
    },
  };
}
