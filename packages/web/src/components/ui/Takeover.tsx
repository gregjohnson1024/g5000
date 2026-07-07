'use client';

/**
 * Takeover — full-viewport critical-alarm overlay.
 *
 * Specification (proposal §5, keep-list, task-5 brief):
 *
 *   - Elevation e3: full-viewport scrim (--scrim) + danger-surface backing
 *     + hairline-strong border + shadow.
 *   - Red-keyed in EVERY theme via --danger / --danger-strong tokens only.
 *     NEVER branches on theme — the token set handles DAY / NIGHT / SUN.
 *   - Giant d1 statement: alarm label on the first line, context on the second
 *     (MOB position as compact DMM "32 18.000n 064 48.000w"; anchor-drag as
 *     "42 m from anchor point" extracted from the label itself).
 *   - One primary action button + a HoldButton hold-to-silence (≥800 ms) that
 *     PATCHes /api/alarms { id, action: 'ack' }.
 *   - After ack the Takeover dismisses automatically (the alarm leaves the
 *     active set within one 2-second poll cycle).
 *   - MOB keeps its hold-with-progress arm (HoldButton with 1200 ms).
 *   - Focus-trapped: Tab cycles only within the overlay; Escape is suppressed
 *     (cannot accidentally dismiss a critical alarm with a key).
 *   - Mounts as a sibling of NavShell inside AlarmStore in layout.tsx so it
 *     can consume useAlarms() directly.
 *
 * Token constraint: NO raw hex, NO slate-/rose-/emerald-/red- classes.
 * All colour comes from --danger, --danger-strong, --danger-surface, --ink-value,
 * --ink-2, --canvas, --scrim, and --hairline-strong.
 */

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAlarms } from '../AlarmStore';
import { HoldButton } from './HoldButton';
import { pickCriticalTakeover } from './takeover-trigger';
import { fmtLatLonDmm } from '../../lib/coords';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable context line from an alarm row's context object.
 * Returns undefined if no meaningful context.
 */
function contextLine(id: string, context: Record<string, unknown> | undefined): string | undefined {
  if (!context) return undefined;

  if (id === 'mob') {
    const lat = typeof context['lat'] === 'number' ? context['lat'] : undefined;
    const lon = typeof context['lon'] === 'number' ? context['lon'] : undefined;
    if (lat !== undefined && lon !== undefined) {
      return fmtLatLonDmm(lat, lon);
    }
  }

  // anchor-watch: label already carries "Anchor drag N m", so no extra context
  // line needed unless a future shape adds one explicitly.
  return undefined;
}

// ---------------------------------------------------------------------------
// Focus trap helper
// ---------------------------------------------------------------------------

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(e: ReactKeyboardEvent<HTMLDivElement>, container: HTMLDivElement | null) {
  if (e.key !== 'Tab' || !container) return;
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  if (nodes.length === 0) return;
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Takeover(): React.ReactElement | null {
  const { active } = useAlarms();
  const alarm = pickCriticalTakeover(active);

  const containerRef = useRef<HTMLDivElement>(null);
  const [acking, setAcking] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  // Move focus into the overlay when it appears.
  useEffect(() => {
    if (!alarm) return;
    const frame = requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;
      const focusable = el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length > 0) {
        focusable[0]!.focus();
      } else {
        el.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [alarm?.id]); // re-run when the alarm id changes

  if (!alarm) return null;

  const ctxLine = contextLine(alarm.id, alarm.context);

  // PATCH /api/alarms { id, action: 'ack' }
  const handleAck = async () => {
    if (acking) return;
    setAcking(true);
    setAckError(null);
    try {
      const res = await fetch('/api/alarms', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: alarm.id, action: 'ack' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setAckError(body.error ?? `HTTP ${res.status}`);
      }
      // On success: alarm leaves the active set within the next 2s poll;
      // the Takeover disappears automatically as useAlarms() updates.
    } catch (err) {
      setAckError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setAcking(false);
    }
  };

  // Hold duration: MOB gets 1200ms (critical, irreversible); anchor-watch 800ms.
  const holdMs = alarm.id === 'mob' ? 1200 : 800;

  return (
    // Full-viewport scrim — e3 elevation backdrop
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center"
      style={{ backgroundColor: 'var(--scrim)' }}
      onKeyDown={(e) => {
        // Suppress Escape — cannot dismiss a critical alarm accidentally.
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
        }
        trapFocus(e, containerRef.current);
      }}
    >
      {/*
       * Takeover panel — e3 surface.
       * Red-keyed via --danger-surface background + --danger-strong border.
       * ALL three themes produce red here because the token values are:
       *   DAY:   --danger-surface #3A0D10, --danger-strong #DC2626
       *   NIGHT: --danger-surface #000000, --danger-strong #F87171
       *   SUN:   --danger-surface #FEE2E2, --danger-strong #991B1B
       */}
      <div
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-live="assertive"
        aria-label={`Critical alarm: ${alarm.label}`}
        tabIndex={-1}
        className={[
          'w-full max-w-lg mx-4',
          'flex flex-col items-center gap-6',
          'px-8 py-10',
          '[border-radius:var(--r-panel)]',
          'border-2',
          'shadow-[0_8px_32px_rgb(0_0_0_/_0.80)]',
          'focus:outline-none',
        ].join(' ')}
        style={{
          backgroundColor: 'var(--danger-surface)',
          borderColor: 'var(--danger-strong)',
        }}
      >
        {/* Alarm identity badge */}
        <div
          className="text-[0.722rem] font-semibold uppercase tracking-[0.08em]"
          style={{ color: 'var(--danger)' }}
        >
          CRITICAL ALARM
        </div>

        {/* d1 statement — giant label */}
        <div className="text-center space-y-2">
          <div
            className="font-bold leading-none tracking-tight tabular-nums"
            style={{
              fontSize: '4.5rem' /* d1 */,
              color: 'var(--danger)',
              wordBreak: 'break-word',
            }}
          >
            {alarm.label}
          </div>

          {/* Context sub-line (compact DMM for MOB; empty for anchor-watch unless future context) */}
          {ctxLine && (
            <div
              className="font-mono tabular-nums text-[1.5rem] leading-snug"
              style={{ color: 'var(--danger)' }}
            >
              {ctxLine}
            </div>
          )}
        </div>

        {/* Error message (if ack fails) */}
        {ackError && (
          <p className="text-[0.833rem] text-center" style={{ color: 'var(--danger)' }}>
            Silence failed: {ackError} — try again.
          </p>
        )}

        {/* Hold-to-silence button */}
        <HoldButton
          holdMs={holdMs}
          onHold={handleAck}
          disabled={acking}
          confirmedLabel="Silenced"
          confirmedDuration={1500}
          fillColor="bg-danger-strong"
          className={['min-h-[56px] w-full px-6', 'text-[1rem] font-semibold', 'border-2'].join(
            ' ',
          )}
          style={
            {
              backgroundColor: 'transparent',
              borderColor: 'var(--danger)',
              color: 'var(--danger)',
            } as React.CSSProperties
          }
          aria-label={`Hold to silence ${alarm.label} alarm`}
        >
          {acking ? 'Silencing…' : 'Hold to silence'}
        </HoldButton>
      </div>
    </div>
  );
}
