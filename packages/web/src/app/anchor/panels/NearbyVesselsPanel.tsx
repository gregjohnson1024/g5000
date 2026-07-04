'use client';

import { useEffect, useState } from 'react';
import type { AisTarget, JsonSafeSample } from '@g5000/core';
import { rankVessels, type RankedVessel } from '../../../lib/nearby-vessels';

const POLL_MS = 3_000;
const MAX_ROWS = 6;
const STALE_AGE_MS = 60_000;
/** 1 NM in metres */
const NM_M = 1852;

interface TargetsResponse {
  targets: AisTarget[];
}

function fmtRange(rangeM: number | null): string {
  if (rangeM === null) return '—';
  if (rangeM < NM_M) return `${Math.round(rangeM)} m`;
  return `${(rangeM / NM_M).toFixed(1)} NM`;
}

function fmtAge(ageMs: number): string {
  const sec = Math.round(ageMs / 1_000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  return `${min}m ago`;
}

function geo(s: JsonSafeSample | undefined): { lat: number; lon: number } | null {
  if (!s || s.value.kind !== 'geo') return null;
  return s.value.value;
}

export function NearbyVesselsPanel({
  channels,
}: {
  channels: ReadonlyMap<string, JsonSafeSample>;
}): React.ReactElement {
  const [vessels, setVessels] = useState<RankedVessel[]>([]);

  const ownFix = geo(channels.get('nav.gps.position'));

  useEffect(() => {
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const r = await fetch('/api/ais/targets', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as TargetsResponse;
        if (!cancelled) {
          setVessels(rankVessels(j.targets ?? [], ownFix, Date.now()));
        }
      } catch {
        /* upstream blip — next tick retries */
      }
    };

    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Re-register when ownFix identity changes so range stays current.
    // ownFix is derived from a ReadonlyMap lookup — stringify avoids
    // effect churn on identical positions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownFix?.lat, ownFix?.lon]);

  const rows = vessels.slice(0, MAX_ROWS);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-col gap-1 min-h-[100px]">
      <span className="text-xs uppercase tracking-wide text-slate-500 font-medium">
        Nearby Vessels
      </span>
      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-slate-600 text-xs italic">No vessels nearby</span>
        </div>
      ) : (
        <ul className="flex-1 flex flex-col gap-0.5 mt-1">
          {rows.map((v) => {
            const stale = v.ageMs > STALE_AGE_MS;
            return (
              <li
                key={v.mmsi}
                className={`flex items-center justify-between text-xs font-mono gap-2 ${
                  stale ? 'opacity-40' : ''
                }`}
              >
                <span className="text-slate-200 truncate min-w-0">{v.name ?? String(v.mmsi)}</span>
                <span className="shrink-0 text-right">
                  <span className="text-slate-300 tabular-nums">{fmtRange(v.rangeM)}</span>
                  <span className="text-slate-500 ml-1">{fmtAge(v.ageMs)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
