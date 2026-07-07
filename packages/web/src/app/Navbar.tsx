'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePoll } from '../hooks/use-poll';

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
  { href: '/anchor', label: 'Anchor' },
  { href: '/passage', label: 'Passage' },
  { href: '/tracker', label: 'Tracker' },
  { href: '/ais', label: 'AIS' },
  { href: '/boat/polars', label: 'Polars' },
  { href: '/tide', label: 'Tide' },
  { href: '/currents', label: 'Currents' },
  { href: '/waypoints', label: 'Waypoints' },
  { href: '/routes', label: 'Routes' },
  { href: '/tracks', label: 'Tracks' },
  { href: '/trips', label: 'Trips' },
  { href: '/log', label: 'Log' },
  { href: '/autopilot', label: 'Autopilot' },
  { href: '/wind-diag', label: 'Wind Dx' },
];

const ALERTS_HREF = '/alerts';

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: 'Calibration',
    items: [
      { href: '/boat/setup/cal/wind', label: 'Wind cal' },
      { href: '/boat/setup/cal/bsp', label: 'BSP cal' },
      { href: '/boat/setup/cal/compass', label: 'Compass' },
    ],
  },
  {
    label: 'Network',
    items: [
      { href: '/devices', label: 'Devices' },
      { href: '/sensors', label: 'Sensors' },
      { href: '/sniff', label: 'Sniff' },
      { href: '/boat/setup/damping', label: 'Damping' },
      { href: '/inspect', label: 'Inspect' },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { href: '/boat/setup', label: 'Settings' },
      { href: '/forecast', label: 'Forecast' },
    ],
  },
  {
    label: 'Boat',
    items: [
      { href: '/boat/setup/profile', label: 'Boat profile' },
      { href: '/boat/sails', label: 'Sails' },
      { href: '/boat/crossover', label: 'Crossover' },
      { href: '/boat/setup/displays', label: 'Displays' },
    ],
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

const ALL_HREFS: readonly string[] = [
  ...TOP_LEVEL.map((it) => it.href),
  ...SETTINGS_GROUPS.flatMap((g) => g.items.map((it) => it.href)),
  ALERTS_HREF,
];

/**
 * Longest-prefix match: the menu item whose href is the longest prefix of the
 * current pathname is "active". This lets `/sails` and `/sails/crossover`
 * coexist without `/sails` lighting up when the user is on the child route.
 */
function bestMatchHref(pathname: string | null): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const href of ALL_HREFS) {
    if (pathname === href || pathname.startsWith(href + '/')) {
      if (best === null || href.length > best.length) best = href;
    }
  }
  return best;
}

function isAnySettingsActive(activeHref: string | null): boolean {
  return activeHref !== null && SETTINGS_HREFS.has(activeHref);
}

/** Tabs gated behind settings.canadianTideCurrents (CHS data is Canada-only). */
const CANADIAN_TIDE_HREFS: ReadonlySet<string> = new Set(['/tide', '/currents']);

export function Navbar({ hiddenHrefs }: { hiddenHrefs?: string[] } = {}) {
  const pathname = usePathname();
  // Default false = hidden until the settings fetch resolves (no layout flash).
  const [canadianTideCurrents, setCanadianTideCurrents] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setCanadianTideCurrents(j?.settings?.canadianTideCurrents === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const hidden = new Set(hiddenHrefs ?? []);
  const topItems = TOP_LEVEL.filter(
    (it) => !hidden.has(it.href) && (canadianTideCurrents || !CANADIAN_TIDE_HREFS.has(it.href)),
  );
  const visibleGroups: SettingsGroup[] = SETTINGS_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((it) => !hidden.has(it.href)),
  })).filter((g) => g.items.length > 0);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { data: alarmsData } = usePoll<{ active?: { severity: 'CRITICAL' | 'WARN' | 'INFO' }[] }>(
    '/api/alarms',
    2000,
  );
  const active = alarmsData?.active ?? [];
  const rank = { CRITICAL: 3, WARN: 2, INFO: 1 } as const;
  const alarmCount = active.length;
  const topSeverity = active.reduce<'CRITICAL' | 'WARN' | 'INFO' | null>(
    (best, a) => (best === null || rank[a.severity] > rank[best] ? a.severity : best),
    null,
  );

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

  const activeHref = bestMatchHref(pathname);
  const settingsActive = isAnySettingsActive(activeHref);

  return (
    <nav className="bg-slate-950 border-b border-slate-800 px-4 py-2 flex items-center gap-1 flex-wrap text-sm">
      <Link href="/" className="font-semibold text-slate-100 mr-3">
        G5000
      </Link>
      {topItems.map((it) => {
        const active = activeHref === it.href;
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`px-2 py-1 rounded ${
              active
                ? 'bg-amber-600 text-slate-900 font-medium'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {it.label}
          </Link>
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
                      const active = activeHref === it.href;
                      return (
                        <li key={it.href}>
                          <Link
                            href={it.href}
                            onClick={() => setOpen(false)}
                            className={`block px-2 py-1 rounded text-sm ${
                              active
                                ? 'bg-amber-600 text-slate-900 font-medium'
                                : 'text-slate-200 hover:bg-slate-800'
                            }`}
                          >
                            {it.label}
                          </Link>
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
        <Link
          href={ALERTS_HREF}
          aria-label={alarmCount > 0 ? `Alerts (${alarmCount} active)` : 'Alerts'}
          title={
            alarmCount > 0 ? `${alarmCount} active alarm${alarmCount === 1 ? '' : 's'}` : 'Alerts'
          }
          className={`ml-auto relative p-1.5 rounded ${
            topSeverity === 'CRITICAL'
              ? 'text-red-400 animate-pulse hover:bg-slate-800'
              : topSeverity === 'WARN'
                ? 'text-yellow-300 hover:bg-slate-800'
                : topSeverity === 'INFO'
                  ? 'text-blue-300 hover:bg-slate-800'
                  : activeHref === ALERTS_HREF
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
        </Link>
      )}
    </nav>
  );
}
