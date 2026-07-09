'use client';

import { useEffect, useState } from 'react';
import { useShipClock } from '../../lib/use-ship-clock';
import { fmtClockTime, toDayKey, type ShipClock } from '../../lib/tz';

function fmtWhen(iso: string, clock: ShipClock): string {
  const sec = Date.parse(iso) / 1000;
  return `${toDayKey(sec, clock)} ${fmtClockTime(sec, clock)}`;
}

interface HistoryRow {
  id: number;
  alarmId: string;
  severity: string;
  firedAt: string;
  clearedAt: string | null;
  ackedAt: string | null;
  context?: Record<string, unknown> | null;
}

export function HistoryList() {
  const clock = useShipClock();
  const [rows, setRows] = useState<HistoryRow[]>([]);

  useEffect(() => {
    fetch('/api/alarms/history?limit=200')
      .then((r) => r.json())
      .then((b) => setRows(b.rows ?? []))
      .catch(() => setRows([]));
  }, []);

  if (rows.length === 0) {
    return <p className="text-gray-500">No alarm history.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-600">
          <th className="py-2">Time</th>
          <th>Alarm</th>
          <th>Severity</th>
          <th>Cleared</th>
          <th>Acked</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t">
            <td className="py-2 font-mono">{fmtWhen(r.firedAt, clock)}</td>
            <td>{r.alarmId}</td>
            <td>{r.severity}</td>
            <td className="text-gray-500">{r.clearedAt ? fmtWhen(r.clearedAt, clock) : '—'}</td>
            <td className="text-gray-500">{r.ackedAt ? fmtWhen(r.ackedAt, clock) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
