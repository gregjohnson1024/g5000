'use client';

import { useEffect, useState } from 'react';

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
          <th className="py-2">Time (UTC)</th>
          <th>Alarm</th>
          <th>Severity</th>
          <th>Cleared</th>
          <th>Acked</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t">
            <td className="py-2 font-mono">{r.firedAt.replace('T', ' ').replace(/\..+$/, '')}</td>
            <td>{r.alarmId}</td>
            <td>{r.severity}</td>
            <td className="text-gray-500">
              {r.clearedAt ? r.clearedAt.replace('T', ' ').replace(/\..+$/, '') : '—'}
            </td>
            <td className="text-gray-500">
              {r.ackedAt ? r.ackedAt.replace('T', ' ').replace(/\..+$/, '') : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
