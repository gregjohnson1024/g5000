'use client';

import { useEffect, useState } from 'react';
import { useSse } from '../hooks/use-sse';

const WINDOW_MS = 30 * 60 * 1000;
const RAD_TO_DEG = 180 / Math.PI;
const WIDTH = 600;
const HEIGHT = 80;

interface Point {
  tMs: number;
  deg: number;
}

export function WindShiftPlot(): React.ReactElement {
  const { channels } = useSse();
  const sample = channels.get('race.windShift.bias');
  const [points, setPoints] = useState<Point[]>([]);

  useEffect(() => {
    if (!sample || sample.value.kind !== 'scalar') return;
    const tMs = Date.now();
    const deg = sample.value.value * RAD_TO_DEG;
    setPoints((prev) => {
      const next = [...prev, { tMs, deg }];
      // Drop anything older than window.
      const cutoff = tMs - WINDOW_MS;
      while (next.length > 0 && next[0]!.tMs < cutoff) next.shift();
      return next;
    });
  }, [sample]);

  if (points.length < 2) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded p-4 text-xs text-slate-500">
        Wind shift plot — waiting for samples…
      </div>
    );
  }

  const tMin = points[0]!.tMs;
  const tMax = points[points.length - 1]!.tMs;
  const tSpan = Math.max(1, tMax - tMin);
  const degMax = Math.max(15, ...points.map((p) => Math.abs(p.deg)));
  const yMid = HEIGHT / 2;
  const yScale = (HEIGHT / 2 - 4) / degMax;
  const pts = points
    .map((p) => {
      const x = ((p.tMs - tMin) / tSpan) * WIDTH;
      const y = yMid - p.deg * yScale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-3">
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
        Wind shift vs 5-min baseline (last 30 min)
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-20">
        <line x1="0" y1={yMid} x2={WIDTH} y2={yMid} stroke="#475569" strokeDasharray="2 2" />
        <polyline points={pts} fill="none" stroke="#fbbf24" strokeWidth="1.5" />
      </svg>
      <div className="text-[10px] text-slate-500 font-mono mt-1">
        ±{degMax.toFixed(0)}° · last {points[points.length - 1]!.deg.toFixed(1)}°
      </div>
    </div>
  );
}
