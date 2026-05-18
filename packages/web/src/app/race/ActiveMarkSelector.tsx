'use client';

import { useCallback, useEffect, useState } from 'react';

interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export function ActiveMarkSelector(): React.ReactElement {
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const [wpR, stR] = await Promise.all([
          fetch('/api/waypoints', { cache: 'no-store' }),
          fetch('/api/race/state', { cache: 'no-store' }),
        ]);
        if (wpR.ok) {
          const j = await wpR.json();
          if (j.ok) setWaypoints(j.waypoints);
        }
        if (stR.ok) {
          const j = await stR.json();
          setActiveId(j.activeMarkWaypointId ?? null);
        }
      } catch {
        /* retry on next mount */
      }
    }
    void load();
  }, []);

  const setActive = useCallback(async (id: string | null) => {
    await fetch('/api/race/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeMarkWaypointId: id }),
    });
    setActiveId(id);
  }, []);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-4 flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wider text-slate-400">Active mark (for VMC)</div>
      <select
        value={activeId ?? ''}
        onChange={(e) => void setActive(e.target.value === '' ? null : e.target.value)}
        className="bg-slate-900 border border-slate-700 rounded text-slate-200 px-2 py-2 text-sm"
      >
        <option value="">— none —</option>
        {waypoints.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </div>
  );
}
