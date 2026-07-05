import type { JsonSafeSample } from '@g5000/core';
import { fmtLatLonDmm } from '../../../lib/format-coords';
import { RAD_TO_DEG, wrap360, cardinal16 } from '../../../lib/units';

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
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-1 min-h-[100px]">
      <span className="text-xs uppercase tracking-wide text-slate-500 font-medium">Position</span>
      <div className="flex-1 flex flex-col justify-center gap-1">
        {posStr !== null ? (
          <span className="text-sm font-mono text-slate-100 break-all">{posStr}</span>
        ) : (
          <span className="text-slate-700 text-xs italic">—</span>
        )}
        {hdgStr !== null ? (
          <div className="flex items-baseline gap-1">
            <span className="text-sm font-semibold text-slate-200">{hdgStr}</span>
            {cardinalStr && <span className="text-xs text-slate-400">{cardinalStr}</span>}
          </div>
        ) : (
          <span className="text-slate-700 text-xs italic">—</span>
        )}
      </div>
    </div>
  );
}
