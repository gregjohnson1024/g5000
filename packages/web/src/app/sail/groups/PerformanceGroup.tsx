'use client';

import type { JsonSafeSample } from '@g5000/core';
import { HelmTile } from '../HelmTile';
import { SailRecommendationTile } from '../SailRecommendationTile';
import { scalar, enumVal, fmtSpeed, fmtAngleSigned, sampleTs } from '../tile-helpers';
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
  const pctPolarSample = channels.get('race.percentPolar');
  const pctPolar = scalar(pctPolarSample);
  const heel = channels.get('motion.heel');
  const pitch = channels.get('motion.pitch');

  const timeInGrooveSample = channels.get('groove.timeInGroove');
  const vmgEffSample = channels.get('groove.vmgEfficiency');
  const twaSteadinessSample = channels.get('groove.twaSteadiness');
  const steeringEffortSample = channels.get('groove.steeringEffort');
  const timeInGroove = scalar(timeInGrooveSample);
  const vmgEff = scalar(vmgEffSample);
  const twaSteadiness = scalar(twaSteadinessSample);
  const steeringEffort = scalar(steeringEffortSample);
  const helmSource = enumVal(channels.get('groove.helmSource'));
  const pointOfSail = enumVal(channels.get('groove.pointOfSail'));

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {twa && <HelmTile label="TWA" value={fmtAngleSigned(twa)} unit="°" tMs={sampleTs(twa)} />}
      {aws && <HelmTile label="AWS" value={fmtSpeed(aws)} unit="kn" small tMs={sampleTs(aws)} />}
      {awa && (
        <HelmTile label="AWA" value={fmtAngleSigned(awa)} unit="°" small tMs={sampleTs(awa)} />
      )}
      {tbsSample && (
        <HelmTile
          label="TBS"
          value={fmtSpeed(tbsSample)}
          unit="kn"
          small
          tMs={sampleTs(tbsSample)}
        />
      )}
      {tTwaSample && (
        <HelmTile
          label="Target TWA"
          value={fmtAngleSigned(tTwaSample)}
          unit="°"
          small
          tMs={sampleTs(tTwaSample)}
        />
      )}
      {pctPolar !== null && (
        <HelmTile
          label="% polar"
          value={pctPolar.toFixed(0)}
          unit="%"
          small
          tMs={sampleTs(pctPolarSample)}
        />
      )}

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
        tMs={sampleTs(timeInGrooveSample)}
      />
      <HelmTile
        label="VMG eff"
        value={vmgEff === null ? '—' : vmgEff.toFixed(0)}
        unit={vmgEff === null ? undefined : '%'}
        severity={vmgEff === null ? 'neutral' : vmgEff >= 98 ? 'good' : vmgEff >= 90 ? 'ok' : 'bad'}
        tMs={sampleTs(vmgEffSample)}
      />
      <HelmTile
        label={helmSource === 'autopilot' ? 'Pilot activity' : 'Helm steadiness'}
        value={twaSteadiness === null ? '—' : (twaSteadiness * RAD_TO_DEG).toFixed(1)}
        unit={twaSteadiness === null ? undefined : '°'}
        severity="neutral"
        small
        tMs={sampleTs(twaSteadinessSample)}
      >
        {steeringEffort !== null && (
          <div className="text-xs text-ink-3">{steeringEffort.toFixed(1)} corr·min⁻¹</div>
        )}
      </HelmTile>

      <HelmTile label="Heel" value={fmtAngleSigned(heel)} unit="°" small tMs={sampleTs(heel)} />
      <HelmTile label="Pitch" value={fmtAngleSigned(pitch)} unit="°" small tMs={sampleTs(pitch)} />
      <SailRecommendationTile />
    </div>
  );
}
