'use client';

import type { JsonSafeSample } from '@g5000/core';
import { HelmTile } from '../HelmTile';
import { PositionTile } from '../PositionTile';
import { useRollingStats } from '../use-rolling-stats';
import { scalar, geo, fmtHeadingRad, fmtLat, fmtLon } from '../tile-helpers';
import { MS_TO_KN } from '../../../lib/units';

/** Navigating tab: position, made-good, course averages, drift, sea-state. */
export function NavigatingGroup({
  channels,
}: {
  channels: ReadonlyMap<string, JsonSafeSample>;
}): React.ReactElement {
  const { avgSog, avgCog, avgHdg, motion } = useRollingStats();
  const vmcMs = scalar(channels.get('race.vmc'));
  const position = geo(channels.get('nav.gps.position'));
  const positionLat = position ? fmtLat(position.lat) : null;
  const positionLon = position ? fmtLon(position.lon) : null;

  let driftDeg: number | null = null;
  if (avgCog && avgHdg) {
    let d = avgCog.rad - avgHdg.rad;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    driftDeg = (d * 180) / Math.PI;
  }

  const sub = (a: { coveredMs: number; windowMs: number } | null): string =>
    a
      ? a.coveredMs >= a.windowMs - 1000
        ? `${Math.round(a.windowMs / 60000)} min`
        : `${Math.max(1, Math.round(a.coveredMs / 60000))} min so far`
      : '15 min';

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <PositionTile positionLat={positionLat} positionLon={positionLon} />
      <HelmTile
        label="VMC"
        value={vmcMs === null ? '—' : (vmcMs * MS_TO_KN).toFixed(1)}
        unit="kn"
        sub={vmcMs === null ? 'no mark' : vmcMs >= 0 ? 'closing' : 'opening'}
      />
      <HelmTile label="Avg SOG" value={avgSog ? (avgSog.ms * MS_TO_KN).toFixed(1) : '—'} unit="kn" sub={sub(avgSog)} small />
      <HelmTile label="Avg COG" value={avgCog ? fmtHeadingRad(avgCog.rad) : '—'} unit="°" sub={sub(avgCog)} small />
      <HelmTile label="Avg HDG" value={avgHdg ? fmtHeadingRad(avgHdg.rad) : '—'} unit="°" sub={sub(avgHdg)} small />
      <HelmTile
        label="Drift (COG−HDG)"
        value={driftDeg === null ? '—' : `${driftDeg >= 0 ? '+' : ''}${driftDeg.toFixed(1)}`}
        unit="°"
        sub={driftDeg === null ? '15 min' : driftDeg >= 0 ? 'set stbd' : 'set port'}
        small
      />
      <HelmTile
        label="Motion"
        value={
          motion?.combinedRmsRad !== null && motion?.combinedRmsRad !== undefined
            ? ((motion.combinedRmsRad * 180) / Math.PI).toFixed(1)
            : '—'
        }
        unit="°"
        sub={
          motion?.heelRmsRad !== null &&
          motion?.heelRmsRad !== undefined &&
          motion?.pitchRmsRad !== null &&
          motion?.pitchRmsRad !== undefined
            ? `h ${((motion.heelRmsRad * 180) / Math.PI).toFixed(1)}° p ${((motion.pitchRmsRad * 180) / Math.PI).toFixed(1)}°`
            : '15 min'
        }
        small
      />
    </div>
  );
}
