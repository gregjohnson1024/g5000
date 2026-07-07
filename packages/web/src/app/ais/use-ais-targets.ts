'use client';

import { useEffect, useMemo, useState } from 'react';
import { computeCpa, type CpaResult } from '@g5000/compute';
import type { AisTarget } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';

const NM = 1852;
export { NM };

export const RANGE_OPTIONS_NM = [1, 2, 4, 8, 20, 30];
export const DEFAULT_RANGE_NM = 30;

/** localStorage key for the user's preferred radar/table range. */
export const RANGE_STORAGE_KEY = 'ais:rangeNm';

/** Targets unseen for this long render in a "stale" style. */
export const STALE_MS = 60_000;

/** Targets unseen for this long are dropped from the UI. */
export const DROP_MS = 5 * 60_000;

export interface AisAlarmConfig {
  enabled: boolean;
  cpaMeters: number;
  tcpaSeconds: number;
}

export const DEFAULT_ALARM: AisAlarmConfig = {
  enabled: true,
  cpaMeters: NM,
  tcpaSeconds: 600,
};

export interface TargetWithCpa {
  target: AisTarget;
  cpa: CpaResult | null;
  stale: boolean;
}

export function readSavedRange(): number {
  try {
    const raw = localStorage.getItem(RANGE_STORAGE_KEY);
    if (raw === null) return DEFAULT_RANGE_NM;
    const n = Number(raw);
    if (RANGE_OPTIONS_NM.includes(n)) return n;
  } catch {
    /* SSR / quota */
  }
  return DEFAULT_RANGE_NM;
}

/** Narrow a Sample to its geo lat/lon, or null if it's missing/wrong-kind. */
function geoValue(
  s: ReturnType<ReturnType<typeof useSse>['channels']['get']>,
): { lat: number; lon: number } | null {
  if (!s || s.value.kind !== 'geo') return null;
  return s.value.value;
}

/** Narrow a Sample to its scalar number, or null if it's missing/wrong-kind. */
function scalarValue(s: ReturnType<ReturnType<typeof useSse>['channels']['get']>): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

/**
 * Shared hook that powers both the /ais page and the AIS lens in the chart
 * dock. All safety-critical CPA/mute logic lives here exactly once.
 */
export function useAisTargets() {
  const { channels } = useSse();

  // Raw targets from the API poll (2s cadence)
  const [targets, setTargets] = useState<AisTarget[]>([]);

  // Alarm thresholds from /api/ais/alarm-config
  const [alarmConfig, setAlarmConfig] = useState<AisAlarmConfig>(DEFAULT_ALARM);

  // Range picker — SSR-safe: start at default, hydrate from localStorage on mount
  const [rangeNm, setRangeNm] = useState(DEFAULT_RANGE_NM);
  useEffect(() => {
    setRangeNm(readSavedRange());
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, String(rangeNm));
    } catch {
      /* quota / private mode */
    }
  }, [rangeNm]);

  // Poll AIS targets every 2s
  useEffect(() => {
    let cancelled = false;
    const fetchTargets = async () => {
      try {
        const r = await fetch('/api/ais/targets', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as { targets: AisTarget[] };
        if (!cancelled) setTargets(j.targets);
      } catch {
        /* swallow — next tick retries */
      }
    };
    void fetchTargets();
    const id = setInterval(fetchTargets, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Load alarm config once on mount
  useEffect(() => {
    void fetch('/api/ais/alarm-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (c && typeof c === 'object') {
          setAlarmConfig(c as AisAlarmConfig);
        }
      })
      .catch(() => {});
  }, []);

  // Own boat state from SSE
  const ownPos = geoValue(channels.get('nav.gps.position'));
  const ownCog = scalarValue(channels.get('nav.gps.cog')) ?? 0;
  const ownSog = scalarValue(channels.get('nav.gps.sog')) ?? 0;

  // Compute CPA per target; apply DROP/STALE gates
  const targetsWithCpa = useMemo((): TargetWithCpa[] => {
    if (!ownPos) return [];
    const now = Date.now();
    return targets
      .filter((t) => now - t.lastSeenMs < DROP_MS)
      .map((t) => {
        const stale = now - t.lastSeenMs > STALE_MS;
        if (t.lat === undefined || t.lon === undefined) {
          return { target: t, cpa: null as CpaResult | null, stale };
        }
        const own = { lat: ownPos.lat, lon: ownPos.lon, cog: ownCog, sog: ownSog };
        const tgt = { lat: t.lat, lon: t.lon, cog: t.cog ?? 0, sog: t.sog ?? 0 };
        return { target: t, cpa: computeCpa(own, tgt), stale };
      });
  }, [targets, ownPos, ownCog, ownSog]);

  // isThreat is purely a function of the config — keep it stable
  const isThreat = (cpa: CpaResult | null): boolean =>
    !!cpa &&
    cpa.cpaMeters < alarmConfig.cpaMeters &&
    cpa.tcpaSeconds > 0 &&
    cpa.tcpaSeconds < alarmConfig.tcpaSeconds;

  // Per-vessel mute: value = CPA (m) at the moment of mute.
  // Auto-re-arm when current CPA drops below 90% of the muted value.
  const [mutes, setMutes] = useState<Record<number, number>>({});

  useEffect(() => {
    setMutes((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const r of targetsWithCpa) {
        const mutedAt = next[r.target.mmsi];
        if (mutedAt !== undefined && r.cpa && r.cpa.cpaMeters < mutedAt * 0.9) {
          delete next[r.target.mmsi];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [targetsWithCpa]);

  const muteVessel = (mmsi: number): void => {
    const row = targetsWithCpa.find((r) => r.target.mmsi === mmsi);
    if (!row?.cpa) return;
    setMutes((prev) => ({ ...prev, [mmsi]: row.cpa!.cpaMeters }));
  };

  const unmuteVessel = (mmsi: number): void => {
    setMutes((prev) => {
      const { [mmsi]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
  };

  // Threatening MMSIs that drive the audio klaxon.
  // Muted vessels and stale targets are excluded.
  const threatMmsis = useMemo(() => {
    const s = new Set<number>();
    for (const r of targetsWithCpa) {
      if (r.stale) continue;
      if (!isThreat(r.cpa)) continue;
      if (mutes[r.target.mmsi] !== undefined) continue;
      s.add(r.target.mmsi);
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsWithCpa, alarmConfig.cpaMeters, alarmConfig.tcpaSeconds, mutes]);

  const toggleAlarmEnabled = async (): Promise<void> => {
    const next = { ...alarmConfig, enabled: !alarmConfig.enabled };
    setAlarmConfig(next);
    await fetch('/api/ais/alarm-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next.enabled }),
    });
  };

  const saveThresholds = async (cpaNm: number, tcpaMin: number): Promise<void> => {
    const cpaMeters = Math.max(1, cpaNm * NM);
    const tcpaSeconds = Math.max(1, tcpaMin * 60);
    const next = { ...alarmConfig, cpaMeters, tcpaSeconds };
    setAlarmConfig(next);
    await fetch('/api/ais/alarm-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpaMeters, tcpaSeconds }),
    });
  };

  return {
    targetsWithCpa,
    alarmConfig,
    rangeNm,
    setRangeNm,
    isThreat,
    mutes,
    muteVessel,
    unmuteVessel,
    threatMmsis,
    toggleAlarmEnabled,
    saveThresholds,
    ownPos,
  };
}
