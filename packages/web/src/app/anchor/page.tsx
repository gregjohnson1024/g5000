'use client';

import { useEffect, useState } from 'react';
import type { JsonSafeSample } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';
import { AnchorDrawer } from './drawer';
import { DepthPanel } from './panels/DepthPanel';
import { PositionPanel } from './panels/PositionPanel';
import { NearbyVesselsPanel } from './panels/NearbyVesselsPanel';
import { WindDial } from './panels/WindDial';
import { AnchorWatchPanel } from './panels/AnchorWatchPanel';
import { TodayNowPanel } from './panels/TodayNowPanel';
import { SystemsPanel } from './panels/SystemsPanel';
import type { DepthOffsets } from '../../lib/depth-offset';

interface AnchorDashboardConfig {
  bowHeightM?: number;
  droopDeductM?: number;
  depthOffsets?: {
    keelBelowTransducerM?: number;
    transducerToWaterlineM?: number;
  };
  weatherPin?: { lat: number; lon: number } | null;
}

function geoFromChannels(
  channels: ReadonlyMap<string, JsonSafeSample>,
): { lat: number; lon: number } | null {
  const s = channels.get('nav.gps.position');
  if (!s || s.value.kind !== 'geo') return null;
  return s.value.value;
}

export default function AnchorPage(): React.ReactElement {
  const { channels, connected } = useSse();
  const position = geoFromChannels(channels);

  const [anchorCfg, setAnchorCfg] = useState<AnchorDashboardConfig>({});

  useEffect(() => {
    void fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && j.settings?.anchorDashboard) {
          setAnchorCfg(j.settings.anchorDashboard as AnchorDashboardConfig);
        }
      })
      .catch(() => {});
  }, []);

  const depthOffsets: DepthOffsets = anchorCfg.depthOffsets ?? {};
  const bowHeightM = anchorCfg.bowHeightM ?? 0;
  const droopDeductM = anchorCfg.droopDeductM ?? 0;

  // Weather pin: use the saved pin if set, otherwise fall through to GPS fix in child components.
  const weatherPin = anchorCfg.weatherPin ?? null;
  const wxLat = weatherPin?.lat ?? position?.lat ?? undefined;
  const wxLon = weatherPin?.lon ?? position?.lon ?? undefined;

  return (
    // pb-24 leaves room for the fixed drawer (tab bar ~44px + content panel up to 224px)
    <main className="p-4 flex-1 overflow-y-auto bg-canvas pb-24">
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
        <DepthPanel channels={channels} offsets={depthOffsets} />
        <PositionPanel channels={channels} />
        <NearbyVesselsPanel channels={channels} />
        <AnchorWatchPanel channels={channels} bowHeightM={bowHeightM} droopDeduct={droopDeductM} />
        <TodayNowPanel channels={channels} weatherLat={wxLat} weatherLon={wxLon} />
        <SystemsPanel />
      </div>

      {/* Fixed slide-up drawer at bottom — pass position for weather/forecast tabs */}
      <AnchorDrawer
        lat={position?.lat ?? null}
        lon={position?.lon ?? null}
        weatherLat={wxLat}
        weatherLon={wxLon}
      />
    </main>
  );
}
