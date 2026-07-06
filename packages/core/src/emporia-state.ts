/**
 * Shared types + globalThis-backed accessors for the Emporia Vue 3 registry.
 *
 * The registry aggregates power data from an Emporia Vue 3 device into a
 * curated snapshot (mains power, circuit-level watts, device info). It's a
 * singleton because the Emporia driver and the Next.js routes run in the same
 * Node process but Turbopack may instantiate workspace packages more than
 * once — same pattern used by the shared Bus, ConfigStore, Victron, and
 * DeviceRegistry.
 *
 * The actual implementation lives in `@g5000/bridge` (or similar). Consumers
 * only need the types and the accessors.
 */

export type EmporiaScale = '1S' | '1MIN' | '15MIN' | '1H' | '1D' | '1W' | '1MON' | '1Y';

export interface EmporiaChannel {
  channelNum: string;
  name: string;
  multiplier: number;
}

export interface EmporiaDevice {
  deviceGid: number;
  model: string;
  firmware: string;
  channels: EmporiaChannel[];
}

export interface EmporiaCircuit {
  channelNum: string;
  name: string;
  watts: number | null;
  multiplier: number;
}

export interface EmporiaSnapshot {
  connected: boolean;
  updatedAt: number; // epoch ms of last update
  deviceGid: number | null;
  model: string | null;
  circuits: EmporiaCircuit[]; // branch circuits (excludes mains + balance)
  mainsW: number | null;
  balanceW: number | null;
}

export interface EmporiaRegistry {
  setSnapshot(s: EmporiaSnapshot): void;
  snapshot(): EmporiaSnapshot;
  setDevices(d: EmporiaDevice[]): void;
  devices(): EmporiaDevice[];
  markStale(): void;
}

/**
 * On-demand history provider (live client or sim), set by startEmporia.
 * Fetches usage data for a specific device/channel over a time range.
 */
export type EmporiaHistoryFn = (
  gid: number,
  channel: string,
  scale: EmporiaScale,
  startIso: string,
  endIso: string,
) => Promise<{ firstUsageInstant: string; usageList: Array<number | null> }>;

const OFFLINE: EmporiaSnapshot = {
  connected: false,
  updatedAt: 0,
  deviceGid: null,
  model: null,
  circuits: [],
  mainsW: null,
  balanceW: null,
};

declare const globalThis: {
  __g5000_emporia__?: EmporiaRegistry;
  __g5000_emporiaHistory__?: EmporiaHistoryFn;
};

/**
 * Get the process-wide Emporia registry, or `undefined` if no producer has
 * created one yet.
 */
export function getSharedEmporia(): EmporiaRegistry | undefined {
  return globalThis.__g5000_emporia__;
}

/** Install the registry as the singleton. Called by the Emporia driver. */
export function setSharedEmporia(r: EmporiaRegistry): void {
  globalThis.__g5000_emporia__ = r;
}

/**
 * Get the process-wide Emporia history provider, or `undefined` if not
 * installed yet.
 */
export function getSharedEmporiaHistory(): EmporiaHistoryFn | undefined {
  return globalThis.__g5000_emporiaHistory__;
}

/** Install the history provider as the singleton. */
export function setSharedEmporiaHistory(f: EmporiaHistoryFn): void {
  globalThis.__g5000_emporiaHistory__ = f;
}

export const EMPORIA_OFFLINE_SNAPSHOT = OFFLINE;
