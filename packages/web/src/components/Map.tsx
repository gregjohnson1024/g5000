'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface MapProps {
  center: { lat: number; lon: number };
  zoom: number;
  onClick?: (latLon: { lat: number; lon: number }) => void;
  onLoad?: (m: maplibregl.Map) => void;
}

export function Map({ center, zoom, onClick, onLoad }: MapProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Track the latest onClick/onLoad in a ref so the map's listeners (which
  // are bound once in the [] effect below) always call through to the
  // current closure. Without this, the click handler captures the initial
  // `start`/`end` props from the parent and never sees state updates —
  // every click would set start, never end.
  const onClickRef = useRef(onClick);
  const onLoadRef = useRef(onLoad);
  onClickRef.current = onClick;
  onLoadRef.current = onLoad;
  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            // Same-origin tile proxy backed by an on-disk cache under
            // ${G5000_ROUTER_ROOT}/tile-cache. First view of a tile fetches
            // from openstreetmap.org and writes to disk; subsequent views
            // never hit the network. Survives autopilot restarts.
            tiles: ['/api/tiles/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          // Solid black floor: when OSM (and every overlay) is toggled off
          // the canvas should be true black, not MapLibre's default grey.
          { id: '__bg-black__', type: 'background', paint: { 'background-color': '#000000' } },
          { id: 'osm', type: 'raster', source: 'osm' },
        ],
      },
      center: [center.lon, center.lat],
      zoom,
      // This is a 2D chartplotter — overlays are screen-plane (boat marker,
      // range rings, tile grid) and there's no terrain/extrusion/globe in
      // play. MapLibre enables pitch gestures by default (for 3D use); turn
      // them off so the camera can't tilt off straight-down. maxPitch:0 also
      // blocks the keyboard pitch path (shift+arrow), not just the gestures.
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
    });
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'nautical' }), 'bottom-left');
    (window as unknown as { __g5kMap?: maplibregl.Map }).__g5kMap = map;
    map.on('click', (e) => {
      onClickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });
    map.on('load', () => {
      // Canonical z-order sentinel. Wind layers add with
      // `beforeId='__above-wind__'` so they sit between OSM and this
      // marker; all annotation layers (trail, COG ext, AIS, route,
      // isochrones, waypoints) just appendLayer — they end up above the
      // sentinel and therefore above all wind layers. Single rule, no
      // moveLayer fights between components.
      if (!map.getLayer('__above-wind__')) {
        map.addLayer({
          id: '__above-wind__',
          type: 'background',
          layout: { visibility: 'none' },
          paint: { 'background-color': 'rgba(0,0,0,0)' },
        });
      }
      onLoadRef.current?.(map);
    });
    mapRef.current = map;
    return () => {
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref} className="w-full h-full" />;
}
