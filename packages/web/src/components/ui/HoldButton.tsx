'use client';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { holdFraction, isComplete } from './hold-progress';

/**
 * HoldButton — generalized hold-with-progress interaction extracted from MobButton.
 *
 * A fill sweeps left→right across the button as the user holds; releasing early
 * cancels with no side effect. The onHold callback fires ONLY on a complete hold.
 * Right-click / context menu is suppressed to prevent accidental cancel on long-press.
 *
 * Props:
 *   holdMs     — hold duration in ms, clamped to [600, 1500]. Default 800.
 *   onHold     — called once when the full hold completes (no argument).
 *   confirmedLabel — optional label shown after onHold completes (e.g. "MOB ✓").
 *                    Reverts after 3 s automatically.
 *   confirmedDuration — how long confirmedLabel shows (ms). Default 3000.
 *   fillColor  — Tailwind token class for the sweep fill. Default 'bg-danger'.
 *   children   — button label / content.
 *
 * Tokens only — no raw hex, no slate-/rose-/emerald- classes.
 */
export interface HoldButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  holdMs?: number;
  onHold?: () => void | Promise<void>;
  confirmedLabel?: ReactNode;
  confirmedDuration?: number;
  fillColor?: string;
  children: ReactNode;
}

export function HoldButton({
  holdMs = 800,
  onHold,
  confirmedLabel,
  confirmedDuration = 3000,
  fillColor = 'bg-danger',
  className,
  children,
  disabled,
  ...rest
}: HoldButtonProps): React.ReactElement {
  // Clamp holdMs to [600, 1500] per spec
  const duration = Math.max(600, Math.min(1500, holdMs));

  const [progress, setProgress] = useState(0); // 0..1
  const [confirmed, setConfirmed] = useState(false);
  const raf = useRef<number | null>(null);

  const cancelHold = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setProgress(0);
  };

  // Always cancel on unmount
  useEffect(() => cancelHold, []);

  const startHold = () => {
    if (raf.current !== null || disabled) return;
    const t0 = performance.now();
    const tick = () => {
      const frac = holdFraction(performance.now() - t0, duration);
      if (isComplete(frac)) {
        raf.current = null;
        setProgress(0);
        // Fire the callback
        const result = onHold?.();
        if (result instanceof Promise) {
          void result.then(() => {
            if (confirmedLabel) {
              setConfirmed(true);
              setTimeout(() => setConfirmed(false), confirmedDuration);
            }
          });
        } else if (confirmedLabel) {
          setConfirmed(true);
          setTimeout(() => setConfirmed(false), confirmedDuration);
        }
        return;
      }
      setProgress(frac);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(e) => e.preventDefault()}
      className={[
        'relative overflow-hidden select-none',
        'inline-flex items-center justify-center',
        'transition-colors duration-150',
        '[border-radius:var(--r-control)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--canvas)]',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {/* Hold-progress fill sweeping left → right */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 opacity-80 transition-none ${fillColor}`}
        style={{ width: `${Math.round(progress * 100)}%` }}
      />
      <span className="relative">{confirmed && confirmedLabel ? confirmedLabel : children}</span>
    </button>
  );
}
