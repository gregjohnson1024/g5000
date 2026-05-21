'use client';
import { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { LivePos } from '../../components/LiveBoatMarker';
import { computeOffscreenAnchor, type OffscreenAnchor } from './offscreen-vessel-edge';

const PILL_PAD = 32;

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
      setAnchor(
        computeOffscreenAnchor({
          projected: { x: projected.x, y: projected.y },
          viewport: { width, height },
          pad: PILL_PAD,
        }),
      );
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
