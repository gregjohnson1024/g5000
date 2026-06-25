'use client';
import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { MayaraClient } from '../lib/radar/mayara-client';
import { RadarCanvas } from '../lib/radar/renderer';
import { rangeBboxCorners } from '../lib/radar/geo';
import type { LivePos } from './LiveBoatMarker';

const SRC = 'radar';
const LAYER = 'radar-layer';
const SIZE = 1024; // offscreen canvas px

export function RadarOverlay(props: {
  map: maplibregl.Map | null;
  pos: LivePos | null;
  /** g5000's same-origin REST proxy base (e.g. `/api/radar`). */
  baseUrl: string;
  /** Direct mayara base for the spoke WebSocket (e.g. `http://host:6502`). */
  wsBase: string;
  opacity: number;
  rangeM: number;
}): null {
  const { map, pos, baseUrl, wsBase, opacity, rangeM } = props;
  // Stable canvas for the component's lifetime — created once, shared by both effects.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  if (!canvasRef.current) {
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    canvasRef.current = c;
  }
  const rcRef = useRef<RadarCanvas | null>(null);
  const posRef = useRef<LivePos | null>(pos);
  posRef.current = pos;

  // Effect A: attach the stable canvas to a CanvasSource/raster-layer on the current map
  // (idempotent ensure, styledata retry). Cleanup removes the layer+source so toggling
  // radar off fully tears down the echoes — no frozen overlay left on the map.
  useEffect(() => {
    if (!map) return;
    const canvas = canvasRef.current!;
    const ensure = (): void => {
      try {
        if (!map.getSource(SRC) && posRef.current) {
          const corners = rangeBboxCorners(posRef.current.lat, posRef.current.lon, rangeM);
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
      try {
        if (map.getLayer(LAYER)) map.removeLayer(LAYER);
        if (map.getSource(SRC)) map.removeSource(SRC);
      } catch {
        /* map may already be torn down */
      }
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effect B: connect MayaraClient → RadarCanvas → drawSpokes (uses the same stable canvas).
  // Guard with `cancelled` so that if cleanup fires before the async chain resolves, the
  // later-opened WS + reconnect loop do not leak.
  useEffect(() => {
    if (!map) return;
    const canvas = canvasRef.current!;
    const client = new MayaraClient({ baseUrl, wsBase });
    let cancelled = false;
    let dispose = (): void => {};
    (async () => {
      const { id, info } = await client.discover();
      if (cancelled) return;
      const caps = await client.capabilities(id);
      if (cancelled) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      rcRef.current = new RadarCanvas(ctx, caps, SIZE);
      const d = client.connectSpokes(
        info.spokeDataUrl,
        (spokes) => rcRef.current?.drawSpokes(spokes),
        () => {},
      );
      if (cancelled) {
        d();
        return;
      }
      dispose = d;
    })().catch(() => {});
    return () => {
      cancelled = true;
      dispose();
    };
  }, [map, baseUrl, wsBase]);

  // Effect C: live opacity
  useEffect(() => {
    if (!map?.getLayer(LAYER)) return;
    map.setPaintProperty(LAYER, 'raster-opacity', opacity);
  }, [map, opacity]);

  // Effect D: re-pin canvas source to boat position and range
  useEffect(() => {
    if (!map || !pos) return;
    const src = map.getSource(SRC) as maplibregl.CanvasSource | undefined;
    src?.setCoordinates(rangeBboxCorners(pos.lat, pos.lon, rangeM));
  }, [map, pos, rangeM]);

  return null;
}
