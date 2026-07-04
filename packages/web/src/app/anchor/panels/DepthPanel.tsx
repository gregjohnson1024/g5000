import type { JsonSafeSample } from '@g5000/core';
import { deriveDepths, type DepthOffsets } from '../../../lib/depth-offset';

function scalar(s: JsonSafeSample | undefined): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

export function DepthPanel({
  channels,
  offsets,
}: {
  channels: ReadonlyMap<string, JsonSafeSample>;
  offsets: DepthOffsets;
}): React.ReactElement {
  const sounderM = scalar(channels.get('nav.depth'));
  const hasOffsets = offsets.keelBelowTransducerM != null || offsets.transducerToWaterlineM != null;

  if (sounderM === null) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-1 min-h-[100px]">
        <span className="text-xs uppercase tracking-wide text-slate-500 font-medium">Depth</span>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-slate-700 text-xs italic">—</span>
        </div>
      </div>
    );
  }

  const depths = deriveDepths(sounderM, offsets);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-1 min-h-[100px]">
      <span className="text-xs uppercase tracking-wide text-slate-500 font-medium">Depth</span>
      {hasOffsets && depths.underKeelM !== null ? (
        <div className="flex-1 flex flex-col justify-center gap-0.5">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-semibold text-slate-100 tabular-nums">
              {depths.underKeelM.toFixed(1)}
            </span>
            <span className="text-xs text-slate-400">m</span>
          </div>
          <span className="text-xs text-slate-500 uppercase tracking-wide">Under keel</span>
          {depths.totalM !== null && (
            <span className="text-xs text-slate-400">{depths.totalM.toFixed(1)} m total depth</span>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-center gap-0.5">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-semibold text-slate-100 tabular-nums">
              {depths.sounderM.toFixed(1)}
            </span>
            <span className="text-xs text-slate-400">m</span>
          </div>
          <span className="text-xs text-slate-500 uppercase tracking-wide">Depth</span>
        </div>
      )}
    </div>
  );
}
