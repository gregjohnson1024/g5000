'use client';
import { useEffect, useRef, useState } from 'react';
import type { ChartModel } from './model-layer';

/**
 * The canonical union of all layer toggle keys. Exported so LayersLens,
 * ChartToolbar, and page.tsx all share one declaration instead of three
 * copy-pasted inline union literals.
 */
export type LayerToggleKey =
  | 'osm'
  | 'enc'
  | 'satellite'
  | 'buoys'
  | 'bathy'
  | 'ais'
  | 'aisCog'
  | 'tideStations'
  | 'currentStations'
  | 'radar';

export interface LayersState {
  /** OSM raster basemap. Defaults true. Off → pure black underneath (handy
   * for NOAA-only or night use). */
  osm: boolean;
  enc: boolean;
  /** Esri World Imagery. Opaque; stacks on top of NOAA when both on. */
  satellite: boolean;
  buoys: boolean;
  /** GEBCO/GMRT depth contours. Off by default. */
  bathy: boolean;
  /** AIS target dots. Defaults true. */
  ais: boolean;
  /** COG-projection extension lines on AIS targets. Defaults true. */
  aisCog: boolean;
  /** Tide-station markers overlay. Defaults false. */
  tideStations: boolean;
  /** Tidal-current-station markers overlay. Defaults false. */
  currentStations: boolean;
  /** Radar overlay (Mayara). Defaults false. */
  radar: boolean;
  /** Mutually-exclusive forecast/current overlay. 'none' = no model overlay. */
  model: ChartModel;
}

/**
 * Top-right popover for chart overlays. The button shows a layers icon
 * plus a badge tallying how many overlays are on; the panel reveals one
 * toggle per row (OSM base, NOAA chart, Buoys), a mutually-exclusive radio
 * group for the model overlay (None / GFS / ECMWF / CMEMS), and a Misc
 * section (AIS targets + their COG extensions).
 *
 * State lives in chart/page.tsx and persists to `chart:layers`.
 */
export function LayersControl({
  state,
  onToggle,
  onSelectModel,
  safetyDepthM,
  onSafetyDepthM,
  showTideCurrents,
}: {
  state: LayersState;
  onToggle: (key: LayerToggleKey) => void;
  onSelectModel: (model: ChartModel) => void;
  /** Shallow-contour highlight threshold (m) for the bathy layer. 0 = off. */
  safetyDepthM: number;
  onSafetyDepthM: (m: number) => void;
  /** settings.canadianTideCurrents gate — hides the CHS station toggles when off. */
  showTideCurrents: boolean;
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
    (state.enc ? 1 : 0) +
    (state.satellite ? 1 : 0) +
    (state.buoys ? 1 : 0) +
    (state.bathy ? 1 : 0) +
    (state.model !== 'none' ? 1 : 0);

  return (
    <div ref={wrapRef} className="relative">
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
          className="absolute right-full mr-2 top-0 w-44 rounded border border-zinc-700 bg-zinc-900/95 text-zinc-100 p-2 shadow-lg"
        >
          <Row label="OSM base" pressed={state.osm} onClick={() => onToggle('osm')} />
          <Row label="NOAA chart" pressed={state.enc} onClick={() => onToggle('enc')} />
          <Row label="Satellite" pressed={state.satellite} onClick={() => onToggle('satellite')} />
          <Row label="Buoys" pressed={state.buoys} onClick={() => onToggle('buoys')} />
          <Row label="Depth (GEBCO)" pressed={state.bathy} onClick={() => onToggle('bathy')} />
          {state.bathy ? (
            <label className="flex items-center justify-between px-2 py-1 pl-5 text-sm text-zinc-300">
              Safety depth
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={safetyDepthM}
                  onChange={(e) => onSafetyDepthM(Math.max(0, Number(e.target.value) || 0))}
                  className="w-14 bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-right"
                  aria-label="Safety depth in metres (0 = off)"
                />
                <span className="text-zinc-400">m</span>
              </span>
            </label>
          ) : null}
          <div className="mt-1 pt-1 border-t border-zinc-700">
            <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-zinc-400">
              Model overlay
            </div>
            <ModelRow
              label="None"
              active={state.model === 'none'}
              onClick={() => onSelectModel('none')}
            />
            <ModelRow
              label="GFS (wind)"
              active={state.model === 'gfs'}
              onClick={() => onSelectModel('gfs')}
            />
            <ModelRow
              label="ECMWF (wind)"
              active={state.model === 'ecmwf'}
              onClick={() => onSelectModel('ecmwf')}
            />
            <ModelRow
              label="HRRR (3 km)"
              active={state.model === 'hrrr'}
              onClick={() => onSelectModel('hrrr')}
            />
            <ModelRow
              label="CMEMS (currents)"
              active={state.model === 'cmems'}
              onClick={() => onSelectModel('cmems')}
            />
          </div>
          <div className="mt-1 pt-1 border-t border-zinc-700">
            <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-zinc-400">Misc</div>
            <Row label="AIS targets" pressed={state.ais} onClick={() => onToggle('ais')} />
            {state.ais ? (
              <Row
                label="AIS COG ext"
                pressed={state.aisCog}
                indent
                onClick={() => onToggle('aisCog')}
              />
            ) : null}
            {showTideCurrents ? (
              <>
                <Row
                  label="Tide stations"
                  pressed={state.tideStations}
                  onClick={() => onToggle('tideStations')}
                />
                <Row
                  label="Current stations"
                  pressed={state.currentStations}
                  onClick={() => onToggle('currentStations')}
                />
              </>
            ) : null}
            <Row label="Radar" pressed={state.radar} onClick={() => onToggle('radar')} />
          </div>
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
  indent = false,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  /** Nudge the label right to read as a sub-toggle of the row above. */
  indent?: boolean;
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
      <span className={indent ? 'pl-3 text-zinc-300' : undefined}>{label}</span>
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
