'use client';

import { useState } from 'react';
import type { CrossoverSettings } from '@g5000/db';

interface Props {
  initial: CrossoverSettings;
  onSave: (settings: CrossoverSettings) => Promise<void>;
}

const FIELDS: Array<{
  key: keyof CrossoverSettings;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'recommendationStableSeconds', label: 'Recommendation stable (s)', min: 5, max: 600, step: 5 },
  { key: 'chartTwsMaxKn', label: 'Chart TWS max (kn)', min: 10, max: 60, step: 1 },
  { key: 'chartTwaMinDeg', label: 'Chart TWA min (°)', min: 0, max: 90, step: 5 },
  { key: 'chartTwaMaxDeg', label: 'Chart TWA max (°)', min: 90, max: 180, step: 5 },
  { key: 'forecastIntervalMinutes', label: 'Forecast interval (min)', min: 5, max: 240, step: 5 },
  { key: 'forecastDurationHours', label: 'Forecast duration (h)', min: 1, max: 96, step: 1 },
];

export function SettingsDrawer({ initial, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CrossoverSettings>(initial);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-slate-400 underline hover:text-slate-200"
      >
        Chart settings
      </button>
    );
  }

  async function save() {
    setBusy(true);
    try {
      await onSave(draft);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded border border-slate-700 bg-slate-950 p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-slate-500">Chart settings</div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          close
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-xs">
            <div className="text-slate-400">{f.label}</div>
            <input
              type="number"
              value={draft[f.key]}
              min={f.min}
              max={f.max}
              step={f.step}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  [f.key]: Number(e.target.value) || initial[f.key],
                })
              }
              className="w-full rounded bg-slate-900 px-2 py-1 text-slate-100"
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="rounded bg-emerald-700 px-3 py-1 text-sm text-white disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
