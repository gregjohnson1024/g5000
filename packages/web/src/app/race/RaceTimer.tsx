'use client';

import { useCallback, useEffect, useState } from 'react';

interface TimerSnap {
  startMs: number | null;
  state: 'idle' | 'pre-start' | 'started' | 'finished';
}

function fmt(secs: number): string {
  const sign = secs < 0 ? '-' : '';
  const a = Math.abs(secs);
  const m = Math.floor(a / 60);
  const s = Math.floor(a % 60);
  return `${sign}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function RaceTimer(): React.ReactElement {
  const [timer, setTimer] = useState<TimerSnap>({ startMs: null, state: 'idle' });
  const [nowMs, setNowMs] = useState<number>(Date.now());

  // Pull RaceState every 1 s.
  useEffect(() => {
    let stopped = false;
    async function poll(): Promise<void> {
      try {
        const r = await fetch('/api/race/state', { cache: 'no-store' });
        if (stopped || !r.ok) return;
        const j = await r.json();
        setTimer({ startMs: j.timer.startMs, state: j.timer.state });
      } catch {
        /* tick again */
      }
    }
    void poll();
    const id = setInterval(poll, 1000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  // Sub-second display: re-render every 100 ms while a startMs is set.
  useEffect(() => {
    if (timer.startMs === null) return;
    const id = setInterval(() => setNowMs(Date.now()), 100);
    return () => clearInterval(id);
  }, [timer.startMs]);

  const post = useCallback(async (body: unknown) => {
    await fetch('/api/race/timer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }, []);

  const secsToGun = timer.startMs === null ? null : Math.round((timer.startMs - nowMs) / 1000);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-6 flex flex-col items-center gap-4">
      <div className="text-xs uppercase tracking-wider text-slate-400">
        Race timer · {timer.state}
      </div>
      <div className="text-7xl font-mono text-slate-100 leading-none tabular-nums">
        {secsToGun === null ? '--:--' : fmt(secsToGun)}
      </div>
      <div className="flex gap-2 flex-wrap justify-center">
        {timer.state === 'idle' && (
          <>
            <button
              type="button"
              onClick={() => void post({ action: 'start', offsetSec: 300 })}
              className="px-4 py-2 rounded bg-emerald-700 hover:bg-emerald-600 text-white"
            >
              Start 5:00
            </button>
            <button
              type="button"
              onClick={() => void post({ action: 'start', offsetSec: 600 })}
              className="px-4 py-2 rounded bg-emerald-800 hover:bg-emerald-700 text-white"
            >
              Start 10:00
            </button>
          </>
        )}
        {timer.state !== 'idle' && (
          <>
            <button
              type="button"
              onClick={() => void post({ action: 'sync', adjustSec: 60 })}
              className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
            >
              +1 min
            </button>
            <button
              type="button"
              onClick={() => void post({ action: 'sync', adjustSec: -60 })}
              className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
            >
              -1 min
            </button>
            <button
              type="button"
              onClick={() => void post({ action: 'sync', adjustSec: 10 })}
              className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
            >
              +10 s
            </button>
            <button
              type="button"
              onClick={() => void post({ action: 'sync', adjustSec: -10 })}
              className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
            >
              -10 s
            </button>
            <button
              type="button"
              onClick={() => void post({ action: 'reset' })}
              className="px-3 py-2 rounded bg-red-800 hover:bg-red-700 text-white"
            >
              Reset
            </button>
          </>
        )}
      </div>
    </div>
  );
}
