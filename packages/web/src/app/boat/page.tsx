'use client';

/**
 * /boat hub page — grouped, status-tinted card index.
 *
 * Three groups: Performance · Setup · Diagnostics.
 * Each card shows a live status line fetched from /api/boat-status.
 * Status is tinted via token classes (ok=green, warn=amber, neutral=muted).
 * Degrades honestly: unknown / offline shows '—', never a fake 0.
 *
 * Tokens only — no raw hex, no slate-/rose-/emerald- classes.
 */

import Link from 'next/link';
import { useBoatStatus } from './boat-status';
import type { BoatStatusCard } from './boat-status';

// ---------------------------------------------------------------------------
// Status-tinted card border / bg token classes
// ---------------------------------------------------------------------------

const TINT_BORDER: Record<BoatStatusCard['tint'], string> = {
  ok: 'border-ok-strong/40',
  warn: 'border-warn-strong/60',
  neutral: 'border-hairline',
};

const TINT_STATUS_INK: Record<BoatStatusCard['tint'], string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  neutral: 'text-ink-3',
};

// ---------------------------------------------------------------------------
// Individual card
// ---------------------------------------------------------------------------

function HubCard({ card }: { card: BoatStatusCard }) {
  const borderClass = TINT_BORDER[card.tint];
  const statusInkClass = TINT_STATUS_INK[card.tint];

  return (
    <Link
      href={card.href}
      className={[
        'block p-4 [border-radius:var(--r-panel)] border',
        'bg-surface hover:bg-surface-raised',
        'transition-colors',
        borderClass,
      ].join(' ')}
    >
      <div className="font-medium text-ink leading-snug">{card.label}</div>
      <div className="text-[0.722rem] text-ink-3 mt-0.5 leading-snug">{card.desc}</div>
      {card.statusLine ? (
        <div
          className={['text-[0.722rem] mt-1.5 tabular-nums leading-none', statusInkClass].join(' ')}
        >
          {card.statusLine}
        </div>
      ) : null}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Group section
// ---------------------------------------------------------------------------

function CardGroup({ label, cards }: { label: string; cards: BoatStatusCard[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[0.667rem] font-semibold uppercase tracking-[0.08em] text-ink-2 px-0.5">
        {label}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {cards.map((card) => (
          <HubCard key={card.href} card={card} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fallback static card data (shown while loading / on error)
// ---------------------------------------------------------------------------

const STATIC_CARDS: {
  group: 'performance' | 'setup' | 'diagnostics';
  href: string;
  label: string;
  desc: string;
}[] = [
  // Performance
  {
    group: 'performance',
    href: '/boat/polars',
    label: 'Polars',
    desc: 'Boat speed targets vs TWS/TWA grid',
  },
  {
    group: 'performance',
    href: '/boat/sails',
    label: 'Sails',
    desc: 'Sail wardrobe — add, remove, set active',
  },
  {
    group: 'performance',
    href: '/boat/crossover',
    label: 'Crossover',
    desc: 'TWS/TWA region editor per sail',
  },
  // Setup
  {
    group: 'setup',
    href: '/boat/setup',
    label: 'Setup',
    desc: 'App settings, satellite cache, source mode',
  },
  {
    group: 'setup',
    href: '/boat/setup/profile',
    label: 'Profile',
    desc: 'Mast geometry, magnetic variation, MMSI',
  },
  {
    group: 'setup',
    href: '/boat/setup/displays',
    label: 'Displays',
    desc: 'Mast display layout, night mode, brightness',
  },
  {
    group: 'setup',
    href: '/boat/setup/damping',
    label: 'Damping',
    desc: 'Per-channel EMA filter time constants',
  },
  {
    group: 'setup',
    href: '/boat/setup/cal/wind',
    label: 'Wind cal',
    desc: 'AWS/AWA calibration table',
  },
  { group: 'setup', href: '/boat/setup/cal/bsp', label: 'BSP cal', desc: 'Boat speed calibration' },
  {
    group: 'setup',
    href: '/boat/setup/cal/compass',
    label: 'Compass',
    desc: 'Compass deviation table',
  },
  // Diagnostics
  {
    group: 'diagnostics',
    href: '/boat/diag',
    label: 'Diagnostics',
    desc: 'N2K bus inspection, session replay, and server logs',
  },
  {
    group: 'diagnostics',
    href: '/boat/diag/sensors',
    label: 'Sensors',
    desc: 'Per-channel source freshness and priority',
  },
  {
    group: 'diagnostics',
    href: '/boat/diag/sessions',
    label: 'Sessions',
    desc: 'Recorded sessions — replay, download, delete',
  },
];

function staticToCard(s: (typeof STATIC_CARDS)[number]): BoatStatusCard {
  return { href: s.href, label: s.label, desc: s.desc, statusLine: '—', tint: 'neutral' };
}

const STATIC_FALLBACK = {
  performance: STATIC_CARDS.filter((c) => c.group === 'performance').map(staticToCard),
  setup: STATIC_CARDS.filter((c) => c.group === 'setup').map(staticToCard),
  diagnostics: STATIC_CARDS.filter((c) => c.group === 'diagnostics').map(staticToCard),
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BoatHubPage() {
  const statusState = useBoatStatus();

  const groups = statusState.status === 'ok' ? statusState.data : STATIC_FALLBACK;

  return (
    <main className="p-6 space-y-6 max-w-3xl">
      {/* Page header */}
      <div className="space-y-1">
        <h1 className="text-[1.111rem] font-semibold text-ink">Boat</h1>
        <p className="text-[0.722rem] text-ink-3">
          Performance targets, sail wardrobe, and boat setup.
        </p>
      </div>

      {/* Loading skeleton — brief flash only */}
      {statusState.status === 'loading' && (
        <div className="text-[0.722rem] text-ink-4 animate-pulse">Loading status…</div>
      )}

      {/* Error — honest but non-fatal; static cards still render */}
      {statusState.status === 'error' && (
        <div className="text-[0.722rem] text-warn px-3 py-2 rounded-[--r-control] bg-warn/10 border border-warn-strong/40">
          Status unavailable — showing static links ({statusState.message})
        </div>
      )}

      {/* Card groups */}
      <CardGroup label="Performance" cards={groups.performance} />
      <CardGroup label="Setup" cards={groups.setup} />
      <CardGroup label="Diagnostics" cards={groups.diagnostics} />
    </main>
  );
}
