'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Position tile with a Copy button. SSE-driven re-renders happen ~5× / sec,
 * which kills any in-progress text selection — making the displayed
 * coordinates effectively un-grabbable by the usual select-and-copy gesture.
 * The button writes the displayed strings verbatim (whatever DMM format
 * fmtLat/fmtLon produce, so what's copied matches exactly what's shown).
 */
export function PositionTile({
  positionLat,
  positionLon,
}: {
  positionLat: string | null;
  positionLon: string | null;
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
  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-4 flex flex-col gap-1 col-span-2 relative">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-slate-400">Position</div>
        <button
          type="button"
          onClick={onCopy}
          disabled={!positionLat || !positionLon}
          className="text-xs px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
          title="Copy lat / lon to clipboard"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <div className="text-3xl font-mono text-slate-100 leading-tight">
        {positionLat ?? <span className="text-slate-500">—</span>}
      </div>
      <div className="text-3xl font-mono text-slate-100 leading-tight">
        {positionLon ?? <span className="text-slate-500">—</span>}
      </div>
    </div>
  );
}
