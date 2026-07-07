'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Panel } from '../../../components/ui';
import {
  NUMBER_FIELDS,
  isModified,
  mergeWithDefaults,
  validateAll,
  type Settings,
} from './race-settings-defs';

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
      const merged = mergeWithDefaults(j.settings);
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
  const validationErrors: string[] = draft === null ? [] : validateAll(draft);
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
    return <Panel label="Settings" emptyState={{ reason: 'loading…' }} />;
  }

  return (
    <Panel
      label="Settings"
      chip={modified ? 'warn' : undefined}
      chipLabel={modified ? 'unsaved' : undefined}
      action={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-ink-3 font-mono text-sm hover:text-ink focus-visible:outline-none"
          aria-expanded={open}
          aria-label={open ? 'Collapse settings' : 'Expand settings'}
        >
          {open ? '▾' : '▸'}
        </button>
      }
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left py-1 focus-visible:outline-none"
        aria-expanded={open}
      >
        <span className="sr-only">{open ? 'Collapse' : 'Expand'} race settings</span>
      </button>

      {open && (
        <div className="border-t border-hairline pt-3 mt-1 flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {NUMBER_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-sm text-ink">
                <span className="text-xs text-ink-2">
                  {f.label} <span className="text-ink-4">(default {f.defaultValue})</span>
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
                    className="bg-canvas border border-hairline [border-radius:var(--r-control)] px-2 py-1 text-ink font-mono w-24"
                  />
                  <span className="text-xs text-ink-4">{f.unit}</span>
                </div>
              </label>
            ))}
            <label className="flex flex-col gap-1 text-sm text-ink">
              <span className="text-xs text-ink-2">
                Integrate current in laylines <span className="text-ink-4">(default on)</span>
              </span>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={draft.integrateCurrent}
                  onChange={(e) =>
                    setDraft((d) => (d === null ? d : { ...d, integrateCurrent: e.target.checked }))
                  }
                  className="w-4 h-4 accent-[var(--accent)]"
                />
                <span className="text-xs text-ink-4">{draft.integrateCurrent ? 'on' : 'off'}</span>
              </div>
            </label>
          </div>

          {validationErrors.length > 0 && (
            <div className="text-xs text-danger">{validationErrors.join(' · ')}</div>
          )}
          {error && <div className="text-xs text-danger">{error}</div>}

          <div className="flex items-center gap-2 justify-end">
            {modified && (
              <Button variant="secondary" size="sm" onClick={revert} disabled={busy}>
                Revert
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={() => void save()} disabled={!canSave}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
