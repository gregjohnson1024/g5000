'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { LivePos } from './LiveBoatMarker';

const SOURCE_ID = 'range-rings';
const LAYER_LINE = 'range-rings-line';

const R_NM = 3440.065; // earth radius in nautical miles (spherical)

/**
 * Resolve a geodesic point: from (lat, lon) on a unit-radius sphere,
 * traveling `distNm` nautical miles along great-circle bearing `brgRad`,
 * return the destination [lat, lon] in degrees. Standard direct-geodesic
 * problem on a spherical earth — accurate to ~0.5% at 1000 NM, which is
 * vastly tighter than we need for navigation-aid range rings.
 */
function destPoint(latDeg: number, lonDeg: number, distNm: number, brgRad: number): [number, number] {
  const φ1 = (latDeg * Math.PI) / 180;
  const λ1 = (lonDeg * Math.PI) / 180;
  const δ = distNm / R_NM;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(brgRad),
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(brgRad) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
  );
  return [(φ2 * 180) / Math.PI, (((λ2 * 180) / Math.PI + 540) % 360) - 180];
}

function ring(latDeg: number, lonDeg: number, distNm: number, segments = 128): GeoJSON.Position[] {
  const coords: GeoJSON.Position[] = [];
  for (let i = 0; i <= segments; i++) {
    const brg = (i / segments) * 2 * Math.PI;
    const [φ, λ] = destPoint(latDeg, lonDeg, distNm, brg);
    coords.push([λ, φ]);
  }
  return coords;
}

export interface RangeRingsProps {
  map: maplibregl.Map | null;
  p: LivePos | null;
  /** Nautical-mile radii. Default [200, 250, 300]. Order doesn't matter. */
  radiiNm?: number[];
  /** When true, hide the rings. */
  hidden?: boolean;
}

/**
 * Draws geodesic range rings around the boat at the given NM radii,
 * with an HTML label at the north intersection of each ring. Useful for
 * passage planning — quickly see what's within ~one to one-and-a-half
 * days' run.
 */
export function RangeRings({
  map,
  p,
  radiiNm = [200, 250, 300],
  hidden = false,
}: RangeRingsProps) {
  const labelMarkersRef = useRef<Map<number, maplibregl.Marker>>(new Map());

  useEffect(() => {
    if (!map) return;
    const labels = labelMarkersRef.current;

    const ensure = (): void => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer(LAYER_LINE)) {
        map.addLayer({
          id: LAYER_LINE,
          type: 'line',
          source: SOURCE_ID,
          paint: {
            'line-color': '#94a3b8', // slate-400 — neutral, not competing with route/AIS
            'line-width': 1.2,
            'line-dasharray': [4, 4],
            'line-opacity': 0.7,
          },
        });
      }
    };
    if (map.isStyleLoaded()) ensure();
    else map.once('load', ensure);

    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    if (hidden || !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
      src.setData({ type: 'FeatureCollection', features: [] });
      for (const mk of labels.values()) {
        try { mk.remove(); } catch { /* map gone */ }
      }
      labels.clear();
      return;
    }

    const features: GeoJSON.Feature[] = radiiNm.map((nm) => ({
      type: 'Feature',
      properties: { nm },
      geometry: { type: 'LineString', coordinates: ring(p.lat, p.lon, nm) },
    }));
    src.setData({ type: 'FeatureCollection', features });

    // Labels: HTML markers at the due-north intersection so they stack
    // vertically above the boat. One per radius. We reuse markers across
    // updates by keying on the radius value.
    const live = new Set<number>();
    for (const nm of radiiNm) {
      live.add(nm);
      const [latLabel, lonLabel] = destPoint(p.lat, p.lon, nm, 0);
      let mk = labels.get(nm);
      if (!mk) {
        const el = document.createElement('div');
        el.style.cssText =
          'font: 10px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;' +
          'color: #94a3b8; background: rgba(11,14,20,0.7);' +
          'padding: 1px 4px; border-radius: 2px;' +
          'transform: translateY(-50%); white-space: nowrap;' +
          'pointer-events: none;';
        el.textContent = `${nm} NM`;
        mk = new maplibregl.Marker({ element: el, anchor: 'left' });
        mk.setLngLat([lonLabel, latLabel]).addTo(map);
        labels.set(nm, mk);
      } else {
        mk.setLngLat([lonLabel, latLabel]);
      }
    }
    for (const [k, mk] of labels) {
      if (!live.has(k)) {
        try { mk.remove(); } catch { /* map gone */ }
        labels.delete(k);
      }
    }
  }, [map, p, radiiNm, hidden]);

  return null;
}
