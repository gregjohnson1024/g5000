'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { Route } from '@g5000/routing';
import { stateAtTime, type PlaybackRoute, type PlaybackState } from '../../lib/route-playback';

const MODELS = ['GFS', 'ECMWF'] as const;
type Model = (typeof MODELS)[number];
const COLOR: Record<Model, string> = { GFS: '#f59e0b', ECMWF: '#22d3ee' };
const SPEEDS = [1, 4, 16];

function toPlayback(r: Route): PlaybackRoute {
  return { start: r.start, end: r.end, legs: r.legs };
}

export function PlaybackScrubber(props: {
  map: maplibregl.Map | null;
  routes: Partial<Record<Model, Route>>;
  onStates: (states: Partial<Record<Model, PlaybackState>>) => void;
  onWindHour: (t: number) => void;
}) {
  const entries = MODELS.filter((m) => props.routes[m]).map(
    (m) => [m, toPlayback(props.routes[m]!)] as const,
  );
  const tMin = entries.length ? Math.min(...entries.map(([, r]) => r.start)) : 0;
  const tMax = entries.length ? Math.max(...entries.map(([, r]) => r.end)) : 0;

  const [t, setT] = useState(tMin);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const markers = useRef<Partial<Record<Model, maplibregl.Marker>>>({});
  const raf = useRef<number | null>(null);
  const last = useRef<number>(0);

  // Detach a model's map marker and drop the ref. Idempotent — safe to call
  // for a model that has no marker.
  const removeMarker = (m: Model): void => {
    markers.current[m]?.remove();
    markers.current[m] = undefined;
  };

  useEffect(() => {
    setT(tMin);
    setPlaying(false);
  }, [tMin, tMax]);

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number): void => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setT((prev) => {
        const next = prev + dt * speed * 60;
        if (next >= tMax) {
          setPlaying(false);
          return tMax;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, speed, tMax]);

  useEffect(() => {
    const map = props.map;
    const states: Partial<Record<Model, PlaybackState>> = {};
    for (const [m, r] of entries) {
      const s = stateAtTime(r, t);
      states[m] = s;
      if (map) {
        let mk = markers.current[m];
        if (!mk) {
          const el = document.createElement('div');
          el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${COLOR[m]};border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,.5)`;
          mk = new maplibregl.Marker({ element: el });
          markers.current[m] = mk;
        }
        mk.setLngLat([s.lon, s.lat]).addTo(map);
      }
    }
    // Remove ghosts for models no longer in the route set (e.g. re-planned
    // with fewer models) so a dropped model's dot doesn't linger.
    for (const m of MODELS) {
      if (!props.routes[m]) removeMarker(m);
    }
    props.onStates(states);
    props.onWindHour(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, props.map, props.routes]);

  useEffect(() => {
    return () => {
      for (const m of MODELS) removeMarker(m);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (entries.length === 0) return null;
  const fmt = (unix: number): string => new Date(unix * 1000).toISOString().slice(11, 16) + 'Z';

  return (
    <section className="space-y-2 bg-slate-900/60 border border-slate-800 rounded p-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="px-2 py-1 text-sm bg-slate-700 rounded w-16"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="text-xs font-mono">{fmt(t)}</span>
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="bg-slate-900 border border-slate-700 rounded text-xs ml-auto"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
      <input
        type="range"
        min={tMin}
        max={tMax}
        step={60}
        value={t}
        onChange={(e) => {
          setPlaying(false);
          setT(Number(e.target.value));
        }}
        className="w-full"
      />
    </section>
  );
}
