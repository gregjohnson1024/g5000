import type { Bus, AlarmsRegistry } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';
import { startAnchorWatchPredicate } from './anchor-watch.js';
import { startShallowWaterPredicate } from './shallow-water.js';
import { startOverSpeedPredicate } from './over-speed.js';
import { startLowBatteryPredicate } from './low-battery.js';
import { startHighWindPredicate } from './high-wind.js';
import { startCpaMonitor } from './cpa-monitor.js';

export {
  startAnchorWatchPredicate,
  startShallowWaterPredicate,
  startOverSpeedPredicate,
  startLowBatteryPredicate,
  startHighWindPredicate,
  startCpaMonitor,
};
// Pure anchor geometry — also consumed by the /api/alarms/anchor route.
export * from './anchor-geometry.js';
// ntfy push transport — consumed by the g5000 app's alarm-push wrapper and
// the /api/alarms/push-test route.
export * from './push.js';

export function startAlarmsPipeline(
  bus: Bus,
  registry: AlarmsRegistry,
  configRef: { current: AlarmsConfig },
): { dispose(): void } {
  const handles = [
    startAnchorWatchPredicate(bus, registry, configRef),
    startShallowWaterPredicate(bus, registry, configRef),
    startOverSpeedPredicate(bus, registry, configRef),
    startLowBatteryPredicate(bus, registry, configRef),
    startHighWindPredicate(bus, registry, configRef),
    startCpaMonitor(bus, registry, configRef),
  ];
  return {
    dispose: () => {
      for (const h of handles) h.dispose();
    },
  };
}
