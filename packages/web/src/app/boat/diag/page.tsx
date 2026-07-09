'use client';

import Link from 'next/link';

const CARDS: {
  href: string;
  label: string;
  desc: string;
}[] = [
  {
    href: '/boat/diag/wind',
    label: 'Wind Diagnostics',
    desc: 'Per-source wind/heading plots off the N2K bus',
  },
  { href: '/boat/diag/devices', label: 'N2K Devices', desc: 'NMEA 2000 device registry' },
  { href: '/boat/diag/sensors', label: 'Sensors', desc: 'Live channel values and source priority' },
  { href: '/boat/diag/sniff', label: 'PGN Sniffer', desc: 'Raw NMEA 2000 frame capture' },
  {
    href: '/boat/diag/inspect',
    label: 'Channel Inspector',
    desc: 'All live bus channels in one table',
  },
  {
    href: '/boat/diag/sessions',
    label: 'Sessions',
    desc: 'Recorded sessions — replay or download',
  },
  { href: '/boat/diag/logs', label: 'Server Logs', desc: 'Live server log stream' },
];

export default function DiagnosticsHubPage() {
  return (
    <main className="page-main p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Diagnostics</h1>
      <p className="text-sm text-slate-400">N2K bus inspection, session replay, and server logs.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="block p-4 rounded-lg border border-slate-800 hover:border-slate-600 hover:bg-slate-900 transition-colors"
          >
            <div className="font-medium text-slate-200">{c.label}</div>
            <div className="text-xs text-slate-500 mt-1">{c.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
