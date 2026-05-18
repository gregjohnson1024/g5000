'use client';

import { useEffect, useState } from 'react';
import type { SailWardrobe } from '@g5000/db';
import { getConfigColor } from '../../lib/config-color';

interface Recommendation {
  recommendedConfigId: string | null;
  recommendedSpeedKn: number | null;
  activeConfigId: string;
  activeSpeedKn: number | null;
  gapPercent: number;
  shouldChange: boolean;
  stale: boolean;
}

/** Subscribes to /api/stream filtered to wardrobe.recommendation. */
function useRecommendation(): Recommendation | null {
  const [rec, setRec] = useState<Recommendation | null>(null);
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      try {
        const sample = JSON.parse(e.data) as { channel: string; value: unknown };
        if (sample.channel === 'wardrobe.recommendation') {
          setRec(sample.value as Recommendation);
        }
      } catch {
        /* ignore malformed lines */
      }
    };
    return () => es.close();
  }, []);
  return rec;
}

function nameOf(wardrobe: SailWardrobe, id: string | null): string {
  if (!id) return '—';
  return wardrobe.configs.find((c) => c.id === id)?.name ?? id;
}

export function RecommendationPanel({ wardrobe }: { wardrobe: SailWardrobe }) {
  const rec = useRecommendation();

  if (!rec) {
    return (
      <div className="rounded border border-slate-700 bg-slate-900 p-4">
        <div className="text-xs text-slate-500">SAIL RECOMMENDATION</div>
        <div className="mt-1 text-slate-400 italic">Waiting for live wind…</div>
      </div>
    );
  }

  const recName = nameOf(wardrobe, rec.recommendedConfigId);
  const actName = nameOf(wardrobe, rec.activeConfigId);
  const recColor = rec.recommendedConfigId ? getConfigColor(rec.recommendedConfigId) : '#888';
  const actColor = getConfigColor(rec.activeConfigId);

  let border = 'border-slate-700';
  let label = 'in sync';
  if (rec.stale) {
    border = 'border-slate-600 opacity-60';
    label = 'stale wind';
  } else if (rec.shouldChange) {
    border = 'border-rose-600';
    label = `change recommended (+${rec.gapPercent.toFixed(1)}%)`;
  } else if (rec.recommendedConfigId !== rec.activeConfigId) {
    border = 'border-amber-600';
    label = `under threshold (+${rec.gapPercent.toFixed(1)}%)`;
  }

  return (
    <div className={`rounded border ${border} bg-slate-900 p-4 space-y-2`}>
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">SAIL RECOMMENDATION</div>
        <div className="text-xs text-slate-400">{label}</div>
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs text-slate-500">Active</div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: actColor }} />
            <span className="font-mono text-slate-100">{actName}</span>
          </div>
          <div className="text-xs text-slate-400">
            {rec.activeSpeedKn !== null ? `${rec.activeSpeedKn.toFixed(2)} kn` : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Recommended</div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: recColor }} />
            <span className="font-mono text-slate-100">{recName}</span>
          </div>
          <div className="text-xs text-slate-400">
            {rec.recommendedSpeedKn !== null ? `${rec.recommendedSpeedKn.toFixed(2)} kn` : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}
