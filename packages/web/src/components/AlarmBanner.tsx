'use client';

import { useEffect, useState } from 'react';

interface AlarmRow {
  id: string;
  severity: 'CRITICAL' | 'WARN' | 'INFO';
  label: string;
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARN: 2, INFO: 1 };

export function AlarmBanner() {
  const [topAlarm, setTopAlarm] = useState<AlarmRow | null>(null);
  const [extraCount, setExtraCount] = useState(0);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const r = await fetch('/api/alarms');
        if (stopped) return;
        const body = await r.json();
        const active = (body.active ?? []) as AlarmRow[];
        active.sort(
          (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
        );
        setTopAlarm(active[0] ?? null);
        setExtraCount(Math.max(0, active.length - 1));
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

  if (!topAlarm) return null;

  const bg =
    topAlarm.severity === 'CRITICAL'
      ? 'bg-red-600'
      : topAlarm.severity === 'WARN'
        ? 'bg-yellow-500'
        : 'bg-blue-500';

  return (
    <a
      href="/alerts"
      className={`block w-full ${bg} text-white px-4 py-2 text-sm font-semibold sticky top-0 z-50`}
    >
      ⚠ {topAlarm.label}
      {extraCount > 0 && <span className="ml-2 opacity-80">(+{extraCount} more)</span>}
    </a>
  );
}
