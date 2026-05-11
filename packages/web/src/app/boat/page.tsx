'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BoatConfig } from '@g5000/db';

const FIELDS: Array<{
  key: keyof BoatConfig;
  label: string;
  unit: string;
  step: number;
}> = [
  { key: 'mastHeight', label: 'Mast height (above masthead unit ref)', unit: 'm', step: 0.1 },
  { key: 'mastheadOffsetX', label: 'Masthead X offset (bow direction)', unit: 'm', step: 0.1 },
  { key: 'mastheadOffsetY', label: 'Masthead Y offset (lateral)', unit: 'm', step: 0.1 },
  { key: 'magVarDeg', label: 'Magnetic variation (positive = east)', unit: '°', step: 0.1 },
];

export default function BoatConfigPage() {
  const [cfg, setCfg] = useState<BoatConfig | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/config/boat', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/config/boat: ${res.status}`);
      const body = (await res.json()) as BoatConfig;
      setCfg(body);
      const e: Record<string, string> = {};
      for (const f of FIELDS) e[f.key] = String(body[f.key]);
      setEdits(e);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleApply = async (): Promise<void> => {
    if (!cfg) return;
    const next: BoatConfig = { ...cfg };
    for (const f of FIELDS) {
      const n = Number(edits[f.key]);
      if (!Number.isFinite(n)) {
        setErr(`${f.label} is not a valid number`);
        return;
      }
      (next as unknown as Record<string, number>)[f.key] = n;
    }
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const res = await fetch('/api/config/boat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`PUT failed: ${res.status} ${t}`);
      }
      setCfg(next);
      setOk(true);
      setTimeout(() => setOk(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="p-6 space-y-4 max-w-xl">
      <h1 className="text-2xl font-semibold">Boat configuration</h1>
      {err && <div className="text-red-400 text-sm">Error: {err}</div>}
      {ok && <div className="text-green-400 text-sm">Saved.</div>}
      {cfg === null && !err && <p className="text-slate-400">Loading…</p>}
      {cfg && (
        <div className="space-y-3">
          {FIELDS.map((f) => (
            <label key={f.key} className="block text-sm">
              <span className="text-slate-400">
                {f.label} ({f.unit})
              </span>
              <input
                type="number"
                step={f.step}
                value={edits[f.key] ?? ''}
                onChange={(e) => setEdits((prev) => ({ ...prev, [f.key]: e.target.value }))}
                className="block w-40 mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 font-mono"
              />
            </label>
          ))}
          <button
            onClick={handleApply}
            disabled={busy}
            className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Apply'}
          </button>
        </div>
      )}
      <p className="text-xs text-slate-500 pt-4 border-t border-slate-800">
        Mast height is used by the true-wind pipeline to correct for masthead motion. If it&apos;s
        wrong, true wind will appear noisy in turning maneuvers.
      </p>
    </main>
  );
}
