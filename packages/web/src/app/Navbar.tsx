'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
}

interface SettingsGroup {
  label: string;
  items: NavItem[];
}

const TOP_LEVEL: NavItem[] = [
  { href: '/helm', label: 'Helm' },
  { href: '/race', label: 'Race' },
  { href: '/chart', label: 'Chart' },
  { href: '/passage', label: 'Passage' },
  { href: '/tracker', label: 'Tracker' },
  { href: '/ais', label: 'AIS' },
  { href: '/polars', label: 'Polars' },
  { href: '/sails', label: 'Sails' },
  { href: '/forecast', label: 'Forecast' },
  { href: '/marks-and-routes', label: 'Marks & routes' },
  { href: '/tracks', label: 'Tracks' },
  { href: '/log', label: 'Log' },
  { href: '/autopilot', label: 'Autopilot' },
];

const ALERTS_HREF = '/alerts';

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: 'Calibration',
    items: [
      { href: '/calibration/wind', label: 'Wind cal' },
      { href: '/calibration/bsp', label: 'BSP cal' },
      { href: '/calibration/compass', label: 'Compass' },
    ],
  },
  {
    label: 'Network',
    items: [
      { href: '/devices', label: 'Devices' },
      { href: '/sources', label: 'Sources' },
      { href: '/sniff', label: 'Sniff' },
      { href: '/damping', label: 'Damping' },
      { href: '/inspect', label: 'Inspect' },
    ],
  },
  {
    label: 'Configuration',
    items: [{ href: '/settings', label: 'Settings' }],
  },
  {
    label: 'Boat',
    items: [{ href: '/boat', label: 'Boat' }],
  },
  {
    label: 'Diagnostics',
    items: [
      { href: '/sessions', label: 'Sessions' },
      { href: '/logs', label: 'Logs' },
    ],
  },
];

const SETTINGS_HREFS: ReadonlySet<string> = new Set(
  SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
);

function isActive(pathname: string | null, href: string): boolean {
  return pathname === href || (pathname?.startsWith(href + '/') ?? false);
}

function isAnySettingsActive(pathname: string | null): boolean {
  for (const href of SETTINGS_HREFS) {
    if (isActive(pathname, href)) return true;
  }
  return false;
}

export function Navbar({ hiddenHrefs }: { hiddenHrefs?: string[] } = {}) {
  const pathname = usePathname();
  const hidden = new Set(hiddenHrefs ?? []);
  const topItems = TOP_LEVEL.filter((it) => !hidden.has(it.href));
  const visibleGroups: SettingsGroup[] = SETTINGS_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((it) => !hidden.has(it.href)),
  })).filter((g) => g.items.length > 0);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [alarmCount, setAlarmCount] = useState(0);
  const [topSeverity, setTopSeverity] = useState<'CRITICAL' | 'WARN' | 'INFO' | null>(null);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const r = await fetch('/api/alarms');
        if (stopped) return;
        const body = (await r.json()) as { active?: { severity: 'CRITICAL' | 'WARN' | 'INFO' }[] };
        const active = body.active ?? [];
        const rank = { CRITICAL: 3, WARN: 2, INFO: 1 } as const;
        const top = active.reduce<keyof typeof rank | null>(
          (best, a) => (best === null || rank[a.severity] > rank[best] ? a.severity : best),
          null,
        );
        setAlarmCount(active.length);
        setTopSeverity(top);
      } catch {
        // transient
      }
    }
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const settingsActive = isAnySettingsActive(pathname);

  return (
    <nav className="bg-slate-950 border-b border-slate-800 px-4 py-2 flex items-center gap-1 flex-wrap text-sm">
      <a href="/" className="font-semibold text-slate-100 mr-3">
        G5000
      </a>
      {topItems.map((it) => {
        const active = isActive(pathname, it.href);
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

      {visibleGroups.length > 0 && (
        <div ref={containerRef} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className={`px-2 py-1 rounded inline-flex items-center gap-1 ${
              settingsActive
                ? 'bg-amber-600 text-slate-900 font-medium'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Settings
            <span aria-hidden className="text-xs">
              ▾
            </span>
          </button>

          {open && (
            <div
              role="menu"
              className="absolute right-0 mt-1 z-50 min-w-[480px] grid grid-cols-2 gap-x-6 gap-y-3 bg-slate-900 border border-slate-700 rounded-md shadow-xl p-3"
            >
              {visibleGroups.map((group) => (
                <div key={group.label} className="min-w-0">
                  <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">
                    {group.label}
                  </div>
                  <ul className="flex flex-col">
                    {group.items.map((it) => {
                      const active = isActive(pathname, it.href);
                      return (
                        <li key={it.href}>
                          <a
                            href={it.href}
                            onClick={() => setOpen(false)}
                            className={`block px-2 py-1 rounded text-sm ${
                              active
                                ? 'bg-amber-600 text-slate-900 font-medium'
                                : 'text-slate-200 hover:bg-slate-800'
                            }`}
                          >
                            {it.label}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!hidden.has(ALERTS_HREF) && (
        <a
          href={ALERTS_HREF}
          aria-label={alarmCount > 0 ? `Alerts (${alarmCount} active)` : 'Alerts'}
          title={alarmCount > 0 ? `${alarmCount} active alarm${alarmCount === 1 ? '' : 's'}` : 'Alerts'}
          className={`ml-auto relative p-1.5 rounded ${
            topSeverity === 'CRITICAL'
              ? 'text-red-400 animate-pulse hover:bg-slate-800'
              : topSeverity === 'WARN'
                ? 'text-yellow-300 hover:bg-slate-800'
                : topSeverity === 'INFO'
                  ? 'text-blue-300 hover:bg-slate-800'
                  : isActive(pathname, ALERTS_HREF)
                    ? 'bg-amber-600 text-slate-900'
                    : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill={topSeverity ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5"
            aria-hidden
          >
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          {alarmCount > 0 && (
            <span
              className={`absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-bold leading-[1.1rem] text-center ${
                topSeverity === 'CRITICAL'
                  ? 'bg-red-600 text-white'
                  : topSeverity === 'WARN'
                    ? 'bg-yellow-500 text-slate-900'
                    : 'bg-blue-500 text-white'
              }`}
            >
              {alarmCount > 9 ? '9+' : alarmCount}
            </span>
          )}
        </a>
      )}
    </nav>
  );
}
