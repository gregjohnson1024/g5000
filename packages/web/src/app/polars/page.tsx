'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PolarTable } from '@g5000/db';
import { PolarHeatmap } from './PolarHeatmap';
import { PolarPlot } from '../../components/PolarPlot';
import { useSse } from '../../hooks/use-sse';

export default function PolarsPage() {
  const [polar, setPolar] = useState<PolarTable | null>(null);
  const [selected, setSelected] = useState<{ twsIdx: number; twaIdx: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { channels } = useSse();

  const reload = useCallback(async () => {
    try {
      const pol = (await fetch('/api/config/polars', { cache: 'no-store' }).then((r) =>
        r.json(),
      )) as PolarTable;
      setPolar(pol);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleApply = async (updated: PolarTable): Promise<void> => {
    try {
      const res = await fetch('/api/config/polars', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`PUT failed: ${res.status} ${t}`);
      }
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const handleImport = async (file: File) => {
    setImportBusy(true);
    try {
      const text = await file.text();
      const res = await fetch('/api/config/polars/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: text,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Import failed: ${res.status} ${t}`);
      }
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Live operating-point values from SSE.
  const twsSample = channels.get('wind.true.speed');
  const twaSample = channels.get('wind.true.angle');
  const bspSample = channels.get('boat.speed.water');
  const targetSpeedSample = channels.get('performance.target.boatSpeed');
  const targetTwaSample = channels.get('performance.target.twaUpwind');

  const num = (s: typeof twsSample): number | undefined =>
    s && s.value.kind === 'scalar' ? s.value.value : undefined;

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Polars</h1>
        <div className="flex items-center gap-2">
          <a href="/sails" className="text-xs text-slate-500 hover:text-slate-300 underline">
            manage sails →
          </a>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,.pol"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
            }}
            className="hidden"
            id="polar-import-active"
          />
          <label
            htmlFor="polar-import-active"
            className={`px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium cursor-pointer text-sm ${
              importBusy ? 'opacity-50' : ''
            }`}
          >
            {importBusy ? 'Importing…' : 'Import CSV'}
          </label>
        </div>
      </div>

      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      {polar && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Polar plot (live)</h2>
            <PolarPlot
              polar={polar}
              currentTws={num(twsSample)}
              currentTwa={num(twaSample)}
              currentBsp={num(bspSample)}
              targetBsp={num(targetSpeedSample)}
              targetTwa={num(targetTwaSample)}
              size={480}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Polar grid (active)</h2>
            <PolarHeatmap
              polar={polar}
              selected={selected ?? undefined}
              onSelect={(c) => setSelected(c)}
              onChange={handleApply}
            />
          </section>
        </div>
      )}

      {!polar && !err && <p className="text-slate-400">Loading…</p>}
    </main>
  );
}
