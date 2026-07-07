'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StalenessShroud } from '../../components/ui/StalenessShroud';

/**
 * Position tile with a Copy button. SSE-driven re-renders happen ~5× / sec,
 * which kills any in-progress text selection — making the displayed
 * coordinates effectively un-grabbable by the usual select-and-copy gesture.
 * The button writes the displayed strings verbatim (whatever DMM format
 * fmtLat/fmtLon produce, so what's copied matches exactly what's shown).
 *
 * Pass `tMs` to enable the built-in StalenessShroud on the coordinates.
 */
export function PositionTile({
  positionLat,
  positionLon,
  tMs,
}: {
  positionLat: string | null;
  positionLon: string | null;
  tMs?: number;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCopy = useCallback(async () => {
    if (!positionLat || !positionLon) return;
    const text = `${positionLat}\n${positionLon}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard refused (insecure context / permission) — silent */
    }
  }, [positionLat, positionLon]);
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Effective t_ms for shroud: when value is absent pass undefined so shroud shows '—'
  const effectiveTMs = positionLat !== null ? tMs : undefined;

  return (
    <div className="bg-surface border border-hairline [border-radius:var(--r-panel)] p-4 flex flex-col gap-1 col-span-2 relative">
      <div className="flex items-center justify-between">
        <div className="text-[0.667rem] font-semibold uppercase tracking-[0.08em] text-ink-2">
          Position
        </div>
        <button
          type="button"
          onClick={onCopy}
          disabled={!positionLat || !positionLon}
          className="text-xs px-2 py-0.5 [border-radius:var(--r-badge)] bg-surface-raised border border-hairline hover:border-accent text-ink-2 disabled:opacity-40"
          title="Copy lat / lon to clipboard"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <StalenessShroud
        t_ms={effectiveTMs}
        className="text-[2.25rem] leading-none font-semibold font-mono tabular-nums"
      >
        <span>{positionLat}</span>
      </StalenessShroud>
      <StalenessShroud
        t_ms={effectiveTMs}
        className="text-[2.25rem] leading-none font-semibold font-mono tabular-nums"
      >
        <span>{positionLon}</span>
      </StalenessShroud>
    </div>
  );
}
