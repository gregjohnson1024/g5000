/**
 * Shared types + globalThis-backed accessor for the Victron Venus OS registry.
 *
 * The registry aggregates MQTT snapshots from a Cerbo GX / Venus OS device
 * into a curated UI-friendly snapshot (battery SOC, solar power, tank levels,
 * temps, etc.). It's a singleton because the MQTT driver and the Next.js
 * routes run in the same Node process but Turbopack may instantiate workspace
 * packages more than once — same pattern used by the shared Bus, ConfigStore,
 * AIS targets, and DeviceRegistry.
 *
 * The actual implementation lives in `@g5000/bridge` (`createVictronRegistry`).
 * Consumers only need the types and the accessor.
 */

export interface VictronCharger {
  id: string; // "solarcharger/279"
  name: string;
  power: number; // W
  voltage: number; // V
  current: number; // A
  state: string; // "Bulk" | "Float" | ...
  yieldTodayKwh: number;
  dayMaxPower: number; // W
}

export interface VictronTank {
  id: string;
  fluidType: string; // "Fuel" | "Fresh water" | "Waste" | ...
  level: number; // 0..1 fraction
  capacityL: number | null;
}

export interface VictronTemperature {
  id: string;
  name: string;
  celsius: number;
}

export interface VictronSnapshot {
  connected: boolean;
  updatedAt: number; // epoch ms of last message applied
  battery: {
    soc: number | null; // %
    voltage: number | null; // V
    current: number | null; // A (signed: + charge, - discharge)
    power: number | null; // W
    temperatureC: number | null;
    timeToGoS: number | null; // seconds to empty/full, if provided
  };
  solar: { totalPower: number | null; chargers: VictronCharger[] };
  dc: { power: number | null };
  ac: {
    inputPower: number | null;
    outputPower: number | null;
    consumptionPower: number | null;
  };
  tanks: VictronTank[];
  temperatures: VictronTemperature[];
  generator: { state: string | null; runtimeH: number | null };
}

export interface VictronRegistry {
  /** Apply one MQTT message (topic + JSON payload string `{"value":…}`). */
  update(topic: string, payloadJson: string): void;
  /** Curated snapshot for the UI. */
  snapshot(): VictronSnapshot;
  /** Mark the feed stale (driver disconnected) — snapshot().connected → false. */
  markStale(): void;
  connected(): boolean;
  setConnected(v: boolean): void;
  clear(): void;
}

declare const globalThis: { __g5000_victron__?: VictronRegistry };

/**
 * Get the process-wide Victron registry, or `undefined` if no producer has
 * created one yet. Consumers that need a guaranteed registry should call
 * `createVictronRegistry()` from `@g5000/bridge` instead.
 */
export function getSharedVictron(): VictronRegistry | undefined {
  return globalThis.__g5000_victron__;
}

/** Install the registry as the singleton. Called by the Victron driver on first use. */
export function setSharedVictron(r: VictronRegistry): void {
  globalThis.__g5000_victron__ = r;
}
