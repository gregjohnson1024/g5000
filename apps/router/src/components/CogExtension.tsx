'use client';
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import type { LivePos } from './LiveBoatMarker';

const SOURCE_ID = 'cog-extension';
const LAYER_LINE = 'cog-extension-line';
const LAYER_TICKS = 'cog-extension-ticks';
const LAYER_LABELS = 'cog-extension-labels';

const M_PER_DEG_LAT = 111_320;
const M_PER_NM = 1852;

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
  /** Minutes ahead to extend. Default 120. Tick marks at every 30 min. */
  totalMinutes?: number;
  /** Spacing between tick marks in minutes. Default 30. */
  tickMinutes?: number;
  /** When true, hide the line. */
  hidden?: boolean;
}

/**
 * Renders a line from the boat extending along COG for `totalMinutes` of
 * travel at the current SOG, with perpendicular tick marks at every
 * `tickMinutes` step. Useful for collision-avoidance and close-quarters
 * planning — answers "where will I be in N minutes if conditions hold".
 */
export function CogExtension({
  map,
  p,
  totalMinutes = 120,
  tickMinutes = 30,
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
        id: LAYER_TICKS,
        type: 'line',
        source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'tick'],
        paint: { 'line-color': '#a78bfa', 'line-width': 2 },
      });
      // Tick labels use ['get', 'label'] which requires no glyphs URL since
      // we set the layer below as 'circle' (kept simple — labels shown as
      // small filled dots; pixel-precise text would need a glyphs source).
      map.addLayer({
        id: LAYER_LABELS,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'tick-point'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#a78bfa',
          'circle-stroke-color': '#0b0e14',
          'circle-stroke-width': 1.5,
        },
      });
    };
    if (map.isStyleLoaded()) ensure();
    else map.once('load', ensure);

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
    ];
    const tickHalf = Math.max(totalM * 0.02, 250);
    for (let mins = tickMinutes; mins <= totalMinutes; mins += tickMinutes) {
      const dist = p.sog * (mins * 60);
      const center = project(p.lat, p.lon, dist, p.cog);
      const leftBearing = p.cog - Math.PI / 2;
      const rightBearing = p.cog + Math.PI / 2;
      const left = project(center[1], center[0], tickHalf, leftBearing);
      const right = project(center[1], center[0], tickHalf, rightBearing);
      features.push({
        type: 'Feature',
        properties: { kind: 'tick', minutes: mins },
        geometry: { type: 'LineString', coordinates: [left, right] },
      });
      features.push({
        type: 'Feature',
        properties: { kind: 'tick-point', minutes: mins },
        geometry: { type: 'Point', coordinates: center },
      });
    }
    src.setData({ type: 'FeatureCollection', features });
  }, [map, p, totalMinutes, tickMinutes, hidden]);

  useEffect(() => {
    if (!map) return;
    return () => {
      if (map.getLayer(LAYER_LABELS)) map.removeLayer(LAYER_LABELS);
      if (map.getLayer(LAYER_TICKS)) map.removeLayer(LAYER_TICKS);
      if (map.getLayer(LAYER_LINE)) map.removeLayer(LAYER_LINE);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map]);

  return null;
}
