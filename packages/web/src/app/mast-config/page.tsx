'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GRID_CAPACITY, DAY_BASE_COLORS } from '@g5000/mast';
import type { DisplayUnit, DayBaseColor, GridKind, MastLayout, MastPage, MastThreshold, MastTile } from '@g5000/mast';
import { MAST_BASE_COLOR_HEX } from '../mast/colors';

// ── constants ──────────────────────────────────────────────────────────────────

const DISPLAY_UNITS: DisplayUnit[] = ['kn', 'deg', 'degT', 'm', 'ft', 'pct', 'v', 'raw'];
const GRID_KINDS: GridKind[] = ['1', '2', '3', '4', '6'];
const THRESHOLD_COLORS: MastThreshold['color'][] = ['green', 'amber', 'red', 'default'];
const THRESHOLD_OPS = ['gte', 'gt', 'lte', 'lt'] as const;
type ThresholdOp = (typeof THRESHOLD_OPS)[number];

/** A threshold row in local edit state (one operator + value). */
interface ThresholdRow {
  op: ThresholdOp;
  value: number;
  color: MastThreshold['color'];
}

function thresholdToRow(t: MastThreshold): ThresholdRow {
  // Pick the first bound present; v1 collapse is acceptable.
  const op: ThresholdOp =
    t.gte !== undefined ? 'gte' :
    t.gt  !== undefined ? 'gt'  :
    t.lte !== undefined ? 'lte' : 'lt';
  const value =
    t.gte !== undefined ? t.gte :
    t.gt  !== undefined ? t.gt  :
    t.lte !== undefined ? t.lte :
    (t.lt ?? 0);
  return { op, value, color: t.color };
}

function rowToThreshold(r: ThresholdRow): MastThreshold {
  return { [r.op]: r.value, color: r.color };
}

function describeCondition(page: MastPage): string {
  const c = page.condition;
  if (!c) return 'Override only';
  if ('always' in c && c.always) return 'Always';
  if ('mode' in c) return `${page.label} (mode: ${c.mode})`;
  return 'Unknown condition';
}

function makeDefaultTile(field: string): MastTile {
  return { field, label: 'NEW', units: 'kn', decimals: 1 };
}

// ── component ──────────────────────────────────────────────────────────────────

export default function MastConfigPage() {
  const [layout, setLayout] = useState<MastLayout | null>(null);
  const [channels, setChannels] = useState<string[]>([]);
  const [brightnessPct, setBrightnessPct] = useState<number>(80);
  const [nightMode, setNightMode] = useState<boolean>(false);
  const [dayBaseColor, setDayBaseColor] = useState<DayBaseColor>('white');
  const brightnessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [ok, setOk] = useState(false);

  // ── load ────────────────────────────────────────────────────────────────────

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [layoutRes, chRes] = await Promise.all([
        fetch('/api/mast/layout', { cache: 'no-store' }),
        fetch('/api/mast/channels', { cache: 'no-store' }),
      ]);
      if (!layoutRes.ok) throw new Error(`GET /api/mast/layout: ${layoutRes.status}`);
      if (!chRes.ok) throw new Error(`GET /api/mast/channels: ${chRes.status}`);
      const layoutBody = (await layoutRes.json()) as { ok: boolean; layout: MastLayout };
      const chBody = (await chRes.json()) as { ok: boolean; channels: string[] };
      setLayout(layoutBody.layout);
      setChannels(chBody.channels);
      setErr(null);
      // Load brightness separately so a failure doesn't break the layout load.
      try {
        const brRes = await fetch('/api/mast/brightness', { cache: 'no-store' });
        if (brRes.ok) {
          const brBody = (await brRes.json()) as { ok: boolean; brightnessPct: number };
          if (brBody.ok) setBrightnessPct(brBody.brightnessPct);
        }
      } catch {
        // non-fatal — brightness just stays at the default
      }
      try {
        const nmRes = await fetch('/api/mast/night-mode', { cache: 'no-store' });
        if (nmRes.ok) {
          const nmBody = (await nmRes.json()) as { ok: boolean; nightMode: boolean };
          if (nmBody.ok) setNightMode(nmBody.nightMode);
        }
      } catch {
        // non-fatal — night mode just stays at the default
      }
      try {
        const dcRes = await fetch('/api/mast/day-base-color', { cache: 'no-store' });
        if (dcRes.ok) {
          const dcBody = (await dcRes.json()) as { ok: boolean; dayBaseColor: DayBaseColor };
          if (dcBody.ok) setDayBaseColor(dcBody.dayBaseColor);
        }
      } catch {
        // non-fatal — day base colour stays at the default
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ── save ────────────────────────────────────────────────────────────────────

  const handleSave = async (): Promise<void> => {
    if (!layout) return;
    setBusy(true);
    setErr(null);
    setSaveErrors([]);
    setOk(false);
    try {
      const res = await fetch('/api/mast/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(layout),
      });
      const body = (await res.json()) as { ok: boolean; errors?: string[] };
      if (body.ok) {
        setOk(true);
        setTimeout(() => setOk(false), 4000);
      } else {
        setSaveErrors(body.errors ?? ['Unknown error']);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ── brightness ──────────────────────────────────────────────────────────────

  const onBrightnessChange = (pct: number): void => {
    setBrightnessPct(pct);
    if (brightnessTimer.current) clearTimeout(brightnessTimer.current);
    brightnessTimer.current = setTimeout(() => {
      void fetch('/api/mast/brightness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brightnessPct: pct }),
      });
    }, 250);
  };

  const onNightModeChange = (on: boolean): void => {
    setNightMode(on);
    void fetch('/api/mast/night-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nightMode: on }),
    });
  };

  const onDayBaseColorChange = (color: DayBaseColor): void => {
    setDayBaseColor(color);
    void fetch('/api/mast/day-base-color', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dayBaseColor: color }),
    });
  };

  // ── immutable helpers ───────────────────────────────────────────────────────

  const updatePage = (pi: number, updated: MastPage): void => {
    if (!layout) return;
    const pages = layout.pages.map((p, i) => (i === pi ? updated : p));
    setLayout({ ...layout, pages });
  };

  const updateTile = (pi: number, ti: number, updated: MastTile): void => {
    if (!layout) return;
    const page = layout.pages[pi];
    if (!page) return;
    const tiles = page.tiles.map((t, i) => (i === ti ? updated : t));
    updatePage(pi, { ...page, tiles });
  };

  // Called from threshold row edits — converts rows back to MastThreshold[].
  const updateTileThresholds = (pi: number, ti: number, rows: ThresholdRow[]): void => {
    if (!layout) return;
    const page = layout.pages[pi];
    if (!page) return;
    const tile = page.tiles[ti];
    if (!tile) return;
    const thresholds = rows.map(rowToThreshold);
    updateTile(pi, ti, {
      ...tile,
      thresholds: thresholds.length > 0 ? thresholds : undefined,
    });
  };

  // Grid change: pad or trim tiles.
  const handleGridChange = (pi: number, grid: GridKind): void => {
    if (!layout) return;
    const page = layout.pages[pi];
    if (!page) return;
    const capacity = GRID_CAPACITY[grid];
    let tiles = [...page.tiles];
    if (tiles.length > capacity) {
      tiles = tiles.slice(0, capacity);
    } else {
      const fallback = channels[0] ?? 'nav.gps.sog';
      while (tiles.length < capacity) {
        tiles.push(makeDefaultTile(fallback));
      }
    }
    updatePage(pi, { ...page, grid, tiles });
  };

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <main className="p-6 space-y-6 max-w-4xl">
      <h1 className="text-2xl font-semibold">Mast Display</h1>
      <p className="text-sm text-slate-400">
        Configure which data each page of the mast display shows. Changes take effect live — no restart
        required.
      </p>

      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      {saveErrors.length > 0 && (
        <div className="text-red-400 text-sm space-y-1">
          <div className="font-medium">Save failed:</div>
          <ul className="list-disc list-inside">
            {saveErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {ok && (
        <div className="text-green-400 text-sm">
          Saved — the mast display updates live.
        </div>
      )}

      <button
        onClick={() => void handleSave()}
        disabled={busy || layout === null}
        className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>

      <section className="border border-slate-700 rounded-md p-4 space-y-2">
        <div className="text-sm font-medium">Panel brightness</div>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="range"
            min={5}
            max={100}
            step={1}
            value={brightnessPct}
            onChange={(e) => onBrightnessChange(Number(e.target.value))}
            className="flex-1"
            aria-label="Panel brightness"
          />
          <span className="w-12 text-right font-mono">{brightnessPct}%</span>
        </label>
        <p className="text-xs text-slate-400">
          Applied to the mast-display panel live. The setting persists and dims the boot screen too.
        </p>
      </section>

      <section className="border border-slate-700 rounded-md p-4 space-y-2">
        <div className="text-sm font-medium">Night mode</div>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={nightMode}
            onChange={(e) => onNightModeChange(e.target.checked)}
            aria-label="Night mode"
          />
          <span className="text-slate-300">{nightMode ? 'On — red on black' : 'Off — day theme'}</span>
        </label>
        <p className="text-xs text-slate-400">
          Forces the mast display's red-on-black night theme on/off. Persists across reboots.
        </p>
      </section>

      <section className="border border-slate-700 rounded-md p-4 space-y-2">
        <div className="text-sm font-medium">Day base colour</div>
        <div className="flex flex-wrap gap-2">
          {DAY_BASE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onDayBaseColorChange(c)}
              aria-label={c}
              aria-pressed={dayBaseColor === c}
              title={c}
              className={`w-8 h-8 rounded-full border-2 ${
                dayBaseColor === c ? 'border-slate-100' : 'border-slate-600'
              }`}
              style={{ backgroundColor: MAST_BASE_COLOR_HEX[c] }}
            />
          ))}
        </div>
        <p className="text-xs text-slate-400">
          Day-mode colour for cell values (black background). Alarm thresholds still override;
          night mode shows everything in red.
        </p>
      </section>

      {layout === null && !err && <p className="text-slate-400">Loading…</p>}

      {layout !== null &&
        layout.pages.map((page, pi) => (
          <PageEditor
            key={page.id}
            page={page}
            pageIndex={pi}
            channels={channels}
            onGridChange={(grid) => handleGridChange(pi, grid)}
            onTileChange={(ti, tile) => updateTile(pi, ti, tile)}
            onThresholdsChange={(ti, rows) => updateTileThresholds(pi, ti, rows)}
          />
        ))}
    </main>
  );
}

// ── PageEditor ─────────────────────────────────────────────────────────────────

interface PageEditorProps {
  page: MastPage;
  pageIndex: number;
  channels: string[];
  onGridChange: (grid: GridKind) => void;
  onTileChange: (ti: number, tile: MastTile) => void;
  onThresholdsChange: (ti: number, rows: ThresholdRow[]) => void;
}

function PageEditor({ page, pageIndex, channels, onGridChange, onTileChange, onThresholdsChange }: PageEditorProps) {
  return (
    <section className="border border-slate-700 rounded-md p-4 space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <div>
          <div className="text-base font-medium">{page.label}</div>
          <div className="text-xs text-slate-400">{describeCondition(page)}</div>
        </div>
        <label className="flex items-center gap-2 text-sm ml-auto">
          <span className="text-slate-400">Grid</span>
          <select
            value={page.grid}
            onChange={(e) => onGridChange(e.target.value as GridKind)}
            className="px-2 py-1 bg-slate-900 border border-slate-700 rounded"
          >
            {GRID_KINDS.map((g) => (
              <option key={g} value={g}>
                {g} cell{g !== '1' ? 's' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(Number(page.grid), 3)}, minmax(0, 1fr))` }}>
        {page.tiles.map((tile, ti) => {
          // Union current field with channel list so an offline field stays selectable.
          const fieldOptions = channels.includes(tile.field)
            ? channels
            : [tile.field, ...channels];
          const thresholdRows = (tile.thresholds ?? []).map(thresholdToRow);
          return (
            <TileEditor
              key={`${pageIndex}-${ti}`}
              tile={tile}
              tileIndex={ti}
              fieldOptions={fieldOptions}
              thresholdRows={thresholdRows}
              onChange={(updated) => onTileChange(ti, updated)}
              onThresholdsChange={(rows) => onThresholdsChange(ti, rows)}
            />
          );
        })}
      </div>
    </section>
  );
}

// ── TileEditor ─────────────────────────────────────────────────────────────────

interface TileEditorProps {
  tile: MastTile;
  tileIndex: number;
  fieldOptions: string[];
  thresholdRows: ThresholdRow[];
  onChange: (tile: MastTile) => void;
  onThresholdsChange: (rows: ThresholdRow[]) => void;
}

function TileEditor({ tile, tileIndex, fieldOptions, thresholdRows, onChange, onThresholdsChange }: TileEditorProps) {
  const addThreshold = (): void => {
    onThresholdsChange([...thresholdRows, { op: 'gte', value: 0, color: 'green' }]);
  };

  const removeThreshold = (ri: number): void => {
    onThresholdsChange(thresholdRows.filter((_, i) => i !== ri));
  };

  const updateThresholdRow = (ri: number, patch: Partial<ThresholdRow>): void => {
    onThresholdsChange(thresholdRows.map((r, i) => (i === ri ? { ...r, ...patch } : r)));
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-3 space-y-2 text-sm">
      <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">Cell {tileIndex + 1}</div>

      {/* field */}
      <label className="flex flex-col gap-1">
        <span className="text-slate-400">Channel</span>
        <select
          value={tile.field}
          onChange={(e) => onChange({ ...tile, field: e.target.value })}
          className="px-2 py-1 bg-slate-800 border border-slate-700 rounded font-mono text-xs"
        >
          {fieldOptions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>

      {/* label */}
      <label className="flex flex-col gap-1">
        <span className="text-slate-400">Label</span>
        <input
          type="text"
          value={tile.label}
          onChange={(e) => onChange({ ...tile, label: e.target.value })}
          className="px-2 py-1 bg-slate-800 border border-slate-700 rounded"
        />
      </label>

      {/* units */}
      <label className="flex flex-col gap-1">
        <span className="text-slate-400">Units</span>
        <select
          value={tile.units}
          onChange={(e) => onChange({ ...tile, units: e.target.value as DisplayUnit })}
          className="px-2 py-1 bg-slate-800 border border-slate-700 rounded"
        >
          {DISPLAY_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>

      {/* decimals */}
      <label className="flex flex-col gap-1">
        <span className="text-slate-400">Decimals</span>
        <input
          type="number"
          min={0}
          max={3}
          step={1}
          value={tile.decimals}
          onChange={(e) => {
            const v = Math.max(0, Math.min(3, Math.floor(Number(e.target.value))));
            onChange({ ...tile, decimals: v });
          }}
          className="w-20 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-right font-mono"
        />
      </label>

      {/* thresholds */}
      <div className="space-y-1">
        <div className="text-slate-400">Thresholds</div>
        {thresholdRows.map((row, ri) => (
          <div key={ri} className="flex items-center gap-1 flex-wrap">
            <select
              value={row.op}
              onChange={(e) => updateThresholdRow(ri, { op: e.target.value as ThresholdOp })}
              className="px-1 py-0.5 bg-slate-800 border border-slate-700 rounded text-xs"
            >
              {THRESHOLD_OPS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="any"
              value={row.value}
              onChange={(e) => updateThresholdRow(ri, { value: Number(e.target.value) })}
              className="w-20 px-1 py-0.5 bg-slate-800 border border-slate-700 rounded text-right font-mono text-xs"
            />
            <select
              value={row.color}
              onChange={(e) => updateThresholdRow(ri, { color: e.target.value as MastThreshold['color'] })}
              className="px-1 py-0.5 bg-slate-800 border border-slate-700 rounded text-xs"
            >
              {THRESHOLD_COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeThreshold(ri)}
              className="px-1 py-0.5 text-slate-400 hover:text-red-400 text-xs"
              title="Remove threshold"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addThreshold}
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          + add threshold
        </button>
      </div>
    </div>
  );
}
