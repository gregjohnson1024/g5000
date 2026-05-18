'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getConfigColor } from '../../lib/config-color';

interface SailRecommendation {
  recommendedConfigId: string | null;
  activeConfigId: string;
  enteredAt: number;
  stableSeconds: number;
}

function useRecommendation(): SailRecommendation | null {
  const [rec, setRec] = useState<SailRecommendation | null>(null);
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as { channel: string; sample: { value: unknown } };
        if (parsed.channel === 'sail.recommendation') {
          setRec(parsed.sample.value as SailRecommendation);
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);
  return rec;
}

// Re-render every 5 s so the maturation timer's UI state stays fresh even
// when no new sail.recommendation event arrives.
function useTick(intervalMs: number): void {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

export function SailRecommendationTile() {
  const rec = useRecommendation();
  useTick(5_000);
  const id = rec?.recommendedConfigId ?? null;
  const color = id ? getConfigColor(id) : '#475569';
  const sameAsActive = rec ? id === rec.activeConfigId : true;
  const elapsedSec = rec ? Math.floor(Date.now() / 1000) - rec.enteredAt : 0;
  const shouldChange = rec
    ? id !== null && !sameAsActive && elapsedSec >= rec.stableSeconds
    : false;
  let border = 'border-slate-700';
  if (shouldChange) border = 'border-rose-600';
  else if (id && !sameAsActive) border = 'border-amber-600';

  return (
    <Link
      href="/sails/crossover"
      className={`block rounded border ${border} bg-slate-900 p-3 hover:bg-slate-800`}
    >
      <div className="text-xs uppercase tracking-wider text-slate-500">Sail</div>
      <div className="mt-1 flex items-center gap-2">
        <span aria-hidden className="inline-block h-3 w-3 rounded" style={{ background: color }} />
        <div className="text-sm text-slate-100">{id ?? '—'}</div>
      </div>
      {shouldChange && <div className="mt-1 text-xs text-rose-300">Change recommended</div>}
    </Link>
  );
}
