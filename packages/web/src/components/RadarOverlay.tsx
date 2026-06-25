'use client';
import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { MayaraClient } from '../lib/radar/mayara-client.js';
import { RadarCanvas } from '../lib/radar/renderer.js';
import { rangeBboxCorners } from '../lib/radar/geo.js';
import type { LivePos } from './LiveBoatMarker.js';

const SRC = 'radar';
const LAYER = 'radar-layer';
const SIZE = 1024; // offscreen canvas px

export function RadarOverlay(props: {
  map: maplibregl.Map | null;
  pos: LivePos | null;
  baseUrl: string;
  opacity: number;
  hidden: boolean;
}): null {
  const { map, pos, baseUrl, opacity, hidden } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rcRef = useRef<RadarCanvas | null>(null);
  const rangeRef = useRef<number>(2000);
  const posRef = useRef<LivePos | null>(pos);
  posRef.current = pos;

  // Effect A: offscreen canvas + CanvasSource/raster-layer (idempotent ensure, styledata retry)
  useEffect(() => {
    if (!map) return;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    canvasRef.current = canvas;
    const ensure = (): void => {
      try {
        if (!map.getSource(SRC) && posRef.current) {
          const corners = rangeBboxCorners(
            posRef.current.lat,
            posRef.current.lon,
            rangeRef.current,
          );
          map.addSource(SRC, {
            type: 'canvas',
            canvas,
            coordinates: corners,
            animate: true,
          } as Parameters<maplibregl.Map['addSource']>[1]);
        }
        if (map.getSource(SRC) && !map.getLayer(LAYER)) {
          map.addLayer({
            id: LAYER,
            type: 'raster',
            source: SRC,
            paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 },
          });
        }
      } catch {
        // retry on styledata
      }
    };
    ensure();
    map.on('styledata', ensure);
    return () => {
      map.off('styledata', ensure);
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effect B: connect MayaraClient → RadarCanvas → drawSpokes
  useEffect(() => {
    if (!map || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const client = new MayaraClient({ baseUrl });
    let dispose = (): void => {};
    (async () => {
      const { id, info } = await client.discover();
      const caps = await client.capabilities(id);
      rangeRef.current = caps.supportedRanges[0] ?? 2000;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      rcRef.current = new RadarCanvas(ctx, caps, SIZE);
      dispose = client.connectSpokes(
        info.spokeDataUrl,
        (spokes) => rcRef.current?.drawSpokes(spokes),
        () => {},
      );
    })().catch(() => {});
    return () => dispose();
  }, [map, baseUrl]);

  // Effect C: live opacity / visibility
  useEffect(() => {
    if (!map?.getLayer(LAYER)) return;
    map.setPaintProperty(LAYER, 'raster-opacity', hidden ? 0 : opacity);
  }, [map, opacity, hidden]);

  // Effect D: re-pin canvas source to boat position
  useEffect(() => {
    if (!map || !pos) return;
    const src = map.getSource(SRC) as maplibregl.CanvasSource | undefined;
    src?.setCoordinates(rangeBboxCorners(pos.lat, pos.lon, rangeRef.current));
  }, [map, pos]);

  return null;
}
