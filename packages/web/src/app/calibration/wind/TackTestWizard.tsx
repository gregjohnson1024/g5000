'use client';

import { useMemo, useState } from 'react';
import type { AwsAwaCalTable } from '@h6000/db';
import { computeTackCorrection, type TackCapture } from '@h6000/compute';
import { useSse } from '../../../hooks/use-sse.js';
import { useChannelHistory } from '../../../hooks/use-channel-history.js';

const RAD_TO_DEG = 180 / Math.PI;

type WizardState =
  | { kind: 'idle' }
  | { kind: 'awaitingPort' }
  | { kind: 'capturingPort'; startedAt: number }
  | { kind: 'portCaptured'; port: TackCapture }
  | { kind: 'awaitingStarboard'; port: TackCapture }
  | { kind: 'capturingStarboard'; port: TackCapture; startedAt: number }
  | { kind: 'reviewing'; port: TackCapture; starboard: TackCapture }
  | { kind: 'applied' };

const CAPTURE_MS = 5000;
const WINDOW_MS = 6000;

export interface TackTestWizardProps {
  cal: AwsAwaCalTable;
  onApply: (updatedCal: AwsAwaCalTable) => void | Promise<void>;
}

export function TackTestWizard({ cal, onApply }: TackTestWizardProps) {
  const { channels } = useSse();
  const twd = useChannelHistory(channels.get('wind.true.calibrated.direction'), WINDOW_MS);
  const twa = useChannelHistory(channels.get('wind.true.calibrated.angle'), WINDOW_MS);
  const tws = useChannelHistory(channels.get('wind.true.calibrated.speed'), WINDOW_MS);
  const aws = useChannelHistory(channels.get('wind.apparent.speed'), WINDOW_MS);
  const awa = useChannelHistory(channels.get('wind.apparent.angle'), WINDOW_MS);

  const [state, setState] = useState<WizardState>({ kind: 'idle' });

  const liveCapture = (): TackCapture | null => {
    const twdAvg = twd.average();
    const twsAvg = tws.average();
    const awaAvg = awa.average();
    const awsAvg = aws.average();
    if (twdAvg === null || twsAvg === null || awaAvg === null || awsAvg === null) {
      return null;
    }
    return { twd: twdAvg, tws: twsAvg, awa: awaAvg, aws: awsAvg };
  };

  const startCapture = (side: 'port' | 'starboard'): void => {
    const now = Date.now();
    if (side === 'port') {
      setState({ kind: 'capturingPort', startedAt: now });
      setTimeout(() => {
        const cap = liveCapture();
        if (cap) setState({ kind: 'portCaptured', port: cap });
        else setState({ kind: 'awaitingPort' });
      }, CAPTURE_MS);
    } else {
      const port = state.kind === 'awaitingStarboard' ? state.port : null;
      if (!port) return;
      setState({ kind: 'capturingStarboard', port, startedAt: now });
      setTimeout(() => {
        const cap = liveCapture();
        if (cap) setState({ kind: 'reviewing', port, starboard: cap });
        else setState({ kind: 'awaitingStarboard', port });
      }, CAPTURE_MS);
    }
  };

  const result = useMemo(() => {
    if (state.kind !== 'reviewing') return null;
    return computeTackCorrection(cal, state.port, state.starboard);
  }, [state, cal]);

  const handleApply = async (): Promise<void> => {
    if (state.kind !== 'reviewing' || !result) return;
    await onApply(result.previewed);
    setState({ kind: 'applied' });
  };

  const reset = (): void => setState({ kind: 'idle' });

  return (
    <div className="border border-slate-700 rounded p-4 space-y-3">
      <div className="text-lg font-semibold">Tack-test wizard</div>

      <div className="grid grid-cols-3 gap-2 text-xs font-mono text-slate-300">
        <div>TWD: {twd.latest !== null ? `${(twd.latest * RAD_TO_DEG).toFixed(1)}°` : '—'}</div>
        <div>TWA: {twa.latest !== null ? `${(twa.latest * RAD_TO_DEG).toFixed(1)}°` : '—'}</div>
        <div>TWS: {tws.latest !== null ? `${tws.latest.toFixed(2)} m/s` : '—'}</div>
        <div>AWA: {awa.latest !== null ? `${(awa.latest * RAD_TO_DEG).toFixed(1)}°` : '—'}</div>
        <div>AWS: {aws.latest !== null ? `${aws.latest.toFixed(2)} m/s` : '—'}</div>
      </div>

      {state.kind === 'idle' && (
        <button
          onClick={() => setState({ kind: 'awaitingPort' })}
          className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
        >
          Start tack test
        </button>
      )}

      {state.kind === 'awaitingPort' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">
            Sail steady close-hauled on <strong>port tack</strong>. When settled, tap Capture.
          </p>
          <button
            onClick={() => startCapture('port')}
            className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
          >
            Capture port tack
          </button>
        </div>
      )}

      {state.kind === 'capturingPort' && (
        <p className="text-sm text-slate-300">Capturing port tack… (5s)</p>
      )}

      {state.kind === 'portCaptured' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">
            Port captured: TWD {(state.port.twd * RAD_TO_DEG).toFixed(1)}°, TWS{' '}
            {state.port.tws.toFixed(2)} m/s. Now tack to starboard.
          </p>
          <button
            onClick={() => setState({ kind: 'awaitingStarboard', port: state.port })}
            className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
          >
            Tacked — continue
          </button>
        </div>
      )}

      {state.kind === 'awaitingStarboard' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">
            Sail steady close-hauled on <strong>starboard tack</strong>. When settled, tap Capture.
          </p>
          <button
            onClick={() => startCapture('starboard')}
            className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
          >
            Capture starboard tack
          </button>
        </div>
      )}

      {state.kind === 'capturingStarboard' && (
        <p className="text-sm text-slate-300">Capturing starboard tack… (5s)</p>
      )}

      {state.kind === 'reviewing' && result && (
        <div className="space-y-2 text-sm">
          <div className="text-slate-300">
            Port TWD: <span className="font-mono">{(state.port.twd * RAD_TO_DEG).toFixed(1)}°</span>
            <br />
            Starboard TWD:{' '}
            <span className="font-mono">{(state.starboard.twd * RAD_TO_DEG).toFixed(1)}°</span>
            <br />
            Difference:{' '}
            <span className="font-mono">{(result.twdDiff * RAD_TO_DEG).toFixed(2)}°</span>
          </div>
          <div className="text-slate-200">
            Suggested correction at cell (AWS{' '}
            <span className="font-mono">{cal.awsBins[result.cell.awsIdx]!.toFixed(0)}</span>, |AWA|{' '}
            <span className="font-mono">
              {(cal.awaBins[result.cell.awaIdx]! * RAD_TO_DEG).toFixed(0)}°
            </span>
            ): <span className="font-mono">{(result.delta * RAD_TO_DEG).toFixed(2)}°</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleApply}
              className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
            >
              Apply
            </button>
            <button onClick={reset} className="px-3 py-1 bg-slate-700 text-slate-200 rounded">
              Discard
            </button>
          </div>
        </div>
      )}

      {state.kind === 'applied' && (
        <div className="space-y-2">
          <p className="text-sm text-green-400">Correction applied.</p>
          <button onClick={reset} className="px-3 py-1 bg-slate-700 text-slate-200 rounded">
            Run another tack test
          </button>
        </div>
      )}
    </div>
  );
}
