'use client';

import { useEffect, useState } from 'react';

function fmt(secs: number): string {
  const sign = secs < 0 ? '-' : '';
  const a = Math.abs(secs);
  const m = Math.floor(a / 60);
  const s = Math.floor(a % 60);
  return `${sign}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function RaceMiniTimer(): React.ReactElement | null {
  const [startMs, setStartMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  useEffect(() => {
    let stopped = false;
    async function poll(): Promise<void> {
      try {
        const r = await fetch('/api/race/state', { cache: 'no-store' });
        if (stopped || !r.ok) return;
        const j = await r.json();
        setStartMs(j.timer.startMs);
      } catch { /* retry */ }
    }
    void poll();
    const id = setInterval(poll, 1000);
    return () => { stopped = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (startMs === null) return;
    const id = setInterval(() => setNowMs(Date.now()), 200);
    return () => clearInterval(id);
  }, [startMs]);

  if (startMs === null) return null;
  const secs = Math.round((startMs - nowMs) / 1000);
  const danger = secs <= 10 && secs >= 0;
  return (
    <a
      href="/race"
      className={`text-xs font-mono px-2 py-1 rounded ${danger ? 'bg-red-700 text-white' : 'bg-slate-800 text-slate-300'}`}
      title="Race countdown — open /race"
    >
      ⏱ {fmt(secs)}
    </a>
  );
}
