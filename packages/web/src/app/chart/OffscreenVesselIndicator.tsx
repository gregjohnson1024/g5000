'use client';
import { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { LivePos } from '../../components/LiveBoatMarker';
import { computeOffscreenAnchor, type OffscreenAnchor } from './offscreen-vessel-edge';

const PILL_PAD = 32;

const PILL_HALF_W = 50;
const PILL_HALF_H = 16;

// Persistent corner controls the edge pill must not cover, as generous
// footprints (px, including the corner inset) measured from each corner:
//   tl = ChartFollowControl (follow + orientation stack)
//   tr = ChartToolbar icon rail (Layers / Annotate / Waypoint)
//   bl = MapLibre scale bar + tile-loading chip
//   br = ZoomIndicator
const CORNERS = {
  tl: { w: 52, h: 96 },
  tr: { w: 56, h: 148 },
  bl: { w: 132, h: 44 },
  br: { w: 80, h: 40 },
};

function clampRange(v: number, lo: number, hi: number): number {
  if (lo >= hi) return (lo + hi) / 2; // edge too short to fit both controls
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Keep the edge pill clear of the corner controls for every boat bearing.
 * The pill rides the viewport perimeter, so this slides it ALONG its current
 * edge, away from whichever corner control it would cover — it never leaves
 * the perimeter and its chevron keeps pointing at the boat. Corners are
 * resolved by sliding along the horizontal (top/bottom) edge.
 */
function avoidCornerControls(
  a: OffscreenAnchor,
  width: number,
  height: number,
  pad: number,
): OffscreenAnchor {
  const onTop = a.y <= pad + 0.5;
  const onBottom = a.y >= height - pad - 0.5;
  const onLeft = a.x <= pad + 0.5;
  const onRight = a.x >= width - pad - 0.5;
  let { x, y } = a;
  if (onTop) {
    x = clampRange(x, CORNERS.tl.w + PILL_HALF_W, width - CORNERS.tr.w - PILL_HALF_W);
  } else if (onBottom) {
    x = clampRange(x, CORNERS.bl.w + PILL_HALF_W, width - CORNERS.br.w - PILL_HALF_W);
  }
  if (onLeft && !onTop && !onBottom) {
    y = clampRange(y, CORNERS.tl.h + PILL_HALF_H, height - CORNERS.bl.h - PILL_HALF_H);
  } else if (onRight && !onTop && !onBottom) {
    y = clampRange(y, CORNERS.tr.h + PILL_HALF_H, height - CORNERS.br.h - PILL_HALF_H);
  }
  return { ...a, x, y };
}

/**
 * Corner pill that appears when the vessel is OUT of the viewport AND
 * follow mode is OFF. Anchored to the viewport edge closest to the
 * boat with a chevron pointing toward it and the great-circle-ish
 * straight-line distance in NM.
 *
 * Tap to re-enter follow mode (caller handles the re-centering via
 * the useChartCamera hook).
 */
export function OffscreenVesselIndicator({
  map,
  livePos,
  visible,
  onTap,
}: {
  map: maplibregl.Map | null;
  livePos: LivePos | null;
  visible: boolean;
  onTap: () => void;
}) {
  const [anchor, setAnchor] = useState<OffscreenAnchor | null>(null);
  const [distanceNm, setDistanceNm] = useState<number | null>(null);

  useEffect(() => {
    if (!map || !livePos || !visible) {
      setAnchor(null);
      setDistanceNm(null);
      return;
    }
    const recompute = (): void => {
      const canvas = map.getCanvas();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const projected = map.project([livePos.lon, livePos.lat]);
      const raw = computeOffscreenAnchor({
        projected: { x: projected.x, y: projected.y },
        viewport: { width, height },
        pad: PILL_PAD,
      });
      setAnchor(raw ? avoidCornerControls(raw, width, height, PILL_PAD) : null);
      const center = map.getCenter();
      setDistanceNm(haversineNm(center.lat, center.lng, livePos.lat, livePos.lon));
    };
    recompute();
    map.on('move', recompute);
    return () => {
      map.off('move', recompute);
    };
  }, [map, livePos, visible]);

  if (!anchor || distanceNm === null) return null;
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`Vessel ${distanceNm.toFixed(1)} NM, tap to follow`}
      title="Vessel is off-screen — tap to follow"
      className="absolute z-10 flex items-center gap-1 px-2 h-8 rounded-full bg-amber-500/95 text-slate-900 text-xs font-semibold shadow border border-amber-700"
      style={{
        left: `${anchor.x}px`,
        top: `${anchor.y}px`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <span
        aria-hidden="true"
        style={{ transform: `rotate(${anchor.bearingDeg}deg)`, display: 'inline-block' }}
      >
        ▲
      </span>
      <span>{distanceNm.toFixed(1)} NM</span>
    </button>
  );
}

const NM_PER_KM = 1 / 1.852;

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R_KM = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_KM * c * NM_PER_KM;
}
