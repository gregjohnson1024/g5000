import type { JsonSafeSample } from '@g5000/core';
import { deriveDepths, type DepthOffsets } from '../../../lib/depth-offset';
import { Panel } from '../../../components/ui/Panel';
import { InstrumentTile } from '../../../components/ui/InstrumentTile';

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
    return <Panel label="Depth" emptyState={{ reason: 'No depth data' }} />;
  }

  const depths = deriveDepths(sounderM, offsets);

  if (hasOffsets && depths.underKeelM !== null) {
    return (
      <Panel label="Depth">
        <InstrumentTile
          label="Under Keel"
          value={depths.underKeelM.toFixed(1)}
          unit="m"
          size="d3"
          className="border-0 rounded-none p-0 bg-transparent"
        >
          {depths.totalM !== null && (
            <span className="text-[0.722rem] text-ink-3">
              {depths.totalM.toFixed(1)} m total depth
            </span>
          )}
        </InstrumentTile>
      </Panel>
    );
  }

  return (
    <Panel label="Depth">
      <InstrumentTile
        label="Depth"
        value={depths.sounderM.toFixed(1)}
        unit="m"
        size="d3"
        className="border-0 rounded-none p-0 bg-transparent"
      />
    </Panel>
  );
}
