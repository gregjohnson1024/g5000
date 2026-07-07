/**
 * capture-wizard — pure state machine for a timed-average capture flow.
 *
 * Used by calibration pages that follow the pattern:
 *   idle → capturing{startedAt} → reviewing{binIdx, newValue, reviewRows} → applied
 *
 * Factored out of the hand-rolled machines in bsp/page.tsx and compass/page.tsx
 * so the transitions can be unit-tested without a DOM or React dependency.
 *
 * The compute function supplied by the caller receives the raw averaged samples
 * and returns the result to display during the reviewing state.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A row shown in the review card. */
export interface ReviewRow {
  label: string;
  value: string;
}

/** Result returned by the caller-supplied compute function. */
export interface CaptureResult<T> {
  /** Index of the bin that was snapped to. */
  binIdx: number;
  /** The new calibration value to write into that bin. */
  newValue: T;
  /** Human-readable rows shown in the review card. */
  reviewRows: ReviewRow[];
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type CaptureState<T> =
  | { kind: 'idle' }
  | { kind: 'capturing'; startedAt: number }
  | { kind: 'reviewing'; result: CaptureResult<T> }
  | { kind: 'applied' };

/**
 * Return the initial idle state (typed helper for call-sites).
 */
export function captureIdle<T>(): CaptureState<T> {
  return { kind: 'idle' };
}

/**
 * Return the capturing state — records `startedAt` for progress tracking.
 */
export function captureStarted<T>(startedAt: number): CaptureState<T> {
  return { kind: 'capturing', startedAt };
}

/**
 * Transition from capturing to reviewing.
 *
 * Returns `null` when the compute function signals a failure (by returning
 * null) — callers should return to idle and display an error.
 */
export function captureFinished<T>(result: CaptureResult<T> | null): CaptureState<T> | null {
  if (result === null) return null;
  return { kind: 'reviewing', result };
}

/**
 * Transition from reviewing to applied.
 */
export function captureApplied<T>(): CaptureState<T> {
  return { kind: 'applied' };
}

/**
 * Fraction of the capture duration elapsed, in [0, 1].
 * Returns 0 for non-capturing states.
 */
export function captureFraction(state: CaptureState<unknown>, durationMs: number): number {
  if (state.kind !== 'capturing') return 0;
  if (durationMs <= 0) return 1;
  const elapsed = Date.now() - state.startedAt;
  return Math.min(1, elapsed / durationMs);
}
