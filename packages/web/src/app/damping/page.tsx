'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSse } from '../../hooks/use-sse';

/**
 * /damping — per-channel low-pass-filter (EMA) configuration.
 *
 * The page lists all scalar channels currently seen on the SSE stream plus a
 * curated set of "expected" channels (so the user can pre-configure damping
 * for a channel before its first sample arrives). Each row has a slider
 * (0–10 s) and a numeric input bound to the same value. 0 = no damping.
 */

interface DampingConfig {
  [channel: string]: number;
}

/** Channels we always show — even before any samples have been seen. */
const KNOWN_CHANNELS: ReadonlyArray<{
  channel: string;
  label: string;
  suggested: number;
  isAngle?: boolean;
}> = [
  { channel: 'boat.speed.water', label: 'Boat speed (water)', suggested: 2.0 },
  { channel: 'wind.apparent.speed', label: 'Apparent wind speed', suggested: 2.0 },
  { channel: 'wind.apparent.angle', label: 'Apparent wind angle', suggested: 1.5, isAngle: true },
  { channel: 'wind.true.speed', label: 'True wind speed', suggested: 3.0 },
  { channel: 'wind.true.angle', label: 'True wind angle', suggested: 3.0, isAngle: true },
  { channel: 'wind.true.direction', label: 'True wind direction', suggested: 3.0, isAngle: true },
  { channel: 'nav.gps.cog', label: 'COG (course over ground)', suggested: 1.0, isAngle: true },
  { channel: 'nav.gps.sog', label: 'SOG (speed over ground)', suggested: 1.0 },
  { channel: 'boat.heading.magnetic', label: 'Heading (magnetic)', suggested: 0.5, isAngle: true },
  { channel: 'boat.heading.true', label: 'Heading (true)', suggested: 0.5, isAngle: true },
  { channel: 'motion.heel', label: 'Heel', suggested: 0.5, isAngle: true },
  { channel: 'motion.pitch', label: 'Pitch', suggested: 0.5, isAngle: true },
  { channel: 'motion.yaw', label: 'Yaw', suggested: 0.5, isAngle: true },
  { channel: 'performance.percentPolar', label: '% polar', suggested: 3.0 },
];

const MAX_TAU = 10.0;

export default function DampingPage() {
  const [cfg, setCfg] = useState<DampingConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const { channels: liveChannels } = useSse();

  // Merge: known list (always shown) ∪ any live channels with scalar values.
  const visibleChannels = useMemo<string[]>(() => {
    const set = new Set<string>(KNOWN_CHANNELS.map((k) => k.channel));
    for (const [ch, s] of liveChannels.entries()) {
      if (s.value.kind === 'scalar') set.add(ch);
    }
    return Array.from(set).sort();
  }, [liveChannels]);

  const knownByChannel = useMemo(() => {
    const m = new Map<string, (typeof KNOWN_CHANNELS)[number]>();
    for (const k of KNOWN_CHANNELS) m.set(k.channel, k);
    return m;
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/config/damping', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/config/damping: ${res.status}`);
      const body = (await res.json()) as DampingConfig;
      setCfg(body);
      setDraft({ ...body });
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const updateDraft = (channel: string, tau: number): void => {
    const clamped = Math.max(0, Math.min(MAX_TAU, tau));
    setDraft((prev) => {
      const next = { ...prev };
      if (clamped <= 0) delete next[channel];
      else next[channel] = clamped;
      return next;
    });
  };

  const handleSave = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const res = await fetch('/api/config/damping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`PUT failed: ${res.status} ${t}`);
      }
      setCfg(draft);
      setOk(true);
      setTimeout(() => setOk(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const applySuggested = (): void => {
    const next: DampingConfig = { ...draft };
    for (const k of KNOWN_CHANNELS) {
      next[k.channel] = k.suggested;
    }
    setDraft(next);
  };

  const clearAll = (): void => {
    setDraft({});
  };

  const dirty = useMemo(() => {
    if (!cfg) return false;
    const aKeys = Object.keys(cfg);
    const bKeys = Object.keys(draft);
    if (aKeys.length !== bKeys.length) return true;
    for (const k of aKeys) {
      if (cfg[k] !== draft[k]) return true;
    }
    return false;
  }, [cfg, draft]);

  return (
    <main className="p-6 space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold">Damping</h1>
      <p className="text-sm text-slate-400">
        Per-channel low-pass filter (EMA) applied at display time. The time constant τ controls how
        much the value is smoothed — 0 disables damping. Values are seconds. Internal compute
        (true-wind, polar) always sees raw samples; damping only affects what tiles, the inspector,
        and tactical software see.
      </p>

      {err && <div className="text-red-400 text-sm">Error: {err}</div>}
      {ok && <div className="text-green-400 text-sm">Saved.</div>}

      <div className="flex gap-2">
        <button
          onClick={() => void handleSave()}
          disabled={busy || !dirty}
          className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50"
        >
          {busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
        <button
          onClick={applySuggested}
          disabled={busy}
          className="px-3 py-1 bg-slate-700 text-slate-200 rounded disabled:opacity-50"
          title="Apply the suggested defaults to all known channels."
        >
          Apply suggested defaults
        </button>
        <button
          onClick={clearAll}
          disabled={busy}
          className="px-3 py-1 bg-slate-700 text-slate-200 rounded disabled:opacity-50"
          title="Set damping to 0 for all channels (no smoothing)."
        >
          Clear all
        </button>
      </div>

      {cfg === null && !err && <p className="text-slate-400">Loading…</p>}

      {cfg !== null && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="p-2">Channel</th>
              <th className="p-2 w-72">τ (s)</th>
              <th className="p-2 w-24 text-right">Value</th>
              <th className="p-2 w-24 text-right">Suggested</th>
            </tr>
          </thead>
          <tbody>
            {visibleChannels.map((ch) => {
              const known = knownByChannel.get(ch);
              const tau = draft[ch] ?? 0;
              return (
                <tr key={ch} className="border-b border-slate-900">
                  <td className="p-2 font-mono">
                    <div>{ch}</div>
                    {known && (
                      <div className="text-xs text-slate-500">
                        {known.label}
                        {known.isAngle && ' · angle'}
                      </div>
                    )}
                  </td>
                  <td className="p-2">
                    <input
                      type="range"
                      min={0}
                      max={MAX_TAU}
                      step={0.1}
                      value={tau}
                      onChange={(e) => updateDraft(ch, Number(e.target.value))}
                      className="w-full"
                    />
                  </td>
                  <td className="p-2 text-right">
                    <input
                      type="number"
                      min={0}
                      max={MAX_TAU}
                      step={0.1}
                      value={tau}
                      onChange={(e) => updateDraft(ch, Number(e.target.value))}
                      className="w-20 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-right font-mono"
                    />
                  </td>
                  <td className="p-2 text-right font-mono text-slate-500">
                    {known ? `${known.suggested.toFixed(1)} s` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="text-xs text-slate-500 pt-4 border-t border-slate-800">
        Damping is applied as an exponential moving average:{' '}
        <span className="font-mono">damped[t] = α·damped[t−1] + (1−α)·raw[t]</span>, with{' '}
        <span className="font-mono">α = exp(−Δt/τ)</span>. Angle channels (heading, wind angle,
        COG, heel/pitch/yaw, …) are damped via atan2(sin, cos) to handle ±π wraparound. After a
        gap longer than 10·τ the filter resets — no smoothing across long pauses.
      </p>
    </main>
  );
}
