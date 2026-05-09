import { Bus } from './bus.js';

let instance: Bus | null = null;

/**
 * Returns the process-wide shared Bus, creating it lazily.
 *
 * In Phase 0a everything runs in one Node process: the autopilot-server
 * starts the bridge (which publishes to this bus) and serves Next.js
 * Route Handlers (which subscribe to this bus). Tests should construct
 * their own `new Bus()` and never call this function.
 */
export function getSharedBus(): Bus {
  if (!instance) instance = new Bus();
  return instance;
}

/** Test helper — resets the singleton. Do not call in production code. */
export function _resetSharedBusForTests(): void {
  instance = null;
}
