'use client';

import { useEffect, useState } from 'react';

export function RadarTab({ lat, lon }: { lat: number; lon: number }): React.ReactElement {
  // SSR-safe: assume online during initial render; correct in effect.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // Apply the real browser state after hydration.
    setOnline(navigator.onLine);
    const handleOnline = (): void => setOnline(true);
    const handleOffline = (): void => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!online) {
    return (
      <div className="flex items-center justify-center h-full min-h-[80px] text-slate-500 text-xs italic">
        No connection — weather radar needs internet
      </div>
    );
  }

  const src =
    `https://embed.windy.com/embed2.html` +
    `?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}` +
    `&zoom=8&level=surface&overlay=radar&menu=false&message=false` +
    `&marker=false&calendar=now&pressure=false&type=map&location=coordinates` +
    `&detail=false&metricWind=kt&metricTemp=%C2%B0C&radarRange=-1`;

  return (
    <iframe
      src={src}
      title="Weather radar"
      className="w-full border-0 rounded"
      style={{ height: '180px' }}
      allowFullScreen
      loading="lazy"
    />
  );
}
