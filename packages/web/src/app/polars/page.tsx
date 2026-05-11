'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PolarTable } from '@g5000/db';
import { PolarHeatmap } from './PolarHeatmap';
import { PolarCellEditor } from './PolarCellEditor';

export default function PolarsPage() {
  const [polar, setPolar] = useState<PolarTable | null>(null);
  const [selected, setSelected] = useState<{ twsIdx: number; twaIdx: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/config/polars', { cache: 'no-store' });
      if (!res.ok) {
        setErr(`reload failed: ${res.status}`);
        return;
      }
      const body = (await res.json()) as PolarTable;
      setPolar(body);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleApply = async (updated: PolarTable): Promise<void> => {
    const res = await fetch('/api/config/polars', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PUT failed: ${res.status} ${body}`);
    }
    await reload();
  };

  const handleImport = async (file: File): Promise<void> => {
    setImportBusy(true);
    setErr(null);
    try {
      const text = await file.text();
      const res = await fetch('/api/config/polars/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: text,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Import failed: ${res.status} ${body}`);
      }
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Polars</h1>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,.pol"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
            }}
            className="hidden"
            id="polar-import"
          />
          <label
            htmlFor="polar-import"
            className={`px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium cursor-pointer ${
              importBusy ? 'opacity-50' : ''
            }`}
          >
            {importBusy ? 'Importing…' : 'Import CSV'}
          </label>
        </div>
      </div>

      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      {polar && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Polar grid</h2>
          <PolarHeatmap
            polar={polar}
            selected={selected ?? undefined}
            onSelect={(c) => setSelected(c)}
          />
          {selected && <PolarCellEditor polar={polar} cell={selected} onApply={handleApply} />}
        </section>
      )}

      {!polar && !err && <p className="text-slate-400">Loading…</p>}
    </main>
  );
}
