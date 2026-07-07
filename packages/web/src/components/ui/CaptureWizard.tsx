'use client';

/**
 * CaptureWizard — Tier-1 UI primitive for a timed-average calibration capture.
 *
 * Renders the four-state UI (idle → capturing → reviewing → applied) for any
 * calibration page that follows the pattern:
 *   1. User clicks Capture.
 *   2. System averages one or more channels for `durationMs` (default 5000 ms).
 *   3. The caller-supplied `compute` fn receives the averages and returns
 *      { binIdx, newValue, reviewRows } or null (capture failed).
 *   4. User reviews and clicks Apply or Discard.
 *   5. `onApply` is called with the new value; on success the state moves to Applied.
 *
 * Tokens only — no raw hex, no slate-/rose-/emerald- classes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type CaptureState,
  type CaptureResult,
  captureIdle,
  captureStarted,
  captureFinished,
  captureApplied,
  captureFraction,
} from './capture-wizard';
import { Button } from './Button';

// ---------------------------------------------------------------------------
// Prop types
// ---------------------------------------------------------------------------

export interface CaptureWizardProps<T> {
  /**
   * Title shown in the wizard section header.
   * @default "Capture wizard"
   */
  title?: string;
  /**
   * Instruction text shown above the Capture button in idle state.
   */
  instructions: string;
  /**
   * Duration of the averaging window in milliseconds.
   * @default 5000
   */
  durationMs?: number;
  /**
   * Called when the timer fires. Return `null` to abort (wizard returns to
   * idle + the caller's `onError` is invoked with the error message);
   * return a `CaptureResult<T>` to move to reviewing.
   */
  compute: () => CaptureResult<T> | null;
  /**
   * Error message when compute returns null (capture failed).
   */
  failureMessage?: string;
  /**
   * Called when the user clicks Apply in reviewing state.
   * Should PUT the new value to the appropriate API endpoint.
   * Throw or reject to signal an error.
   */
  onApply: (result: CaptureResult<T>) => Promise<void>;
  /**
   * Called when an error occurs (capture failure or apply failure).
   */
  onError: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CaptureWizard<T>({
  title = 'Capture wizard',
  instructions,
  durationMs = 5000,
  compute,
  failureMessage = 'Capture failed: insufficient samples',
  onApply,
  onError,
}: CaptureWizardProps<T>): React.ReactElement {
  const [state, setState] = useState<CaptureState<T>>(captureIdle<T>());
  const [busy, setBusy] = useState(false);
  // For the progress display — re-render at ~4 Hz while capturing.
  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending timers when unmounted.
  useEffect(() => {
    return () => {
      if (tickRef.current !== null) clearInterval(tickRef.current);
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  const startCapture = useCallback(() => {
    const startedAt = Date.now();
    setState(captureStarted<T>(startedAt));

    // Progress tick at ~4 Hz.
    tickRef.current = setInterval(() => setTick((t) => t + 1), 250);

    // Main capture timeout.
    timeoutRef.current = setTimeout(() => {
      if (tickRef.current !== null) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      const result = compute();
      const next = captureFinished<T>(result);
      if (next === null) {
        setState(captureIdle<T>());
        onError(failureMessage);
      } else {
        setState(next);
      }
    }, durationMs);
  }, [compute, durationMs, failureMessage, onError]);

  const handleApply = useCallback(async () => {
    if (state.kind !== 'reviewing') return;
    setBusy(true);
    try {
      await onApply(state.result);
      setState(captureApplied<T>());
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [state, onApply, onError]);

  const handleDiscard = useCallback(() => {
    setState(captureIdle<T>());
  }, []);

  const fraction = state.kind === 'capturing' ? captureFraction(state, durationMs) : 0;
  const pct = Math.round(fraction * 100);

  return (
    <section className="border border-[var(--hairline-strong)] [border-radius:var(--r-panel)] p-4 space-y-3">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="text-xs text-ink-3 max-w-xl">{instructions}</p>

      {/* ---- IDLE ---- */}
      {state.kind === 'idle' && (
        <Button variant="primary" size="sm" onClick={startCapture}>
          Capture
        </Button>
      )}

      {/* ---- CAPTURING ---- */}
      {state.kind === 'capturing' && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-[var(--surface-raised)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] transition-all duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs font-mono text-ink-2 tabular-nums w-8 text-right">{pct}%</span>
          </div>
          <p className="text-xs text-ink-2">Capturing… ({(durationMs / 1000).toFixed(0)} s)</p>
        </div>
      )}

      {/* ---- REVIEWING ---- */}
      {state.kind === 'reviewing' && (
        <div className="space-y-3">
          <dl className="grid gap-y-0.5 text-xs">
            {state.result.reviewRows.map((row) => (
              <div key={row.label} className="grid grid-cols-2 gap-x-4 max-w-xs">
                <dt className="text-ink-3">{row.label}</dt>
                <dd className="font-mono text-ink-value tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={() => void handleApply()} disabled={busy}>
              {busy ? 'Applying…' : 'Apply'}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleDiscard} disabled={busy}>
              Discard
            </Button>
          </div>
        </div>
      )}

      {/* ---- APPLIED ---- */}
      {state.kind === 'applied' && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--ok)]">Applied.</p>
          <Button variant="secondary" size="sm" onClick={handleDiscard}>
            Capture again
          </Button>
        </div>
      )}
    </section>
  );
}
