'use client';

import { ForecastGraphTab } from '../tabs/ForecastGraphTab';
import { ForecastTableTab } from '../tabs/ForecastTableTab';
import { useAnchorContext } from '../use-anchor-context';

export default function AnchorForecastPage() {
  const { wxLat, wxLon } = useAnchorContext();

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-ink mb-3">Forecast</h1>
      <div className="space-y-6">
        <ForecastGraphTab lat={wxLat} lon={wxLon} />
        <ForecastTableTab lat={wxLat} lon={wxLon} />
      </div>
    </main>
  );
}
