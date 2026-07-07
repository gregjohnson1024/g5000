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
      <div className="flex flex-col items-center justify-center min-h-[80px] gap-1">
        <span className="text-ink-4 text-lg font-medium select-none">—</span>
        <span className="text-[0.722rem] text-ink-4 italic">
          No connection — weather radar needs internet
        </span>
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
