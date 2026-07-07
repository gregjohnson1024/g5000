'use client';

import type { JsonSafeSample } from '@g5000/core';
import { CellGrid } from '../../../components/ui/CellGrid';
import type { CellSpec } from '../../../components/ui/CellGrid';
import { SailRecommendationTile } from '../SailRecommendationTile';
import { scalar, enumVal, fmtSpeed, fmtAngleSigned, sampleTs } from '../tile-helpers';
import { RAD_TO_DEG } from '../../../lib/units';

/** Performance tab: wind, polar targets, groove, trim, sail recommendation.
 *
 * All slots are FIXED — absent channels render '—', no tile ever collapses
 * (zero-reflow law, mirrors NavigatingGroup's stable-slot exemplar).
 */
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

  // Fixed-slot cells — absent = '—', no reflow.
  const cells: CellSpec[] = [
    // Slot 0 — TWA
    {
      key: 'twa',
      label: 'TWA',
      value: fmtAngleSigned(twa),
      unit: twa ? '°' : undefined,
      tMs: sampleTs(twa),
    },
    // Slot 1 — AWS
    {
      key: 'aws',
      label: 'AWS',
      value: fmtSpeed(aws),
      unit: aws ? 'kn' : undefined,
      small: true,
      tMs: sampleTs(aws),
    },
    // Slot 2 — AWA
    {
      key: 'awa',
      label: 'AWA',
      value: fmtAngleSigned(awa),
      unit: awa ? '°' : undefined,
      small: true,
      tMs: sampleTs(awa),
    },
    // Slot 3 — TBS (target boat speed)
    {
      key: 'tbs',
      label: 'TBS',
      value: fmtSpeed(tbsSample),
      unit: tbsSample ? 'kn' : undefined,
      small: true,
      tMs: sampleTs(tbsSample),
    },
    // Slot 4 — Target TWA
    {
      key: 'targetTwa',
      label: 'Target TWA',
      value: fmtAngleSigned(tTwaSample),
      unit: tTwaSample ? '°' : undefined,
      small: true,
      tMs: sampleTs(tTwaSample),
    },
    // Slot 5 — % Polar
    {
      key: 'pctPolar',
      label: '% Polar',
      value: pctPolar !== null ? pctPolar.toFixed(0) : '—',
      unit: pctPolar !== null ? '%' : undefined,
      small: true,
      tMs: sampleTs(pctPolarSample),
    },
    // Slot 6 — In groove
    {
      key: 'inGroove',
      label: 'In groove',
      value: timeInGroove === null ? '—' : timeInGroove.toFixed(0),
      unit: timeInGroove === null ? undefined : '%',
      severity:
        timeInGroove === null
          ? 'neutral'
          : timeInGroove >= 80
            ? 'good'
            : timeInGroove >= 50
              ? 'ok'
              : 'bad',
      sub: pointOfSail ?? undefined,
      tMs: sampleTs(timeInGrooveSample),
    },
    // Slot 7 — VMG efficiency
    {
      key: 'vmgEff',
      label: 'VMG eff',
      value: vmgEff === null ? '—' : vmgEff.toFixed(0),
      unit: vmgEff === null ? undefined : '%',
      severity: vmgEff === null ? 'neutral' : vmgEff >= 98 ? 'good' : vmgEff >= 90 ? 'ok' : 'bad',
      tMs: sampleTs(vmgEffSample),
    },
    // Slot 8 — Helm steadiness / Pilot activity
    {
      key: 'steadiness',
      label: helmSource === 'autopilot' ? 'Pilot activity' : 'Helm steadiness',
      value: twaSteadiness === null ? '—' : (twaSteadiness * RAD_TO_DEG).toFixed(1),
      unit: twaSteadiness === null ? undefined : '°',
      severity: 'neutral',
      small: true,
      tMs: sampleTs(twaSteadinessSample),
      children:
        steeringEffort !== null ? (
          <div className="text-xs text-ink-3">{steeringEffort.toFixed(1)} corr·min⁻¹</div>
        ) : undefined,
    },
    // Slot 9 — Heel
    {
      key: 'heel',
      label: 'Heel',
      value: fmtAngleSigned(heel),
      unit: heel ? '°' : undefined,
      small: true,
      tMs: sampleTs(heel),
    },
    // Slot 10 — Pitch
    {
      key: 'pitch',
      label: 'Pitch',
      value: fmtAngleSigned(pitch),
      unit: pitch ? '°' : undefined,
      small: true,
      tMs: sampleTs(pitch),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <CellGrid cols={{ base: 2, md: 3 }} cells={cells} />
      <SailRecommendationTile />
    </div>
  );
}
