'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getConfigColor } from '../../lib/config-color';

interface Recommendation {
  recommendedConfigId: string | null;
  activeConfigId: string;
  shouldChange: boolean;
  gapPercent: number;
  stale: boolean;
}

function useRecommendation(): Recommendation | null {
  const [rec, setRec] = useState<Recommendation | null>(null);
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as {
          channel: string;
          sample: { value: unknown };
        };
        if (parsed.channel === 'wardrobe.recommendation') {
          setRec(parsed.sample.value as Recommendation);
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);
  return rec;
}

export function SailRecommendationTile() {
  const rec = useRecommendation();
  const name = rec?.recommendedConfigId ?? '—';
  const color = rec?.recommendedConfigId ? getConfigColor(rec.recommendedConfigId) : '#475569';

  let border = 'border-slate-700';
  if (rec?.stale) border = 'border-slate-600 opacity-60';
  else if (rec?.shouldChange) border = 'border-rose-600';
  else if (rec && rec.recommendedConfigId !== rec.activeConfigId) border = 'border-amber-600';

  return (
    <Link
      href="/sails"
      className={`block rounded border ${border} bg-slate-900 p-3 hover:bg-slate-800`}
    >
      <div className="text-[10px] uppercase tracking-wider text-slate-500">SAIL</div>
      <div className="flex items-center gap-2 mt-1">
        <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
        <span className="font-mono text-slate-100 truncate">{name}</span>
      </div>
      {rec?.shouldChange && !rec.stale && (
        <div className="text-[10px] text-rose-400 mt-1">▲ change (+{rec.gapPercent.toFixed(1)}%)</div>
      )}
    </Link>
  );
}
