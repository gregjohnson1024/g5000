'use client';
import { useEffect, useState } from 'react';

type Mode = 'unknown' | 'live' | 'offline';

export function StatusBadge() {
  const [mode, setMode] = useState<Mode>('unknown');
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const r = await fetch('/api/live/polar', { signal: AbortSignal.timeout(3000) });
        if (cancelled) return;
        setMode(r.ok ? 'live' : 'offline');
      } catch {
        if (!cancelled) setMode('offline');
      }
    };
    check();
    const id = setInterval(check, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  const color =
    mode === 'live' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-700'
    : mode === 'offline' ? 'bg-amber-500/20 text-amber-300 border-amber-700'
    : 'bg-slate-700/40 text-slate-300 border-slate-700';
  const label =
    mode === 'live' ? 'Live: g5000 onboard ✓'
    : mode === 'offline' ? 'Offline 🌐'
    : 'Checking…';
  return (
    <span className={`text-xs px-2 py-1 border rounded ${color}`}>{label}</span>
  );
}
