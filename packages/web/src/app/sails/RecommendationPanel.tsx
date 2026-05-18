'use client';

import { useEffect, useState } from 'react';
import type { SailWardrobe } from '@g5000/db';
import { getConfigColor } from '../../lib/config-color';

interface SailRecommendation {
  recommendedConfigId: string | null;
  activeConfigId: string;
  cellTwsIdx: number;
  cellTwaIdx: number;
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

function nameOf(wardrobe: SailWardrobe, id: string | null): string {
  if (!id) return '—';
  return wardrobe.configs.find((c) => c.id === id)?.name ?? id;
}

export function RecommendationPanel({ wardrobe }: { wardrobe: SailWardrobe }) {
  const rec = useRecommendation();
  useTick(5_000);
  if (!rec) {
    return (
      <div className="rounded border border-slate-700 bg-slate-900 p-4 text-sm text-slate-400">
        Waiting for wind…
      </div>
    );
  }
  const active = nameOf(wardrobe, rec.activeConfigId);
  const recommended = nameOf(wardrobe, rec.recommendedConfigId);
  const sameAsActive = rec.recommendedConfigId === rec.activeConfigId;
  const elapsedSec = Math.floor(Date.now() / 1000) - rec.enteredAt;
  const shouldChange =
    rec.recommendedConfigId !== null && !sameAsActive && elapsedSec >= rec.stableSeconds;

  let frame = 'border-slate-700';
  if (shouldChange) frame = 'border-rose-600';
  else if (!sameAsActive && rec.recommendedConfigId) frame = 'border-amber-600';

  return (
    <div className={`rounded border bg-slate-900 p-4 ${frame}`}>
      <div className="text-xs uppercase tracking-wider text-slate-500">Sail recommendation</div>
      <div className="mt-2 flex items-center gap-3">
        <span
          aria-hidden
          className="inline-block h-4 w-4 rounded"
          style={{
            background: rec.recommendedConfigId ? getConfigColor(rec.recommendedConfigId) : '#475569',
          }}
        />
        <div className="text-lg text-slate-100">{recommended}</div>
      </div>
      <div className="mt-1 text-xs text-slate-400">
        Active: <span className="text-slate-200">{active}</span>
      </div>
      <div className="mt-1 text-xs text-slate-500">
        Cell: TWS bin {rec.cellTwsIdx} × TWA bin {rec.cellTwaIdx} · stable {elapsedSec}s / {rec.stableSeconds}s
      </div>
      {shouldChange && (
        <div className="mt-2 text-sm text-rose-300">Change recommended — switch active config.</div>
      )}
    </div>
  );
}
