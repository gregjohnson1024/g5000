import { firstValueFrom, type Subscription } from 'rxjs';
import { Bus, type Sample } from '@g5000/core';
import type { ConfigStore, PolarTable } from '@g5000/db';
import {
  interpolatePolarSpeed,
  optimalTwaForVmg,
  vmgFor,
} from './math.js';

export interface PolarPipelineOptions {
  bus: Bus;
  configStore: ConfigStore;
  /** If a sample on a required channel is older than this, drop the tick. */
  staleAfterMs?: number;
}

interface LatestValues {
  tws?: { value: number; t_ns: bigint };
  twa?: { value: number; t_ns: bigint };
  bsp?: { value: number; t_ns: bigint };
}

export async function startPolarPipeline(
  opts: PolarPipelineOptions,
): Promise<() => Promise<void>> {
  const { bus, configStore } = opts;
  const staleAfterMs = opts.staleAfterMs ?? 2000;
  const latest: LatestValues = {};
  const subs: Array<() => void> = [];
  const rxSubs: Subscription[] = [];

  let polar: PolarTable = await firstValueFrom(configStore.polars$);

  function recompute(): void {
    if (!latest.tws || !latest.twa || !latest.bsp) return;
    const now_ns = BigInt(Date.now()) * 1_000_000n;
    const stale = (t: bigint): boolean =>
      Number((now_ns - t) / 1_000_000n) > staleAfterMs;
    if (
      stale(latest.tws.t_ns) ||
      stale(latest.twa.t_ns) ||
      stale(latest.bsp.t_ns)
    ) {
      return;
    }
    const tws = latest.tws.value;
    const twa = latest.twa.value;
    const twaAbs = Math.abs(twa);
    const bsp = latest.bsp.value;
    const targetBsp = interpolatePolarSpeed(polar, tws, twaAbs);
    const percentPolar = targetBsp > 0 ? (bsp / targetBsp) * 100 : 0;
    const vmg = vmgFor(bsp, twa);
    const tUp = optimalTwaForVmg(polar, tws, 'upwind');
    const tDn = optimalTwaForVmg(polar, tws, 'downwind');
    const targetVmg =
      twaAbs < Math.PI / 2
        ? vmgFor(interpolatePolarSpeed(polar, tws, tUp), tUp)
        : -vmgFor(interpolatePolarSpeed(polar, tws, tDn), tDn);

    bus.publish(make('performance.target.boatSpeed', targetBsp, now_ns, 'm/s'));
    bus.publish(make('performance.percentPolar', percentPolar, now_ns, '%'));
    bus.publish(make('performance.vmg', vmg, now_ns, 'm/s'));
    bus.publish(make('performance.target.vmg', targetVmg, now_ns, 'm/s'));
    bus.publish(make('performance.target.twaUpwind', tUp, now_ns, 'rad'));
    bus.publish(make('performance.target.twaDownwind', tDn, now_ns, 'rad'));
  }

  const trackScalar = (channel: string, key: keyof LatestValues): void => {
    subs.push(
      bus.subscribe(channel, (s) => {
        if (s.value.kind !== 'scalar') return;
        latest[key] = { value: s.value.value, t_ns: s.t_ns };
        recompute();
      }),
    );
  };
  trackScalar('wind.true.calibrated.speed', 'tws');
  trackScalar('wind.true.calibrated.angle', 'twa');
  trackScalar('boat.speed.water', 'bsp');

  rxSubs.push(
    configStore.polars$.subscribe((next) => {
      polar = next;
      recompute();
    }),
  );

  return async () => {
    for (const u of subs) u();
    for (const s of rxSubs) s.unsubscribe();
  };
}

function make(
  channel: string,
  value: number,
  t_ns: bigint,
  unit: string,
): Sample {
  return {
    channel,
    t_ns,
    value: { kind: 'scalar', value, unit },
    source: 'computed:polars',
  };
}
