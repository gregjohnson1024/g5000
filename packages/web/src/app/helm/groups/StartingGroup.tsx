'use client';

import type { JsonSafeSample } from '@g5000/core';
import { HelmTile } from '../HelmTile';
import { RaceMiniTimer } from '../RaceMiniTimer';
import { scalar, enumVal } from '../tile-helpers';
import { RAD_TO_DEG } from '../../../lib/units';

/** Starting tab: pre-start line work + timer. */
export function StartingGroup({
  channels,
}: {
  channels: ReadonlyMap<string, JsonSafeSample>;
}): React.ReactElement {
  const dtl = scalar(channels.get('race.line.distanceToLine'));
  const ttl = scalar(channels.get('race.line.timeToLine'));
  const bias = scalar(channels.get('race.line.bias'));
  const ocs = enumVal(channels.get('race.line.ocsPredicted'));
  const shift = scalar(channels.get('race.windShift.bias'));

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <div className="col-span-2 md:col-span-3">
        <RaceMiniTimer />
      </div>
      <HelmTile
        label="DTL"
        value={dtl === null ? '—' : Math.abs(dtl).toFixed(0)}
        unit="m"
        sub={dtl === null ? undefined : dtl >= 0 ? 'pre-start' : 'past line'}
      />
      <HelmTile label="TTL" value={ttl === null ? '—' : Math.round(ttl).toString()} unit="s" />
      <HelmTile
        label="Bias"
        value={bias === null ? '—' : `${bias >= 0 ? '+' : ''}${(bias * RAD_TO_DEG).toFixed(0)}`}
        unit="°"
        sub={bias === null ? undefined : bias > 0 ? 'port favored' : bias < 0 ? 'stbd favored' : 'square'}
      />
      <HelmTile
        label="OCS"
        value={ocs ?? '—'}
        sub={ocs === 'OCS' ? 'over early!' : ocs === 'OK' ? 'clear' : undefined}
      />
      <HelmTile
        label="Wind shift"
        value={shift === null ? '—' : `${shift >= 0 ? '+' : ''}${(shift * RAD_TO_DEG).toFixed(0)}`}
        unit="°"
        sub={shift === null ? undefined : shift > 0 ? 'veer (right)' : shift < 0 ? 'back (left)' : 'steady'}
      />
    </div>
  );
}
