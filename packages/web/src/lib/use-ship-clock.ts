'use client';

/**
 * useShipClock — the resolved app-wide clock for display formatting.
 *
 * Combines the boat-wide ClockConfig (theme-store, synced over the mast SSE
 * stream) with the live GPS longitude (SSE store) so 'auto' ship offsets
 * follow the boat's nautical zone. Components pass the result straight to
 * the lib/tz.ts formatters.
 */

import { useSseChannel } from '../hooks/use-sse-store';
import { useThemeStore } from './theme-store';
import { resolveClock, type ShipClock } from './tz';

/** Never published — subscribing to it yields a stable null sample, so the
 *  hook does not re-render at GPS rate when the offset is not on auto. */
const OFF = '__ship-clock-off__';

export function useShipClock(): ShipClock {
  const { clockCfg } = useThemeStore();
  const auto = clockCfg.mode === 'ship' && clockCfg.offsetMin === null;
  const { sample } = useSseChannel(auto ? 'nav.gps.position' : OFF);
  const v = sample?.value as { lon?: number } | null | undefined;
  const lon = typeof v?.lon === 'number' ? v.lon : null;
  return resolveClock(clockCfg, lon);
}
