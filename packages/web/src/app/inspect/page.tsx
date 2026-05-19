'use client';

import { useEffect, useState } from 'react';
import type { JsonSafeSample } from '@g5000/core';

interface ChannelEntry {
  sample: JsonSafeSample;
  receivedAtMs: number;
}

function formatValue(s: JsonSafeSample): string {
  switch (s.value.kind) {
    case 'scalar':
      return s.value.unit
        ? `${s.value.value.toFixed(3)} ${s.value.unit}`
        : s.value.value.toFixed(3);
    case 'vec3':
      return `[${s.value.value.map((n) => n.toFixed(3)).join(', ')}]`;
    case 'quat':
      return `q[${s.value.value.map((n) => n.toFixed(3)).join(', ')}]`;
    case 'geo':
      return `${s.value.value.lat.toFixed(5)}, ${s.value.value.lon.toFixed(5)}`;
    case 'enum':
      return s.value.value;
    case 'sail_recommendation': {
      const v = s.value;
      return `cell (${v.cellTwsKn} kn, ${v.cellTwaDeg}°) — H:${v.valid.headsail.join('/') || '—'} M:${v.valid.main.join('/') || '—'} D:${v.valid.downwind.join('/') || '—'}`;
    }
  }
}

export default function InspectPage() {
  const [channels, setChannels] = useState<Map<string, ChannelEntry>>(new Map());

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (ev) => {
      try {
        const { channel, sample } = JSON.parse(ev.data) as {
          channel: string;
          sample: JsonSafeSample;
        };
        setChannels((prev) => {
          const next = new Map(prev);
          next.set(channel, { sample, receivedAtMs: Date.now() });
          return next;
        });
      } catch {
        /* ignore malformed payloads */
      }
    };
    es.onerror = () => {
      /* EventSource auto-reconnects; nothing to do here */
    };
    return () => es.close();
  }, []);

  const sorted = Array.from(channels.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Channel inspector</h1>
      <p className="text-slate-400 mb-4 text-sm">
        Live channels published on the bus. {sorted.length} active.
      </p>
      <table className="w-full text-sm font-mono">
        <thead>
          <tr className="text-left text-slate-400 border-b border-slate-800">
            <th className="py-2 pr-4">Channel</th>
            <th className="py-2 pr-4">Value</th>
            <th className="py-2 pr-4">Source</th>
            <th className="py-2">Age</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(([channel, entry]) => (
            <tr key={channel} className="border-b border-slate-900">
              <td className="py-1 pr-4">{channel}</td>
              <td className="py-1 pr-4">{formatValue(entry.sample)}</td>
              <td className="py-1 pr-4 text-slate-500">{entry.sample.source}</td>
              <td className="py-1 text-slate-500">
                {((Date.now() - entry.receivedAtMs) / 1000).toFixed(1)}s
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-slate-500">
                Waiting for samples…
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
