'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
}

const ITEMS: NavItem[] = [
  { href: '/helm', label: 'Helm' },
  { href: '/chart', label: 'Chart' },
  { href: '/passage', label: 'Passage' },
  { href: '/ais', label: 'AIS' },
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
  { href: '/sessions', label: 'Sessions' },
  { href: '/logs', label: 'Logs' },
  { href: '/inspect', label: 'Inspect' },
];

interface SourceModeStatus {
  mode: 'live' | 'demo' | 'replay';
  sessionId?: string;
  errorMessage?: string;
}

const CHIP_STYLES: Record<SourceModeStatus['mode'], string> = {
  live: 'bg-emerald-700 text-emerald-100 hover:bg-emerald-600',
  demo: 'bg-amber-600 text-amber-100 hover:bg-amber-500',
  replay: 'bg-purple-700 text-purple-100 hover:bg-purple-600',
};

export function Navbar() {
  const pathname = usePathname();
  const [status, setStatus] = useState<SourceModeStatus>({ mode: 'live' });
  const [pending, setPending] = useState(false);

  const refresh = (): void => {
    fetch('/api/source-mode')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j.mode === 'string') setStatus(j as SourceModeStatus);
      })
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, []);

  const swapTo = async (target: 'live' | 'demo'): Promise<void> => {
    const msg =
      target === 'demo'
        ? 'Swap to demo mode? Real-bus TX will stop and synthetic samples will publish.'
        : 'Swap to live mode? Will attempt to open the NGT-1.';
    if (!window.confirm(msg)) return;
    setPending(true);
    try {
      const res = await fetch('/api/source-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: target }),
      });
      const j = (await res.json()) as SourceModeStatus | { error: string };
      if ('mode' in j) {
        setStatus(j);
      } else if (j.error) {
        // Don't update status — let polling catch the truth.
        // eslint-disable-next-line no-alert
        alert(`Mode swap failed: ${j.error}`);
        refresh();
      }
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(`Mode swap failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPending(false);
    }
  };

  const renderChip = (): React.ReactNode => {
    const chipClass = `ml-auto px-2 py-1 rounded text-xs font-mono ${CHIP_STYLES[status.mode]}${
      pending ? ' opacity-60 cursor-wait' : ''
    }`;
    const errSuffix = status.errorMessage ? ' (!)' : '';
    const tooltip = status.errorMessage
      ? `Source mode: ${status.mode} — error: ${status.errorMessage}`
      : status.mode === 'replay'
        ? `Replaying ${status.sessionId ?? '(unknown)'} — click for sessions`
        : `Source mode: ${status.mode} — click to swap to ${status.mode === 'live' ? 'demo' : 'live'}`;

    if (status.mode === 'replay') {
      return (
        <a href="/sessions" className={chipClass} title={tooltip}>
          REPLAY: {status.sessionId ?? ''}
          {errSuffix}
        </a>
      );
    }
    const target: 'live' | 'demo' = status.mode === 'live' ? 'demo' : 'live';
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => void swapTo(target)}
        className={chipClass}
        title={tooltip}
      >
        {status.mode.toUpperCase()}
        {errSuffix}
      </button>
    );
  };

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
      {renderChip()}
    </nav>
  );
}
