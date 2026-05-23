'use client';
import { useEffect, useRef, useState } from 'react';
import type { ChartModel } from './model-layer';

export interface LayersState {
  /** OSM raster basemap. Defaults true. Off → pure black underneath (handy
   * for NOAA-only or night use). */
  osm: boolean;
  enc: boolean;
  buoys: boolean;
  /** Debug: draw the boundary + z/x/y label of every visible tile. */
  tileGrid: boolean;
  /** Mutually-exclusive forecast/current overlay. 'none' = no model overlay. */
  model: ChartModel;
}

/**
 * Top-right popover for chart overlays. The button shows "Layers" plus
 * a tally of how many overlays are on; the panel reveals one row per
 * toggle. Two toggles today: NOAA raster chart, and the NOAA vector
 * buoys layer. A mutually-exclusive radio group selects the model
 * overlay (None / GFS / ECMWF / CMEMS).
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
  onSelectModel,
  onRefreshNoaa,
}: {
  state: LayersState;
  onToggle: (key: 'osm' | 'enc' | 'buoys' | 'tileGrid') => void;
  onSelectModel: (model: ChartModel) => void;
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

  const onCount =
    (state.enc ? 1 : 0) + (state.buoys ? 1 : 0) + (state.model !== 'none' ? 1 : 0);

  return (
    <div ref={wrapRef} className="absolute top-2 right-2 z-10">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={onCount > 0 ? `Layers (${onCount} on)` : 'Layers'}
        title="Chart layers"
        onClick={() => setOpen((v) => !v)}
        className={
          'relative w-9 h-9 rounded border flex items-center justify-center ' +
          (onCount > 0
            ? 'bg-zinc-100 text-zinc-900 border-zinc-100 hover:bg-zinc-200'
            : 'bg-zinc-900/85 text-zinc-100 border-zinc-700 hover:bg-zinc-800')
        }
      >
        <LayersIcon />
        {onCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-bold leading-[1.1rem] text-center bg-amber-500 text-zinc-900 border border-amber-700"
          >
            {onCount}
          </span>
        ) : null}
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
          <div className="mt-1 pt-1 border-t border-zinc-700">
            <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-zinc-400">
              Model overlay
            </div>
            <ModelRow label="None" active={state.model === 'none'} onClick={() => onSelectModel('none')} />
            <ModelRow label="GFS (wind)" active={state.model === 'gfs'} onClick={() => onSelectModel('gfs')} />
            <ModelRow label="ECMWF (wind)" active={state.model === 'ecmwf'} onClick={() => onSelectModel('ecmwf')} />
            <ModelRow label="CMEMS (currents)" active={state.model === 'cmems'} onClick={() => onSelectModel('cmems')} />
          </div>
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

function LayersIcon(): React.ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 2 9 5-9 5-9-5z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
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

function ModelRow({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={
        'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm ' +
        (active ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-200 hover:bg-zinc-800')
      }
    >
      <span>{label}</span>
      <span aria-hidden="true" className={active ? 'opacity-100' : 'opacity-30'}>
        {active ? '◉' : '○'}
      </span>
    </button>
  );
}
