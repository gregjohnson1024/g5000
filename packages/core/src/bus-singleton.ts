import { Bus } from './bus.js';

declare const globalThis: { __g5000_sharedBus__?: Bus };

/**
 * Returns the process-wide shared Bus, creating it lazily.
 *
 * Backed by `globalThis` so the bus survives Next.js + Turbopack's tendency
 * to instantiate a workspace package once per server bundle. Without this,
 * the autopilot-server's bus and the Next.js route handlers' bus would be
 * two different objects in the same Node process and SSE would never see
 * the bridge's publishes. (Same fix applied to ConfigStore in Plan 3.)
 */
export function getSharedBus(): Bus {
  if (!globalThis.__g5000_sharedBus__) {
    globalThis.__g5000_sharedBus__ = new Bus();
  }
  return globalThis.__g5000_sharedBus__;
}

/** Test helper — resets the singleton. Do not call in production code. */
export function _resetSharedBusForTests(): void {
  globalThis.__g5000_sharedBus__ = undefined;
}
