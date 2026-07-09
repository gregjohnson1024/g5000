'use client';

import { useEffect, useState } from 'react';
import type { JsonSafeSample } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';
import type { DepthOffsets } from '../../lib/depth-offset';

/**
 * Shared plumbing for the ANCHOR section pages: live SSE channels, the GPS
 * fix, and the anchor-dashboard settings (weather pin, rode geometry).
 * Extracted from the old single-page-plus-drawer layout so each sub-tab
 * route can source the same inputs the drawer used to thread down.
 */

export interface AnchorDashboardConfig {
  bowHeightM?: number;
  droopDeductM?: number;
  depthOffsets?: {
    keelBelowTransducerM?: number;
    transducerToWaterlineM?: number;
  };
  weatherPin?: { lat: number; lon: number } | null;
}

/** Fallback when no GPS fix has arrived yet (kept from the drawer). */
const DEFAULT_LAT = 32.3;
const DEFAULT_LON = -64.7;

function geoFromChannels(
  channels: ReadonlyMap<string, JsonSafeSample>,
): { lat: number; lon: number } | null {
  const s = channels.get('nav.gps.position');
  if (!s || s.value.kind !== 'geo') return null;
  return s.value.value;
}

export interface AnchorContext {
  channels: ReadonlyMap<string, JsonSafeSample>;
  connected: boolean;
  /** Raw GPS fix, null before the first sample. */
  position: { lat: number; lon: number } | null;
  /** GPS with the offshore fallback — for tabs that want the boat itself (radar). */
  gpsLat: number;
  gpsLon: number;
  /** Weather-pin override if set, else GPS — for forecast/tides/sky tabs. */
  wxLat: number;
  wxLon: number;
  depthOffsets: DepthOffsets;
  bowHeightM: number;
  droopDeductM: number;
}

export function useAnchorContext(): AnchorContext {
  const { channels, connected } = useSse();
  const position = geoFromChannels(channels);
  const [cfg, setCfg] = useState<AnchorDashboardConfig>({});

  useEffect(() => {
    void fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && j.settings?.anchorDashboard) {
          setCfg(j.settings.anchorDashboard as AnchorDashboardConfig);
        }
      })
      .catch(() => {});
  }, []);

  const gpsLat = position?.lat ?? DEFAULT_LAT;
  const gpsLon = position?.lon ?? DEFAULT_LON;
  const weatherPin = cfg.weatherPin ?? null;

  return {
    channels,
    connected,
    position,
    gpsLat,
    gpsLon,
    wxLat: weatherPin?.lat ?? gpsLat,
    wxLon: weatherPin?.lon ?? gpsLon,
    depthOffsets: cfg.depthOffsets ?? {},
    bowHeightM: cfg.bowHeightM ?? 0,
    droopDeductM: cfg.droopDeductM ?? 0,
  };
}
