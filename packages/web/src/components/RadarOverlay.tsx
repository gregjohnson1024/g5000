'use client';
import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { mapAlive } from './Map';
import { MayaraClient } from '../lib/radar/mayara-client';
import { RadarCanvas } from '../lib/radar/renderer';
import { rangeBboxCorners } from '../lib/radar/geo';
import type { LivePos } from './LiveBoatMarker';

const SRC = 'radar';
const LAYER = 'radar-layer';
const SIZE = 1024; // offscreen canvas px
// Cadence at which the offscreen canvas is pushed into the MapLibre ImageSource.
// ~3/s is smooth for a radar sweep (a full revolution is ~2.5 s) and keeps the
// per-tick `toDataURL` encode cost modest on low-end chart clients.
const REFRESH_MS = 300;

type Corners = ReturnType<typeof rangeBboxCorners>;

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
  // Latest range read by the refresh interval (which lives in effect A, deps [map]).
  const rangeMRef = useRef(rangeM);
  rangeMRef.current = rangeM;
  // Lets effect D (which fires on position change) trigger effect A's `ensure`,
  // so the source/layer get added once the live fix arrives after mount.
  const ensureRef = useRef<() => void>(() => {});

  // Effect A: drive the stable canvas onto an ImageSource/raster-layer on the current
  // map (idempotent ensure, styledata retry), and push the canvas in on a cadence.
  //
  // We deliberately use an `image` source, NOT a `canvas` source. MapLibre only
  // re-uploads a CanvasSource's GL texture during a source-update pass (`_sourcesDirty`),
  // not on a plain `triggerRepaint`/render — so with nothing else continuously animating,
  // the CanvasSource uploads its (initially blank) texture once and never refreshes.
  // Echoes painted to the offscreen canvas were therefore invisible on the map (verified
  // on real hardware GL: vector + raster-tile + ImageSource all render, CanvasSource does
  // not). `ImageSource.updateImage` re-uploads the texture explicitly, so we re-encode the
  // canvas and push it every REFRESH_MS. Cleanup removes the layer+source so toggling radar
  // off fully tears down the echoes — no frozen overlay left on the map.
  useEffect(() => {
    if (!map) return;
    const canvas = canvasRef.current!;
    const cornersNow = (): Corners | null => {
      const p = posRef.current;
      return p ? rangeBboxCorners(p.lat, p.lon, rangeMRef.current) : null;
    };
    const ensure = (): void => {
      try {
        const corners = cornersNow();
        if (!map.getSource(SRC) && corners) {
          map.addSource(SRC, {
            type: 'image',
            url: canvas.toDataURL('image/png'),
            coordinates: corners,
          });
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
    ensureRef.current = ensure;
    ensure();
    map.on('styledata', ensure);
    const timer = setInterval(() => {
      if (!mapAlive(map)) return;
      const src = map.getSource(SRC) as maplibregl.ImageSource | undefined;
      const corners = cornersNow();
      if (!src || !corners) return;
      try {
        src.updateImage({ url: canvas.toDataURL('image/png'), coordinates: corners });
      } catch {
        // source mid-teardown; the next tick retries
      }
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
      map.off('styledata', ensure);
      ensureRef.current = () => {};
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
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Retry discover/capabilities on failure (mayara booting, proxy route warming)
    // so the overlay self-heals; once connected, the WS handles its own reconnect.
    const attempt = async (): Promise<void> => {
      try {
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
      } catch {
        if (!cancelled) timer = setTimeout(() => void attempt(), 2000);
      }
    };
    void attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      dispose();
    };
  }, [map, baseUrl, wsBase]);

  // Effect C: live opacity
  useEffect(() => {
    if (!map?.getLayer(LAYER)) return;
    map.setPaintProperty(LAYER, 'raster-opacity', opacity);
  }, [map, opacity]);

  // Effect D: re-pin the image source to boat position and range for snappy response on
  // a fix/range change (the REFRESH_MS tick also re-pins, but only every REFRESH_MS).
  // Also runs `ensure` first, so the source/layer are created when the live fix arrives
  // after mount (the styledata retry in effect A does not fire on position updates).
  useEffect(() => {
    if (!map || !pos) return;
    ensureRef.current();
    const src = map.getSource(SRC) as maplibregl.ImageSource | undefined;
    src?.setCoordinates(rangeBboxCorners(pos.lat, pos.lon, rangeM));
  }, [map, pos, rangeM]);

  return null;
}
