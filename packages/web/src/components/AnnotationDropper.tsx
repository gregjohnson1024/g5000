'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { openPeriodStart, type TrackAnnotation } from '../lib/track-annotations';

const POLL_MS = 5_000;

interface DropperState {
  trackId: string | null;
  annotations: TrackAnnotation[];
}

const QUICK_BUTTONS: Array<{ label: string; row: number }> = [
  { label: 'Tack', row: 0 },
  { label: 'Gybe', row: 0 },
  { label: 'Reef in', row: 0 },
  { label: 'Reef out', row: 0 },
  { label: 'Main up', row: 1 },
  { label: 'Main down', row: 1 },
  { label: 'J1', row: 1 },
  { label: 'J2', row: 1 },
  { label: 'J3', row: 1 },
  { label: 'Spinnaker up', row: 2 },
  { label: 'Spinnaker down', row: 2 },
];

/**
 * Floating widget for dropping labelled annotations on the active track.
 *
 * Mounted on /chart and /helm. Polls GET /api/tracks/active/annotation
 * every 5 s, plus an immediate refetch whenever the tab becomes visible
 * (so navigating between /chart and /helm sees fresh state without
 * waiting for the next poll). The response also updates after every
 * successful POST.
 *
 * When an open period exists, the collapsed pill turns amber and shows
 * the elapsed minutes; the expanded panel promotes a prominent "End
 * period (N min)" button to the top.
 */
export function AnnotationDropper({
  position = 'top-2 right-2',
}: {
  /** Tailwind position classes — caller decides anchor. /chart uses
   * 'top-2 right-14' to clear the NOAA layers button. */
  position?: string;
}) {
  const [state, setState] = useState<DropperState>({ trackId: null, annotations: [] });
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState('');
  const [customKind, setCustomKind] =
    useState<TrackAnnotation['kind']>('event');
  const [submitting, setSubmitting] = useState(false);
  const [tickMs, setTickMs] = useState<number>(() => Date.now());

  // 1 Hz tick so the "open period — N min" pill updates without polling
  // the server. Cheap; only renders when state changes.
  useEffect(() => {
    const id = window.setInterval(() => setTickMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  // Initial fetch + 5 s poll + on-visibility-change refetch.
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/tracks/active/annotation', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as DropperState;
        if (alive) setState(body);
      } catch {
        /* offline — keep last good state */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    const onVis = (): void => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const post = useCallback(
    async (label: string, kind: TrackAnnotation['kind']): Promise<void> => {
      if (!state.trackId || submitting) return;
      setSubmitting(true);
      try {
        const res = await fetch('/api/tracks/active/annotation', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label, kind }),
        });
        if (!res.ok) {
          setFlash(`✗ Failed: ${res.status}`);
          window.setTimeout(() => setFlash(null), 1500);
          return;
        }
        const body = (await res.json()) as DropperState;
        setState(body);
        const time = new Date().toISOString().slice(11, 19) + 'Z';
        setFlash(`✓ Marked: ${label} at ${time}`);
        window.setTimeout(() => setFlash(null), 1000);
        setOpen(false);
        setCustomLabel('');
      } finally {
        setSubmitting(false);
      }
    },
    [state.trackId, submitting],
  );

  const open_ = useMemo(() => openPeriodStart(state.annotations), [state.annotations]);
  const minutesOpen = open_ ? Math.floor((tickMs - open_.tsMs) / 60_000) : 0;
  const disabled = state.trackId === null;

  const pillLabel = open_ ? `⏺ open period — ${minutesOpen} min` : '+ marker';
  const pillTitle = disabled
    ? 'No active track — wait for GPS'
    : open_
    ? `Open period since ${new Date(open_.tsMs).toISOString().slice(11, 19)}Z`
    : 'Drop a marker on the active track';
  const pillClass = open_
    ? 'bg-amber-500/85 text-slate-900 border-amber-600 hover:bg-amber-400'
    : 'bg-slate-900/85 text-slate-200 border-slate-700 hover:bg-slate-800';

  return (
    <div className={`absolute ${position} z-20 flex flex-col items-end gap-2`}>
      {flash && (
        <div className="text-xs px-2 py-1 rounded bg-slate-900/90 text-slate-100 border border-slate-700 shadow">
          {flash}
        </div>
      )}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          title={pillTitle}
          className={`px-3 py-1.5 text-sm rounded border shadow ${disabled ? 'bg-slate-900/40 text-slate-500 border-slate-800 cursor-not-allowed' : pillClass}`}
        >
          {pillLabel}
        </button>
      )}
      {open && (
        <div className="w-[280px] bg-slate-900/95 border border-slate-700 rounded shadow-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-100">Drop a marker</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-slate-400 hover:text-slate-200"
              aria-label="close"
            >
              ✕
            </button>
          </div>

          {open_ && (
            <button
              type="button"
              onClick={() => void post('End period', 'periodEnd')}
              disabled={submitting}
              className="w-full px-3 py-2 text-sm font-semibold rounded border bg-amber-500/90 text-slate-900 border-amber-600 hover:bg-amber-400 disabled:opacity-50"
            >
              End period ({minutesOpen} min)
            </button>
          )}

          {[0, 1, 2].map((rowIdx) => (
            <div key={rowIdx} className="flex flex-wrap gap-1">
              {QUICK_BUTTONS.filter((b) => b.row === rowIdx).map((b) => (
                <button
                  key={b.label}
                  type="button"
                  onClick={() => void post(b.label, 'event')}
                  disabled={submitting}
                  className="px-2 py-1 text-xs rounded border bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 disabled:opacity-40"
                >
                  {b.label}
                </button>
              ))}
            </div>
          ))}

          {!open_ && (
            <button
              type="button"
              onClick={() => void post('Start period', 'periodStart')}
              disabled={submitting}
              className="w-full px-3 py-1.5 text-xs rounded border bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 disabled:opacity-40"
            >
              Start period
            </button>
          )}

          <div className="space-y-1 pt-1 border-t border-slate-800">
            <label className="text-xs text-slate-400">Custom</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="label"
                disabled={submitting}
                className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-sm px-2 py-1 rounded disabled:opacity-40"
              />
              <select
                value={customKind}
                onChange={(e) =>
                  setCustomKind(e.target.value as TrackAnnotation['kind'])
                }
                disabled={submitting}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs px-1 py-1 rounded disabled:opacity-40"
              >
                <option value="event">event</option>
                <option value="periodStart">period start</option>
                <option value="periodEnd">period end</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  if (customLabel.length > 0) void post(customLabel, customKind);
                }}
                disabled={submitting || customLabel.length === 0}
                className="px-2 py-1 text-xs rounded border bg-slate-700 text-slate-100 border-slate-600 hover:bg-slate-600 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
