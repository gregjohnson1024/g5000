'use client';

import Link from 'next/link';

const CARDS: {
  href: string;
  label: string;
  desc: string;
}[] = [
  { href: '/boat/polars', label: 'Polars', desc: 'Boat speed targets vs TWS/TWA grid' },
  { href: '/boat/sails', label: 'Sails', desc: 'Sail wardrobe — add, remove, set active' },
  { href: '/boat/crossover', label: 'Crossover', desc: 'TWS/TWA region editor per sail' },
  { href: '/boat/setup', label: 'Setup', desc: 'App settings, satellite cache, source mode' },
  {
    href: '/boat/setup/profile',
    label: 'Profile',
    desc: 'Mast geometry, magnetic variation, MMSI',
  },
  {
    href: '/boat/setup/displays',
    label: 'Displays',
    desc: 'Mast display layout, night mode, brightness',
  },
  { href: '/boat/setup/damping', label: 'Damping', desc: 'Per-channel EMA filter time constants' },
  { href: '/boat/setup/cal/wind', label: 'Wind cal', desc: 'AWS/AWA calibration table' },
  { href: '/boat/setup/cal/bsp', label: 'BSP cal', desc: 'Boat speed calibration' },
  { href: '/boat/setup/cal/compass', label: 'Compass', desc: 'Compass deviation table' },
  {
    href: '/boat/diag',
    label: 'Diagnostics',
    desc: 'N2K bus inspection, session replay, and server logs',
  },
];

export default function BoatHubPage() {
  return (
    <main className="p-6 space-y-4 max-w-2xl">
      <h1 className="text-2xl font-semibold">Boat</h1>
      <p className="text-sm text-slate-400">Performance targets, sail wardrobe, and boat setup.</p>
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
