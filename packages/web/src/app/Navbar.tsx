'use client';

import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
}

const ITEMS: NavItem[] = [
  { href: '/helm', label: 'Helm' },
  { href: '/chart', label: 'Chart' },
  { href: '/passage', label: 'Passage' },
  { href: '/tracker', label: 'Tracker' },
  { href: '/ais', label: 'AIS' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/polars', label: 'Polars' },
  { href: '/sails', label: 'Sails' },
  { href: '/forecast', label: 'Forecast' },
  { href: '/marks-and-routes', label: 'Marks & routes' },
  { href: '/tracks', label: 'Tracks' },
  { href: '/calibration/wind', label: 'Wind cal' },
  { href: '/calibration/bsp', label: 'BSP cal' },
  { href: '/calibration/compass', label: 'Compass' },
  { href: '/damping', label: 'Damping' },
  { href: '/boat', label: 'Boat' },
  { href: '/autopilot', label: 'Autopilot' },
  { href: '/devices', label: 'Devices' },
  { href: '/sources', label: 'Sources' },
  { href: '/settings', label: 'Settings' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/logs', label: 'Logs' },
  { href: '/inspect', label: 'Inspect' },
  { href: '/sniff', label: 'Sniff' },
];

export function Navbar({ hiddenHrefs }: { hiddenHrefs?: string[] } = {}) {
  const pathname = usePathname();
  const hidden = new Set(hiddenHrefs ?? []);
  const items = ITEMS.filter((it) => !hidden.has(it.href));

  return (
    <nav className="bg-slate-950 border-b border-slate-800 px-4 py-2 flex items-center gap-1 flex-wrap text-sm">
      <a href="/" className="font-semibold text-slate-100 mr-3">
        G5000
      </a>
      {items.map((it) => {
        const active = pathname === it.href || pathname?.startsWith(it.href + '/');
        return (
          <a
            key={it.href}
            href={it.href}
            className={`px-2 py-1 rounded ${
              active
                ? 'bg-amber-600 text-slate-900 font-medium'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {it.label}
          </a>
        );
      })}
    </nav>
  );
}
