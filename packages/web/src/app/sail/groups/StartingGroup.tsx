'use client';

import type { JsonSafeSample } from '@g5000/core';
import { CellGrid } from '../../../components/ui/CellGrid';
import { scalar, enumVal, sampleTs } from '../tile-helpers';
import { RAD_TO_DEG } from '../../../lib/units';

/** Starting tab: pre-start line work + timer. */
export function StartingGroup({
  channels,
}: {
  channels: ReadonlyMap<string, JsonSafeSample>;
}): React.ReactElement {
  const dtlSample = channels.get('race.line.distanceToLine');
  const ttlSample = channels.get('race.line.timeToLine');
  const biasSample = channels.get('race.line.bias');
  const ocsSample = channels.get('race.line.ocsPredicted');
  const shiftSample = channels.get('race.windShift.bias');

  const dtl = scalar(dtlSample);
  const ttl = scalar(ttlSample);
  const bias = scalar(biasSample);
  const ocs = enumVal(ocsSample);
  const shift = scalar(shiftSample);

  return (
    <CellGrid
      cols={{ base: 2, md: 3 }}
      cells={[
        {
          key: 'dtl',
          label: 'DTL',
          value: dtl === null ? '—' : Math.abs(dtl).toFixed(0),
          unit: dtl === null ? undefined : 'm',
          sub: dtl === null ? undefined : dtl >= 0 ? 'pre-start' : 'past line',
          tMs: sampleTs(dtlSample),
        },
        {
          key: 'ttl',
          label: 'TTL',
          value: ttl === null ? '—' : Math.round(ttl).toString(),
          unit: ttl === null ? undefined : 's',
          tMs: sampleTs(ttlSample),
        },
        {
          key: 'bias',
          label: 'Bias',
          value: bias === null ? '—' : `${bias >= 0 ? '+' : ''}${(bias * RAD_TO_DEG).toFixed(0)}`,
          unit: bias === null ? undefined : '°',
          sub:
            bias === null
              ? undefined
              : bias > 0
                ? 'port favored'
                : bias < 0
                  ? 'stbd favored'
                  : 'square',
          tMs: sampleTs(biasSample),
        },
        {
          key: 'ocs',
          label: 'OCS',
          value: ocs ?? '—',
          sub: ocs === 'OCS' ? 'over early!' : ocs === 'OK' ? 'clear' : undefined,
          tMs: sampleTs(ocsSample),
        },
        {
          key: 'shift',
          label: 'Wind shift',
          value:
            shift === null ? '—' : `${shift >= 0 ? '+' : ''}${(shift * RAD_TO_DEG).toFixed(0)}`,
          unit: shift === null ? undefined : '°',
          sub:
            shift === null
              ? undefined
              : shift > 0
                ? 'veer (right)'
                : shift < 0
                  ? 'back (left)'
                  : 'steady',
          tMs: sampleTs(shiftSample),
        },
      ]}
    />
  );
}
