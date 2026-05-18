'use client';

import { useEffect, useState } from 'react';
import type {
  CrossoverMap,
  CrossoverSettings,
  PolarTable,
  SailWardrobe,
} from '@g5000/db';
import { CrossoverChart } from './CrossoverChart';
import { ForecastTimeline } from './ForecastTimeline';
import { RecommendationPanel } from './RecommendationPanel';
import { SettingsDrawer } from './SettingsDrawer';

export default function SailsPage() {
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);
  const [polar, setPolar] = useState<PolarTable | null>(null);
  const [map, setMap] = useState<CrossoverMap | null>(null);
  const [settings, setSettings] = useState<CrossoverSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    try {
      const [wRes, pRes, mRes, sRes] = await Promise.all([
        fetch('/api/sails', { cache: 'no-store' }),
        fetch('/api/polar/active', { cache: 'no-store' }),
        fetch('/api/crossover-map', { cache: 'no-store' }),
        fetch('/api/crossover-settings', { cache: 'no-store' }),
      ]);
      if (!wRes.ok) {
        setErr(`GET /api/sails: ${wRes.status}`);
        return;
      }
      const wJ = (await wRes.json()) as SailWardrobe;
      const pJ = (await pRes.json()) as {
        ok: boolean;
        polar?: PolarTable;
        error?: { message: string };
      };
      const mJ = (await mRes.json()) as {
        ok: boolean;
        map?: CrossoverMap;
        error?: { message: string };
      };
      const sJ = (await sRes.json()) as {
        ok: boolean;
        settings?: CrossoverSettings;
        error?: { message: string };
      };
      if (!pJ.ok || !mJ.ok || !sJ.ok) {
        setErr(
          pJ.error?.message ?? mJ.error?.message ?? sJ.error?.message ?? 'load failed',
        );
        return;
      }
      setWardrobe(wJ);
      setPolar(pJ.polar ?? null);
      setMap(mJ.map ?? null);
      setSettings(sJ.settings ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function saveMap(next: CrossoverMap) {
    const res = await fetch('/api/crossover-map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const j = (await res.json()) as { error?: { message?: string } };
      throw new Error(j.error?.message ?? `HTTP ${res.status}`);
    }
    await reload();
  }

  async function saveSettings(next: CrossoverSettings) {
    const res = await fetch('/api/crossover-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await reload();
  }

  if (err) return <div className="p-4 text-rose-300">Error: {err}</div>;
  if (!wardrobe || !polar || !map || !settings)
    return <div className="p-4 text-slate-400">Loading…</div>;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start justify-between">
        <h1 className="text-xl text-slate-100">Sails</h1>
        <SettingsDrawer initial={settings} onSave={saveSettings} />
      </div>
      <RecommendationPanel wardrobe={wardrobe} />
      <CrossoverChart
        wardrobe={wardrobe}
        polar={polar}
        initial={map}
        settings={settings}
        onSave={saveMap}
      />
      <ForecastTimeline wardrobe={wardrobe} />
    </div>
  );
}
