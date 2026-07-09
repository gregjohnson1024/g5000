'use client';
import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import type { LivePos } from './LiveBoatMarker';
import { cssColor } from '../lib/map-colors';

const SRC = 'anchor-watch';
const ZONE_FILL = 'anchor-zone-fill';
const ZONE_LINE = 'anchor-zone-line';
const RODE_LINE = 'anchor-rode-line';
const POINT_LAYER = 'anchor-point';
const LABEL_LAYER = 'anchor-label';

export interface AnchorZone {
  anchorPoint: { lat: number; lon: number };
  radiusM: number;
  coneDeg?: number;
  coneCenterDeg?: number;
  /** True while the anchor-watch breach condition currently holds. */
  breached: boolean;
}

const R = 6371_008.8;
const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;

/** Spherical forward geodesic (mirror of @g5000/compute anchor-geometry; kept client-side). */
function destPoint(lat: number, lon: number, bearingDeg: number, distM: number): [number, number] {
  const delta = distM / R;
  const theta = toRad(bearingDeg);
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [((toDeg(lon2) + 540) % 360) - 180, toDeg(lat2)]; // GeoJSON [lon, lat]
}

/**
 * ~64-point watch-zone polygon: a full circle by default, or a pie sector
 * (anchor vertex + arc) when coneDeg < 360 with a defined centre bearing.
 */
function zonePolygon(zone: AnchorZone): GeoJSON.Position[] {
  const { anchorPoint, radiusM } = zone;
  const cone = zone.coneDeg ?? 360;
  const N = 64;
  const ring: GeoJSON.Position[] = [];
  if (cone < 360 && zone.coneCenterDeg !== undefined) {
    const start = zone.coneCenterDeg - cone / 2;
    ring.push([anchorPoint.lon, anchorPoint.lat]); // sector apex at the anchor
    for (let i = 0; i <= N; i++) {
      ring.push(destPoint(anchorPoint.lat, anchorPoint.lon, start + (cone * i) / N, radiusM));
    }
  } else {
    for (let i = 0; i <= N; i++) {
      ring.push(destPoint(anchorPoint.lat, anchorPoint.lon, (360 * i) / N, radiusM));
    }
  }
  ring.push(ring[0]!); // close
  return ring;
}

function featureCollection(zone: AnchorZone, live: LivePos | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [
    {
      type: 'Feature',
      properties: { kind: 'zone', breached: zone.breached },
      geometry: { type: 'Polygon', coordinates: [zonePolygon(zone)] },
    },
    {
      type: 'Feature',
      properties: { kind: 'anchor' },
      geometry: { type: 'Point', coordinates: [zone.anchorPoint.lon, zone.anchorPoint.lat] },
    },
  ];
  if (live) {
    features.push({
      type: 'Feature',
      properties: { kind: 'rode' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [live.lon, live.lat],
          [zone.anchorPoint.lon, zone.anchorPoint.lat],
        ],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Anchor-watch chart layer.
 *
 * Polls /api/alarms/anchor every 2 s (same cadence as AlarmBanner / MobLayer).
 * While armed, draws the anchor marker at the resolved anchor position, the
 * watch zone (circle, or sector when coneDeg < 360) and a dashed rode line
 * from the live boat to the anchor. The zone fill flips red while the breach
 * condition holds (breached comes back on the same poll — no second fetch).
 *
 * Annotation layer: appends normally (no beforeId) so it renders above the
 * `__above-wind__` sentinel like AIS/route/waypoints.
 */
export function AnchorWatchLayer({
  map,
  livePos,
}: {
  map: maplibregl.Map | null;
  livePos: LivePos | null;
}) {
  const [zone, setZone] = useState<AnchorZone | null>(null);
  const livePosRef = useRef<LivePos | null>(livePos);
  livePosRef.current = livePos;
  const zoneRef = useRef<AnchorZone | null>(zone);
  zoneRef.current = zone;

  // Poll the anchor endpoint for the armed threshold + live breach state.
  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const r = await fetch('/api/alarms/anchor', { cache: 'no-store' });
        if (stopped) return;
        const body = await r.json();
        const anchor = body?.anchor as
          | {
              armed?: boolean;
              point?: { lat: number; lon: number };
              anchorPoint?: { lat: number; lon: number };
              radiusM?: number;
              coneDeg?: number;
              coneCenterDeg?: number;
            }
          | undefined;
        const anchorPoint = anchor?.anchorPoint ?? anchor?.point;
        if (body?.ok && anchor?.armed && anchorPoint && typeof anchor.radiusM === 'number') {
          setZone({
            anchorPoint,
            radiusM: anchor.radiusM,
            coneDeg: anchor.coneDeg,
            coneCenterDeg: anchor.coneCenterDeg,
            breached: body.breached === true,
          });
        } else {
          setZone(null);
        }
      } catch {
        // transient
      }
    }
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  // Source + layers while armed; full teardown on weigh.
  useEffect(() => {
    if (!map || !zone) return;
    const ensure = () => {
      try {
        if (!map.getSource(SRC)) {
          map.addSource(SRC, {
            type: 'geojson',
            data: featureCollection(zoneRef.current ?? zone, livePosRef.current),
          });
        }
        if (!map.getLayer(ZONE_FILL)) {
          map.addLayer({
            id: ZONE_FILL,
            type: 'fill',
            source: SRC,
            filter: ['==', ['get', 'kind'], 'zone'],
            paint: {
              'fill-color': [
                'case',
                ['get', 'breached'],
                cssColor('--danger', '#f87171'),
                cssColor('--info', '#38bdf8'),
              ],
              'fill-opacity': ['case', ['get', 'breached'], 0.25, 0.1],
            },
          });
        }
        if (!map.getLayer(ZONE_LINE)) {
          map.addLayer({
            id: ZONE_LINE,
            type: 'line',
            source: SRC,
            filter: ['==', ['get', 'kind'], 'zone'],
            paint: {
              'line-color': [
                'case',
                ['get', 'breached'],
                cssColor('--danger', '#f87171'),
                cssColor('--info', '#38bdf8'),
              ],
              'line-width': 1.5,
            },
          });
        }
        if (!map.getLayer(RODE_LINE)) {
          map.addLayer({
            id: RODE_LINE,
            type: 'line',
            source: SRC,
            filter: ['==', ['get', 'kind'], 'rode'],
            paint: {
              'line-color': cssColor('--ink-2', '#94a3b8'),
              'line-width': 1.5,
              'line-dasharray': [2, 2],
            },
          });
        }
        if (!map.getLayer(POINT_LAYER)) {
          map.addLayer({
            id: POINT_LAYER,
            type: 'circle',
            source: SRC,
            filter: ['==', ['get', 'kind'], 'anchor'],
            paint: {
              'circle-radius': 5,
              'circle-color': cssColor('--surface', '#0f172a'),
              'circle-stroke-color': cssColor('--info', '#38bdf8'),
              'circle-stroke-width': 2,
            },
          });
        }
        if (!map.getLayer(LABEL_LAYER)) {
          map.addLayer({
            id: LABEL_LAYER,
            type: 'symbol',
            source: SRC,
            filter: ['==', ['get', 'kind'], 'anchor'],
            layout: {
              'text-field': 'ANCHOR',
              'text-size': 10,
              'text-offset': [0, -1.4],
              'text-allow-overlap': true,
            },
            paint: {
              'text-color': cssColor('--info', '#38bdf8'),
              'text-halo-color': cssColor('--surface', '#0f172a'),
              'text-halo-width': 1.2,
            },
          });
        }
      } catch {
        // style not ready yet — retried on styledata
      }
    };
    ensure();
    map.on('styledata', ensure);
    return () => {
      map.off('styledata', ensure);
      try {
        for (const id of [LABEL_LAYER, POINT_LAYER, RODE_LINE, ZONE_LINE, ZONE_FILL]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(SRC)) map.removeSource(SRC);
      } catch {
        /* map already torn down */
      }
    };
  }, [map, zone === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the rode pinned to the moving boat and the zone/breach tint current
  // without re-creating layers.
  useEffect(() => {
    if (!map || !zone) return;
    try {
      const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
      src?.setData(featureCollection(zone, livePos));
    } catch {
      /* source mid-teardown; next poll re-ensures */
    }
  }, [map, zone, livePos]);

  return null;
}
