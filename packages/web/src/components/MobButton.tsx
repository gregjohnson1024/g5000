'use client';
import { useEffect, useRef, useState } from 'react';
import type { LivePos } from './LiveBoatMarker';

/** Hold duration before the alarm fires. Long enough to stop a stray click. */
const HOLD_MS = 800;

/**
 * One-tap(-and-hold) man-overboard button.
 *
 * Requires a press held for {@link HOLD_MS} to fire — a red fill sweeps
 * across the button as progress feedback; releasing early cancels. On
 * trigger it POSTs the manual MOB fire to /api/alarms with the current
 * fix as context (position + timestamp) so MobLayer can pin the marker.
 * No fix yet? Fire anyway with empty context — the alarm still sounds.
 *
 * Mouse-driven UI (Pi chart client): pointer events cover mouse fine and
 * cost nothing extra.
 */
export function MobButton({ livePos, className }: { livePos: LivePos | null; className?: string }) {
  const [progress, setProgress] = useState(0); // 0..1 while held
  const [fired, setFired] = useState(false);
  const raf = useRef<number | null>(null);
  const livePosRef = useRef<LivePos | null>(livePos);
  livePosRef.current = livePos;

  const cancelHold = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setProgress(0);
  };

  useEffect(() => cancelHold, []);

  async function fire() {
    const p = livePosRef.current;
    const context = p ? { lat: p.lat, lon: p.lon, t: p.t } : {};
    try {
      await fetch('/api/alarms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'mob', action: 'fire', context }),
      });
      setFired(true);
      setTimeout(() => setFired(false), 3000);
    } catch {
      // transient — the user will see no banner and can hold again
    }
  }

  const startHold = () => {
    if (raf.current !== null) return;
    const t0 = performance.now();
    const tick = () => {
      const frac = (performance.now() - t0) / HOLD_MS;
      if (frac >= 1) {
        raf.current = null;
        setProgress(0);
        void fire();
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
      aria-label="Man overboard — press and hold to fire"
      title="Man overboard — press and hold to fire"
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative overflow-hidden select-none px-3 py-1.5 text-sm font-bold rounded border shadow w-[110px] text-left bg-red-900/85 text-red-100 border-red-700 hover:bg-red-800 ${className ?? ''}`}
    >
      {/* hold-progress fill sweeping left → right */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-red-500/80"
        style={{ width: `${Math.round(progress * 100)}%` }}
      />
      <span className="relative">{fired ? 'MOB ✓' : 'MOB'}</span>
    </button>
  );
}
