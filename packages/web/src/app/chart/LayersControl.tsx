'use client';
import { useEffect, useRef, useState } from 'react';

export interface LayersState {
  /** OSM raster basemap. Defaults true. Off → pure black underneath (handy
   * for NOAA-only or night use). */
  osm: boolean;
  enc: boolean;
  buoys: boolean;
  /** Debug: draw the boundary + z/x/y label of every visible tile. */
  tileGrid: boolean;
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
  onRefreshNoaa,
}: {
  state: LayersState;
  onToggle: (key: keyof LayersState) => void;
  /** Optional handler for the "Refresh NOAA tiles" action — invalidates
   * MapLibre's in-memory tile cache so newly-seeded disk tiles render. */
  onRefreshNoaa?: () => void;
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
          <Row label="OSM base" pressed={state.osm} onClick={() => onToggle('osm')} />
          <Row label="NOAA chart" pressed={state.enc} onClick={() => onToggle('enc')} />
          <Row label="Buoys" pressed={state.buoys} onClick={() => onToggle('buoys')} />
          <Row
            label="Tile grid (debug)"
            pressed={state.tileGrid}
            onClick={() => onToggle('tileGrid')}
          />
          {onRefreshNoaa && state.enc ? (
            <button
              type="button"
              onClick={onRefreshNoaa}
              className="w-full mt-1 px-2 py-1.5 rounded text-xs text-zinc-300 border border-zinc-700 hover:bg-zinc-800"
              title="Drop MapLibre's tile cache and re-fetch NOAA tiles from disk"
            >
              ↻ Refresh NOAA tiles
            </button>
          ) : null}
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
