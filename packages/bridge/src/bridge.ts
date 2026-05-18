import type { Bus } from '@g5000/core';
import type { WireDriver } from './wire-driver.js';
import { createDriverHub, setSharedDriverHub } from './driver-hub.js';
import { registerAutopilotTxIfEnabled } from './autopilot-tx-impl.js';

export interface BridgeOptions {
  bus: Bus;
  drivers: WireDriver[];
}

/**
 * Wires each boot-time WireDriver through the shared DriverHub and
 * publishes resulting Samples on the shared Bus. The hub is also set as
 * the process-wide shared singleton so API routes can hot-add or remove
 * drivers (e.g. SocketCAN toggling on/off) without a restart.
 *
 * The boot-time drivers are registered under labels `boot-0`, `boot-1`,
 * ... — opaque from the caller's perspective, since the boot path tears
 * them down via the returned `teardown()` rather than by label. Hot-added
 * drivers (post-boot) get explicit, semantic labels.
 */
export async function runBridge(opts: BridgeOptions): Promise<() => Promise<void>> {
  const { bus, drivers } = opts;
  const hub = createDriverHub(bus);
  setSharedDriverHub(hub);

  // AP TX is disabled by default. Mac dev enables it by setting
  // G5000_ENABLE_AP_TX=1 before launching the autopilot server. The TX
  // path is bound to the first registered driver — historically that's
  // the NGT-1 if present, else the YDWG. Preserving that binding for now;
  // a richer "AP TX picks the best TX-capable driver" can come later.
  if (drivers.length > 0) {
    registerAutopilotTxIfEnabled(drivers[0]!);
  }

  for (let i = 0; i < drivers.length; i++) {
    await hub.addDriver(`boot-${i}`, drivers[i]!);
  }

  return () => hub.teardown();
}
