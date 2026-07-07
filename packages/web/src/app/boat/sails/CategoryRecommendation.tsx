'use client';

import { useEffect, useState } from 'react';
import type { SailCategory, SailWardrobe } from '@g5000/db';

interface Rec {
  cellTwsKn: number;
  cellTwaDeg: number;
  valid: Record<SailCategory, string[]>;
  active: Partial<Record<SailCategory, string>>;
  changeNeeded: Record<SailCategory, boolean>;
}

export function CategoryRecommendation({ wardrobe }: { wardrobe: SailWardrobe }) {
  const [rec, setRec] = useState<Rec | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/stream?channels=sail.recommendation');
    es.addEventListener('message', (ev) => {
      try {
        const sample = JSON.parse(ev.data);
        if (sample.value?.kind === 'sail_recommendation') setRec(sample.value);
      } catch {
        // ignore parse error
      }
    });
    return () => es.close();
  }, []);

  const byId = new Map(wardrobe.sails.map((s) => [s.id, s] as const));
  const labels: Record<SailCategory, string> = {
    headsail: 'Headsail',
    main: 'Main',
    downwind: 'Downwind',
  };

  return (
    <div className="space-y-2">
      <h3 className="text-base font-medium">Recommendation</h3>
      {rec ? (
        <p className="text-xs text-ink-3">
          {rec.cellTwsKn} kn / {rec.cellTwaDeg}°
        </p>
      ) : (
        <p className="text-xs text-ink-3">waiting for wind…</p>
      )}
      {(['headsail', 'main', 'downwind'] as SailCategory[]).map((cat) => {
        const active = rec?.active[cat];
        const valid = rec?.valid[cat] ?? [];
        const change = rec?.changeNeeded[cat] ?? false;
        return (
          <div key={cat} className="border border-hairline [border-radius:var(--r-control)] p-2 bg-surface-raised">
            <div className="text-sm font-medium flex items-center gap-2">
              {labels[cat]}
              {change && (
                <span className="bg-danger-strong text-ink-value text-caption px-1.5 py-0.5 [border-radius:var(--r-control)]">
                  change
                </span>
              )}
            </div>
            <div className="text-sm">
              <span className="text-ink-4">active:</span>{' '}
              {active ? (byId.get(active)?.name ?? active) : '—'}
            </div>
            <div className="text-xs text-ink-4 flex flex-wrap gap-1 mt-1">
              {valid.length ? (
                valid.map((id) => (
                  <span key={id} className="bg-surface-raised px-1 rounded">
                    {byId.get(id)?.name ?? id}
                  </span>
                ))
              ) : (
                <span>none valid</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
