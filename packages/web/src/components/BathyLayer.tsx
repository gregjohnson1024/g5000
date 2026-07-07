'use client';
import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import type { ExpressionSpecification } from 'maplibre-gl';

const SOURCE_ID = 'bathy-contours';
const LINE_LAYER_ID = 'bathy-contour-line';
// Vector tile layer name baked into the archive (config tippecanoe.layer).
const SOURCE_LAYER = 'depth_contours';

// Depth-based opacity expression used when the layer is "on". Major isobaths
// (>=200 m) are more solid than the shallow set so they read at a glance.
const VISIBLE_OPACITY: ExpressionSpecification = ['case', ['>=', ['get', 'depth'], 200], 0.9, 0.6];

// Depth gradient, smoothly interpolated in HCL (perceptually uniform —
// MapLibre's closest analogue to HSL; naive HSL/HSV would band unevenly in
// luminance). Shallow cyan → royal blue → navy → near-black at the deepest
// abyssal (~10,000 m).
// NOTE: MapLibre paint expressions don't support CSS var() — these must be resolved
// hex values. They derive from info/seq tokens in DAY; see token map below:
//   0m  → #7dd3fc  (sky-300, near --info)
//   200m → #38bdf8  (--info / --seq-3)
//   1000m→ #2563eb  (blue-600, near --info-strong)
//   5000m→ #1e3a8a  (--seq-1)
//   10000m→#050a1a  (near --canvas / --surface-sunken)
const HCL_RAMP: ExpressionSpecification = [
  'interpolate-hcl',
  ['linear'],
  ['get', 'depth'],
  0,
  '#7dd3fc',
  200,
  '#38bdf8',
  1000,
  '#2563eb',
  5000,
  '#1e3a8a',
  10000,
  '#050a1a',
];

// Major isobaths (>=200 m) thicker than the shallow set.
const BASE_WIDTH: ExpressionSpecification = ['case', ['>=', ['get', 'depth'], 200], 1.6, 0.8];

/** Read a CSS custom property from the root element (for MapLibre paint resolution). */
function resolveToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Paint set for a given safety depth. 0/off reproduces the classic ramp
 *  byte-for-byte; >0 flags contours at or shallower than the safety depth in
 *  the danger token color (red), slightly wider and fully opaque, leaving deeper
 *  contours on the HCL ramp. */
function paintFor(safetyDepthM: number, visible: boolean) {
  const shallow: ExpressionSpecification = ['<=', ['get', 'depth'], safetyDepthM];
  // Resolve --danger token at call time so theme changes are reflected.
  const dangerColor = resolveToken('--danger', '#f87171');
  return safetyDepthM > 0
    ? {
        color: ['case', shallow, dangerColor, HCL_RAMP] as ExpressionSpecification,
        width: [
          'case',
          shallow,
          2.4,
          ['>=', ['get', 'depth'], 200],
          1.6,
          0.8,
        ] as ExpressionSpecification,
        opacity: visible
          ? ([
              'case',
              shallow,
              1,
              ['>=', ['get', 'depth'], 200],
              0.9,
              0.6,
            ] as ExpressionSpecification)
          : 0,
      }
    : { color: HCL_RAMP, width: BASE_WIDTH, opacity: visible ? VISIBLE_OPACITY : 0 };
}

/**
 * Depth-contour overlay backed by a precomputed global PMTiles archive
 * (tools/gebco-contour-maker → ~/.g5000-router/bathy-pmtiles/world.pmtiles),
 * served same-origin at /api/bathy-pmtiles and read via the pmtiles:// protocol
 * registered in Map.tsx. Each contour carries a positive `depth` (m) and a
 * per-feature minzoom baked into the tiles, so coarse isobaths show when zoomed
 * out and the dense 20 m set only appears when zoomed in — MapLibre does the
 * zoom-gating, no client fetching.
 *
 * The layer is always mounted; toggling `visible` flips `line-opacity` between
 * the depth-based expression and 0 (rather than setting visibility:'none'),
 * which keeps the source's tiles loaded and lets the cursor-depth readout
 * query rendered features even when the lines are turned off.
 *
 * NOT for navigation — GEBCO is an interpolated ~450 m grid that smooths out
 * shoals and isolated dangers. Situational awareness only.
 */
export function BathyLayer({
  map,
  visible,
  safetyDepthM = 0,
}: {
  map: maplibregl.Map | null;
  visible: boolean;
  /** Highlight contours at/shallower than this (m) in red-orange. 0 = off. */
  safetyDepthM?: number;
}) {
  useEffect(() => {
    if (!map) return;

    const ensure = (): void => {
      try {
        const paint = paintFor(safetyDepthM, visible);
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, {
            type: 'vector',
            url: `pmtiles://${window.location.origin}/api/bathy-pmtiles`,
          });
        }
        if (!map.getLayer(LINE_LAYER_ID)) {
          map.addLayer({
            id: LINE_LAYER_ID,
            type: 'line',
            source: SOURCE_ID,
            'source-layer': SOURCE_LAYER,
            layout: { 'line-join': 'round' },
            paint: {
              'line-color': paint.color,
              'line-width': paint.width,
              'line-opacity': paint.opacity,
            },
          });
        }
        // Idempotent: force visibility back to 'visible' (in case a prior
        // mount left it 'none') and update paint for the current toggle +
        // safety depth. Keeping the layer rendered with line-opacity 0 when
        // "off" is what lets the cursor depth readout work without the user
        // seeing lines.
        map.setLayoutProperty(LINE_LAYER_ID, 'visibility', 'visible');
        map.setPaintProperty(LINE_LAYER_ID, 'line-color', paint.color);
        map.setPaintProperty(LINE_LAYER_ID, 'line-width', paint.width);
        map.setPaintProperty(LINE_LAYER_ID, 'line-opacity', paint.opacity);
      } catch {
        /* style not ready — styledata retry covers it */
      }
    };

    ensure();
    map.on('styledata', ensure);

    return () => {
      map.off('styledata', ensure);
      try {
        if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* map torn down */
      }
    };
  }, [map, visible, safetyDepthM]);

  return null;
}
