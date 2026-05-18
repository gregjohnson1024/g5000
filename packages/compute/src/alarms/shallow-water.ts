import type { Bus, AlarmsRegistry } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';

const ID = 'shallow-water';

export function startShallowWaterPredicate(
  bus: Bus,
  registry: AlarmsRegistry,
  configRef: { current: AlarmsConfig },
): { dispose(): void } {
  let pendingFireTimer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = bus.subscribe('nav.depth', (sample) => {
    const cfg = configRef.current;
    if (!cfg.enabled[ID]) {
      if (pendingFireTimer) {
        clearTimeout(pendingFireTimer);
        pendingFireTimer = null;
      }
      return;
    }
    if (sample.value.kind !== 'scalar') return;
    const depth = sample.value.value;
    if (!Number.isFinite(depth)) return;

    const threshold = cfg.thresholds.shallowWater;
    const holdMs = threshold.holdMs ?? 5000;
    const thresholdM = threshold.thresholdM ?? 3;

    if (depth < thresholdM) {
      const current = registry.get(ID);
      if (current && current.clearedAt === null) return;
      if (pendingFireTimer) return;
      pendingFireTimer = setTimeout(() => {
        pendingFireTimer = null;
        registry.fire({
          id: ID,
          severity: 'CRITICAL',
          label: 'Shallow Water',
          sticky: false,
          context: { depthM: depth, thresholdM },
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
