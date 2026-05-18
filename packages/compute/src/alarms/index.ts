import type { Bus, AlarmsRegistry } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';
import { startAnchorWatchPredicate } from './anchor-watch.js';
import { startShallowWaterPredicate } from './shallow-water.js';
import { startOverSpeedPredicate } from './over-speed.js';
import { startLowBatteryPredicate } from './low-battery.js';

export {
  startAnchorWatchPredicate,
  startShallowWaterPredicate,
  startOverSpeedPredicate,
  startLowBatteryPredicate,
};

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
  ];
  return {
    dispose: () => {
      for (const h of handles) h.dispose();
    },
  };
}
