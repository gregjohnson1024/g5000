'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { LivePos } from './LiveBoatMarker';

const SOURCE_ID = 'drift-arrow';
const LAYER_LINE = 'drift-arrow-line';
const LAYER_HEAD = 'drift-arrow-head';
const LAYER_LABEL = 'drift-arrow-label';

const M_PER_NM = 1852;
const M_PER_DEG_LAT = 111_320; // good enough for short arrows

export interface DriftArrowProps {
  map: maplibregl.Map | null;
  p: LivePos | null;
  /** NM per knot — visual scale of the arrow. Default 1 NM/kt. */
  scaleNmPerKt?: number;
}

/**
 * Compute the drift vector from HDG, COG, and SOG assuming the boat's
 * through-water speed equals SOG (no current model). The result is the
 * vector difference (over-ground) − (assumed-through-water), giving the
 * combined leeway + current set in meters/second.
 *
 * Returns null if any input is missing.
 */
export function computeDrift(
  hdgRad: number | null,
  cogRad: number | null,
  sogMps: number | null,
): { magnitudeMps: number; bearingRad: number } | null {
  if (
    hdgRad === null ||
    cogRad === null ||
    sogMps === null ||
    !Number.isFinite(hdgRad) ||
    !Number.isFinite(cogRad) ||
    !Number.isFinite(sogMps)
  ) {
    return null;
  }
  // Compass convention: N = 0, increasing clockwise.
  // east = sin(theta), north = cos(theta)
  const gx = sogMps * Math.sin(cogRad);
  const gy = sogMps * Math.cos(cogRad);
  const wx = sogMps * Math.sin(hdgRad);
  const wy = sogMps * Math.cos(hdgRad);
  const dx = gx - wx;
  const dy = gy - wy;
  const magnitudeMps = Math.hypot(dx, dy);
  if (magnitudeMps < 1e-6) {
    return { magnitudeMps: 0, bearingRad: 0 };
  }
  // atan2(east, north) gives compass bearing.
  let bearingRad = Math.atan2(dx, dy);
  if (bearingRad < 0) bearingRad += 2 * Math.PI;
  return { magnitudeMps, bearingRad };
}

/** Project `from` (lat, lon) `meters` along compass bearing (rad). */
function projectLatLon(
  fromLat: number,
  fromLon: number,
  meters: number,
  bearingRad: number,
): [number, number] {
  const dN = meters * Math.cos(bearingRad);
  const dE = meters * Math.sin(bearingRad);
  const dLat = dN / M_PER_DEG_LAT;
  const dLon = dE / (M_PER_DEG_LAT * Math.cos((fromLat * Math.PI) / 180));
  return [fromLon + dLon, fromLat + dLat];
}

export function DriftArrow({ map, p, scaleNmPerKt = 5 }: DriftArrowProps) {
  const ensuredRef = useRef(false);

  useEffect(() => {
    if (!map) return;
    if (!p) return;

    const ensureLayers = (): void => {
      if (map.getSource(SOURCE_ID)) return;
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: LAYER_LINE,
        type: 'line',
        source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'shaft'],
        paint: { 'line-color': '#06b6d4', 'line-width': 3, 'line-opacity': 0.9 },
      });
      map.addLayer({
        id: LAYER_HEAD,
        type: 'fill',
        source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'head'],
        paint: { 'fill-color': '#06b6d4', 'fill-opacity': 0.9 },
      });
      // No text-symbol layer — the raster-only style has no glyphs URL,
      // and the magnitude is already shown in the sidebar panel.
      void LAYER_LABEL;
    };
    if (map.isStyleLoaded()) ensureLayers();
    else map.once('load', ensureLayers);

    const drift = computeDrift(p.hdg, p.cog, p.sog);
    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!drift || drift.magnitudeMps < 0.05) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const driftKn = drift.magnitudeMps / 0.514444;
    const lengthM = driftKn * scaleNmPerKt * M_PER_NM;
    const tip = projectLatLon(p.lat, p.lon, lengthM, drift.bearingRad);

    // Arrowhead triangle at the tip, 12% of shaft length on each side.
    const headHalfAngle = (20 * Math.PI) / 180;
    const headLen = Math.max(lengthM * 0.12, 200);
    const leftBearing = drift.bearingRad + Math.PI - headHalfAngle;
    const rightBearing = drift.bearingRad + Math.PI + headHalfAngle;
    const left = projectLatLon(tip[1], tip[0], headLen, leftBearing);
    const right = projectLatLon(tip[1], tip[0], headLen, rightBearing);
    const headLabel = `Set ${driftKn.toFixed(1)}kn @ ${((drift.bearingRad * 180) / Math.PI).toFixed(0)}°T`;

    void headLabel;
    src.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { kind: 'shaft' },
          geometry: { type: 'LineString', coordinates: [[p.lon, p.lat], tip] },
        },
        {
          type: 'Feature',
          properties: { kind: 'head' },
          geometry: { type: 'Polygon', coordinates: [[tip, left, right, tip]] },
        },
      ],
    });
    ensuredRef.current = true;

    return () => {
      // No-op per render. Layer cleanup happens on unmount below.
    };
  }, [map, p, scaleNmPerKt]);

  useEffect(() => {
    if (!map) return;
    return () => {
      if (map.getLayer(LAYER_LABEL)) map.removeLayer(LAYER_LABEL);
      if (map.getLayer(LAYER_HEAD)) map.removeLayer(LAYER_HEAD);
      if (map.getLayer(LAYER_LINE)) map.removeLayer(LAYER_LINE);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map]);

  return null;
}
