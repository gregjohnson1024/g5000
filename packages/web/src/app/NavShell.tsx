'use client';

/**
 * NavShell — Phase-2 Tier-0 shell (replaces Navbar.tsx).
 *
 * Renders:
 *   AppBar (48px): brand · 6 section chips · AlarmLane · UTC clock · link LED
 *                  ThemeChip · AlertsBell · MOB cell
 *   SectionTabs (40px): underline sub-nav for the active section.
 *                       HIDDEN on /chart and /anchor.
 *   Phone bottom TabBar: 6 items ≥56px targets (responsive, never wrapped rows).
 *
 * Task-3: hrefs are canonical new URLs; Mast (/mast) added to SAIL tabs; BOAT tabs
 * trimmed to spec (Crossover added, Damping removed, Diagnostics → /boat/diag/wind).
 * Task-4: AlarmLane + bell read from the shared AlarmStore (useAlarms()). No private poll.
 * Bell keeps the existing SVG shape (lucide swap deferred to Task 6 per spec).
 *
 * Lucide icons used (shell only, per Task-1 spec):
 *   Bell, AlertTriangle, Wifi, WifiOff, Sun, Moon, Zap — from lucide-react.
 *
 * Keep-list invariants honoured:
 *   - MOB: hold-with-progress interaction preserved (renders <MobButton>).
 *   - AlarmLane: pre-reserved fixed-width cell; zero reflow when alarm fires.
 *   - UTC discipline: clock shows HH:MM:SSz in tabular numerals.
 *   - aria-current='page' on the active section / tab.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Wifi, WifiOff, Sun, Moon, Zap } from 'lucide-react';

import { useSseConnected, useSseChannel } from '../hooks/use-sse-store';
import { MobButton } from '../components/MobButton';
import type { LivePos } from '../components/LiveBoatMarker';
import { geo } from './sail/tile-helpers';
import { useAlarms, type AlarmRow, SEVERITY_RANK } from '../components/AlarmStore';
import { useThemeStore } from '../lib/theme-store';
import { useShipClock } from '../lib/use-ship-clock';
import { fmtClockTime } from '../lib/tz';
import type { Theme } from '@g5000/mast';
import { SECTIONS, activeSection, shouldHideSectionTabs, bestMatchHref } from './nav-sections';
import { useBoatState } from './use-boat-state';
import { SectionSuggestor } from './SectionSuggestor';

// ---------------------------------------------------------------------------
// AppBar clock — HH:MM:SSz (UTC mode) or HH:MM:SS±H (ship mode), 1 s ticks
// ---------------------------------------------------------------------------

function useAppBarClock(): string {
  const clock = useShipClock();
  // Start empty so SSR and the first client render agree (rendering the live
  // time in the useState initialiser makes server-time ≠ client-time → a React
  // #418 hydration text mismatch). Fill in after mount via the effect.
  const [display, setDisplay] = useState('');

  useEffect(() => {
    // Lowercase suffix ('z' not 'Z') is the established AppBar style.
    const tick = () => setDisplay(fmtClockTime(Date.now() / 1000, clock).toLowerCase());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // Depend on primitives — the clock object identity changes per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.mode, clock.offsetMin]);

  return display;
}

// ---------------------------------------------------------------------------
// ThemeChip — reads from shared ThemeStore (SSE-synced); lucide icons for
// DAY (Zap), NIGHT (Moon), SUN (Sun). Cycles on click.
// ---------------------------------------------------------------------------

const THEME_LABELS: Record<Theme, string> = { day: 'DAY', night: 'NGT', sun: 'SUN' };

/** Lucide icon representing each theme. Uses currentColor for re-theming. */
function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'night') return <Moon size={14} strokeWidth={2} aria-hidden />;
  if (theme === 'sun') return <Sun size={14} strokeWidth={2} aria-hidden />;
  return <Zap size={14} strokeWidth={2} aria-hidden />;
}

function ThemeChip() {
  // Read shared store — updated by ThemeController on SSE push and by cycleTheme locally.
  const { theme, cycleTheme } = useThemeStore();

  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={`Theme: ${THEME_LABELS[theme]}. Click to cycle theme.`}
      className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-semibold border border-hairline-strong text-ink-3 hover:border-accent hover:text-accent-ink transition-colors shrink-0"
    >
      <ThemeIcon theme={theme} />
      {THEME_LABELS[theme]}
    </button>
  );
}

// ---------------------------------------------------------------------------
// AlarmLane — fixed-width reserved cell; never shifts adjacent items
// ---------------------------------------------------------------------------

interface AlarmLaneProps {
  alarms: AlarmRow[];
}

/**
 * AlarmLane: a fixed-width cell always present in the AppBar.
 * When no alarms: renders an empty placeholder preserving layout.
 * When alarm fires: renders the top alarm statement + ACK link.
 * Zero reflow: the cell has a hard min-w so adjacent slots never move.
 */
function AlarmLane({ alarms }: AlarmLaneProps) {
  const sorted = [...alarms].sort(
    (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
  );
  const top = sorted[0] ?? null;

  const severityClass = top
    ? top.severity === 'CRITICAL'
      ? 'text-danger border-danger'
      : top.severity === 'WARN'
        ? 'text-warn border-warn'
        : 'text-info border-info'
    : '';

  return (
    // min-w-[12rem] reserves space; content fills in but cell width never changes.
    <div
      className="min-w-[12rem] flex items-center justify-center px-2 overflow-hidden"
      aria-live="polite"
      aria-label="Alarm lane"
    >
      {top ? (
        <Link
          href="/alerts"
          className={`flex items-center gap-1.5 text-xs font-semibold border rounded px-2 py-0.5 truncate max-w-full ${severityClass} hover:opacity-80`}
          aria-label={`${top.severity}: ${top.label}. Tap to view all alerts.`}
        >
          <span className="truncate">{top.label}</span>
          {sorted.length > 1 && <span className="shrink-0 opacity-70">(+{sorted.length - 1})</span>}
        </Link>
      ) : (
        // Empty placeholder — same height as the chip so the row height is stable.
        <span className="invisible text-xs border rounded px-2 py-0.5" aria-hidden>
          placeholder
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AlertsBell
// ---------------------------------------------------------------------------

interface AlertsBellProps {
  alarmCount: number;
  topSeverity: 'CRITICAL' | 'WARN' | 'INFO' | null;
  activeHref: string | null;
}

function AlertsBell({ alarmCount, topSeverity, activeHref }: AlertsBellProps) {
  const colorClass =
    topSeverity === 'CRITICAL'
      ? 'text-danger animate-pulse'
      : topSeverity === 'WARN'
        ? 'text-warn'
        : topSeverity === 'INFO'
          ? 'text-info'
          : activeHref === '/alerts'
            ? 'text-accent-ink'
            : 'text-ink-3';

  return (
    <Link
      href="/alerts"
      aria-label={alarmCount > 0 ? `Alerts (${alarmCount} active)` : 'Alerts'}
      className={`relative p-2 rounded hover:bg-surface-raised transition-colors ${colorClass}`}
      aria-current={activeHref === '/alerts' ? 'page' : undefined}
    >
      <Bell size={18} strokeWidth={2} aria-hidden />
      {alarmCount > 0 && (
        <span
          className={`absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 rounded-full text-[10px] font-bold leading-4 text-center ${
            topSeverity === 'CRITICAL'
              ? 'bg-danger text-canvas'
              : topSeverity === 'WARN'
                ? 'bg-warn text-on-warn'
                : 'bg-info text-canvas'
          }`}
        >
          {alarmCount > 9 ? '9+' : alarmCount}
        </span>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// LinkLED — reads connected state from SseStoreContext
// ---------------------------------------------------------------------------

/**
 * ShellMobButton — supplies the live GPS fix to the shell's MOB button so a
 * MOB fired from the AppBar captures a position (previously livePos was
 * hardcoded null, so the Takeover showed no lat/lon and no marker pinned).
 * Subscribes to only the position channel, so position updates re-render this
 * small leaf, not the whole shell. MobButton reads the fix at fire-time via a
 * ref, and HoldButton reads onHold at call-time, so an in-hold re-render is safe.
 */
function ShellMobButton({ className }: { className?: string }) {
  const { sample } = useSseChannel('nav.gps.position');
  const g = geo(sample ?? undefined);
  const livePos: LivePos | null = g
    ? { lat: g.lat, lon: g.lon, cog: null, sog: null, hdg: null, t: sample!.t_ms }
    : null;
  return <MobButton livePos={livePos} className={className} />;
}

function LinkLED() {
  // Connectivity-only selector: re-renders only when the link opens/closes,
  // NOT on every SSE data message (which would re-render the whole shell).
  const connected = useSseConnected();
  return (
    <div
      className={`flex items-center gap-1 text-xs font-mono shrink-0 ${connected ? 'text-live' : 'text-ink-4'}`}
      aria-label={connected ? 'Link: connected' : 'Link: offline'}
    >
      {connected ? (
        <Wifi size={14} strokeWidth={2} aria-hidden />
      ) : (
        <WifiOff size={14} strokeWidth={2} aria-hidden />
      )}
      <span className="hidden sm:inline">{connected ? 'LIVE' : 'LOST'}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NavShell
// ---------------------------------------------------------------------------

export function NavShell({ hiddenHrefs }: { hiddenHrefs?: string[] } = {}) {
  const pathname = usePathname();
  const clockTime = useAppBarClock();

  // Settings: canadianTideCurrents gate (same logic as Navbar.tsx).
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

  // Alarms — read from shared AlarmStore (no private poll).
  const { active: activeAlarms, topSeverity, count: alarmCount } = useAlarms();

  // Boat-state suggestion dots (Task 5).
  const boatState = useBoatState();

  const hidden = new Set(hiddenHrefs ?? []);
  const currentActiveHref = bestMatchHref(pathname);
  const currentSection = activeSection(pathname);
  const hideTabs = shouldHideSectionTabs(pathname);

  // Map section IDs to boat-state suggestion flags.
  // 'chart' and 'conditions' and 'boat' have no suggestion signal.
  const sectionDotMap: Record<string, boolean> = {
    sail: boatState.sail,
    anchor: boatState.anchor,
    voyage: boatState.voyage,
  };

  // Filter a section's tabs: apply canadianTideCurrents gating + hiddenHrefs.
  const visibleTabs = (section: (typeof SECTIONS)[number]) =>
    section.tabs.filter((t) => !hidden.has(t.href) && (!t.canadianGated || canadianTideCurrents));

  return (
    <>
      {/* =====================================================================
          AppBar — 48px, bg-surface-sunken
          Layout: [brand] [section chips] [AlarmLane] [clock] [LED] [theme] [bell] [MOB]
          On small screens: section chips collapse into bottom TabBar.
      ===================================================================== */}
      <header className="bg-surface-sunken border-b border-hairline shrink-0">
        <div className="h-12 px-2 flex items-center gap-1 min-w-0">
          {/* Brand */}
          <Link
            href="/sail"
            className="font-semibold text-ink-value text-sm mr-1 shrink-0"
            aria-label="G5000 home"
          >
            G5000
          </Link>

          {/* Section chips — hidden on small screens (bottom TabBar takes over) */}
          <nav className="hidden md:flex items-center gap-0.5 shrink-0" aria-label="Main sections">
            {SECTIONS.map((section) => {
              const isActive = currentSection?.id === section.id;
              const hasDot = sectionDotMap[section.id] === true;
              const ariaLabel = hasDot ? `${section.label} (suggested)` : section.label;
              return (
                <Link
                  key={section.id}
                  href={section.href}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={ariaLabel}
                  className={`relative px-2.5 py-1 rounded text-xs font-semibold transition-colors min-h-[44px] flex items-center gap-1 ${
                    isActive
                      ? 'bg-accent text-on-accent'
                      : 'text-ink-2 hover:bg-surface-raised hover:text-ink'
                  }`}
                >
                  {section.label}
                  {hasDot && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isActive ? 'bg-on-accent' : 'bg-accent-ink'
                      }`}
                      aria-hidden
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* AlarmLane — pre-reserved, fixed-width, always present */}
          <div className="flex-1 flex justify-center min-w-0">
            <AlarmLane alarms={activeAlarms} />
          </div>

          {/* Ship clock — z-suffixed UTC or ±H-suffixed ship time */}
          <time
            dateTime={clockTime}
            className="hidden sm:block text-xs font-mono tabular-nums text-ink-2 shrink-0 select-none"
            aria-label={`Ship clock: ${clockTime}`}
          >
            {clockTime}
          </time>

          {/* Link LED */}
          <LinkLED />

          {/* Theme chip */}
          <ThemeChip />

          {/* Alerts bell */}
          {!hidden.has('/alerts') && (
            <AlertsBell
              alarmCount={alarmCount}
              topSeverity={topSeverity}
              activeHref={currentActiveHref}
            />
          )}

          {/* MOB cell — hold-with-progress preserved from keep-list */}
          <ShellMobButton className="shrink-0" />
        </div>
      </header>

      {/* =====================================================================
          SectionTabs — ~40px underline row.
          Absent on /chart (hideSectionTabs=true) and /anchor (hideSectionTabs=true).
          Also absent when no tabs to show.
      ===================================================================== */}
      {!hideTabs && currentSection && visibleTabs(currentSection).length > 0 && (
        <nav
          className="hidden md:flex items-end bg-surface-sunken border-b border-hairline px-2 gap-0 shrink-0 h-10"
          aria-label={`${currentSection.label} sub-navigation`}
        >
          {visibleTabs(currentSection).map((tab) => {
            const isActive = currentActiveHref === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={`px-3 h-full flex items-center text-xs font-semibold border-b-2 transition-colors ${
                  isActive
                    ? 'border-accent-ink text-accent-ink'
                    : 'border-transparent text-ink-3 hover:text-ink hover:border-hairline-strong'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}

      {/* =====================================================================
          Phone bottom TabBar — visible on narrow screens only.
          6 items, ≥56px touch targets. Replaces the wrapped flex rows.
      ===================================================================== */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-sunken border-t border-hairline flex"
        aria-label="Main sections"
      >
        {SECTIONS.map((section) => {
          const isActive = currentSection?.id === section.id;
          const hasDot = sectionDotMap[section.id] === true;
          const ariaLabel = hasDot ? `${section.label} (suggested)` : section.label;
          return (
            <Link
              key={section.id}
              href={section.href}
              aria-current={isActive ? 'page' : undefined}
              aria-label={ariaLabel}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[10px] font-semibold transition-colors ${
                isActive ? 'text-accent-ink' : 'text-ink-3 hover:text-ink'
              }`}
            >
              {/* Accent underline for active item */}
              <span
                className={`w-6 h-0.5 rounded-full mb-0.5 ${isActive ? 'bg-accent-ink' : 'bg-transparent'}`}
                aria-hidden
              />
              {/* Label + optional dot in a row */}
              <span className="flex items-center gap-0.5">
                {section.label}
                {hasDot && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isActive ? 'bg-accent-ink' : 'bg-accent-ink opacity-70'
                    }`}
                    aria-hidden
                  />
                )}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Spacer so phone content doesn't hide behind bottom TabBar */}
      <div className="md:hidden h-14 shrink-0" aria-hidden />

      {/* Boat-state suggestion toast — rendered in the shell so it persists
          across client-side navigation without remounting */}
      <SectionSuggestor flags={boatState} />
    </>
  );
}
