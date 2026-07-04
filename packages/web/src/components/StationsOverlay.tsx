'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import {
  summarizeTide,
  summarizeCurrent,
  fmtSetDeg,
  CURRENT_KIND_LABEL,
} from '../lib/station-summary';

type Kind = 'tide' | 'current';

export interface StationsOverlayProps {
  /** Map instance from `<Map onLoad>`. Pass null until ready. */
  map: maplibregl.Map | null;
  kind: Kind;
}

interface StationFeatureProps {
  id: string;
  name: string;
  sourceId?: string;
}

/** Local clock label, e.g. "14:02". Not pure (locale/tz) — kept out of station-summary. */
function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Cyan teardrop (tide) / magenta double-chevron (current) drawn to a canvas.
 *  Returns ImageData for map.addImage — no glyphs/sprite dependency. */
function makeStationIcon(kind: Kind): { data: ImageData; pixelRatio: number } | null {
  const pixelRatio = 2;
  const size = 18; // logical px
  const dim = size * pixelRatio;
  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(pixelRatio, pixelRatio);
  if (kind === 'tide') {
    const cx = size / 2;
    const w = 5;
    ctx.beginPath();
    ctx.moveTo(cx, 2);
    ctx.bezierCurveTo(cx + w, 8, cx + w, 13, cx, 16);
    ctx.bezierCurveTo(cx - w, 13, cx - w, 8, cx, 2);
    ctx.closePath();
    ctx.fillStyle = '#22d3ee'; // cyan-400
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0b0e14';
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#e879f9'; // fuchsia-400
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const chevron = (ox: number): void => {
      ctx.beginPath();
      ctx.moveTo(ox, 4);
      ctx.lineTo(ox + 5, size / 2);
      ctx.lineTo(ox, size - 4);
      ctx.stroke();
    };
    chevron(5);
    chevron(10);
  }
  return { data: ctx.getImageData(0, 0, dim, dim), pixelRatio };
}

function deepLink(kind: Kind, p: StationFeatureProps): string {
  if (kind === 'tide') {
    return `/tide?source=${encodeURIComponent(p.sourceId ?? '')}&station=${encodeURIComponent(p.id)}`;
  }
  return `/currents?station=${encodeURIComponent(p.id)}`;
}

/** Fetch this station's live data and format the one-line popup summary. */
async function fetchSummaryLine(kind: Kind, p: StationFeatureProps): Promise<string> {
  try {
    if (kind === 'tide') {
      const r = await fetch(
        `/api/tide/events?stationId=${encodeURIComponent(p.id)}&source=${encodeURIComponent(p.sourceId ?? '')}`,
      );
      const j = (await r.json().catch(() => ({ ok: false }))) as {
        ok: boolean;
        events?: Parameters<typeof summarizeTide>[0];
      };
      if (!r.ok || !j.ok) return 'data unavailable';
      const s = summarizeTide(j.events ?? [], Date.now());
      if (!s) return 'outside forecast window';
      const next = s.next
        ? ` · → ${s.next.type} ${s.next.heightM.toFixed(1)} m ${fmtClock(s.next.timeMs)}`
        : '';
      return `Height ${s.heightNowM.toFixed(1)} m${s.state ? ` · ${s.state}` : ''}${next}`;
    }
    const r = await fetch(`/api/currents/predictions?stationId=${encodeURIComponent(p.id)}`);
    const j = (await r.json().catch(() => ({ ok: false }))) as {
      ok: boolean;
      predictions?: Parameters<typeof summarizeCurrent>[0];
      events?: Parameters<typeof summarizeCurrent>[1];
    };
    if (!r.ok || !j.ok) return 'data unavailable';
    const s = summarizeCurrent(j.predictions ?? [], j.events ?? [], Date.now());
    if (!s) return 'no current data';
    const next = s.next ? ` · → ${CURRENT_KIND_LABEL[s.next.kind]} ${fmtClock(s.next.timeMs)}` : '';
    return `Set ${fmtSetDeg(s.dirDeg)} · Drift ${s.speedKn.toFixed(1)} kn${next}`;
  } catch {
    return 'data unavailable';
  }
}

/**
 * Renders tide or tidal-current stations as clustered icons on the chart.
 * Tap a cluster to expand it; tap a station for a popup with a live summary
 * (height/set-drift now + next event) and an "Open" button that deep-links
 * into /tide or /currents with that station pre-selected. Static markers —
 * live data is fetched only on tap, never per marker.
 */
export function StationsOverlay({ map, kind }: StationsOverlayProps): null {
  // Captured in a ref so the imperatively-built popup's Open handler always
  // calls the latest router without re-running the map effect.
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const popupRef = useRef<maplibregl.Popup | null>(null);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    let lastData: GeoJSON.FeatureCollection | null = null;
    let idleHandler: (() => void) | null = null;

    const srcId = `stations-${kind}`;
    const clusterLayerId = `stations-${kind}-cluster`;
    const stationLayerId = `stations-${kind}-point`;
    const iconId = `station-icon-${kind}`;
    const clusterColor = kind === 'tide' ? '#0e7490' : '#a21caf';

    const ensureIcon = (): void => {
      if (map.hasImage(iconId)) return;
      const icon = makeStationIcon(kind);
      if (icon) map.addImage(iconId, icon.data, { pixelRatio: icon.pixelRatio });
    };

    const ensureLayers = (data: GeoJSON.FeatureCollection): void => {
      ensureIcon();
      if (!map.getSource(srcId)) {
        map.addSource(srcId, {
          type: 'geojson',
          data,
          cluster: true,
          clusterRadius: 50,
          clusterMaxZoom: 11,
        });
      }
      if (!map.getLayer(clusterLayerId)) {
        map.addLayer({
          id: clusterLayerId,
          type: 'circle',
          source: srcId,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': clusterColor,
            'circle-opacity': 0.85,
            'circle-stroke-color': '#0b0e14',
            'circle-stroke-width': 1.5,
            'circle-radius': ['step', ['get', 'point_count'], 12, 25, 16, 100, 22],
          },
        });
      }
      if (!map.getLayer(stationLayerId)) {
        map.addLayer({
          id: stationLayerId,
          type: 'symbol',
          source: srcId,
          filter: ['!', ['has', 'point_count']],
          layout: {
            'icon-image': iconId,
            'icon-size': 1,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        });
      }
    };

    // Re-add the icon (and source/layers if dropped) when the style reloads.
    const onStyleData = (): void => {
      if (!map.isStyleLoaded()) return;
      ensureIcon();
      if (lastData && !map.getSource(srcId)) ensureLayers(lastData);
    };
    map.on('styledata', onStyleData);

    const onClusterClick = (e: maplibregl.MapLayerMouseEvent): void => {
      const f = e.features?.[0];
      const clusterId = f?.properties?.cluster_id;
      if (clusterId == null) return;
      const src = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const coords = (f!.geometry as GeoJSON.Point).coordinates as [number, number];
      void src
        .getClusterExpansionZoom(clusterId as number)
        .then((zoom) => map.easeTo({ center: coords, zoom }))
        .catch(() => {
          /* cluster gone — ignore */
        });
    };

    const onStationClick = (e: maplibregl.MapLayerMouseEvent): void => {
      const f = e.features?.[0];
      if (!f) return;
      const props = f.properties as StationFeatureProps;
      const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];

      const root = document.createElement('div');
      root.className = 'text-xs font-mono';
      const title = document.createElement('div');
      title.textContent = props.name;
      title.style.fontWeight = '600';
      title.style.marginBottom = '2px';
      const line = document.createElement('div');
      line.textContent = 'Loading…';
      line.style.color = '#94a3b8';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Open';
      btn.style.cssText =
        'margin-top:6px;padding:2px 10px;border-radius:4px;border:none;' +
        'background:#0284c7;color:#fff;cursor:pointer;font:inherit;';
      btn.addEventListener('click', () => {
        popupRef.current?.remove();
        routerRef.current.push(deepLink(kind, props));
      });
      root.append(title, line, btn);

      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 8 })
        .setLngLat(coords)
        .setDOMContent(root)
        .addTo(map);

      void fetchSummaryLine(kind, props).then((text) => {
        // Popup may have been closed/replaced before the fetch resolved.
        if (line.isConnected) line.textContent = text;
      });
    };

    const onEnter = (): void => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const onLeave = (): void => {
      map.getCanvas().style.cursor = '';
    };

    const endpoint = kind === 'tide' ? '/api/tide/stations' : '/api/currents/stations';
    void (async () => {
      try {
        const r = await fetch(endpoint);
        const j = (await r.json().catch(() => null)) as {
          ok: boolean;
          sources?: Record<string, { id: string; name: string; lat: number; lon: number }[]>;
          stations?: { id: string; name: string; lat: number; lon: number }[];
        } | null;
        if (cancelled || !map || !r.ok || !j || !j.ok) return;

        const features: GeoJSON.Feature[] = [];
        if (kind === 'tide') {
          for (const [sourceId, arr] of Object.entries(j.sources ?? {})) {
            for (const s of arr) {
              if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
              features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
                properties: { id: s.id, name: s.name, sourceId },
              });
            }
          }
        } else {
          for (const s of j.stations ?? []) {
            if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
            features.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
              properties: { id: s.id, name: s.name },
            });
          }
        }

        if (!map.isStyleLoaded()) {
          await new Promise<void>((resolve) => {
            idleHandler = (): void => resolve();
            map.once('idle', idleHandler);
          });
          if (cancelled) return;
        }
        lastData = { type: 'FeatureCollection', features };
        ensureLayers(lastData);

        map.on('click', clusterLayerId, onClusterClick);
        map.on('click', stationLayerId, onStationClick);
        for (const id of [clusterLayerId, stationLayerId]) {
          map.on('mouseenter', id, onEnter);
          map.on('mouseleave', id, onLeave);
        }
      } catch {
        /* outage — overlay renders nothing */
      }
    })();

    return () => {
      cancelled = true;
      if (idleHandler) {
        try {
          map.off('idle', idleHandler);
        } catch {
          /* map gone */
        }
      }
      map.off('styledata', onStyleData);
      map.off('click', clusterLayerId, onClusterClick);
      map.off('click', stationLayerId, onStationClick);
      for (const id of [clusterLayerId, stationLayerId]) {
        map.off('mouseenter', id, onEnter);
        map.off('mouseleave', id, onLeave);
      }
      try {
        map.getCanvas().style.cursor = '';
      } catch {
        /* canvas gone */
      }
      popupRef.current?.remove();
      popupRef.current = null;
      for (const id of [clusterLayerId, stationLayerId]) {
        try {
          if (map.getLayer(id)) map.removeLayer(id);
        } catch {
          /* style torn down */
        }
      }
      try {
        if (map.getSource(srcId)) map.removeSource(srcId);
      } catch {
        /* style torn down */
      }
    };
  }, [map, kind]);

  return null;
}
