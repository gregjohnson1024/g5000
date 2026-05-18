'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CrossoverMap, CrossoverSettings, PolarTable, SailWardrobe } from '@g5000/db';
import { getConfigColor } from '../../lib/config-color';

const KN_PER_MS = 1 / 0.514444;
const DEG_PER_RAD = 180 / Math.PI;

interface Props {
  wardrobe: SailWardrobe;
  polar: PolarTable;
  initial: CrossoverMap;
  settings: CrossoverSettings;
  onSave: (map: CrossoverMap) => Promise<void>;
}

export function CrossoverChart({ wardrobe, polar, initial, settings, onSave }: Props) {
  const [cells, setCells] = useState<Record<string, string>>(initial.cells);
  const [paint, setPaint] = useState<string>(wardrobe.configs[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Filter the polar grid to the settings-defined display window.
  const cols = useMemo(
    () => polar.twsBins.map((v, i) => ({ i, kn: v * KN_PER_MS })).filter((c) => c.kn <= settings.chartTwsMaxKn),
    [polar.twsBins, settings.chartTwsMaxKn],
  );
  const rows = useMemo(
    () =>
      polar.twaBins
        .map((v, i) => ({ i, deg: v * DEG_PER_RAD }))
        .filter((r) => r.deg >= settings.chartTwaMinDeg && r.deg <= settings.chartTwaMaxDeg),
    [polar.twaBins, settings.chartTwaMinDeg, settings.chartTwaMaxDeg],
  );

  function toggleCell(twsIdx: number, twaIdx: number) {
    const key = `${twsIdx},${twaIdx}`;
    setCells((c) => {
      const next = { ...c };
      if (next[key] === paint) delete next[key]; // click same: clear
      else next[key] = paint;
      return next;
    });
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    try {
      await onSave({
        boatId: initial.boatId,
        mode: initial.mode,
        cells,
        updatedAt: Math.floor(Date.now() / 1000),
      });
      setDirty(false);
    } finally {
      setBusy(false);
    }
  }

  function clearAll() {
    setCells({});
    setDirty(true);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs uppercase tracking-wider text-slate-500">Paint:</div>
        {wardrobe.configs.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setPaint(c.id)}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${
              paint === c.id ? 'border-slate-300' : 'border-slate-700'
            }`}
          >
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded"
              style={{ background: getConfigColor(c.id) }}
            />
            {c.name}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 1 }}>
          <thead>
            <tr>
              <th className="bg-slate-900 px-1 py-1 text-xs text-slate-500">TWA \ TWS (kn)</th>
              {cols.map((c) => (
                <th key={c.i} className="bg-slate-900 px-1 py-1 text-xs text-slate-400">
                  {c.kn.toFixed(0)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.i}>
                <th className="bg-slate-900 px-1 py-1 text-xs text-slate-400">{r.deg.toFixed(0)}°</th>
                {cols.map((c) => {
                  const key = `${c.i},${r.i}`;
                  const id = cells[key];
                  const bg = id ? getConfigColor(id) : 'transparent';
                  return (
                    <td
                      key={c.i}
                      onClick={() => toggleCell(c.i, r.i)}
                      className="h-6 w-6 cursor-pointer border border-slate-800 hover:border-slate-500"
                      style={{ background: bg }}
                      title={id ?? '(empty)'}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          className="rounded bg-emerald-700 px-3 py-1 text-sm text-white disabled:opacity-40"
        >
          {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-300"
        >
          Clear all
        </button>
        <div className="text-xs text-slate-500">
          {Object.keys(cells).length} cells painted
        </div>
      </div>
    </div>
  );
}
