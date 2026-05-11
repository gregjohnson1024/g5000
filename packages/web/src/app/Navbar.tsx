'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
}

const ITEMS: NavItem[] = [
  { href: '/helm', label: 'Helm' },
  { href: '/polars', label: 'Polars' },
  { href: '/sails', label: 'Sails' },
  { href: '/calibration/wind', label: 'Wind cal' },
  { href: '/calibration/bsp', label: 'BSP cal' },
  { href: '/calibration/compass', label: 'Compass' },
  { href: '/boat', label: 'Boat' },
  { href: '/autopilot', label: 'Autopilot' },
  { href: '/devices', label: 'Devices' },
  { href: '/inspect', label: 'Inspect' },
];

export function Navbar() {
  const pathname = usePathname();
  const [demoMode, setDemoMode] = useState(false);
  useEffect(() => {
    fetch('/api/dev/demo')
      .then((r) => r.json())
      .then((j) => setDemoMode(Boolean(j.demoMode)))
      .catch(() => {});
  }, []);
  return (
    <nav className="bg-slate-950 border-b border-slate-800 px-4 py-2 flex items-center gap-1 flex-wrap text-sm">
      <a href="/" className="font-semibold text-slate-100 mr-3">
        G5000
      </a>
      {ITEMS.map((it) => {
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
      {demoMode && (
        <span className="ml-auto px-2 py-1 rounded bg-purple-700 text-purple-100 text-xs font-mono">
          DEMO
        </span>
      )}
    </nav>
  );
}
