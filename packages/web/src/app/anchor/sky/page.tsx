'use client';

import { SkyTab } from '../tabs/SkyTab';
import { useAnchorContext } from '../use-anchor-context';

export default function AnchorSkyPage() {
  const { wxLat, wxLon } = useAnchorContext();

  return (
    <main className="p-6 page-main">
      <h1 className="text-xl font-semibold text-ink mb-3">Sky</h1>
      <SkyTab lat={wxLat} lon={wxLon} />
    </main>
  );
}
