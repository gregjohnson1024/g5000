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
  // When no recommendation id: fall back to ink-4 token via CSS variable.
  const color = id ? getConfigColor(id) : 'var(--ink-4)';
  const sameAsActive = rec ? id === rec.activeConfigId : true;
  const elapsedSec = rec ? Math.floor(Date.now() / 1000) - rec.enteredAt : 0;
  const shouldChange = rec
    ? id !== null && !sameAsActive && elapsedSec >= rec.stableSeconds
    : false;

  // Severity-keyed border: danger = change needed, ok = pending, hairline-strong = idle
  let borderClass = 'border-hairline-strong';
  if (shouldChange) borderClass = 'border-danger';
  else if (id && !sameAsActive) borderClass = 'border-accent-ink';

  return (
    <Link
      href="/boat/crossover"
      className={`block [border-radius:var(--r-panel)] border ${borderClass} bg-surface p-3 hover:bg-surface-raised`}
    >
      <div className="text-[0.667rem] font-semibold uppercase tracking-[0.08em] text-ink-2">
        Sail
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span aria-hidden className="inline-block h-3 w-3 rounded" style={{ background: color }} />
        <div className="text-sm text-ink">{id ?? '—'}</div>
      </div>
      {shouldChange && <div className="mt-1 text-xs text-danger">Change recommended</div>}
    </Link>
  );
}
