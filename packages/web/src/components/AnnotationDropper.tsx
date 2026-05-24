'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openPeriodStart, type TrackAnnotation } from '../lib/track-annotations';
import { type BoatState, type SailCategory, type SailWardrobe } from '@g5000/db';
import { sailGroups } from './sail-groups';
import { daggerboardLabel } from './daggerboard-label';

function FlagIcon(): React.ReactElement {
  // A flag (mark an event on the track), deliberately distinct from the
  // map-pin used by the waypoint-drop button directly below it in the rail.
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

const POLL_MS = 5_000;

interface DropperState {
  trackId: string | null;
  annotations: TrackAnnotation[];
}

const QUICK_BUTTONS: Array<{ label: string; row: number }> = [
  { label: 'Tack', row: 0 },
  { label: 'Gybe', row: 0 },
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
  variant = 'pill',
}: {
  /** Tailwind position classes — caller decides anchor. /chart uses
   * 'top-2 right-14' to clear the NOAA layers button. Ignored in
   * 'icon' variant (parent flex-col positions the element). */
  position?: string;
  /** 'pill' (default) = floating pill button, absolutely positioned.
   * 'icon' = w-9 h-9 icon button; root is relative so a parent
   * flex-col can position it; expanded panel opens to the left. */
  variant?: 'pill' | 'icon';
}): React.ReactElement {
  const [state, setState] = useState<DropperState>({ trackId: null, annotations: [] });
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);
  const [boatState, setBoatState] = useState<BoatState | null>(null);
  const [open, setOpen] = useState(false);
  const [justSelected, setJustSelected] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState('');
  const [customKind, setCustomKind] = useState<TrackAnnotation['kind']>('event');
  const [submitting, setSubmitting] = useState(false);
  const [tickMs, setTickMs] = useState<number>(() => Date.now());
  const wrapRef = useRef<HTMLDivElement | null>(null);

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
      try {
        const wr = await fetch('/api/sails', { cache: 'no-store' });
        if (wr.ok && alive) setWardrobe((await wr.json()) as SailWardrobe);
      } catch {
        /* keep last wardrobe */
      }
      try {
        const bs = await fetch('/api/boat-state', { cache: 'no-store' });
        if (bs.ok && alive) {
          const j = (await bs.json()) as { ok: boolean; boatState?: BoatState };
          if (j.boatState) setBoatState(j.boatState);
        }
      } catch {
        /* keep last */
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

  // Close the panel when clicking outside it (matches LayersControl).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Flash the just-clicked pill amber and keep the panel visible briefly so
  // the selection registers visually, then auto-close. Selection actions
  // (sails / daggerboards / engines) use this instead of closing instantly.
  const markSelectedAndClose = useCallback((key: string): void => {
    setJustSelected(key);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      setJustSelected(null);
      closeTimerRef.current = null;
    }, 300);
  }, []);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const post = useCallback(
    async (label: string, kind: TrackAnnotation['kind'], closePanel = true): Promise<void> => {
      if (!state.trackId || submitting) return;
      setSubmitting(true);
      // The custom "Add" button closes the panel immediately; flash actions
      // (sails, daggerboards, engines, tack/gybe, period start/end) pass
      // closePanel=false and let the 300ms amber-flash timer close it. The
      // flash message reports the outcome either way.
      if (closePanel) setOpen(false);
      setCustomLabel('');
      try {
        const res = await fetch('/api/tracks/active/annotation', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label, kind }),
        });
        if (!res.ok) {
          setFlash(`✗ ${label} failed: HTTP ${res.status}`);
          window.setTimeout(() => setFlash(null), 2500);
          return;
        }
        const body = (await res.json()) as DropperState;
        setState(body);
        const time = new Date().toISOString().slice(11, 19) + 'Z';
        setFlash(`✓ Marked: ${label} at ${time}`);
        window.setTimeout(() => setFlash(null), 1500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFlash(`✗ ${label} failed: ${msg}`);
        window.setTimeout(() => setFlash(null), 2500);
      } finally {
        setSubmitting(false);
      }
    },
    [state.trackId, submitting],
  );

  const setSail = useCallback(
    async (category: SailCategory, sailId: string | null, label: string): Promise<void> => {
      markSelectedAndClose(`sail:${category}:${sailId ?? 'none'}`);
      try {
        const res = await fetch('/api/sails/active', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category, sailId }),
        });
        if (!res.ok) {
          setFlash(`✗ ${label} failed`);
          window.setTimeout(() => setFlash(null), 2500);
          return;
        }
        const wr = await fetch('/api/sails', { cache: 'no-store' });
        if (wr.ok) setWardrobe((await wr.json()) as SailWardrobe);
        if (state.trackId) await post(label, 'event', false);
        else {
          setFlash(`✓ ${label}`);
          window.setTimeout(() => setFlash(null), 1500);
        }
      } catch {
        setFlash(`✗ ${label} failed`);
        window.setTimeout(() => setFlash(null), 2500);
      }
    },
    [post, state.trackId, markSelectedAndClose],
  );

  const postBoatState = useCallback(
    async (patch: Partial<BoatState>, label: string, selectionKey: string): Promise<void> => {
      markSelectedAndClose(selectionKey);
      try {
        const res = await fetch('/api/boat-state', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          setFlash(`✗ ${label} failed`);
          window.setTimeout(() => setFlash(null), 2500);
          return;
        }
        const j = (await res.json()) as { ok: boolean; boatState?: BoatState };
        if (j.boatState) setBoatState(j.boatState);
        if (state.trackId) await post(label, 'event', false);
        else {
          setFlash(`✓ ${label}`);
          window.setTimeout(() => setFlash(null), 1500);
        }
      } catch {
        setFlash(`✗ ${label} failed`);
        window.setTimeout(() => setFlash(null), 2500);
      }
    },
    [post, state.trackId, markSelectedAndClose],
  );

  const open_ = useMemo(() => openPeriodStart(state.annotations), [state.annotations]);
  const minutesOpen = open_ ? Math.floor((tickMs - open_.tsMs) / 60_000) : 0;
  const disabled = state.trackId === null;

  // Panel is accessible when either a track is active (annotations) or wardrobe
  // is loaded (sail groups work without a track). Both paths need the panel open.
  const triggerDisabled = disabled && !wardrobe;

  const pillLabel = open_ ? `⏺ open period — ${minutesOpen} min` : '+ marker';
  const pillTitle = triggerDisabled
    ? 'No active track — wait for GPS'
    : disabled
      ? 'Set sails (no active track)'
      : open_
        ? `Open period since ${new Date(open_.tsMs).toISOString().slice(11, 19)}Z`
        : 'Annotate the track';
  const pillClass = open_
    ? 'bg-amber-500/85 text-slate-900 border-amber-600 hover:bg-amber-400'
    : 'bg-slate-900/85 text-slate-200 border-slate-700 hover:bg-slate-800';

  const rootClass =
    variant === 'icon' ? 'relative' : `absolute ${position} z-20 flex flex-col items-end gap-2`;

  return (
    <div ref={wrapRef} className={rootClass}>
      {flash && variant === 'pill' && (
        <div className="text-xs px-2 py-1 rounded bg-slate-900/90 text-slate-100 border border-slate-700 shadow">
          {flash}
        </div>
      )}
      {!open && variant === 'pill' && (
        <button
          type="button"
          onClick={() => {
            setJustSelected(null);
            setOpen(true);
          }}
          disabled={triggerDisabled}
          title={pillTitle}
          className={`px-3 py-1.5 text-sm rounded border shadow ${triggerDisabled ? 'bg-slate-900/40 text-slate-500 border-slate-800 cursor-not-allowed' : pillClass}`}
        >
          {pillLabel}
        </button>
      )}
      {!open && variant === 'icon' && (
        <button
          type="button"
          aria-label={
            open_ ? `Annotate the track — open period ${minutesOpen} min` : 'Annotate the track'
          }
          title={pillTitle}
          onClick={() => {
            setJustSelected(null);
            setOpen(true);
          }}
          disabled={triggerDisabled}
          className={
            'relative w-9 h-9 rounded border flex items-center justify-center ' +
            (triggerDisabled
              ? 'bg-zinc-900/40 text-zinc-500 border-zinc-800 cursor-not-allowed'
              : open_
                ? 'bg-amber-500 text-zinc-900 border-amber-600 hover:bg-amber-400'
                : 'bg-zinc-900/85 text-zinc-100 border-zinc-700 hover:bg-zinc-800')
          }
        >
          <FlagIcon />
          {open_ ? (
            <span
              aria-hidden
              className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 border border-amber-700"
            />
          ) : null}
        </button>
      )}
      {open && (
        <div
          className={
            'w-[280px] bg-slate-900/95 border border-slate-700 rounded shadow-lg p-3 space-y-3 max-h-[70vh] overflow-y-auto' +
            (variant === 'icon' ? ' absolute right-full mr-2 top-0 z-20' : '')
          }
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-100">Annotate the track</span>
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
              onClick={() => {
                markSelectedAndClose('period:end');
                void post('End period', 'periodEnd', false);
              }}
              disabled={submitting}
              className={
                'w-full px-3 py-2 text-sm font-semibold rounded border text-slate-900 border-amber-600 disabled:opacity-50 ' +
                (justSelected === 'period:end'
                  ? 'bg-amber-400'
                  : 'bg-amber-500/90 hover:bg-amber-400')
              }
            >
              End period ({minutesOpen} min)
            </button>
          )}

          <div className="flex items-center justify-between gap-1">
            {QUICK_BUTTONS.map((b) => (
              <button
                key={b.label}
                type="button"
                onClick={() => {
                  markSelectedAndClose(`quick:${b.label}`);
                  void post(b.label, 'event', false);
                }}
                disabled={disabled || submitting}
                className={
                  'px-2 py-1 text-xs rounded border disabled:opacity-40 ' +
                  (justSelected === `quick:${b.label}`
                    ? 'bg-amber-500 text-slate-900 border-amber-600'
                    : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700')
                }
              >
                {b.label}
              </button>
            ))}
          </div>

          {wardrobe &&
            sailGroups(wardrobe).map((g) => (
              <div key={g.category} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wide text-slate-400">
                    {g.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => void setSail(g.category, null, `${g.label} down`)}
                    className={
                      'px-2 py-0.5 text-xs rounded border ' +
                      (justSelected === `sail:${g.category}:none` || !g.activeId
                        ? 'bg-amber-500 text-slate-900 border-amber-600'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700')
                    }
                  >
                    None
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {g.sails.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => void setSail(g.category, s.id, s.name)}
                      className={
                        'px-2 py-1 text-xs rounded border ' +
                        (justSelected === `sail:${g.category}:${s.id}` || g.activeId === s.id
                          ? 'bg-amber-500 text-slate-900 border-amber-600'
                          : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700')
                      }
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}

          {boatState && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(['port', 'starboard'] as const).map((side) => (
                  <div key={`dagger-${side}`} className="space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">
                      {side === 'port' ? 'Port board' : 'Stbd board'}
                    </div>
                    <div className="flex flex-col gap-1">
                      {[0, 25, 50, 75, 100].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() =>
                            void postBoatState(
                              { daggerboards: { [side]: pct } } as Partial<BoatState>,
                              daggerboardLabel(side, pct),
                              `dagger:${side}:${pct}`,
                            )
                          }
                          className={
                            'px-2 py-1 text-xs rounded border ' +
                            (justSelected === `dagger:${side}:${pct}` ||
                            boatState.daggerboards[side] === pct
                              ? 'bg-amber-500 text-slate-900 border-amber-600'
                              : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700')
                          }
                        >
                          {pct === 0 ? 'Up' : pct === 100 ? 'Down' : `${pct}%`}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(['port', 'starboard'] as const).map((side) => {
                  const running = boatState.engines[side].running;
                  const label = side === 'port' ? 'Port engine' : 'Stbd engine';
                  return (
                    <div key={`engine-${side}`} className="space-y-1">
                      <div className="text-[11px] uppercase tracking-wide text-slate-400">
                        {label}
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            void postBoatState(
                              { engines: { [side]: { running: true } } } as Partial<BoatState>,
                              `${label} on`,
                              `engine:${side}:run`,
                            )
                          }
                          className={
                            'flex-1 px-2 py-1 text-xs rounded border ' +
                            (justSelected === `engine:${side}:run` || running
                              ? 'bg-amber-500 text-slate-900 border-amber-600'
                              : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700')
                          }
                        >
                          Run
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void postBoatState(
                              { engines: { [side]: { running: false } } } as Partial<BoatState>,
                              `${label} off`,
                              `engine:${side}:stop`,
                            )
                          }
                          className={
                            'flex-1 px-2 py-1 text-xs rounded border ' +
                            (justSelected === `engine:${side}:stop` || !running
                              ? 'bg-amber-500 text-slate-900 border-amber-600'
                              : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700')
                          }
                        >
                          Stop
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!open_ && (
            <button
              type="button"
              onClick={() => {
                markSelectedAndClose('period:start');
                void post('Start period', 'periodStart', false);
              }}
              disabled={disabled || submitting}
              className={
                'w-full px-3 py-1.5 text-xs rounded border disabled:opacity-40 ' +
                (justSelected === 'period:start'
                  ? 'bg-amber-500 text-slate-900 border-amber-600'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700')
              }
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
                className="flex-1 min-w-0 bg-slate-800 border border-slate-700 text-slate-200 text-sm px-2 py-1 rounded disabled:opacity-40"
              />
              <select
                value={customKind}
                onChange={(e) => setCustomKind(e.target.value as TrackAnnotation['kind'])}
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
                disabled={disabled || submitting || customLabel.length === 0}
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
