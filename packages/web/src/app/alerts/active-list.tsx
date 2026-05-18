'use client';

import { useEffect, useState } from 'react';

interface AlarmRow {
  id: string;
  severity: 'CRITICAL' | 'WARN' | 'INFO';
  label: string;
  firedAt: string;
  clearedAt: string | null;
  ackedAt: string | null;
  context?: Record<string, unknown>;
}

interface AlertRow {
  key: string;
  type: string;
  state: string;
  text?: string;
  lastSeenMs: number;
}

export function ActiveList() {
  const [alarms, setAlarms] = useState<AlarmRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const [a, b] = await Promise.all([
          fetch('/api/alarms').then((r) => r.json()),
          fetch('/api/alerts').then((r) => r.json()),
        ]);
        if (stopped) return;
        setAlarms(a.active ?? []);
        setAlerts(b.alerts ?? []);
      } catch {
        // ignore transient
      }
    }
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  async function ackAlarm(id: string) {
    await fetch('/api/alarms', {
      method: 'PATCH',
      body: JSON.stringify({ id, action: 'ack' }),
    });
  }

  const allRows: Array<{ kind: 'alarm' | 'alert'; severity: string; row: AlarmRow | AlertRow }> = [
    ...alarms.map((r) => ({ kind: 'alarm' as const, severity: r.severity, row: r })),
    ...alerts.map((r) => ({ kind: 'alert' as const, severity: r.type, row: r })),
  ];
  const severityRank: Record<string, number> = { CRITICAL: 3, 'Emergency Alarm': 3, Alarm: 3, WARN: 2, Warning: 2, Caution: 1, INFO: 0 };
  allRows.sort((a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0));

  if (allRows.length === 0) {
    return <p className="text-gray-500">No active alarms or alerts.</p>;
  }

  return (
    <ul className="space-y-2">
      {allRows.map((entry) => (
        <li
          key={entry.kind === 'alarm' ? `alarm-${(entry.row as AlarmRow).id}` : `alert-${(entry.row as AlertRow).key}`}
          className={`p-3 rounded border ${(severityRank[entry.severity] ?? 0) >= 3 ? 'border-red-500 bg-red-50' : 'border-yellow-500 bg-yellow-50'}`}
        >
          <div className="flex justify-between items-center">
            <div>
              <span className="font-semibold">
                {entry.kind === 'alarm' ? (entry.row as AlarmRow).label : (entry.row as AlertRow).text ?? 'N2K alert'}
              </span>
              <span className="ml-2 text-sm text-gray-600">{entry.severity}</span>
            </div>
            {entry.kind === 'alarm' && (
              <button
                onClick={() => ackAlarm((entry.row as AlarmRow).id)}
                className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
              >
                Ack
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
