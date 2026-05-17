'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';

const R_NM = 3440.065; // earth radius in nautical miles (spherical)

/**
 * Direct-geodesic problem on a spherical earth: from `(latDeg, lonDeg)`,
 * travel `distNm` NM along great-circle bearing `brgRad`, return
 * `[latDeg, lonDeg]` at the destination. ~0.5% accuracy at 1000 NM —
 * far tighter than navigation-aid range rings need.
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
  /** Origin point. When null, the rings are cleared. */
  origin: { lat: number; lon: number } | null;
  /** Nautical-mile radii. Order doesn't matter. */
  radiiNm: number[];
  /**
   * Unique id for this instance — used to namespace the MapLibre source
   * and layer so multiple instances on the same map don't collide.
   */
  id: string;
  /** Line color (hex). Default `#94a3b8` (slate-400). */
  color?: string;
  /** Optional prefix shown in each label, e.g. "Sula" or "WF". */
  labelPrefix?: string;
  /** When true, hide the rings without unmounting the component. */
  hidden?: boolean;
}

/**
 * Geodesic range rings around `origin` at each radius in `radiiNm`,
 * with an HTML label at the due-north intersection of each ring.
 * Generalized over origin (live boat position, or any static point),
 * so multiple instances can coexist on a chart — pass a unique `id`
 * to avoid MapLibre source/layer collisions.
 */
export function RangeRings({
  map,
  origin,
  radiiNm,
  id,
  color = '#94a3b8',
  labelPrefix,
  hidden = false,
}: RangeRingsProps) {
  const labelMarkersRef = useRef<Map<number, maplibregl.Marker>>(new Map());
  const sourceId = `range-rings-${id}`;
  const layerId = `range-rings-line-${id}`;

  useEffect(() => {
    if (!map) return;
    const labels = labelMarkersRef.current;

    const ensure = (): void => {
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': color,
            'line-width': 1.2,
            'line-dasharray': [4, 4],
            'line-opacity': 0.7,
          },
        });
      } else {
        map.setPaintProperty(layerId, 'line-color', color);
      }
    };
    if (map.isStyleLoaded()) ensure();
    else map.once('load', ensure);

    const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    if (hidden || !origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) {
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
      geometry: { type: 'LineString', coordinates: ring(origin.lat, origin.lon, nm) },
    }));
    src.setData({ type: 'FeatureCollection', features });

    // Labels at the due-north intersection so they stack vertically above
    // the origin. Reuse markers across updates by keying on radius.
    const live = new Set<number>();
    for (const nm of radiiNm) {
      live.add(nm);
      const [latLabel, lonLabel] = destPoint(origin.lat, origin.lon, nm, 0);
      let mk = labels.get(nm);
      const text = labelPrefix ? `${labelPrefix} ${nm} NM` : `${nm} NM`;
      if (!mk) {
        const el = document.createElement('div');
        el.style.cssText =
          'font: 10px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;' +
          `color: ${color}; background: rgba(11,14,20,0.7);` +
          'padding: 1px 4px; border-radius: 2px;' +
          'transform: translateY(-50%); white-space: nowrap;' +
          'pointer-events: none;';
        el.textContent = text;
        mk = new maplibregl.Marker({ element: el, anchor: 'left' });
        mk.setLngLat([lonLabel, latLabel]).addTo(map);
        labels.set(nm, mk);
      } else {
        mk.setLngLat([lonLabel, latLabel]);
        // Refresh text + color in case props changed.
        const el = mk.getElement();
        el.textContent = text;
        el.style.color = color;
      }
    }
    for (const [k, mk] of labels) {
      if (!live.has(k)) {
        try { mk.remove(); } catch { /* map gone */ }
        labels.delete(k);
      }
    }
  }, [map, origin, radiiNm, hidden, color, labelPrefix, sourceId, layerId]);

  // Clean up on unmount so layer/source/labels go away with the component.
  useEffect(() => {
    return () => {
      const labels = labelMarkersRef.current;
      for (const mk of labels.values()) {
        try { mk.remove(); } catch { /* map gone */ }
      }
      labels.clear();
      if (!map) return;
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        /* map already torn down */
      }
    };
  }, [map, sourceId, layerId]);

  return null;
}
