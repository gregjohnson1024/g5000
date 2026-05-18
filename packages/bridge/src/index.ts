export * from './wire-driver.js';
export * from './ngt-driver.js';
export * from './ydwg-raw-tcp-driver.js';
export * from './socket-can-driver.js';
export * from './decoder.js';
export * from './channel-mapper.js';
export * from './bridge.js';
export * from './nmea0183/sentence-parser.js';
export * from './nmea0183/serial-driver.js';
export * from './nmea0183/channel-mapper.js';
export * from './persistence/session-logger.js';
export * from './persistence/replay-driver.js';
export {
  listSessions,
  summarizeSession,
  type SessionInfo,
  type SessionSummary,
} from './persistence/session-summary.js';
export * from './tx/true-wind-tx.js';
export * from './devices/device-registry.js';
export * from './ais/targets-registry.js';
export * from './alerts/registry.js';
export { readCaptureCodes } from './capture-codes.js';
export type { CaptureCodes, CaptureEntry } from './autopilot-commands.js';

import { DeviceRegistry } from './devices/device-registry.js';

declare const globalThis: { __g5000_deviceRegistry__?: DeviceRegistry };

export function getSharedDeviceRegistry(): DeviceRegistry {
  if (!globalThis.__g5000_deviceRegistry__) {
    globalThis.__g5000_deviceRegistry__ = new DeviceRegistry();
  }
  return globalThis.__g5000_deviceRegistry__;
}

export function _resetSharedDeviceRegistryForTests(): void {
  globalThis.__g5000_deviceRegistry__ = undefined;
}
