'use client';

import { useEffect, useState } from 'react';

export interface RollingAvg {
  ms: number;
  coveredMs: number;
  windowMs: number;
}
export interface RollingAngle {
  rad: number;
  concentration: number;
  coveredMs: number;
  windowMs: number;
}
export interface RollingMotion {
  heelRmsRad: number | null;
  pitchRmsRad: number | null;
  combinedRmsRad: number | null;
  coveredMs: number;
  windowMs: number;
}
export interface RollingStats {
  avgSog: RollingAvg | null;
  avgCog: RollingAngle | null;
  avgHdg: RollingAngle | null;
  motion: RollingMotion | null;
}

/** Polls /api/stats/{sog,cog,hdg,motion} every 2 s. Server owns the buffers,
 *  so unmount/remount (tab switch) doesn't reset the averages. */
export function useRollingStats(): RollingStats {
  const [avgSog, setAvgSog] = useState<RollingAvg | null>(null);
  const [avgCog, setAvgCog] = useState<RollingAngle | null>(null);
  const [avgHdg, setAvgHdg] = useState<RollingAngle | null>(null);
  const [motion, setMotion] = useState<RollingMotion | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const [sogR, cogR, hdgR, motionR] = await Promise.all([
          fetch('/api/stats/sog', { cache: 'no-store' }),
          fetch('/api/stats/cog', { cache: 'no-store' }),
          fetch('/api/stats/hdg', { cache: 'no-store' }),
          fetch('/api/stats/motion', { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        if (sogR.ok) {
          const j = (await sogR.json()) as {
            ok: boolean;
            stats?: { avgMs: number | null; coveredMs: number; windowMs: number };
          };
          if (j.ok && j.stats && j.stats.avgMs !== null) {
            setAvgSog({
              ms: j.stats.avgMs,
              coveredMs: j.stats.coveredMs,
              windowMs: j.stats.windowMs,
            });
          }
        }
        if (cogR.ok) {
          const j = (await cogR.json()) as {
            ok: boolean;
            stats?: {
              avgRad: number | null;
              concentration: number;
              coveredMs: number;
              windowMs: number;
            };
          };
          if (j.ok && j.stats && j.stats.avgRad !== null) {
            setAvgCog({
              rad: j.stats.avgRad,
              concentration: j.stats.concentration,
              coveredMs: j.stats.coveredMs,
              windowMs: j.stats.windowMs,
            });
          }
        }
        if (hdgR.ok) {
          const j = (await hdgR.json()) as {
            ok: boolean;
            stats?: {
              avgRad: number | null;
              concentration: number;
              coveredMs: number;
              windowMs: number;
            };
          };
          if (j.ok && j.stats && j.stats.avgRad !== null) {
            setAvgHdg({
              rad: j.stats.avgRad,
              concentration: j.stats.concentration,
              coveredMs: j.stats.coveredMs,
              windowMs: j.stats.windowMs,
            });
          }
        }
        if (motionR.ok) {
          const j = (await motionR.json()) as {
            ok: boolean;
            stats?: {
              heelRmsRad: number | null;
              pitchRmsRad: number | null;
              combinedRmsRad: number | null;
              coveredMs: number;
              windowMs: number;
            };
          };
          if (j.ok && j.stats) {
            setMotion({
              heelRmsRad: j.stats.heelRmsRad,
              pitchRmsRad: j.stats.pitchRmsRad,
              combinedRmsRad: j.stats.combinedRmsRad,
              coveredMs: j.stats.coveredMs,
              windowMs: j.stats.windowMs,
            });
          }
        }
      } catch {
        /* next tick retries */
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { avgSog, avgCog, avgHdg, motion };
}
