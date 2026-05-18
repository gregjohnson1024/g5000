'use client';

import type { JsonSafeSample } from '@g5000/core';
import { useSse } from '../hooks/use-sse';
import { HelmTile } from '../app/helm/HelmTile';

const MS_TO_KN = 1 / 0.514444;
const RAD_TO_DEG = 180 / Math.PI;

function scalar(s: JsonSafeSample | undefined): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

function enumStr(s: JsonSafeSample | undefined): string | null {
  if (!s || s.value.kind !== 'enum') return null;
  return s.value.value;
}

export function RaceTiles(): React.ReactElement {
  const { channels } = useSse();
  const dtl = scalar(channels.get('race.line.distanceToLine'));
  const ttl = scalar(channels.get('race.line.timeToLine'));
  const bias = scalar(channels.get('race.line.bias'));
  const ocs = enumStr(channels.get('race.line.ocsPredicted'));
  const vmcMs = scalar(channels.get('race.vmc'));

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3">
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
        sub={
          bias === null
            ? undefined
            : bias > 0
              ? 'port favored'
              : bias < 0
                ? 'stbd favored'
                : 'square'
        }
      />
      <HelmTile
        label="OCS"
        value={ocs ?? '—'}
        unit=""
        sub={ocs === 'OCS' ? 'over early!' : ocs === 'OK' ? 'clear' : undefined}
      />
      <HelmTile
        label="VMC"
        value={vmcMs === null ? '—' : (vmcMs * MS_TO_KN).toFixed(1)}
        unit="kn"
        sub={vmcMs === null ? 'no mark' : vmcMs >= 0 ? 'closing' : 'opening'}
      />
    </div>
  );
}
