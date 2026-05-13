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
  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [center.lon, center.lat],
      zoom,
    });
    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 120, unit: 'nautical' }),
      'bottom-left',
    );
    // Expose for in-page debugging — set on a global so we can inspect
    // layer order from the dev console / playwright.
    (window as unknown as { __g5kMap?: maplibregl.Map }).__g5kMap = map;
    if (onClick) {
      map.on('click', (e) => onClick({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    }
    if (onLoad) {
      map.on('load', () => onLoad(map));
    }
    mapRef.current = map;
    return () => { map.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref} className="w-full h-full" />;
}
