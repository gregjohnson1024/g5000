'use client';

import { TidesTab } from '../tabs/TidesTab';
import { useAnchorContext } from '../use-anchor-context';

export default function AnchorTidesPage() {
  const { wxLat, wxLon } = useAnchorContext();

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-ink mb-3">Tides</h1>
      <TidesTab lat={wxLat} lon={wxLon} />
    </main>
  );
}
