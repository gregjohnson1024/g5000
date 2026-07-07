/**
 * StatusChip kind → token class mappings.
 *
 * Pure module — no React, no I/O. Maps the 10 chip kinds to token-only
 * Tailwind classes so the mapping can be independently unit-tested.
 *
 * Kinds: ok / warn / alarm / info / neutral / live / stale / demo / replay / armed
 */

export type StatusChipKind =
  | 'ok'
  | 'warn'
  | 'alarm'
  | 'info'
  | 'neutral'
  | 'live'
  | 'stale'
  | 'demo'
  | 'replay'
  | 'armed';

export interface StatusChipClasses {
  /** Wrapper className — background, border, text colour. */
  wrapper: string;
  /** Whether to show a pulse animation on the dot/chip. */
  pulse: boolean;
}

const CHIP_CLASSES: Record<StatusChipKind, StatusChipClasses> = {
  ok: {
    wrapper: 'bg-ok/20 border-ok-strong text-ok',
    pulse: false,
  },
  warn: {
    wrapper: 'bg-warn/20 border-warn-strong text-warn',
    pulse: false,
  },
  alarm: {
    wrapper: 'bg-danger/20 border-danger-strong text-danger',
    pulse: false,
  },
  info: {
    wrapper: 'bg-info/20 border-info-strong text-info',
    pulse: false,
  },
  neutral: {
    wrapper: 'bg-surface-raised border-hairline-strong text-ink-2',
    pulse: false,
  },
  live: {
    wrapper: 'bg-live/20 border-live text-live',
    pulse: true,
  },
  stale: {
    wrapper: 'bg-stale/20 border-stale text-stale',
    pulse: false,
  },
  demo: {
    wrapper: 'bg-demo/20 border-demo text-demo',
    pulse: false,
  },
  replay: {
    wrapper: 'bg-replay/20 border-replay text-replay',
    pulse: false,
  },
  armed: {
    wrapper: 'bg-warn/20 border-warn-strong text-warn',
    pulse: true,
  },
};

/** Return the token-class descriptor for a StatusChip kind. */
export function statusChipClasses(kind: StatusChipKind): StatusChipClasses {
  return CHIP_CLASSES[kind];
}
