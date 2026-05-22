'use client';
import { useEffect, useRef, useState } from 'react';

export interface LayersState {
  enc: boolean;
  buoys: boolean;
}

/**
 * Top-right popover for chart overlays. The button shows "Layers" plus
 * a tally of how many overlays are on; the panel reveals one row per
 * toggle. Two toggles today: NOAA raster chart, and the NOAA vector
 * buoys layer.
 *
 * If the panel ever drops back to a single toggle, collapse this back
 * to a single button — same logic that drove the previous single-button
 * shape.
 *
 * State lives in chart/page.tsx and persists to `chart:layers`.
 */
export function LayersControl({
  state,
  onToggle,
}: {
  state: LayersState;
  onToggle: (key: keyof LayersState) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const onCount = (state.enc ? 1 : 0) + (state.buoys ? 1 : 0);

  return (
    <div ref={wrapRef} className="absolute top-2 right-2 z-10">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={
          'px-3 h-9 rounded border text-sm font-medium ' +
          (onCount > 0
            ? 'bg-zinc-100 text-zinc-900 border-zinc-100 hover:bg-zinc-200'
            : 'bg-zinc-900/85 text-zinc-100 border-zinc-700 hover:bg-zinc-800')
        }
      >
        Layers {onCount > 0 ? `(${onCount})` : ''}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Chart layers"
          className="mt-2 w-44 rounded border border-zinc-700 bg-zinc-900/95 text-zinc-100 p-2 shadow-lg"
        >
          <Row label="NOAA chart" pressed={state.enc} onClick={() => onToggle('enc')} />
          <Row label="Buoys" pressed={state.buoys} onClick={() => onToggle('buoys')} />
        </div>
      ) : null}
    </div>
  );
}

function Row({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={
        'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm ' +
        (pressed ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-200 hover:bg-zinc-800')
      }
    >
      <span>{label}</span>
      <span aria-hidden="true" className={pressed ? 'opacity-100' : 'opacity-30'}>
        ●
      </span>
    </button>
  );
}
