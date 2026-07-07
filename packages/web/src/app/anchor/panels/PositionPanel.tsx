import type { JsonSafeSample } from '@g5000/core';
import { fmtLatLonDmm } from '../../../lib/coords';
import { RAD_TO_DEG, wrap360, cardinal16 } from '../../../lib/units';
import { Panel } from '../../../components/ui/Panel';

function scalar(s: JsonSafeSample | undefined): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

function geo(s: JsonSafeSample | undefined): { lat: number; lon: number } | null {
  if (!s || s.value.kind !== 'geo') return null;
  return s.value.value;
}

export function PositionPanel({
  channels,
}: {
  channels: ReadonlyMap<string, JsonSafeSample>;
}): React.ReactElement {
  const position = geo(channels.get('nav.gps.position'));
  const hdgRadMag = scalar(channels.get('boat.heading.magnetic'));
  const hdgRadTrue = scalar(channels.get('boat.heading.true'));
  const hdgRad = hdgRadMag ?? hdgRadTrue;

  const posStr = position ? fmtLatLonDmm(position.lat, position.lon) : null;

  let hdgStr: string | null = null;
  let cardinalStr: string | null = null;
  if (hdgRad !== null) {
    const deg = wrap360(hdgRad * RAD_TO_DEG);
    hdgStr = `${String(Math.round(deg)).padStart(3, '0')}°`;
    cardinalStr = cardinal16(deg);
  }

  return (
    <Panel label="Position">
      <div className="flex flex-col justify-center gap-1">
        {posStr !== null ? (
          <span className="text-sm font-mono text-ink-value break-all">{posStr}</span>
        ) : (
          <span className="text-ink-4 text-xs italic">—</span>
        )}
        {hdgStr !== null ? (
          <div className="flex items-baseline gap-1">
            <span className="text-sm font-semibold text-ink">{hdgStr}</span>
            {cardinalStr && <span className="text-xs text-ink-3">{cardinalStr}</span>}
          </div>
        ) : (
          <span className="text-ink-4 text-xs italic">—</span>
        )}
      </div>
    </Panel>
  );
}
