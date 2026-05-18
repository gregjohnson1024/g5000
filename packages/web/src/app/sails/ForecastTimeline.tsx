'use client';

import { useEffect, useState } from 'react';
import type { SailWardrobe } from '@g5000/db';
import { getConfigColor } from '../../lib/config-color';

interface SailTimelineSegment {
  fromLegIdx: number;
  toLegIdx: number;
  configId: string;
  startTime: number;
  endTime: number;
  durationHours: number;
}

interface PlanRecord {
  id: string;
  name: string;
  createdAt: number;
  route: { distance: number; model: string; sailTimeline?: SailTimelineSegment[] };
}

export function ForecastTimeline({ wardrobe }: { wardrobe: SailWardrobe }) {
  const [latestPlan, setLatestPlan] = useState<PlanRecord | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/plans', { cache: 'no-store' });
        const j = (await r.json()) as {
          ok: boolean;
          items?: PlanRecord[];
          error?: { message: string };
        };
        if (!j.ok) {
          setErr(j.error?.message ?? 'failed to load plans');
          return;
        }
        const sorted = [...(j.items ?? [])].sort((a, b) => b.createdAt - a.createdAt);
        setLatestPlan(sorted[0] ?? null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (err) {
    return (
      <div className="rounded border border-rose-700 bg-rose-900/20 p-3 text-xs text-rose-300">
        Forecast timeline: {err}
      </div>
    );
  }

  if (!latestPlan) {
    return (
      <div className="rounded border border-slate-700 bg-slate-900 p-3 text-xs text-slate-400 italic">
        Plan a route on /chart with the wardrobe enabled to see forecasted sail recommendations.
      </div>
    );
  }

  const timeline = latestPlan.route.sailTimeline;
  if (!timeline || timeline.length === 0) {
    return (
      <div className="rounded border border-slate-700 bg-slate-900 p-3 text-xs text-slate-400 italic">
        Latest plan ({latestPlan.name}) is single-config. Re-plan with the wardrobe to enable the
        timeline.
      </div>
    );
  }

  const totalHours = timeline.reduce((acc, s) => acc + s.durationHours, 0);
  const pxPerHour = Math.max(20, Math.min(80, Math.floor(800 / totalHours)));

  return (
    <div className="rounded border border-slate-700 bg-slate-900 p-3 space-y-1">
      <div className="text-xs text-slate-500 uppercase tracking-wider">
        FORECAST TIMELINE — {latestPlan.name}
      </div>
      <div className="flex overflow-x-auto text-[10px]">
        {timeline.map((seg, i) => {
          const name = wardrobe.configs.find((c) => c.id === seg.configId)?.name ?? seg.configId;
          return (
            <div
              key={i}
              style={{
                width: `${seg.durationHours * pxPerHour}px`,
                background: getConfigColor(seg.configId),
              }}
              className="px-2 py-2 border-r border-slate-800 text-slate-900 whitespace-nowrap font-mono"
              title={`${name} · ${seg.durationHours.toFixed(1)}h · ${new Date(seg.startTime * 1000).toISOString()}`}
            >
              {name} · {seg.durationHours.toFixed(1)}h
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-slate-500">
        Total {totalHours.toFixed(1)} h · {timeline.length} segments. Click any segment to focus the
        chart (not yet implemented).
      </div>
    </div>
  );
}
