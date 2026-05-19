'use client';

import type { JsonSafeSample } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';

const RAD_TO_DEG = 180 / Math.PI;

function fmtAngle(s: JsonSafeSample | undefined): string {
  if (!s || s.value.kind !== 'scalar') return '—';
  // Normalize to [0, 360) for displayed headings.
  let deg = s.value.value * RAD_TO_DEG;
  while (deg < 0) deg += 360;
  while (deg >= 360) deg -= 360;
  return `${deg.toFixed(1)}°`;
}

function fmtRudder(s: JsonSafeSample | undefined): string {
  if (!s || s.value.kind !== 'scalar') return '—';
  const deg = s.value.value * RAD_TO_DEG;
  const sign = deg >= 0 ? '+' : '';
  return `${sign}${deg.toFixed(1)}°`;
}

function fmtMode(s: JsonSafeSample | undefined): string {
  if (!s) return 'Unknown';
  if (s.value.kind === 'enum') return s.value.value;
  return 'Unknown';
}

function age(s: JsonSafeSample | undefined): string {
  if (!s) return '—';
  const sec = (Date.now() - s.t_ms) / 1000;
  return `${sec.toFixed(1)}s ago`;
}

export function ReadonlyView({ apTxEnabled }: { apTxEnabled: boolean }) {
  const { channels, connected } = useSse();

  const mode = channels.get('autopilot.mode');
  const targetHdg = channels.get('autopilot.target.heading');
  const targetTrack = channels.get('autopilot.target.track');
  const rudder = channels.get('autopilot.commandedRudder');
  const actualHdg = channels.get('autopilot.actual.heading');
  const vesselHdg = channels.get('boat.heading.magnetic');

  // Compute heading error (target − actual), normalized into [-π, π].
  let headingError: number | null = null;
  if (targetHdg?.value.kind === 'scalar') {
    const tgt = targetHdg.value.value;
    let act: number | null = null;
    if (actualHdg?.value.kind === 'scalar') act = actualHdg.value.value;
    else if (vesselHdg?.value.kind === 'scalar') act = vesselHdg.value.value;
    if (act !== null) {
      let diff = tgt - act;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      headingError = diff;
    }
  }

  const modeIsActive = mode?.value.kind === 'enum' && mode.value.value !== 'Standby';

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Autopilot</h1>
        <div className="text-xs text-slate-500">{connected ? 'Connected' : 'Reconnecting…'}</div>
      </div>

      <section>
        <div
          className={`inline-block px-4 py-2 rounded text-2xl font-mono font-semibold ${
            modeIsActive ? 'bg-amber-600 text-slate-900' : 'bg-slate-700 text-slate-300'
          }`}
        >
          {fmtMode(mode)}
        </div>
        <div className="text-xs text-slate-500 mt-1">{age(mode)}</div>
      </section>

      <section className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-slate-400">Targets</h2>
          <div>
            <div className="text-xs text-slate-500">Target heading</div>
            <div className="text-3xl font-mono">{fmtAngle(targetHdg)}</div>
            <div className="text-xs text-slate-500">{age(targetHdg)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Target track</div>
            <div className="text-2xl font-mono">{fmtAngle(targetTrack)}</div>
            <div className="text-xs text-slate-500">{age(targetTrack)}</div>
          </div>
        </div>
        <div className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-slate-400">Actual</h2>
          <div>
            <div className="text-xs text-slate-500">Vessel heading (mag)</div>
            <div className="text-3xl font-mono">{fmtAngle(vesselHdg)}</div>
            <div className="text-xs text-slate-500">{age(vesselHdg)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Heading error (target − actual)</div>
            <div
              className={`text-2xl font-mono ${
                headingError !== null && Math.abs(headingError * RAD_TO_DEG) > 5
                  ? 'text-amber-400'
                  : 'text-slate-200'
              }`}
            >
              {headingError !== null
                ? `${headingError >= 0 ? '+' : ''}${(headingError * RAD_TO_DEG).toFixed(1)}°`
                : '—'}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-slate-400 mb-2">Commanded rudder</h2>
        <div className="text-3xl font-mono">{fmtRudder(rudder)}</div>
        <div className="text-xs text-slate-500">{age(rudder)}</div>
      </section>

      {!apTxEnabled && (
        <section className="text-xs text-slate-500 pt-4 border-t border-slate-800 max-w-xl">
          Listen-only. The G5000 does not transmit any autopilot commands. All values above come
          from PGN 127237 broadcast by your H5000 (or other autopilot computer) on the N2K bus. If
          "Unknown" / "—" persists, your autopilot may use B&G-proprietary PGNs instead of (or in
          addition to) standard 127237 — those are decoded in a later plan.
        </section>
      )}
    </>
  );
}
