import { Bus, Channels, type RaceState } from '@g5000/core';
import type { PolarTable } from '@g5000/db';
import type { CurrentField } from '@g5000/grib';
import { startPolarTargetsPredicate } from './polar-targets.js';
import { createWindShiftDetector } from './wind-shift.js';
import { projectLayline } from './laylines.js';
import {
  haversineMeters,
  lineBearingRad,
  distanceToLineMeters,
  timeToLineSeconds,
  lineBiasRad,
  initialBearingRad,
  sideOfLine,
  type LatLon,
} from './line-geometry.js';
import { vmc } from './vmc.js';
import { predictOcs } from './ocs-predictor.js';
import { interpolatePolarSpeed, optimalTwaForVmg } from '../polars/math.js';

export { startPolarTargetsPredicate, createWindShiftDetector, projectLayline, vmc, predictOcs };

interface Latest {
  pos?: LatLon;
  cog?: number;
  sog?: number;
  twd?: number;
  tws?: number;
  twa?: number;
  hdg?: number;
}

const DEG = Math.PI / 180;

export interface RacePipelineHandles {
  dispose(): void;
}

export function startRaceComputePipeline(
  bus: Bus,
  raceState: RaceState,
  polarRef: { current: PolarTable | null },
  currentFieldRef: { current: CurrentField | null },
  waypointsRef: { current: Map<string, LatLon> },
  cogConcentrationRef: { current: number },
): RacePipelineHandles {
  const latest: Latest = {};
  const unsubs: Array<() => void> = [];

  // Polar targets predicate self-manages its subscriptions.
  const polarTargets = startPolarTargetsPredicate(bus, polarRef);

  // Wind-shift detector (consumed by the wind-shift subscriber below).
  let detector = createWindShiftDetector({
    baselineWindowMs: 300_000,
    currentWindowMs: 30_000,
    thresholdRad: raceState.get().settings.shiftThresholdDeg * DEG,
    persistenceMs: 60_000,
  });
  // Reconfigure detector on settings change.
  unsubs.push(
    raceState.subscribe((cfg) => {
      detector = createWindShiftDetector({
        baselineWindowMs: 300_000,
        currentWindowMs: 30_000,
        thresholdRad: cfg.settings.shiftThresholdDeg * DEG,
        persistenceMs: 60_000,
      });
    }),
  );

  // --- Input subscriptions (cache latest, recompute derived) ---
  unsubs.push(
    bus.subscribe(Channels.Nav.Position, (s) => {
      if (s.value.kind === 'geo') {
        latest.pos = s.value.value;
        recomputeLineGeometry(s.t_ns);
        recomputeOcs(s.t_ns);
        recomputeVmc(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Nav.Cog, (s) => {
      if (s.value.kind === 'scalar') {
        latest.cog = s.value.value;
        recomputeLineGeometry(s.t_ns);
        recomputeOcs(s.t_ns);
        recomputeVmc(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Nav.Sog, (s) => {
      if (s.value.kind === 'scalar') {
        latest.sog = s.value.value;
        recomputeLineGeometry(s.t_ns);
        recomputeOcs(s.t_ns);
        recomputeVmc(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Wind.TrueDirection, (s) => {
      if (s.value.kind === 'scalar') {
        latest.twd = s.value.value;
        const tMs = Number(s.t_ns / 1_000_000n);
        const r = detector.update(latest.twd, tMs, latest.hdg);
        bus.publish({
          channel: Channels.Race.WindShiftBias,
          t_ns: s.t_ns,
          value: { kind: 'scalar', value: r.biasRad, unit: 'rad' },
          source: 'race/wind-shift',
        });
        if (r.event) {
          bus.publish({
            channel: Channels.Race.WindShiftEvent,
            t_ns: s.t_ns,
            value: { kind: 'enum', value: `${r.event.direction}:${r.event.deg.toFixed(1)}` },
            source: 'race/wind-shift',
          });
        }
        recomputeLineGeometry(s.t_ns);
        recomputeLaylines(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Wind.TrueSpeed, (s) => {
      if (s.value.kind === 'scalar') {
        latest.tws = s.value.value;
        recomputeLaylines(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Wind.TrueAngle, (s) => {
      if (s.value.kind === 'scalar') latest.twa = s.value.value;
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Boat.HeadingTrue, (s) => {
      if (s.value.kind === 'scalar') latest.hdg = s.value.value;
    }),
  );

  // --- Layline recomputation, throttled to 1 Hz ---
  let lastLaylineMs = 0;
  function recomputeLaylines(t_ns: bigint): void {
    if (latest.pos === undefined || latest.tws === undefined || latest.twd === undefined) return;
    const polar = polarRef.current;
    if (!polar) return;
    const tMs = Number(t_ns / 1_000_000n);
    if (tMs - lastLaylineMs < 1000) return;
    lastLaylineMs = tMs;
    const cfg = raceState.get().settings;
    const upwindTwa = optimalTwaForVmg(polar, latest.tws, 'upwind');
    const portHeading = (latest.twd + Math.PI - upwindTwa + 2 * Math.PI) % (2 * Math.PI);
    const stbdHeading = (latest.twd + Math.PI + upwindTwa) % (2 * Math.PI);
    const tws = latest.tws;
    // Through-water speed for layline projection — TBS at the optimal-VMG TWA.
    const tbs = interpolatePolarSpeed(polar, tws, upwindTwa);
    const portPoly = projectLayline({
      pos: latest.pos,
      headingRad: portHeading,
      throughWaterSpeedMs: tbs,
      currentField: currentFieldRef.current,
      distanceNm: cfg.laylineDistanceNm,
      integrateCurrent: cfg.integrateCurrent,
      timeAtSampleMs: tMs,
    });
    const stbdPoly = projectLayline({
      pos: latest.pos,
      headingRad: stbdHeading,
      throughWaterSpeedMs: tbs,
      currentField: currentFieldRef.current,
      distanceNm: cfg.laylineDistanceNm,
      integrateCurrent: cfg.integrateCurrent,
      timeAtSampleMs: tMs,
    });
    // Polylines are arrays of {lat,lon}; encode as enum for transport.
    bus.publish({
      channel: Channels.Race.LaylinePort,
      t_ns,
      value: { kind: 'enum', value: JSON.stringify(portPoly) },
      source: 'race/laylines',
    });
    bus.publish({
      channel: Channels.Race.LaylineStbd,
      t_ns,
      value: { kind: 'enum', value: JSON.stringify(stbdPoly) },
      source: 'race/laylines',
    });
  }

  // --- Line geometry recomputation ---
  function recomputeLineGeometry(t_ns: bigint): void {
    const { line } = raceState.get();
    if (!line.port || !line.stbd || latest.pos === undefined) return;

    // Lazily determine preStartSide from the boat's first non-degenerate
    // off-line position. This fires when the user pinged both ends while
    // standing at an endpoint (boatPos ≈ endpoint, cross product ≈ 0) and
    // the API deferred the decision. Uses the same 1e-7 deg² threshold as
    // the API route.
    if (!line.preStartSide) {
      const crossMag = Math.abs(
        (line.stbd.lon - line.port.lon) * (latest.pos.lat - line.port.lat) -
          (line.stbd.lat - line.port.lat) * (latest.pos.lon - line.port.lon),
      );
      if (crossMag > 1e-7) {
        raceState.mutate((d) => {
          if (d.line.port && d.line.stbd && !d.line.preStartSide) {
            d.line.preStartSide = sideOfLine(latest.pos!, d.line.port, d.line.stbd);
          }
        });
      }
      // Still undefined — come back on the next GPS sample.
      if (!raceState.get().line.preStartSide) return;
    }

    const freshLine = raceState.get().line;
    if (!freshLine.preStartSide || !freshLine.port || !freshLine.stbd) return;
    const bearing = lineBearingRad(freshLine.port, freshLine.stbd);
    const dPort = haversineMeters(latest.pos, freshLine.port);
    const dStbd = haversineMeters(latest.pos, freshLine.stbd);
    const dtl = distanceToLineMeters(
      latest.pos,
      freshLine.port,
      freshLine.stbd,
      freshLine.preStartSide,
    );
    bus.publish({
      channel: Channels.Race.LineDistancePort,
      t_ns,
      value: { kind: 'scalar', value: dPort, unit: 'm' },
      source: 'race/line',
    });
    bus.publish({
      channel: Channels.Race.LineDistanceStbd,
      t_ns,
      value: { kind: 'scalar', value: dStbd, unit: 'm' },
      source: 'race/line',
    });
    bus.publish({
      channel: Channels.Race.LineDistanceToLine,
      t_ns,
      value: { kind: 'scalar', value: dtl, unit: 'm' },
      source: 'race/line',
    });
    if (latest.cog !== undefined && latest.sog !== undefined) {
      const normalToLine =
        freshLine.preStartSide === 'port' ? bearing - Math.PI / 2 : bearing + Math.PI / 2;
      let dθ = latest.cog - normalToLine;
      while (dθ > Math.PI) dθ -= 2 * Math.PI;
      while (dθ < -Math.PI) dθ += 2 * Math.PI;
      const ttl = timeToLineSeconds(dtl, latest.sog, dθ);
      if (ttl !== null) {
        bus.publish({
          channel: Channels.Race.LineTimeToLine,
          t_ns,
          value: { kind: 'scalar', value: ttl, unit: 's' },
          source: 'race/line',
        });
      }
    }
    if (latest.twd !== undefined) {
      const bias = lineBiasRad(bearing, latest.twd);
      bus.publish({
        channel: Channels.Race.LineBias,
        t_ns,
        value: { kind: 'scalar', value: bias, unit: 'rad' },
        source: 'race/line',
      });
    }
  }

  // --- OCS recomputation ---
  function recomputeOcs(t_ns: bigint): void {
    const { line, timer, settings } = raceState.get();
    if (latest.pos === undefined || latest.cog === undefined || latest.sog === undefined) return;
    const result = predictOcs({
      pos: latest.pos,
      cogRad: latest.cog,
      sogMs: latest.sog,
      cogConcentration: cogConcentrationRef.current,
      line: { port: line.port, stbd: line.stbd },
      startMs: timer.startMs,
      lookAheadSec: settings.ocsLookAheadSec,
    });
    if (result === null) return;
    bus.publish({
      channel: Channels.Race.LineOcsPredicted,
      t_ns,
      value: { kind: 'enum', value: result ? 'OCS' : 'OK' },
      source: 'race/ocs',
    });
  }

  // --- VMC recomputation ---
  function recomputeVmc(t_ns: bigint): void {
    const id = raceState.get().activeMarkWaypointId;
    if (!id) return;
    const wp = waypointsRef.current.get(id);
    if (!wp) return;
    if (latest.pos === undefined || latest.cog === undefined || latest.sog === undefined) return;
    const bearing = initialBearingRad(latest.pos, wp);
    const v = vmc(latest.sog, latest.cog, bearing);
    bus.publish({
      channel: Channels.Race.Vmc,
      t_ns,
      value: { kind: 'scalar', value: v, unit: 'm/s' },
      source: 'race/vmc',
    });
  }

  // --- 1 Hz timer-state tick ---
  const timerTick = setInterval(() => {
    raceState.mutate((draft) => {
      const t = draft.timer;
      if (t.startMs === null) {
        if (t.state !== 'idle') t.state = 'idle';
        return;
      }
      const now = Date.now();
      if (now < t.startMs) {
        if (t.state !== 'pre-start') t.state = 'pre-start';
      } else if (now - t.startMs < 3_600_000) {
        if (t.state !== 'started') t.state = 'started';
      } else {
        if (t.state !== 'finished') {
          t.state = 'finished';
          t.startMs = null;
        }
      }
    });
  }, 1000);

  return {
    dispose: () => {
      polarTargets.dispose();
      for (const u of unsubs) u();
      clearInterval(timerTick);
    },
  };
}
