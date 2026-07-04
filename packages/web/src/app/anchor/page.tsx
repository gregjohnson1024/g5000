'use client';

import type { JsonSafeSample } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';
import { AnchorDrawer } from './drawer';
import { DepthPanel } from './panels/DepthPanel';
import { PositionPanel } from './panels/PositionPanel';
import { NearbyVesselsPanel } from './panels/NearbyVesselsPanel';
import { WindDial } from './panels/WindDial';
import type { DepthOffsets } from '../../lib/depth-offset';

const PLACEHOLDER_PANELS = ['Anchor Watch', 'Today & Now', 'Systems'] as const;

type PlaceholderName = (typeof PLACEHOLDER_PANELS)[number];

/** Placeholder panel card — later tasks swap the children for real content. */
function PanelCard({
  title,
  channels: _channels,
}: {
  title: PlaceholderName;
  channels: ReadonlyMap<string, JsonSafeSample>;
}): React.ReactElement {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-1 min-h-[100px]">
      <span className="text-xs uppercase tracking-wide text-slate-500 font-medium">{title}</span>
      <div className="flex-1 flex items-center justify-center">
        <span className="text-slate-700 text-xs italic">—</span>
      </div>
    </div>
  );
}

// Task 21 will wire the real offsets from ConfigStore; pass empty for now.
const DEPTH_OFFSETS: DepthOffsets = {};

export default function AnchorPage(): React.ReactElement {
  const { channels, connected } = useSse();

  return (
    // pb-24 leaves room for the fixed drawer (tab bar ~44px + content panel up to 224px)
    <main className="p-4 flex-1 overflow-y-auto bg-black pb-24">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-300">Anchor</h1>
        <div className="text-xs text-slate-500">{connected ? 'Live' : 'Reconnecting…'}</div>
      </div>

      {/* Top-zone panel grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {/* WindDial spans 2 cols so the circular dial has room */}
        <div className="col-span-2">
          <WindDial channels={channels} />
        </div>
        <DepthPanel channels={channels} offsets={DEPTH_OFFSETS} />
        <PositionPanel channels={channels} />
        <NearbyVesselsPanel channels={channels} />
        {PLACEHOLDER_PANELS.map((name) => (
          <PanelCard key={name} title={name} channels={channels} />
        ))}
      </div>

      {/* Fixed slide-up drawer at bottom */}
      <AnchorDrawer />
    </main>
  );
}
