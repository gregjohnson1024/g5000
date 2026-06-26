'use client';
import { useEffect, useRef, useState } from 'react';
import { MayaraClient } from '../../lib/radar/mayara-client';

export interface RadarControlsProps {
  /** g5000's same-origin REST proxy base (e.g. `/api/radar`). */
  baseUrl: string;
  /** Direct mayara base for the spoke WebSocket (e.g. `http://host:6502`). */
  wsBase: string;
  opacity: number;
  onOpacity: (v: number) => void;
  rangeM: number;
  onRange: (m: number) => void;
}

interface ControlState {
  value: number;
  auto: boolean;
}

interface ReadyState {
  id: string;
  /** Range steps the radar's `range` control accepts (its validValues, NOT supportedRanges). */
  ranges: number[];
}

/**
 * Compact radar control panel: range stepper, gain/sea/rain (auto + slider),
 * and opacity slider (local only, not sent to mayara).
 *
 * Phase-1 note: there is no read-back / seeding from GET …/controls because the
 * emulator returns empty controls: {}. A future phase should call
 * client.getControls(id) on mount and seed the sliders from the response.
 * All setControl calls are best-effort and do NOT block the UI on failure.
 */
export function RadarControls({
  baseUrl,
  wsBase,
  opacity,
  onOpacity,
  rangeM,
  onRange,
}: RadarControlsProps): React.ReactElement {
  const clientRef = useRef<MayaraClient | null>(null);
  const [ready, setReady] = useState<ReadyState | null>(null);
  const [gain, setGain] = useState<ControlState>({ value: 50, auto: true });
  const [sea, setSea] = useState<ControlState>({ value: 50, auto: true });
  const [rain, setRain] = useState<ControlState>({ value: 50, auto: true });
  // Transient error message shown briefly when a setControl call fails.
  const [ctrlError, setCtrlError] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount: discover → capabilities → store id + supportedRanges.
  // Retries on failure (mayara may be booting, or the proxy route still warming
  // up on first hit), so the panel self-heals instead of sticking on "connecting".
  useEffect(() => {
    const client = new MayaraClient({ baseUrl, wsBase });
    clientRef.current = client;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = async (): Promise<void> => {
      try {
        const { id } = await client.discover();
        const caps = await client.capabilities(id);
        if (!alive) return;
        // Use the range CONTROL's validValues — the values the radar will actually
        // accept. supportedRanges is a superset (round-metric steps interleaved with
        // nm-derived ones); sending a metric-only step (e.g. 36000) is rejected 400.
        const ranges = caps.controls?.range?.validValues ?? caps.supportedRanges;
        setReady({ id, ranges });
      } catch {
        if (alive) timer = setTimeout(() => void attempt(), 2000);
      }
    };
    void attempt();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [baseUrl, wsBase]);

  const showError = (msg: string): void => {
    setCtrlError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setCtrlError(null), 3000);
  };

  const send = (controlId: string, body: { value: number; auto?: boolean }): void => {
    const client = clientRef.current;
    const id = ready?.id;
    if (!client || !id) return;
    void client.setControl(id, controlId, body).catch((e: unknown) => {
      showError(`${controlId}: ${e instanceof Error ? e.message : String(e)}`);
    });
  };

  // Derive the current range index as the nearest accepted range to the shared rangeM prop.
  const rangeIdx = (() => {
    const ranges = ready?.ranges;
    if (!ranges || ranges.length === 0) return 0;
    let best = 0;
    let bestDelta = Infinity;
    for (let i = 0; i < ranges.length; i++) {
      const delta = Math.abs((ranges[i] ?? 0) - rangeM);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = i;
      }
    }
    return best;
  })();

  const handleRange = (idx: number): void => {
    const ranges = ready?.ranges;
    const m = ranges?.[idx];
    if (m !== undefined) {
      onRange(m);
      send('range', { value: m });
    }
  };

  const handleGain = (next: ControlState): void => {
    setGain(next);
    send('gain', { value: next.value, auto: next.auto });
  };

  const handleSea = (next: ControlState): void => {
    setSea(next);
    send('sea', { value: next.value, auto: next.auto });
  };

  const handleRain = (next: ControlState): void => {
    setRain(next);
    send('rain', { value: next.value, auto: next.auto });
  };

  const connecting = ready === null;

  return (
    <div className="space-y-2 bg-slate-900/60 border border-slate-800 rounded p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-slate-300 font-semibold uppercase tracking-wide text-[11px]">
          Radar
        </span>
        {connecting && <span className="text-slate-500 text-[11px]">connecting…</span>}
      </div>

      {/* Range stepper */}
      <div className="flex items-center gap-2">
        <span className="text-slate-400 w-12 shrink-0">Range</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={connecting || rangeIdx === 0}
            onClick={() => handleRange(rangeIdx - 1)}
            className="w-6 h-6 rounded border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-30 flex items-center justify-center"
          >
            −
          </button>
          <span className="text-slate-200 font-mono w-14 text-center">
            {connecting || !ready.ranges[rangeIdx] ? '—' : fmtRange(ready.ranges[rangeIdx]!)}
          </span>
          <button
            type="button"
            disabled={connecting || rangeIdx >= ready.ranges.length - 1}
            onClick={() => handleRange(rangeIdx + 1)}
            className="w-6 h-6 rounded border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-30 flex items-center justify-center"
          >
            +
          </button>
        </div>
      </div>

      {/* Gain */}
      <ControlRow label="Gain" ctrl={gain} disabled={connecting} onChange={handleGain} />

      {/* Sea clutter */}
      <ControlRow label="Sea" ctrl={sea} disabled={connecting} onChange={handleSea} />

      {/* Rain clutter */}
      <ControlRow label="Rain" ctrl={rain} disabled={connecting} onChange={handleRain} />

      {/* Opacity (local only — not sent to mayara) */}
      <div className="flex items-center gap-2">
        <span className="text-slate-400 w-12 shrink-0">Opacity</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => onOpacity(Number(e.target.value))}
          className="flex-1 accent-sky-500"
          aria-label="Radar opacity"
        />
        <span className="text-slate-300 font-mono w-8 text-right">
          {Math.round(opacity * 100)}%
        </span>
      </div>

      {ctrlError && <div className="text-rose-400 text-[11px] truncate">{ctrlError}</div>}
    </div>
  );
}

/** Format a range in metres as "NNN m" or "N.N km". */
function fmtRange(metres: number): string {
  if (metres < 1000) return `${metres} m`;
  return `${(metres / 1000).toFixed(metres % 1000 === 0 ? 0 : 1)} km`;
}

function ControlRow({
  label,
  ctrl,
  disabled,
  onChange,
}: {
  label: string;
  ctrl: ControlState;
  disabled: boolean;
  onChange: (next: ControlState) => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-400 w-12 shrink-0">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange({ ...ctrl, auto: !ctrl.auto })}
        aria-pressed={ctrl.auto}
        className={
          'h-5 px-1.5 rounded border text-[10px] font-semibold disabled:opacity-30 ' +
          (ctrl.auto
            ? 'bg-sky-600 border-sky-500 text-white'
            : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700')
        }
      >
        Auto
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={ctrl.value}
        disabled={disabled || ctrl.auto}
        onChange={(e) => onChange({ ...ctrl, value: Number(e.target.value) })}
        className="flex-1 accent-sky-500 disabled:opacity-40"
        aria-label={`${label} level`}
      />
      <span
        className={'font-mono w-8 text-right ' + (ctrl.auto ? 'text-slate-500' : 'text-slate-300')}
      >
        {ctrl.auto ? 'A' : ctrl.value}
      </span>
    </div>
  );
}
