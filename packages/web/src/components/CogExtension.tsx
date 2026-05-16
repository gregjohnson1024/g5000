'use client';
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import type { LivePos } from './LiveBoatMarker';

const SOURCE_ID = 'cog-extension';
const LAYER_LINE = 'cog-extension-line';
const LAYER_TIP = 'cog-extension-tip';

const M_PER_DEG_LAT = 111_320;

function project(
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

export interface CogExtensionProps {
  map: maplibregl.Map | null;
  p: LivePos | null;
  /** Minutes ahead to extend the line. Default 360 (6 h). */
  totalMinutes?: number;
  /** When true, hide the line. */
  hidden?: boolean;
}

/**
 * Renders a dashed line from the boat extending along COG for
 * `totalMinutes` of travel at the current SOG, with a single circle
 * at the tip showing where the boat will be at that time.
 */
export function CogExtension({
  map,
  p,
  totalMinutes = 360,
  hidden = false,
}: CogExtensionProps) {
  useEffect(() => {
    if (!map) return;
    const ensure = (): void => {
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
        paint: {
          'line-color': '#a78bfa', // violet-400 — distinct from drift cyan
          'line-width': 2,
          'line-dasharray': [3, 2],
        },
      });
      map.addLayer({
        id: LAYER_TIP,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'tip'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#a78bfa',
          'circle-stroke-color': '#0b0e14',
          'circle-stroke-width': 1.5,
        },
      });
    };
    if (map.isStyleLoaded()) ensure();
    else map.once('load', ensure);

    // Z-order is enforced by Map.tsx's `__above-wind__` sentinel; this
    // layer was added without a beforeId so it sits above the sentinel,
    // which is above all wind layers. No moveLayer needed.

    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    if (hidden || !p || typeof p.cog !== 'number' || typeof p.sog !== 'number' || p.sog < 0.05) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const totalM = p.sog * (totalMinutes * 60); // SOG in m/s × seconds
    if (totalM < 200) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const tip = project(p.lat, p.lon, totalM, p.cog);
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { kind: 'shaft' },
        geometry: { type: 'LineString', coordinates: [[p.lon, p.lat], tip] },
      },
      {
        type: 'Feature',
        properties: { kind: 'tip' },
        geometry: { type: 'Point', coordinates: tip },
      },
    ];
    src.setData({ type: 'FeatureCollection', features });
  }, [map, p, totalMinutes, hidden]);
  // Layer cleanup intentionally not registered — the parent Map component
  // calls `map.remove()` on unmount which discards every layer. A separate
  // cleanup effect would race against StrictMode's double-mount and leave
  // the COG extension stripped while p hadn't yet propagated.

  return null;
}
