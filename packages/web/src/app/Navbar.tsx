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
  { href: '/sessions', label: 'Sessions' },
  { href: '/inspect', label: 'Inspect' },
];

interface SourceModeStatus {
  mode: 'live' | 'demo' | 'replay';
  sessionId?: string;
}

const CHIP_STYLES: Record<SourceModeStatus['mode'], string> = {
  live: 'bg-emerald-700 text-emerald-100',
  demo: 'bg-amber-600 text-amber-100',
  replay: 'bg-purple-700 text-purple-100',
};

export function Navbar() {
  const pathname = usePathname();
  const [status, setStatus] = useState<SourceModeStatus>({ mode: 'live' });

  useEffect(() => {
    const poll = () => {
      fetch('/api/source-mode')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j && typeof j.mode === 'string') setStatus(j);
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
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
      <a
        href="/sessions"
        className={`ml-auto px-2 py-1 rounded text-xs font-mono ${CHIP_STYLES[status.mode]}`}
        title={
          status.mode === 'replay'
            ? `Replaying ${status.sessionId ?? '(unknown)'}`
            : `Source mode: ${status.mode}`
        }
      >
        {status.mode === 'replay'
          ? `REPLAY: ${status.sessionId ?? ''}`
          : status.mode.toUpperCase()}
      </a>
    </nav>
  );
}
