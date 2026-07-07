'use client';

import { useCallback, useEffect, useState } from 'react';
import { Panel } from '../../../components/ui';

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
    <Panel label="Active mark (for VMC)">
      <select
        value={activeId ?? ''}
        onChange={(e) => void setActive(e.target.value === '' ? null : e.target.value)}
        className="w-full bg-canvas border border-hairline [border-radius:var(--r-control)] text-ink px-2 py-2 text-sm"
      >
        <option value="">— none —</option>
        {waypoints.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </Panel>
  );
}
