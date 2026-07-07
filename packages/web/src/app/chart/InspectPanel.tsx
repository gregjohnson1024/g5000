'use client';
import { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { fmtLatLonDmm } from '../../lib/coords';
import { greatCircleNm, bearingDeg } from '../../lib/geo';
import { MS_TO_KN, cardinal16 } from '../../lib/units';
import { sampleUV, type UvGrid } from '../../lib/grid-sample';
import type { LivePos } from '../../components/LiveBoatMarker';

/**
 * Format a u/v grid sample at the cursor as a single readable line. Wind uses
 * the meteorological convention "FROM" (the direction it blows out of);
 * current uses "SET" (the direction it flows toward). Returns null if the grid
 * is missing or the cursor is outside the grid's coverage.
 */
export function formatCursorUv(
  grid: UvGrid | null,
  cursor: { lat: number; lon: number },
  kind: 'wind' | 'current',
): string | null {
  if (!grid) return null;
  const uv = sampleUV(grid, cursor.lat, cursor.lon);
  if (!uv) return null;
  const speedKn = Math.hypot(uv.u, uv.v) * MS_TO_KN;
  if (kind === 'wind') {
    const fromDeg = (Math.atan2(-uv.u, -uv.v) * 180) / Math.PI;
    const d = ((fromDeg % 360) + 360) % 360;
    return `Wind ${speedKn.toFixed(1)} kn · ${cardinal16(d)} (${d.toFixed(0).padStart(3, '0')}°)`;
  }
  const setDeg = (Math.atan2(uv.u, uv.v) * 180) / Math.PI;
  const d = ((setDeg % 360) + 360) % 360;
  return `Current ${speedKn.toFixed(1)} kn · set ${cardinal16(d)} (${d.toFixed(0).padStart(3, '0')}°)`;
}

/**
 * Depth of the bathy contour line nearest the cursor in pixel space across the
 * whole viewport, or null if no contour features are rendered (e.g. the source
 * hasn't loaded a tile yet, or we're over an area with no bathy at this zoom).
 * Works regardless of whether the user has toggled Depth (GEBCO) visible —
 * BathyLayer keeps the layer mounted with line-opacity 0 when "off" so
 * queryRenderedFeatures still returns features.
 *
 * Per-mousemove cost is O(total vertices in viewport) project() calls. At z6
 * over Bermuda that's ~50–100k vertices and a few ms; if a future zoom level
 * shows lag, switch to a two-stage filter (feature centroid → top-N → all
 * vertices).
 */
export function nearestContourDepth(
  map: maplibregl.Map,
  cursor: { lat: number; lon: number },
): number | null {
  if (!map.getLayer('bathy-contour-line')) return null;
  let feats: maplibregl.MapGeoJSONFeature[] = [];
  try {
    feats = map.queryRenderedFeatures(undefined, { layers: ['bathy-contour-line'] });
  } catch {
    return null; // style not ready
  }
  if (!feats.length) return null;
  const p = map.project([cursor.lon, cursor.lat]);
  let bestSq = Infinity;
  let bestDepth: number | null = null;
  for (const f of feats) {
    const g = f.geometry as GeoJSON.LineString | GeoJSON.MultiLineString;
    const lines: GeoJSON.Position[][] =
      g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of lines) {
      for (const c of line) {
        const q = map.project([c[0]!, c[1]!]);
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const sq = dx * dx + dy * dy;
        if (sq < bestSq) {
          bestSq = sq;
          bestDepth = (f.properties as { depth?: number } | null)?.depth ?? null;
        }
      }
    }
  }
  return bestDepth;
}

/**
 * Content rows shared between the hover preview and the pinned panel.
 * Stateless — the parent controls which lat/lon to show.
 */
function ReadoutRows({
  pos,
  boat,
  map,
  wind,
  current,
}: {
  pos: { lat: number; lon: number };
  boat: LivePos | null;
  map: maplibregl.Map | null;
  wind: UvGrid | null;
  current: UvGrid | null;
}) {
  const hasBoat = !!boat && Number.isFinite(boat.lat) && Number.isFinite(boat.lon);
  const rangeBearing = hasBoat
    ? {
        distNm: greatCircleNm({ lat: boat!.lat, lon: boat!.lon }, pos),
        bearingDeg: bearingDeg({ lat: boat!.lat, lon: boat!.lon }, pos),
      }
    : null;
  const depthM = map ? nearestContourDepth(map, pos) : null;
  const windLine = formatCursorUv(wind, pos, 'wind');
  const currentLine = formatCursorUv(current, pos, 'current');

  return (
    <>
      <div>{fmtLatLonDmm(pos.lat, pos.lon)}</div>
      {windLine && <div className="text-info mt-1">{windLine}</div>}
      {currentLine && <div className="text-series-2 mt-1">{currentLine}</div>}
      {depthM != null && <div className="text-info mt-1">Depth ≈ {depthM} m (nearest isobath)</div>}
      <div className="text-ink-2 mt-1">
        {rangeBearing
          ? `${rangeBearing.distNm.toFixed(1)} NM · ${rangeBearing.bearingDeg
              .toFixed(0)
              .padStart(3, '0')}° from boat`
          : '— · — (boat fix pending)'}
      </div>
    </>
  );
}

export interface InspectPanelWithPinProps {
  /**
   * The parent writes a `pin(pos)` function here on mount (and keeps it
   * up-to-date each render). page.tsx calls `inspectPinRef.current(pos)`
   * from the Map onClick to pin the panel imperatively without lifting state.
   */
  pinRef: React.MutableRefObject<(pos: { lat: number; lon: number }) => void>;
  /** Live cursor position — null when the pointer is off the map. */
  cursor: { lat: number; lon: number } | null;
  /** Live boat fix for range/bearing computations. */
  boat: LivePos | null;
  /** Map instance for depth sampling. */
  map: maplibregl.Map | null;
  /** Wind grid, if loaded. */
  wind: UvGrid | null;
  /** Current grid, if loaded. */
  current: UvGrid | null;
  /**
   * Called when the user confirms "Drop mark" from the pinned panel.
   * Returns the new waypoint id or null on failure.
   */
  onDropMark: (pos: { lat: number; lon: number }) => Promise<string | null>;
  /**
   * Called when the user confirms "Route here" from the pinned panel.
   * Internally: drop-marks first, then sets the route end to the returned id.
   */
  onRouteHere: (pos: { lat: number; lon: number }) => void;
}

/**
 * InspectPanel — BR CornerSlot occupant (T5).
 *
 * Hover (pointer:fine devices — Pi/desktop):
 *   Previews the live cursor position with compact DMM lat/lon + wind/current
 *   + nearest-isobath depth + range/bearing from boat. pointer-events-none so
 *   it never blocks the map.
 *
 * Click / tap → PIN:
 *   Triggered by `inspectPinRef.current(pos)` from the Map onClick in
 *   page.tsx. Pins the panel at that lat/lon, becomes pointer-events-auto, and
 *   shows a ✕ dismiss button plus "Drop mark" and "Route here" action buttons
 *   that reuse the same handlers as ChartContextMenu.
 *
 * Design note: pinnedPos state lives here (not in page.tsx) to keep the
 * component self-contained. The imperative `pinRef` is the seam — page.tsx
 *  writes to it each render so the Map onClick always calls the current
 * setPinned without capturing stale closures.
 */
export function InspectPanelWithPin({
  pinRef,
  cursor,
  boat,
  map,
  wind,
  current,
  onDropMark,
  onRouteHere,
}: InspectPanelWithPinProps) {
  const [pinned, setPinned] = useState<{ lat: number; lon: number } | null>(null);
  const [dropping, setDropping] = useState(false);

  // Keep the imperative pin handle up-to-date each render so page.tsx's Map
  // onClick always has the current setPinned — no stale closure risk.
  pinRef.current = (pos) => setPinned(pos);

  const dismiss = () => {
    setPinned(null);
    setDropping(false);
  };

  const handleDropMark = async () => {
    if (!pinned || dropping) return;
    setDropping(true);
    await onDropMark(pinned);
    setDropping(false);
    dismiss();
  };

  const handleRouteHere = () => {
    if (!pinned) return;
    onRouteHere(pinned);
    dismiss();
  };

  // Dismiss the pinned panel on Escape.
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinned]);

  // ── Pinned mode ──────────────────────────────────────────────────────────
  if (pinned) {
    return (
      <div className="z-30 px-3 py-2 bg-surface/95 border border-hairline-strong text-ink text-xs font-mono rounded shadow-lg pointer-events-auto leading-tight min-w-[220px]">
        {/* Header row with dismiss */}
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-ink-3 text-[10px] uppercase tracking-wide">Pinned</span>
          <button
            onClick={dismiss}
            className="text-ink-3 hover:text-ink-value text-sm leading-none ml-3 -mr-1"
            aria-label="Dismiss inspect panel"
          >
            ✕
          </button>
        </div>

        <ReadoutRows pos={pinned} boat={boat} map={map} wind={wind} current={current} />

        {/* Action buttons */}
        <div className="flex gap-2 mt-2.5">
          <button
            onClick={() => void handleDropMark()}
            disabled={dropping}
            className="flex-1 px-2 py-1 text-[10px] bg-surface-raised hover:bg-hairline-strong disabled:opacity-50 rounded text-ink-value font-sans font-medium"
          >
            {dropping ? 'Dropping…' : 'Drop mark'}
          </button>
          <button
            onClick={handleRouteHere}
            className="flex-1 px-2 py-1 text-[10px] bg-surface-raised hover:bg-hairline-strong rounded text-ink-value font-sans font-medium"
          >
            Route here
          </button>
        </div>
      </div>
    );
  }

  // ── Hover preview mode ────────────────────────────────────────────────────
  // Only renders when the cursor is over the map. pointer-events-none so it
  // never steals clicks from the map beneath it.
  if (!cursor) return null;

  return (
    <div className="z-30 px-3 py-2 bg-surface/85 border border-hairline text-ink text-xs font-mono rounded shadow pointer-events-none leading-tight">
      <ReadoutRows pos={cursor} boat={boat} map={map} wind={wind} current={current} />
    </div>
  );
}
