'use client';
import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import type { LivePos } from './LiveBoatMarker';
import { fmtLatLonDmm } from '../lib/coords';
import { cssColor } from '../lib/map-colors';
import { haversineM, initialBearingDeg } from '../lib/mob';
import { fmtClockTime, toDayKey } from '../lib/tz';
import { useShipClock } from '../lib/use-ship-clock';

const SRC = 'mob';
const LINE_LAYER = 'mob-return-line';
const POINT_LAYER = 'mob-point';
const LABEL_LAYER = 'mob-label';

interface MobState {
  lat: number;
  lon: number;
  /** ISO timestamp of the fire transition (registry firedAt). */
  firedAt: string;
}

interface AlarmRow {
  id: string;
  firedAt: string;
  context?: Record<string, unknown>;
}

function featureCollection(mob: MobState, live: LivePos | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [
    {
      type: 'Feature',
      properties: { kind: 'mob' },
      geometry: { type: 'Point', coordinates: [mob.lon, mob.lat] },
    },
  ];
  if (live) {
    features.push({
      type: 'Feature',
      properties: { kind: 'return' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [live.lon, live.lat],
          [mob.lon, mob.lat],
        ],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * MOB chart layer + locked panel.
 *
 * Polls /api/alarms every 2 s (same cadence as AlarmBanner). While an
 * active 'mob' alarm carries a position in its context, draws:
 *  - a distinctive MOB marker (red core, white ring, 'MOB' text), and
 *  - a return line from the live boat position to the MOB point,
 * plus a fixed bottom-left panel with the locked coordinates, fire time,
 * and a live bearing/distance readout back to the point. Ack tears
 * everything down (layers, source, panel).
 *
 * Annotation layer: appends normally (no beforeId) so it renders above
 * the `__above-wind__` sentinel like AIS/route/waypoints.
 */
export function MobLayer({
  map,
  livePos,
}: {
  map: maplibregl.Map | null;
  livePos: LivePos | null;
}) {
  const clock = useShipClock();
  const [mob, setMob] = useState<MobState | null>(null);
  const livePosRef = useRef<LivePos | null>(livePos);
  livePosRef.current = livePos;
  const mobRef = useRef<MobState | null>(mob);
  mobRef.current = mob;

  // Poll the alarm registry for an active MOB with a position.
  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const r = await fetch('/api/alarms', { cache: 'no-store' });
        if (stopped) return;
        const body = await r.json();
        const active = (body.active ?? []) as AlarmRow[];
        const row = active.find((a) => a.id === 'mob');
        const lat = row?.context?.lat;
        const lon = row?.context?.lon;
        if (row && typeof lat === 'number' && typeof lon === 'number') {
          setMob({ lat, lon, firedAt: row.firedAt });
        } else {
          setMob(null);
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

  // Source + layers while a positioned MOB alarm is active; full teardown after.
  useEffect(() => {
    if (!map || !mob) return;
    const ensure = () => {
      try {
        if (!map.getSource(SRC)) {
          map.addSource(SRC, {
            type: 'geojson',
            data: featureCollection(mobRef.current ?? mob, livePosRef.current),
          });
        }
        if (!map.getLayer(LINE_LAYER)) {
          map.addLayer({
            id: LINE_LAYER,
            type: 'line',
            source: SRC,
            filter: ['==', ['get', 'kind'], 'return'],
            paint: {
              'line-color': cssColor('--danger', '#f87171'),
              'line-width': 2.5,
              'line-dasharray': [2, 1.5],
            },
          });
        }
        if (!map.getLayer(POINT_LAYER)) {
          map.addLayer({
            id: POINT_LAYER,
            type: 'circle',
            source: SRC,
            filter: ['==', ['get', 'kind'], 'mob'],
            paint: {
              'circle-radius': 8,
              'circle-color': cssColor('--danger-strong', '#dc2626'),
              'circle-stroke-color': cssColor('--ink-value', '#f1f5f9'),
              'circle-stroke-width': 3,
            },
          });
        }
        if (!map.getLayer(LABEL_LAYER)) {
          map.addLayer({
            id: LABEL_LAYER,
            type: 'symbol',
            source: SRC,
            filter: ['==', ['get', 'kind'], 'mob'],
            layout: {
              'text-field': 'MOB',
              'text-size': 12,
              'text-offset': [0, -1.6],
              'text-allow-overlap': true,
            },
            paint: {
              'text-color': cssColor('--danger', '#f87171'),
              'text-halo-color': cssColor('--ink-value', '#f1f5f9'),
              'text-halo-width': 1.5,
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
        for (const id of [LABEL_LAYER, POINT_LAYER, LINE_LAYER]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(SRC)) map.removeSource(SRC);
      } catch {
        /* map already torn down */
      }
    };
  }, [map, mob === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the return line pinned to the moving boat (and the point to any
  // refreshed context) without re-creating layers.
  useEffect(() => {
    if (!map || !mob) return;
    try {
      const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
      src?.setData(featureCollection(mob, livePos));
    } catch {
      /* source mid-teardown; next poll re-ensures */
    }
  }, [map, mob, livePos]);

  async function ack() {
    try {
      const res = await fetch('/api/alarms', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'mob', action: 'ack' }),
      });
      // Only clear locally when the ack actually landed — otherwise the marker
      // vanishes for a poll cycle and pops back, reading as a glitch.
      if (res.ok) setMob(null); // don't wait for the next poll to drop the marker
    } catch {
      // transient — the next click retries
    }
  }

  if (!mob) return null;

  const distM = livePos ? haversineM(livePos, mob) : null;
  const brgDeg = livePos ? initialBearingDeg(livePos, mob) : null;
  const distText =
    distM === null
      ? '—'
      : distM < 1852
        ? `${Math.round(distM)} m`
        : `${(distM / 1852).toFixed(2)} NM`;
  const brgText = brgDeg === null ? '—' : `${Math.round(brgDeg).toString().padStart(3, '0')}°T`;
  const firedSec = Date.parse(mob.firedAt) / 1000;
  // Seconds matter on a MOB timestamp (elapsed-time reckoning), so compose
  // date + seconds-precision time rather than the minute-resolution stamp.
  const firedText = `${toDayKey(firedSec, clock)} ${fmtClockTime(firedSec, clock)}`;

  return (
    <div className="absolute bottom-3 left-3 z-20 w-64 rounded border border-red-700 bg-slate-900/90 shadow-lg">
      <div className="flex items-center justify-between bg-red-700 px-3 py-1.5">
        <span className="text-sm font-bold text-white">MOB</span>
        <button
          type="button"
          onClick={() => void ack()}
          className="rounded border border-red-300 px-2 py-0.5 text-xs font-semibold text-red-100 hover:bg-red-600"
        >
          Ack
        </button>
      </div>
      <div className="space-y-1 px-3 py-2 font-mono text-xs text-slate-200">
        <div>{fmtLatLonDmm(mob.lat, mob.lon)}</div>
        <div className="text-slate-400">{firedText}</div>
        <div>
          <span className="text-slate-400">to MOB </span>
          {brgText} / {distText}
        </div>
      </div>
    </div>
  );
}
