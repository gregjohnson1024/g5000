'use client';
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import type { LivePos } from './LiveBoatMarker';
import { projectGeo } from '../lib/wind-barb';

const SOURCE_ID = 'cog-extension';
const LAYER_LINE = 'cog-extension-line';
const LAYER_TIP = 'cog-extension-tip';

export interface CogExtensionProps {
  map: maplibregl.Map | null;
  p: LivePos | null;
  /** Minutes ahead to extend the line. Default 360 (6 h). Ignored if totalNm is set. */
  totalMinutes?: number;
  /**
   * Fixed extension length in nautical miles. If provided, takes precedence
   * over `totalMinutes` — useful for "show me 100 NM ahead" on a passage
   * chart where the user wants a distance-based horizon, not a time one.
   */
  totalNm?: number;
  /** When true, hide the line. */
  hidden?: boolean;
}

/**
 * Renders a dashed line from the boat extending along COG, with a single
 * circle at the tip. Two horizon modes:
 *
 * - `totalNm` (preferred when set): fixed distance ahead.
 * - `totalMinutes` (fallback): SOG × time horizon — extension grows and
 *   shrinks with speed. Used by AIS targets for "where will everyone be
 *   in N minutes" type rendering.
 */
export function CogExtension({
  map,
  p,
  totalMinutes = 360,
  totalNm,
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
    // Distance-based mode wins if set; otherwise time-based (SOG × time).
    const totalM = totalNm !== undefined ? totalNm * 1852 : p.sog * (totalMinutes * 60);
    if (totalM < 200) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const tip = projectGeo(p.lat, p.lon, totalM, p.cog);
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
  }, [map, p, totalMinutes, totalNm, hidden]);
  // Layer cleanup intentionally not registered — the parent Map component
  // calls `map.remove()` on unmount which discards every layer. A separate
  // cleanup effect would race against StrictMode's double-mount and leave
  // the COG extension stripped while p hadn't yet propagated.

  return null;
}
