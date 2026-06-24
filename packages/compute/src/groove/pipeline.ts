import { Bus, Channels, subscribeSelected, getSharedSourcePriority } from '@g5000/core';
import type { GrooveSettings } from '@g5000/db';
import { classifyPointOfSail, type PointOfSail } from './point-of-sail.js';
import { isInGroove, vmgEfficiencyPct, vmgMs, targetTwaErrorRad } from './metrics.js';
import { leewayRad } from './leeway.js';
import {
  timeWeightedFraction,
  circularStdDev,
  coefficientOfVariation,
  reversalsPerMinute,
  maxRisingSlope,
  pruneBefore,
  type FlagSample,
  type NumSample,
} from './windows.js';

const DEG = Math.PI / 180;
const KN_TO_MS = 0.514444;

// Active autopilot steering modes (PGN 127237 "Steering Mode"). Matched as
// prefixes to tolerate variant spellings (e.g. "Wind Vane"). NOTE: the exact
// canboat enum strings are instrument-dependent — verify against live data
// during on-boat autopilot validation.
const ACTIVE_AP_MODES = ['Heading Control', 'Track Control', 'Wind', 'Vane', 'Nav', 'No Drift'];
const isApEngaged = (mode: string): boolean => ACTIVE_AP_MODES.some((m) => mode.startsWith(m));

export interface GrooveSettingsRef {
  current: GrooveSettings;
}
export interface GroovePipelineHandle {
  dispose(): void;
}

interface Latest {
  twa?: number;
  tws?: number;
  bsp?: number;
  targetSpeed?: number;
  targetTwa?: number;
  rudder?: number;
  heel?: number;
  apMode?: string;
  apModeT_ns?: bigint;
}

export function startGrooveComputePipeline(
  bus: Bus,
  settingsRef: GrooveSettingsRef,
): GroovePipelineHandle {
  const latest: Latest = {};
  const inGrooveBuf: FlagSample[] = [];
  const twaBuf: NumSample[] = [];
  const bspBuf: NumSample[] = [];
  const rudderBuf: NumSample[] = [];
  const unsubs: Array<() => void> = [];

  const publishScalar = (channel: string, value: number, t_ns: bigint, unit: string): void => {
    bus.publish({ channel, t_ns, value: { kind: 'scalar', value, unit }, source: 'groove' });
  };
  const publishEnum = (channel: string, value: string, t_ns: bigint): void => {
    bus.publish({ channel, t_ns, value: { kind: 'enum', value }, source: 'groove' });
  };
  const pruneInPlace = <T extends { t_ns: bigint }>(buf: T[], cutoff_ns: bigint): void => {
    const kept = pruneBefore(buf, cutoff_ns);
    buf.length = 0;
    buf.push(...kept);
  };

  function recompute(t_ns: bigint): void {
    const s = settingsRef.current;
    const windowNs = BigInt(Math.round(s.windowSec * 1e9));
    const cutoff = t_ns - windowNs;

    pruneInPlace(inGrooveBuf, cutoff);
    pruneInPlace(twaBuf, cutoff);
    pruneInPlace(bspBuf, cutoff);
    pruneInPlace(rudderBuf, cutoff);

    let helmSource: 'human' | 'autopilot' = 'human';
    if (
      latest.apMode !== undefined &&
      latest.apModeT_ns !== undefined &&
      isApEngaged(latest.apMode)
    ) {
      const apAgeS = Number(t_ns - latest.apModeT_ns) / 1e9;
      if (apAgeS >= 0 && apAgeS <= s.helmSourceTtlSec) helmSource = 'autopilot';
    }
    publishEnum(Channels.Groove.HelmSource, helmSource, t_ns);

    if (latest.heel !== undefined && latest.bsp !== undefined) {
      const lee = leewayRad({
        heelRad: latest.heel,
        stwMs: latest.bsp,
        k: s.leewayK,
        maxRad: s.leewayMaxDeg * DEG,
        stwFloorMs: s.steerageFloorKn * KN_TO_MS,
      });
      publishScalar(Channels.Boat.Leeway, lee, t_ns, 'rad');
    }

    const effort = reversalsPerMinute(rudderBuf, s.rudderDeadbandDeg * DEG);
    if (effort !== null) publishScalar(Channels.Groove.SteeringEffort, effort, t_ns, '1/min');

    if (latest.twa === undefined || latest.tws === undefined || latest.bsp === undefined) return;
    const twaAbs = Math.abs(latest.twa);

    const pos: PointOfSail = classifyPointOfSail({
      twaAbsRad: twaAbs,
      twsMs: latest.tws,
      bspMs: latest.bsp,
      reachingLoRad: s.reachingBandLoDeg * DEG,
      reachingHiRad: s.reachingBandHiDeg * DEG,
      twsFloorMs: s.twsFloorKn * KN_TO_MS,
      steerageFloorMs: s.steerageFloorKn * KN_TO_MS,
    });
    publishEnum(Channels.Groove.PointOfSail, pos, t_ns);

    if (
      pos === 'not-sailing' ||
      latest.targetSpeed === undefined ||
      latest.targetTwa === undefined ||
      latest.targetSpeed <= 0
    ) {
      inGrooveBuf.length = 0;
      twaBuf.length = 0;
      bspBuf.length = 0;
      return;
    }

    const tolerance =
      s.twaToleranceDeg * DEG * (pos === 'downwind' ? s.downwindToleranceFactor : 1);

    const flag = isInGroove({
      pointOfSail: pos,
      twaAbsRad: twaAbs,
      targetTwaRad: latest.targetTwa,
      bspMs: latest.bsp,
      targetSpeedMs: latest.targetSpeed,
      toleranceRad: tolerance,
      speedFraction: s.speedFraction,
    });
    if (flag !== null) {
      inGrooveBuf.push({ t_ns, flag });
      publishEnum(Channels.Groove.InGroove, flag ? 'in' : 'out', t_ns);
      const tig = timeWeightedFraction(inGrooveBuf);
      if (tig !== null) publishScalar(Channels.Groove.TimeInGroove, tig * 100, t_ns, '%');
    }

    const eff = vmgEfficiencyPct({
      pointOfSail: pos,
      twaRad: latest.twa,
      targetTwaRad: latest.targetTwa,
      bspMs: latest.bsp,
      targetSpeedMs: latest.targetSpeed,
    });
    if (eff !== null) publishScalar(Channels.Groove.VmgEfficiency, eff, t_ns, '%');

    publishScalar(Channels.Groove.Vmg, vmgMs(latest.bsp, latest.twa), t_ns, 'm/s');
    publishScalar(
      Channels.Groove.TargetTwaError,
      targetTwaErrorRad(twaAbs, latest.targetTwa),
      t_ns,
      'rad',
    );

    twaBuf.push({ t_ns, value: latest.twa });
    const sd = circularStdDev(twaBuf.map((x) => x.value));
    if (sd !== null) publishScalar(Channels.Groove.TwaSteadiness, sd, t_ns, 'rad');
    const cv = coefficientOfVariation(bspBuf.map((x) => x.value));
    if (cv !== null) publishScalar(Channels.Groove.SpeedCv, cv, t_ns, '');
    const build = maxRisingSlope(bspBuf);
    if (build !== null) publishScalar(Channels.Groove.BuildRate, build, t_ns, 'm/s^2');
  }

  unsubs.push(
    bus.subscribe(Channels.Wind.TrueAngle, (s) => {
      if (s.value.kind === 'scalar') {
        latest.twa = s.value.value;
        recompute(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Wind.TrueSpeed, (s) => {
      if (s.value.kind === 'scalar') {
        latest.tws = s.value.value;
        recompute(s.t_ns);
      }
    }),
  );
  unsubs.push(
    subscribeSelected(bus, Channels.Boat.SpeedWater, getSharedSourcePriority, (s) => {
      if (s.value.kind === 'scalar') {
        latest.bsp = s.value.value;
        bspBuf.push({ t_ns: s.t_ns, value: s.value.value });
        recompute(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Race.TargetSpeed, (s) => {
      if (s.value.kind === 'scalar') latest.targetSpeed = s.value.value;
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Race.TargetTwa, (s) => {
      if (s.value.kind === 'scalar') latest.targetTwa = s.value.value;
    }),
  );
  unsubs.push(
    subscribeSelected(bus, Channels.Boat.RudderAngle, getSharedSourcePriority, (s) => {
      if (s.value.kind === 'scalar') {
        latest.rudder = s.value.value;
        rudderBuf.push({ t_ns: s.t_ns, value: s.value.value });
      }
    }),
  );
  unsubs.push(
    subscribeSelected(bus, Channels.Motion.Heel, getSharedSourcePriority, (s) => {
      if (s.value.kind === 'scalar') latest.heel = s.value.value;
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Autopilot.Mode, (s) => {
      if (s.value.kind === 'enum') {
        latest.apMode = s.value.value;
        latest.apModeT_ns = s.t_ns;
      }
    }),
  );

  return {
    dispose: () => {
      for (const u of unsubs) u();
    },
  };
}
