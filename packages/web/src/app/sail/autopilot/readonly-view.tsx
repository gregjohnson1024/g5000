'use client';

import { useSse } from '../../../hooks/use-sse';
import { InstrumentTile } from '../../../components/ui/InstrumentTile';

const RAD_TO_DEG = 180 / Math.PI;

function fmtAngle(v: number): string {
  // Normalize to [0, 360) for displayed headings.
  let deg = v * RAD_TO_DEG;
  while (deg < 0) deg += 360;
  while (deg >= 360) deg -= 360;
  return `${deg.toFixed(1)}`;
}

function fmtRudder(v: number): string {
  const deg = v * RAD_TO_DEG;
  const sign = deg >= 0 ? '+' : '';
  return `${sign}${deg.toFixed(1)}`;
}

export function ReadonlyView({ apTxEnabled }: { apTxEnabled: boolean }) {
  const { channels, connected } = useSse();

  const modeSample = channels.get('autopilot.mode');
  const targetHdgSample = channels.get('autopilot.target.heading');
  const targetTrackSample = channels.get('autopilot.target.track');
  const rudderSample = channels.get('autopilot.commandedRudder');
  const actualHdgSample = channels.get('autopilot.actual.heading');
  const vesselHdgSample = channels.get('boat.heading.magnetic');

  // Extract typed values
  const modeValue = modeSample?.value.kind === 'enum' ? modeSample.value.value : null;
  const targetHdgValue =
    targetHdgSample?.value.kind === 'scalar' ? targetHdgSample.value.value : null;
  const targetTrackValue =
    targetTrackSample?.value.kind === 'scalar' ? targetTrackSample.value.value : null;
  const rudderValue = rudderSample?.value.kind === 'scalar' ? rudderSample.value.value : null;
  const actualHdgValue =
    actualHdgSample?.value.kind === 'scalar' ? actualHdgSample.value.value : null;
  const vesselHdgValue =
    vesselHdgSample?.value.kind === 'scalar' ? vesselHdgSample.value.value : null;

  // Compute heading error (target − actual), normalized into [-π, π].
  let headingError: number | null = null;
  if (targetHdgValue !== null) {
    const act = actualHdgValue ?? vesselHdgValue;
    if (act !== null) {
      let diff = targetHdgValue - act;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      headingError = diff;
    }
  }

  const modeIsActive = modeValue !== null && modeValue !== 'Standby';

  // Raw sample timestamps for StalenessShroud (computes age internally on its
  // own 1 s tick — correct even when the parent is frozen after SSE stops).
  const modeTMs = modeSample?.t_ms;
  const targetHdgTMs = targetHdgSample?.t_ms;
  const targetTrackTMs = targetTrackSample?.t_ms;
  const rudderTMs = rudderSample?.t_ms;
  // heading error derives from two samples; use the older of the two as the age
  const headingErrorTMs =
    targetHdgSample?.t_ms !== undefined &&
    (actualHdgSample?.t_ms ?? vesselHdgSample?.t_ms) !== undefined
      ? Math.min(targetHdgSample.t_ms, actualHdgSample?.t_ms ?? targetHdgSample.t_ms)
      : undefined;
  const vesselHdgTMs = vesselHdgSample?.t_ms;

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Autopilot</h1>
        <div className="text-xs text-ink-3">{connected ? 'Connected' : 'Reconnecting…'}</div>
      </div>

      {/* Mode tile — amber when active, muted in standby */}
      <section>
        <InstrumentTile
          label="Mode"
          value={modeValue ?? 'Unknown'}
          size="d3"
          severity={modeIsActive ? 'ok' : 'neutral'}
          tMs={modeTMs}
        />
      </section>

      <section className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-ink-2 mb-2">Targets</h2>
          <InstrumentTile
            label="Target heading"
            value={targetHdgValue !== null ? fmtAngle(targetHdgValue) : null}
            unit="°"
            size="d3"
            tMs={targetHdgTMs}
          />
          <InstrumentTile
            label="Target track"
            value={targetTrackValue !== null ? fmtAngle(targetTrackValue) : null}
            unit="°"
            size="d4"
            tMs={targetTrackTMs}
          />
        </div>
        <div className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-ink-2 mb-2">Actual</h2>
          <InstrumentTile
            label="Vessel heading (mag)"
            value={vesselHdgValue !== null ? fmtAngle(vesselHdgValue) : null}
            unit="°"
            size="d3"
            tMs={vesselHdgTMs}
          />
          <InstrumentTile
            label="Heading error (target − actual)"
            value={
              headingError !== null
                ? `${headingError >= 0 ? '+' : ''}${(headingError * RAD_TO_DEG).toFixed(1)}`
                : null
            }
            unit="°"
            size="d4"
            severity={
              headingError !== null && Math.abs(headingError * RAD_TO_DEG) > 5 ? 'ok' : 'neutral'
            }
            tMs={headingErrorTMs}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-ink-2 mb-2">Commanded rudder</h2>
        <InstrumentTile
          label="Rudder"
          value={rudderValue !== null ? fmtRudder(rudderValue) : null}
          unit="°"
          size="d3"
          tMs={rudderTMs}
        />
      </section>

      {!apTxEnabled && (
        <section className="text-xs text-ink-3 pt-4 border-t border-hairline max-w-xl">
          Listen-only. The G5000 does not transmit any autopilot commands. All values above come
          from PGN 127237 broadcast by your H5000 (or other autopilot computer) on the N2K bus. If
          "Unknown" / "—" persists, your autopilot may use B&G-proprietary PGNs instead of (or in
          addition to) standard 127237 — those are decoded in a later plan.
        </section>
      )}
    </>
  );
}
