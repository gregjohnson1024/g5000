import type { Bus, AlarmsRegistry } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';

const ID = 'over-speed';
const MS_PER_KN = 0.514444; // 1 knot in m/s

export function startOverSpeedPredicate(
  bus: Bus,
  registry: AlarmsRegistry,
  configRef: { current: AlarmsConfig },
): { dispose(): void } {
  let pendingFireTimer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = bus.subscribe('nav.gps.sog', (sample) => {
    const cfg = configRef.current;
    if (!cfg.enabled[ID]) {
      if (pendingFireTimer) {
        clearTimeout(pendingFireTimer);
        pendingFireTimer = null;
      }
      return;
    }
    if (sample.value.kind !== 'scalar') return;
    const sogMs = sample.value.value;
    if (!Number.isFinite(sogMs)) return;

    const threshold = cfg.thresholds.overSpeed;
    const holdMs = threshold.holdMs ?? 5000;
    const thresholdKn = threshold.thresholdKn ?? 12;
    const thresholdMs = thresholdKn * MS_PER_KN;

    if (sogMs > thresholdMs) {
      const current = registry.get(ID);
      if (current && current.clearedAt === null) return;
      if (pendingFireTimer) return;
      pendingFireTimer = setTimeout(() => {
        pendingFireTimer = null;
        registry.fire({
          id: ID,
          severity: 'WARN',
          label: 'Over Speed',
          sticky: false,
          context: { sogKn: sogMs / MS_PER_KN, thresholdKn },
        });
      }, holdMs);
    } else {
      if (pendingFireTimer) {
        clearTimeout(pendingFireTimer);
        pendingFireTimer = null;
      }
      registry.clear(ID);
    }
  });

  return {
    dispose: () => {
      unsubscribe();
      if (pendingFireTimer) clearTimeout(pendingFireTimer);
    },
  };
}
