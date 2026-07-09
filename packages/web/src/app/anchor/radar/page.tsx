'use client';

import { RadarTab } from '../tabs/RadarTab';
import { useAnchorContext } from '../use-anchor-context';

export default function AnchorRadarPage() {
  const { gpsLat, gpsLon } = useAnchorContext();

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-ink mb-3">Radar</h1>
      <RadarTab lat={gpsLat} lon={gpsLon} />
    </main>
  );
}
