'use client';

import type { JsonSafeSample } from '@g5000/core';
import { HelmTile } from '../HelmTile';
import { SailRecommendationTile } from '../SailRecommendationTile';
import { scalar, enumVal, fmtSpeed, fmtAngleSigned } from '../tile-helpers';
import { RAD_TO_DEG } from '../../../lib/units';

/** Performance tab: wind, polar targets, groove, trim, sail recommendation. */
export function PerformanceGroup({
  channels,
}: {
  channels: ReadonlyMap<string, JsonSafeSample>;
}): React.ReactElement {
  const twa = channels.get('wind.true.angle');
  const awa = channels.get('wind.apparent.angle');
  const aws = channels.get('wind.apparent.speed');
  const tbsSample = channels.get('race.targetSpeed');
  const tTwaSample = channels.get('race.targetTwa');
  const pctPolar = scalar(channels.get('race.percentPolar'));
  const heel = channels.get('motion.heel');
  const pitch = channels.get('motion.pitch');

  const timeInGroove = scalar(channels.get('groove.timeInGroove'));
  const vmgEff = scalar(channels.get('groove.vmgEfficiency'));
  const twaSteadiness = scalar(channels.get('groove.twaSteadiness'));
  const steeringEffort = scalar(channels.get('groove.steeringEffort'));
  const helmSource = enumVal(channels.get('groove.helmSource'));
  const pointOfSail = enumVal(channels.get('groove.pointOfSail'));

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {twa && <HelmTile label="TWA" value={fmtAngleSigned(twa)} unit="°" />}
      {aws && <HelmTile label="AWS" value={fmtSpeed(aws)} unit="kn" small />}
      {awa && <HelmTile label="AWA" value={fmtAngleSigned(awa)} unit="°" small />}
      {tbsSample && <HelmTile label="TBS" value={fmtSpeed(tbsSample)} unit="kn" small />}
      {tTwaSample && (
        <HelmTile label="Target TWA" value={fmtAngleSigned(tTwaSample)} unit="°" small />
      )}
      {pctPolar !== null && <HelmTile label="% polar" value={pctPolar.toFixed(0)} unit="%" small />}

      <HelmTile
        label="In groove"
        value={timeInGroove === null ? '—' : timeInGroove.toFixed(0)}
        unit={timeInGroove === null ? undefined : '%'}
        severity={
          timeInGroove === null
            ? 'neutral'
            : timeInGroove >= 80
              ? 'good'
              : timeInGroove >= 50
                ? 'ok'
                : 'bad'
        }
        sub={pointOfSail ?? undefined}
      />
      <HelmTile
        label="VMG eff"
        value={vmgEff === null ? '—' : vmgEff.toFixed(0)}
        unit={vmgEff === null ? undefined : '%'}
        severity={vmgEff === null ? 'neutral' : vmgEff >= 98 ? 'good' : vmgEff >= 90 ? 'ok' : 'bad'}
      />
      <HelmTile
        label={helmSource === 'autopilot' ? 'Pilot activity' : 'Helm steadiness'}
        value={twaSteadiness === null ? '—' : (twaSteadiness * RAD_TO_DEG).toFixed(1)}
        unit={twaSteadiness === null ? undefined : '°'}
        severity="neutral"
        small
      >
        {steeringEffort !== null && (
          <div className="text-xs text-slate-500">{steeringEffort.toFixed(1)} corr·min⁻¹</div>
        )}
      </HelmTile>

      <HelmTile label="Heel" value={fmtAngleSigned(heel)} unit="°" small />
      <HelmTile label="Pitch" value={fmtAngleSigned(pitch)} unit="°" small />
      <SailRecommendationTile />
    </div>
  );
}
