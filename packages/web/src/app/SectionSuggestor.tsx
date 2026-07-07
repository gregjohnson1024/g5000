'use client';

/**
 * SectionSuggestor.tsx — one-time dismissible toast for boat-state suggestions
 * (Task 5, Phase 2).
 *
 * Renders a toast (bottom-center) when a boat-state signal becomes true for the
 * first time in this session, offering to jump to the relevant section.  The
 * dismissal is persisted to localStorage so the toast never appears again for
 * that signal in subsequent sessions.
 *
 * Signals:
 *   sail   → "Race active or underway — switch to SAIL?"
 *   anchor → "Anchor watch armed — switch to ANCHOR?"
 *   voyage → "Active route plan — switch to VOYAGE?"
 *
 * Design laws (keep-list + proposal §5):
 *   - NEVER auto-navigates.  NEVER auto-switches theme.
 *   - Dismissed toasts do not reappear: one key per signal in localStorage.
 *   - Toast only shows when the user is NOT already on the suggested section.
 *   - Multiple signals coalesce: only the highest-priority undismissed signal
 *     shows at a time (priority: sail > anchor > voyage).
 *   - "Go now" navigates via next/link (router.push) — user must click.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { X } from 'lucide-react';

import type { BoatStateFlags } from './use-boat-state';
import { storageGet, storageSet } from '../lib/storage';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type SuggestSignal = 'sail' | 'anchor' | 'voyage';

const SIGNAL_ORDER: SuggestSignal[] = ['sail', 'anchor', 'voyage'];

const SIGNAL_META: Record<
  SuggestSignal,
  { label: string; detail: string; href: string; sectionPathPrefix: string }
> = {
  sail: {
    label: 'SAIL',
    detail: 'Race timer armed or underway.',
    href: '/sail',
    sectionPathPrefix: '/sail',
  },
  anchor: {
    label: 'ANCHOR',
    detail: 'Anchor watch is armed.',
    href: '/anchor',
    sectionPathPrefix: '/anchor',
  },
  voyage: {
    label: 'VOYAGE',
    detail: 'Active route plan.',
    href: '/voyage',
    sectionPathPrefix: '/voyage',
  },
};

/** localStorage key that records dismissed signals. */
function dismissKey(signal: SuggestSignal): string {
  return `suggest-dismissed:${signal}`;
}

function isDismissed(signal: SuggestSignal): boolean {
  return storageGet(dismissKey(signal)) === '1';
}

function setDismissed(signal: SuggestSignal): void {
  storageSet(dismissKey(signal), '1');
}

// ---------------------------------------------------------------------------
// SectionSuggestor
// ---------------------------------------------------------------------------

interface SectionSuggestorProps {
  flags: BoatStateFlags;
}

/**
 * Renders a dismissible toast whenever a boat-state signal becomes active and
 * the user is not already in that section.  Renders nothing when silent.
 */
export function SectionSuggestor({ flags }: SectionSuggestorProps) {
  const pathname = usePathname();
  const router = useRouter();

  // Which signal is active and relevant right now?
  const [activeSignal, setActiveSignal] = useState<SuggestSignal | null>(null);

  useEffect(() => {
    // Walk priority order, find the first undismissed, active signal whose
    // section is not already the current pathname.
    let next: SuggestSignal | null = null;
    for (const signal of SIGNAL_ORDER) {
      if (!flags[signal]) continue;
      if (isDismissed(signal)) continue;
      const meta = SIGNAL_META[signal];
      // Don't toast when the user is already on the target section.
      if (pathname.startsWith(meta.sectionPathPrefix)) continue;
      next = signal;
      break;
    }
    setActiveSignal(next);
  }, [flags, pathname]);

  const dismiss = useCallback(() => {
    if (activeSignal) {
      setDismissed(activeSignal);
      setActiveSignal(null);
    }
  }, [activeSignal]);

  const goNow = useCallback(() => {
    if (!activeSignal) return;
    const { href } = SIGNAL_META[activeSignal];
    dismiss();
    router.push(href);
  }, [activeSignal, dismiss, router]);

  if (!activeSignal) return null;

  const meta = SIGNAL_META[activeSignal];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Suggestion: switch to ${meta.label} section`}
      className="fixed bottom-20 inset-x-0 flex justify-center z-50 pointer-events-none md:bottom-4"
    >
      <div className="pointer-events-auto flex items-center gap-3 bg-surface-raised border border-hairline-strong rounded-lg px-4 py-3 shadow-lg max-w-sm w-full mx-4">
        {/* Signal dot */}
        <span className="w-2 h-2 rounded-full bg-accent-ink shrink-0" aria-hidden />

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-ink-value leading-tight">{meta.detail}</p>
          <p className="text-xs text-ink-3 leading-tight mt-0.5">
            Switch to <span className="text-accent-ink font-semibold">{meta.label}</span>?
          </p>
        </div>

        {/* Go button */}
        <button
          type="button"
          onClick={goNow}
          className="shrink-0 px-2.5 py-1 rounded text-xs font-semibold bg-accent text-on-accent hover:bg-accent-hi transition-colors"
          aria-label={`Go to ${meta.label} section`}
        >
          Go
        </button>

        {/* Dismiss */}
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 p-1 rounded text-ink-3 hover:text-ink hover:bg-surface-raised transition-colors"
          aria-label="Dismiss suggestion"
        >
          <X size={14} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
