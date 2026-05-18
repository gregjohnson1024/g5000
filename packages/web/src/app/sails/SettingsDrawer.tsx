'use client';

import { useState } from 'react';
import type { SailWardrobe } from '@g5000/db';
import {
  DEFAULT_WARDROBE_SETTINGS,
  wardrobeSettingsOf,
  type WardrobeSettings,
} from '@g5000/db/defaults';

export function SettingsDrawer({
  wardrobe,
  onSave,
}: {
  wardrobe: SailWardrobe;
  onSave: (settings: WardrobeSettings) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WardrobeSettings>(wardrobeSettingsOf(wardrobe));
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs underline text-slate-400 hover:text-slate-200"
      >
        Chart settings
      </button>
    );
  }

  const set = <K extends keyof WardrobeSettings>(k: K, v: WardrobeSettings[K]) =>
    setDraft({ ...draft, [k]: v });

  return (
    <div className="rounded border border-slate-700 bg-slate-950 p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500 uppercase tracking-wider">Chart settings</div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          close
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs">
          Hysteresis %
          <input
            type="number"
            step="0.1"
            value={draft.hysteresisPercent}
            onChange={(e) => set('hysteresisPercent', Number(e.target.value))}
            className="block w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono"
          />
        </label>
        <label className="block text-xs">
          Chart TWS max (kn)
          <input
            type="number"
            step="1"
            value={draft.chartTwsMaxKn}
            onChange={(e) => set('chartTwsMaxKn', Number(e.target.value))}
            className="block w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono"
          />
        </label>
        <label className="block text-xs">
          Chart TWA min (°)
          <input
            type="number"
            step="1"
            value={draft.chartTwaMinDeg}
            onChange={(e) => set('chartTwaMinDeg', Number(e.target.value))}
            className="block w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono"
          />
        </label>
        <label className="block text-xs">
          Chart TWA max (°)
          <input
            type="number"
            step="1"
            value={draft.chartTwaMaxDeg}
            onChange={(e) => set('chartTwaMaxDeg', Number(e.target.value))}
            className="block w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono"
          />
        </label>
        <label className="block text-xs">
          Forecast interval (min)
          <input
            type="number"
            step="5"
            value={draft.forecastIntervalMinutes}
            onChange={(e) => set('forecastIntervalMinutes', Number(e.target.value))}
            className="block w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono"
          />
        </label>
        <label className="block text-xs">
          Forecast duration (h)
          <input
            type="number"
            step="1"
            value={draft.forecastDurationHours}
            onChange={(e) => set('forecastDurationHours', Number(e.target.value))}
            className="block w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(draft);
            } finally {
              setBusy(false);
            }
          }}
          className="rounded bg-emerald-700 hover:bg-emerald-600 px-3 py-1 text-xs"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setDraft(DEFAULT_WARDROBE_SETTINGS)}
          className="rounded bg-slate-700 hover:bg-slate-600 px-3 py-1 text-xs"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
