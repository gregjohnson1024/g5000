import { combineLatest, firstValueFrom, type Subscription } from 'rxjs';
import { Bus, Channels, type Sample } from '@g5000/core';
import type { AwsAwaCalTable, BoatConfig, BspCal, CompassDeviation, ConfigStore } from '@g5000/db';
import { computeTrueWind } from './math.js';

export interface TrueWindPipelineOptions {
  bus: Bus;
  configStore: ConfigStore;
  /** If a sample on a required channel is older than this, drop the tick. */
  staleAfterMs?: number;
}

interface LatestValues {
  aws?: { value: number; t_ns: bigint };
  awa?: { value: number; t_ns: bigint };
  bsp?: { value: number; t_ns: bigint };
  hdg?: { value: number; t_ns: bigint };
  yawRate?: { value: number; t_ns: bigint };
}

export async function startTrueWindPipeline(
  opts: TrueWindPipelineOptions,
): Promise<() => Promise<void>> {
  const { bus, configStore } = opts;
  const staleAfterMs = opts.staleAfterMs ?? 2000;
  const latest: LatestValues = {};
  const subs: Array<() => void> = [];
  const rxSubs: Subscription[] = [];

  // Cache the latest cal tables so recompute() doesn't pull from the
  // BehaviorSubject on every tick. Initialised synchronously here, then
  // updated by the combineLatest below.
  let configSnapshot: {
    boatConfig: BoatConfig;
    awsAwaCal: AwsAwaCalTable;
    bspCal: BspCal;
    compassDeviation: CompassDeviation;
  } = {
    boatConfig: await firstValueFrom(configStore.boatConfig$),
    awsAwaCal: await firstValueFrom(configStore.awsAwaCal$),
    bspCal: await firstValueFrom(configStore.bspCal$),
    compassDeviation: await firstValueFrom(configStore.compassDeviation$),
  };

  function recompute(): void {
    if (!latest.aws || !latest.awa || !latest.bsp || !latest.hdg) return;
    const now_ns = BigInt(Date.now()) * 1_000_000n;
    const stale = (t: bigint): boolean => Number((now_ns - t) / 1_000_000n) > staleAfterMs;
    if (
      stale(latest.aws.t_ns) ||
      stale(latest.awa.t_ns) ||
      stale(latest.bsp.t_ns) ||
      stale(latest.hdg.t_ns)
    ) {
      return;
    }
    const out = computeTrueWind({
      aws: latest.aws.value,
      awa: latest.awa.value,
      bsp: latest.bsp.value,
      headingMagRad: latest.hdg.value,
      yawRateRad: latest.yawRate?.value ?? 0,
      awsAwaCal: configSnapshot.awsAwaCal,
      bspCal: configSnapshot.bspCal,
      compassDeviation: configSnapshot.compassDeviation,
      boatConfig: configSnapshot.boatConfig,
    });
    bus.publish(make('wind.true.speed', out.tws, now_ns));
    bus.publish(make('wind.true.angle', out.twa, now_ns));
    bus.publish(make('wind.true.direction', out.twd, now_ns));
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
  trackScalar(Channels.Wind.ApparentSpeed, 'aws');
  trackScalar(Channels.Wind.ApparentAngle, 'awa');
  trackScalar(Channels.Boat.SpeedWater, 'bsp');
  trackScalar(Channels.Boat.HeadingMagnetic, 'hdg');
  trackScalar('motion.rateOfTurn', 'yawRate');

  rxSubs.push(
    combineLatest([
      configStore.boatConfig$,
      configStore.awsAwaCal$,
      configStore.bspCal$,
      configStore.compassDeviation$,
    ]).subscribe(([boatConfig, awsAwaCal, bspCal, compassDeviation]) => {
      configSnapshot = { boatConfig, awsAwaCal, bspCal, compassDeviation };
      recompute();
    }),
  );

  return async () => {
    for (const u of subs) u();
    for (const s of rxSubs) s.unsubscribe();
  };
}

function make(channel: string, value: number, t_ns: bigint): Sample {
  return {
    channel,
    t_ns,
    value: {
      kind: 'scalar',
      value,
      unit: channel.endsWith('.speed') ? 'm/s' : 'rad',
    },
    source: 'computed:true_wind',
  };
}
