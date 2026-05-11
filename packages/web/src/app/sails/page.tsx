'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SailConfig, SailWardrobe, PolarTable } from '@g5000/db';
import { PolarHeatmap } from '../polars/PolarHeatmap';

export default function SailsPage() {
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ twsIdx: number; twaIdx: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importBusy, setImportBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/sails', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/sails: ${res.status}`);
      const body = (await res.json()) as SailWardrobe;
      setWardrobe(body);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const writeWardrobe = async (w: SailWardrobe) => {
    const res = await fetch('/api/sails', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(w),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`PUT failed: ${res.status} ${t}`);
    }
    await reload();
  };

  const setActive = async (id: string) => {
    const res = await fetch('/api/sails/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configId: id }),
    });
    if (!res.ok) {
      const t = await res.text();
      setErr(`activate failed: ${res.status} ${t}`);
      return;
    }
    await reload();
  };

  const addConfig = async () => {
    if (!wardrobe) return;
    const baseId = `config-${Date.now()}`;
    const base = wardrobe.configs.find((c) => c.id === wardrobe.activeConfigId)!;
    const newCfg: SailConfig = {
      id: baseId,
      name: `New config (${wardrobe.configs.length + 1})`,
      polar: base.polar, // start from current active
    };
    try {
      await writeWardrobe({
        ...wardrobe,
        configs: [...wardrobe.configs, newCfg],
      });
      setEditingId(baseId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteConfig = async (id: string) => {
    if (!wardrobe) return;
    if (wardrobe.configs.length === 1) {
      setErr('Cannot delete the last config');
      return;
    }
    if (id === wardrobe.activeConfigId) {
      setErr('Cannot delete the active config (switch first)');
      return;
    }
    if (!confirm(`Delete config "${id}"?`)) return;
    try {
      await writeWardrobe({
        ...wardrobe,
        configs: wardrobe.configs.filter((c) => c.id !== id),
      });
      if (editingId === id) setEditingId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const updateConfig = async (id: string, patch: Partial<SailConfig>) => {
    if (!wardrobe) return;
    try {
      await writeWardrobe({
        ...wardrobe,
        configs: wardrobe.configs.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const applyPolarChange = async (id: string, polar: PolarTable) => {
    await updateConfig(id, { polar });
  };

  const handleImport = async (file: File, configId: string) => {
    setImportBusy(true);
    try {
      const text = await file.text();
      const res = await fetch(`/api/sails/import?configId=${encodeURIComponent(configId)}`, {
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

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sail wardrobe</h1>
        <button
          onClick={addConfig}
          className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
        >
          Add config
        </button>
      </div>
      {err && <div className="text-red-400 text-sm">{err}</div>}

      {!wardrobe && !err && <p className="text-slate-400">Loading…</p>}

      {wardrobe && (
        <div className="space-y-2">
          {wardrobe.configs.map((c) => {
            const isActive = c.id === wardrobe.activeConfigId;
            const isEditing = c.id === editingId;
            return (
              <div
                key={c.id}
                className={`border rounded p-3 ${
                  isActive ? 'border-amber-500' : 'border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setActive(c.id)}
                      className={`px-2 py-1 rounded text-xs font-mono ${
                        isActive ? 'bg-amber-600 text-slate-900' : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {isActive ? 'ACTIVE' : 'Make active'}
                    </button>
                    <div>
                      <div className="text-base font-semibold">{c.name}</div>
                      <div className="text-xs text-slate-500 font-mono">{c.id}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditingId(isEditing ? null : c.id)}
                      className="px-2 py-1 bg-slate-700 text-slate-200 rounded text-xs"
                    >
                      {isEditing ? 'Close' : 'Edit'}
                    </button>
                    <button
                      onClick={() => deleteConfig(c.id)}
                      disabled={isActive || wardrobe.configs.length === 1}
                      className="px-2 py-1 bg-red-900 text-red-200 rounded text-xs disabled:opacity-30"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-4 space-y-3 border-t border-slate-800 pt-3">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-sm">
                        <span className="text-slate-400">Name:</span>
                        <input
                          type="text"
                          value={c.name}
                          onChange={(e) => updateConfig(c.id, { name: e.target.value })}
                          className="block w-full mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="text-slate-400">Main:</span>
                        <input
                          type="text"
                          placeholder="Full / Reef 1 / Reef 2 / None"
                          value={c.mainState ?? ''}
                          onChange={(e) =>
                            updateConfig(c.id, { mainState: e.target.value || undefined })
                          }
                          className="block w-full mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="text-slate-400">Headsail:</span>
                        <input
                          type="text"
                          placeholder="J1 / J2 / Storm / None"
                          value={c.headsail ?? ''}
                          onChange={(e) =>
                            updateConfig(c.id, { headsail: e.target.value || undefined })
                          }
                          className="block w-full mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="text-slate-400">Downwind sail:</span>
                        <input
                          type="text"
                          placeholder="A2 / A3 / Code 0 / None"
                          value={c.downwindSail ?? ''}
                          onChange={(e) =>
                            updateConfig(c.id, { downwindSail: e.target.value || undefined })
                          }
                          className="block w-full mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200"
                        />
                      </label>
                    </div>

                    <div className="flex items-center gap-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.txt,.pol"
                        id={`import-${c.id}`}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleImport(f, c.id);
                        }}
                        className="hidden"
                      />
                      <label
                        htmlFor={`import-${c.id}`}
                        className={`px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium cursor-pointer text-sm ${importBusy ? 'opacity-50' : ''}`}
                      >
                        {importBusy ? 'Importing…' : 'Import CSV for this config'}
                      </label>
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-sm uppercase tracking-wider text-slate-400">
                        Polar grid
                      </h3>
                      <PolarHeatmap
                        polar={c.polar}
                        selected={selectedCell ?? undefined}
                        onSelect={(cell) => setSelectedCell(cell)}
                        onChange={(updated) => applyPolarChange(c.id, updated)}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
