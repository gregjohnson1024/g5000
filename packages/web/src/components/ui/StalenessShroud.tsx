'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { stalenessState, stalenessClasses, ageLabel } from './staleness';

/**
 * StalenessShroud — per-value freshness state machine.
 *
 * Wraps a value and dims/hollows it as it ages. Accepts the raw sample
 * timestamp (`t_ms`) and computes age internally on a ~1 s tick, so
 * threshold crossings advance correctly even when the parent component is
 * frozen (e.g. SSE stream has stopped sending).
 *
 * States (proposal §5 / staleness.ts):
 *   fresh  (<2s)    — normal rendering
 *   aging  (2-10s)  — text-ink-3 (dims)
 *   stale  (>10s)   — text-ink-4 (hollows) + age chip shown below the value
 *
 * When `t_ms` is undefined (value absent):
 *   Renders '—' in a reserved slot so the tile never collapses.
 *
 * Props:
 *   t_ms      — Unix-ms timestamp of the last live sample (sample.t_ms).
 *                When undefined the value is treated as absent (no data).
 *   className — extra classes applied to the value span (e.g. size tier)
 *   children  — the formatted value string/node to render when present
 */
export interface StalenessShroudProps {
  /**
   * Unix-ms timestamp of the last live sample (sample.t_ms).
   * Undefined = no data yet (renders '—').
   */
  t_ms: number | undefined;
  /** Extra classes applied to the value wrapper (e.g. display-size tier). */
  className?: string;
  /** The formatted value to display when data is present. */
  children?: ReactNode;
}

export function StalenessShroud({
  t_ms,
  className = '',
  children,
}: StalenessShroudProps): React.ReactElement {
  // Tick state — bump every second so the age computation (Date.now() - t_ms)
  // advances even when the parent is frozen (SSE stopped). Computing age HERE
  // inside the shroud's own tick is the critical fix: a frozen parent prop
  // would keep a stale ageMs forever, making a dead value look live.
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // No data path — render the reserved '—' slot
  if (t_ms === undefined) {
    return (
      <span
        aria-label="no data"
        className={['tabular-nums select-none text-ink-4', className].filter(Boolean).join(' ')}
      >
        —
      </span>
    );
  }

  // Compute age NOW, inside the shroud's own render tick. This is correct even
  // when the parent has not re-rendered since the last sample arrived.
  const ageMs = Date.now() - t_ms;
  const state = stalenessState(ageMs);
  const dimClass = stalenessClasses(state);

  return (
    <span className="flex flex-col items-start gap-0.5">
      {/* Value — dims or hollows based on state */}
      <span className={['tabular-nums', dimClass, className].filter(Boolean).join(' ')}>
        {children}
      </span>

      {/* Age chip — only shown in stale state */}
      {state === 'stale' && (
        <span
          aria-label={`data is ${ageLabel(ageMs)} old`}
          className={[
            'inline-flex items-center',
            'px-1.5 py-0.5',
            'text-[0.667rem] font-medium leading-none',
            'border',
            '[border-radius:var(--r-badge)]',
            'bg-stale/20 border-stale text-stale',
          ].join(' ')}
        >
          {ageLabel(ageMs)}
        </span>
      )}
    </span>
  );
}
