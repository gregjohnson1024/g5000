import type { Bus, AlarmsRegistry } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';

const ID = 'low-battery';

export function startLowBatteryPredicate(
  bus: Bus,
  registry: AlarmsRegistry,
  configRef: { current: AlarmsConfig },
): { dispose(): void } {
  let pendingFireTimer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = bus.subscribe('electrical.battery.voltage', (sample) => {
    const cfg = configRef.current;
    if (!cfg.enabled[ID]) {
      if (pendingFireTimer) {
        clearTimeout(pendingFireTimer);
        pendingFireTimer = null;
      }
      return;
    }
    if (sample.value.kind !== 'scalar') return;
    const volts = sample.value.value;
    if (!Number.isFinite(volts)) return;

    const threshold = cfg.thresholds.lowBattery;
    const holdMs = threshold.holdMs ?? 5000;
    const thresholdV = threshold.thresholdV ?? 11.8;

    if (volts < thresholdV) {
      const current = registry.get(ID);
      if (current && current.clearedAt === null) return;
      if (pendingFireTimer) return;
      pendingFireTimer = setTimeout(() => {
        pendingFireTimer = null;
        registry.fire({
          id: ID,
          severity: 'WARN',
          label: 'Low Battery',
          sticky: false,
          context: { volts, thresholdV },
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
