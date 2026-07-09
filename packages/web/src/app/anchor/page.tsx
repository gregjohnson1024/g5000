'use client';

import { useAnchorContext } from './use-anchor-context';
import { DepthPanel } from './panels/DepthPanel';
import { PositionPanel } from './panels/PositionPanel';
import { NearbyVesselsPanel } from './panels/NearbyVesselsPanel';
import { WindDial } from './panels/WindDial';
import { AnchorWatchPanel } from './panels/AnchorWatchPanel';
import { TodayNowPanel } from './panels/TodayNowPanel';
import { SystemsPanel } from './panels/SystemsPanel';

export default function AnchorPage(): React.ReactElement {
  const { channels, connected, depthOffsets, bowHeightM, droopDeductM, wxLat, wxLon } =
    useAnchorContext();

  return (
    <main className="p-4 flex-1 overflow-y-auto bg-canvas">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-ink">Anchor</h1>
        <div className="text-xs text-ink-3">{connected ? 'Live' : 'Reconnecting…'}</div>
      </div>

      {/* Top-zone panel grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {/* WindDial spans 2 cols so the circular dial has room */}
        <div className="col-span-2">
          <WindDial channels={channels} />
        </div>
        <DepthPanel channels={channels} offsets={depthOffsets} />
        <PositionPanel channels={channels} />
        <NearbyVesselsPanel channels={channels} />
        <AnchorWatchPanel channels={channels} bowHeightM={bowHeightM} droopDeduct={droopDeductM} />
        <TodayNowPanel channels={channels} weatherLat={wxLat} weatherLon={wxLon} />
        <SystemsPanel />
      </div>
    </main>
  );
}
