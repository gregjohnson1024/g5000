'use client';
import { useRef } from 'react';
import type { LivePos } from './LiveBoatMarker';
import { HoldButton } from './ui/HoldButton';

/**
 * One-tap(-and-hold) man-overboard button.
 *
 * Requires a press held for 800 ms to fire — a red fill sweeps
 * across the button as progress feedback; releasing early cancels. On
 * trigger it POSTs the manual MOB fire to /api/alarms with the current
 * fix as context (position + timestamp) so MobLayer can pin the marker.
 * No fix yet? Fire anyway with empty context — the alarm still sounds.
 *
 * Mouse-driven UI (Pi chart client): pointer events cover mouse fine and
 * cost nothing extra.
 *
 * Implementation note: this component wraps HoldButton (packages/web/src/components/ui/HoldButton.tsx)
 * which provides the canonical hold-with-progress mechanic. MOB-specific
 * behavior (POST /api/alarms + confirmed-state display) is layered here.
 */
export function MobButton({ livePos, className }: { livePos: LivePos | null; className?: string }) {
  const livePosRef = useRef<LivePos | null>(livePos);
  livePosRef.current = livePos;

  async function fire(): Promise<void> {
    const p = livePosRef.current;
    const context = p ? { lat: p.lat, lon: p.lon, t: p.t } : {};
    const res = await fetch('/api/alarms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'mob', action: 'fire', context }),
    });
    // Safety control: only show ✓ when the registry confirmed the fire — a
    // 4xx/5xx must leave the button ready to retry, not fake success.
    // HoldButton shows confirmedLabel on resolved promise; on a non-ok response
    // we throw so the promise rejects and confirmedLabel is NOT shown.
    if (!res.ok) {
      throw new Error(`MOB fire rejected: ${res.status}`);
    }
  }

  return (
    <HoldButton
      holdMs={800}
      onHold={fire}
      confirmedLabel="MOB ✓"
      confirmedDuration={3000}
      fillColor="bg-danger"
      aria-label="Man overboard — press and hold to fire"
      title="Man overboard — press and hold to fire"
      className={`px-3 py-1.5 text-sm font-bold w-[110px] text-left bg-danger-surface text-danger border border-danger-strong hover:bg-[var(--danger-surface)] shadow ${className ?? ''}`}
    >
      MOB
    </HoldButton>
  );
}
