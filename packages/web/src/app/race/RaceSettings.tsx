'use client';

import { useCallback, useEffect, useState } from 'react';

interface Settings {
  shiftThresholdDeg: number;
  ocsLookAheadSec: number;
  laylineDistanceNm: number;
  integrateCurrent: boolean;
}

interface FieldDef {
  key: 'shiftThresholdDeg' | 'ocsLookAheadSec' | 'laylineDistanceNm';
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

const NUMBER_FIELDS: FieldDef[] = [
  {
    key: 'shiftThresholdDeg',
    label: 'Wind shift threshold',
    unit: '°',
    min: 1,
    max: 30,
    step: 1,
    defaultValue: 7,
  },
  {
    key: 'ocsLookAheadSec',
    label: 'OCS look-ahead',
    unit: 's',
    min: 3,
    max: 60,
    step: 1,
    defaultValue: 10,
  },
  {
    key: 'laylineDistanceNm',
    label: 'Layline distance',
    unit: 'NM',
    min: 1,
    max: 15,
    step: 1,
    defaultValue: 5,
  },
];

function isInRange(field: FieldDef, value: number): boolean {
  return Number.isFinite(value) && value >= field.min && value <= field.max;
}

function isModified(a: Settings, b: Settings): boolean {
  return (
    a.shiftThresholdDeg !== b.shiftThresholdDeg ||
    a.ocsLookAheadSec !== b.ocsLookAheadSec ||
    a.laylineDistanceNm !== b.laylineDistanceNm ||
    a.integrateCurrent !== b.integrateCurrent
  );
}

export function RaceSettings(): React.ReactElement {
  const [open, setOpen] = useState(false);
  // `saved` is the truth from the server (last successful fetch or PUT).
  // `draft` is the local edit buffer; diverges from saved while the user
  // is editing, then snaps back on Save or Revert.
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const r = await fetch('/api/race/state', { cache: 'no-store' });
      if (!r.ok) return;
      const j = (await r.json()) as { settings?: Partial<Settings> };
      const s = j.settings;
      if (!s) return;
      const merged: Settings = {
        shiftThresholdDeg: s.shiftThresholdDeg ?? 7,
        ocsLookAheadSec: s.ocsLookAheadSec ?? 10,
        laylineDistanceNm: s.laylineDistanceNm ?? 5,
        integrateCurrent: s.integrateCurrent ?? true,
      };
      setSaved(merged);
      setDraft(merged);
    } catch {
      /* show stale values if any */
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const modified = saved !== null && draft !== null && isModified(saved, draft);

  // Defensive: even though number inputs have min/max, paste/keyboard
  // can sneak out-of-range values past the spinner clamp.
  const validationErrors: string[] =
    draft === null
      ? []
      : NUMBER_FIELDS.flatMap((f) =>
          isInRange(f, draft[f.key]) ? [] : [`${f.label} must be ${f.min}–${f.max} ${f.unit}`],
        );

  const canSave = modified && validationErrors.length === 0 && !busy;

  const save = useCallback(async () => {
    if (!draft || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/race/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: draft }),
      });
      if (!r.ok) {
        setError(`save failed (${r.status})`);
        return;
      }
      // Round-trip the truth so we display whatever the server actually
      // persisted (covers any server-side clamping / merging).
      await fetchSettings();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draft, canSave, fetchSettings]);

  const revert = useCallback(() => {
    if (saved) setDraft({ ...saved });
    setError(null);
  }, [saved]);

  if (draft === null) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded p-3 text-xs text-slate-500">
        Settings — loading…
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2 flex items-center justify-between text-left"
      >
        <span className="text-xs uppercase tracking-wider text-slate-400 flex items-center gap-2">
          Settings
          {modified && <span className="text-amber-400" title="unsaved changes">●</span>}
        </span>
        <span className="text-slate-500 font-mono text-sm">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-800 p-3 flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {NUMBER_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-sm text-slate-300">
                <span className="text-xs text-slate-400">
                  {f.label} <span className="text-slate-500">(default {f.defaultValue})</span>
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={draft[f.key]}
                    onChange={(e) =>
                      setDraft((d) =>
                        d === null
                          ? d
                          : { ...d, [f.key]: e.target.value === '' ? NaN : Number(e.target.value) },
                      )
                    }
                    className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono w-24"
                  />
                  <span className="text-xs text-slate-500">{f.unit}</span>
                </div>
              </label>
            ))}
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              <span className="text-xs text-slate-400">
                Integrate current in laylines{' '}
                <span className="text-slate-500">(default on)</span>
              </span>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={draft.integrateCurrent}
                  onChange={(e) =>
                    setDraft((d) => (d === null ? d : { ...d, integrateCurrent: e.target.checked }))
                  }
                  className="w-4 h-4 accent-emerald-600"
                />
                <span className="text-xs text-slate-500">
                  {draft.integrateCurrent ? 'on' : 'off'}
                </span>
              </div>
            </label>
          </div>

          {validationErrors.length > 0 && (
            <div className="text-xs text-red-400">{validationErrors.join(' · ')}</div>
          )}
          {error && <div className="text-xs text-red-400">{error}</div>}

          <div className="flex items-center gap-2 justify-end">
            {modified && (
              <button
                type="button"
                onClick={revert}
                disabled={busy}
                className="px-3 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-100 disabled:opacity-40"
              >
                Revert
              </button>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              className="px-3 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40 disabled:bg-slate-700"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
