import type { Bus, AlarmsRegistry } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';

const ID = 'high-wind';
const KN_PER_MS = 1.94384; // m/s -> knots

/** Clear hysteresis: the alarm clears only once TWS drops below 90% of threshold. */
const CLEAR_FRACTION = 0.9;

/**
 * High-wind (TWS) predicate.
 *
 * `wind.true.speed` is a single-source computed channel (m/s, produced by the
 * true-wind pipeline), so this uses plain bus.subscribe — no multi-source
 * arbitration needed. Fires a WARN once TWS stays above thresholdKn for
 * holdMs; clears with hysteresis at 90% of the threshold so a gusty breeze
 * sitting right on the line doesn't strobe the alarm.
 */
export function startHighWindPredicate(
  bus: Bus,
  registry: AlarmsRegistry,
  configRef: { current: AlarmsConfig },
): { dispose(): void } {
  let pendingFireTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTwsKn = 0;

  const cancelPending = (): void => {
    if (pendingFireTimer) {
      clearTimeout(pendingFireTimer);
      pendingFireTimer = null;
    }
  };

  const unsubscribe = bus.subscribe('wind.true.speed', (sample) => {
    const cfg = configRef.current;
    if (!cfg.enabled[ID]) {
      cancelPending();
      return;
    }
    if (sample.value.kind !== 'scalar') return;
    const twsMs = sample.value.value;
    if (!Number.isFinite(twsMs)) return;
    const twsKn = twsMs * KN_PER_MS;
    lastTwsKn = twsKn;

    const threshold = cfg.thresholds.highWind;
    const holdMs = threshold?.holdMs ?? 60000;
    const thresholdKn = threshold?.thresholdKn ?? 30;

    if (twsKn > thresholdKn) {
      const current = registry.get(ID);
      if (current && current.clearedAt === null) return; // already active (or acked)
      if (pendingFireTimer) return;
      pendingFireTimer = setTimeout(() => {
        pendingFireTimer = null;
        registry.fire({
          id: ID,
          severity: 'WARN',
          label: `High wind ${lastTwsKn.toFixed(1)} kn`,
          sticky: false,
          context: { twsKn: lastTwsKn, thresholdKn },
        });
      }, holdMs);
    } else if (twsKn < thresholdKn * CLEAR_FRACTION) {
      cancelPending();
      registry.clear(ID);
    } else {
      // Hysteresis band (90%..100% of threshold): the sustain above threshold
      // is broken, so cancel any pending fire — but an active alarm stays up.
      cancelPending();
    }
  });

  return {
    dispose: () => {
      unsubscribe();
      cancelPending();
    },
  };
}
