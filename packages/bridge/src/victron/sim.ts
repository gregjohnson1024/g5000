/**
 * Deterministic Victron simulator.
 *
 * `simSnapshotAt(tSec)` — pure function, no Date.now() / Math.random().
 * All values are derived from `tSec` so the same input always yields
 * the same output.
 *
 * Solar curve: bell over 06:00–18:00 UTC, peaking at noon.
 * SoC tracks the integral of net power (rises during the day, falls at night).
 * 5 MPPT chargers (instances 279–283) split total solar proportionally.
 * 2 tanks (0 = fresh water, 1 = fuel), 2 temperature sensors.
 */

import type { Bus, VictronRegistry } from '@g5000/core';
import { publishVictronToBus } from './publisher.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORTAL = 'sim';
const CHARGER_INSTANCES = [279, 280, 281, 282, 283] as const;
const CHARGER_NAMES = ['Bow MPPT', 'Mast MPPT', 'Stern MPPT', 'Port MPPT', 'Stbd MPPT'] as const;
// Weights that define how each MPPT splits total solar (must sum to 1).
const CHARGER_WEIGHTS = [0.25, 0.2, 0.2, 0.18, 0.17] as const;

// Solar window: 06:00–18:00 UTC  (seconds from midnight)
const SOLAR_START_S = 6 * 3600;
const SOLAR_END_S = 18 * 3600;
const SOLAR_PEAK_KW = 3.8; // peak array output in kW at midday

// Battery parameters
const BATTERY_VOLTAGE = 48; // nominal 48 V bank
const BATTERY_CAPACITY_KWH = 20;
// SoC at dead-of-night (midnight) — the curve oscillates from here upward.
const BATTERY_SOC_NIGHT = 65; // %
const BATTERY_SOC_PEAK = 98; // % at solar peak accumulation
const BATTERY_TEMP_C = 25.5;

// AC/DC loads (roughly constant; a tiny diurnal wobble keeps it interesting)
const AC_CONSUMPTION_BASE_W = 420;
const DC_SYSTEM_BASE_W = 180;

// Tanks — slow-changing values driven by tSec
const TANK_FRESH_CAPACITY_L = 400; // L → stored as m³
const TANK_FUEL_CAPACITY_L = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fraction of solar day elapsed (0–1), clamped to [0,1].
 * 0 = before sunrise, 1 = after sunset.
 */
function solarFraction(tSec: number): number {
  const secsOfDay = ((tSec % 86400) + 86400) % 86400;
  const t = secsOfDay;
  if (t <= SOLAR_START_S || t >= SOLAR_END_S) return 0;
  return (t - SOLAR_START_S) / (SOLAR_END_S - SOLAR_START_S);
}

/** Solar power in watts at time `tSec` — bell curve via Math.sin. */
function solarPowerW(tSec: number): number {
  const frac = solarFraction(tSec);
  if (frac === 0) return 0;
  // sin(0..π) gives a smooth bell: max at frac=0.5 (noon)
  return SOLAR_PEAK_KW * 1000 * Math.sin(frac * Math.PI);
}

/**
 * State-of-charge (%) derived from the diurnal solar integral.
 * Rises from BATTERY_SOC_NIGHT during the day, falls back at night.
 * Pure — no integration state, just an analytic approximation.
 */
function batterySoc(tSec: number): number {
  const secsOfDay = ((tSec % 86400) + 86400) % 86400;
  const t = secsOfDay;
  let soc: number;

  if (t <= SOLAR_START_S) {
    // Pre-dawn: SoC has been draining since sunset yesterday.
    // Model: linear decline from post-peak level back to BATTERY_SOC_NIGHT
    // over the night portion (18:00 → 06:00 = 12 h).
    const nightLen = SOLAR_START_S + (86400 - SOLAR_END_S);
    const elapsed = t + (86400 - SOLAR_END_S); // seconds since yesterday's sunset
    const nightFrac = elapsed / nightLen;
    soc = BATTERY_SOC_PEAK - (BATTERY_SOC_PEAK - BATTERY_SOC_NIGHT) * nightFrac;
  } else if (t >= SOLAR_END_S) {
    // Post-sunset: draining from BATTERY_SOC_PEAK.
    const nightLen = SOLAR_START_S + (86400 - SOLAR_END_S);
    const elapsed = t - SOLAR_END_S;
    const nightFrac = elapsed / nightLen;
    soc = BATTERY_SOC_PEAK - (BATTERY_SOC_PEAK - BATTERY_SOC_NIGHT) * nightFrac;
  } else {
    // Daytime: rises as the integral of sin over [0, frac*π].
    // ∫₀^(f·π) sin(θ) dθ = 1 - cos(f·π), which peaks at 2 when f=1.
    const frac = solarFraction(tSec);
    const integral = (1 - Math.cos(frac * Math.PI)) / 2; // 0→1 over day
    soc = BATTERY_SOC_NIGHT + (BATTERY_SOC_PEAK - BATTERY_SOC_NIGHT) * integral;
  }

  return Math.max(BATTERY_SOC_NIGHT, Math.min(BATTERY_SOC_PEAK, soc));
}

/** Build an MQTT topic in Victron's N/<portal>/<service>/<inst>/<path> format. */
function topic(service: string, inst: string | number, path: string): string {
  return `N/${PORTAL}/${service}/${inst}/${path}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pure function — returns an array of [topic, value] pairs for the given time.
 * Feed each pair to registry.update(topic, JSON.stringify({ value })).
 * No side effects; no Date.now(); no Math.random().
 */
export function simSnapshotAt(tSec: number): Array<[string, unknown]> {
  const pairs: Array<[string, unknown]> = [];
  const emit = (t: string, v: unknown) => pairs.push([t, v]);

  // ── Solar ──────────────────────────────────────────────────────────────────
  const totalSolarW = solarPowerW(tSec);
  emit(topic('system', 0, 'Dc/Pv/Power'), totalSolarW);

  // Per-MPPT charger topics
  const chargerStateNum = totalSolarW > 10 ? 3 : 0; // Bulk when producing, Off at night
  const chargerVoltage = BATTERY_VOLTAGE + (totalSolarW > 0 ? 2.5 : 0); // slight boost when charging

  CHARGER_INSTANCES.forEach((inst, i) => {
    const w = totalSolarW * CHARGER_WEIGHTS[i]!;
    const a = chargerVoltage > 0 ? w / chargerVoltage : 0;
    // Yield today: analytic integral of sin up to this point in the day (kWh)
    const frac = solarFraction(tSec);
    const integralFrac = frac > 0 ? (1 - Math.cos(frac * Math.PI)) / 2 : 0;
    const yieldTodayKwh = (SOLAR_PEAK_KW * CHARGER_WEIGHTS[i]! * integralFrac * 12) / 1; // 12h day
    const dayMaxW = SOLAR_PEAK_KW * 1000 * CHARGER_WEIGHTS[i]!;

    emit(topic('solarcharger', inst, 'Yield/Power'), w);
    emit(topic('solarcharger', inst, 'Dc/0/Voltage'), chargerVoltage);
    emit(topic('solarcharger', inst, 'Dc/0/Current'), a);
    emit(topic('solarcharger', inst, 'State'), chargerStateNum);
    emit(topic('solarcharger', inst, 'History/Daily/0/Yield'), yieldTodayKwh);
    emit(topic('solarcharger', inst, 'History/Daily/0/MaxPower'), dayMaxW);
    emit(topic('solarcharger', inst, 'CustomName'), CHARGER_NAMES[i]);
  });

  // ── Battery ────────────────────────────────────────────────────────────────
  const soc = batterySoc(tSec);
  // Net battery current: positive = charging; negative = discharging
  const acLoadW = AC_CONSUMPTION_BASE_W + 30 * Math.sin(tSec / 3600);
  const dcLoadW = DC_SYSTEM_BASE_W + 20 * Math.sin(tSec / 5400 + 1);
  const netBatteryW = totalSolarW - acLoadW - dcLoadW;
  const battVoltage = BATTERY_VOLTAGE + (soc - 80) * 0.02; // slight droop model
  const battCurrentA = battVoltage !== 0 ? netBatteryW / battVoltage : 0;
  // Time to go (seconds) — only meaningful when discharging
  const remainingKwh = ((soc / 100) * BATTERY_CAPACITY_KWH * 1000) / battVoltage; // Ah → kWh
  const timeToGoS = netBatteryW < 0 ? (remainingKwh * 3_600_000) / Math.abs(netBatteryW) : null;

  emit(topic('system', 0, 'Dc/Battery/Soc'), soc);
  emit(topic('system', 0, 'Dc/Battery/Voltage'), battVoltage);
  emit(topic('system', 0, 'Dc/Battery/Current'), battCurrentA);
  emit(topic('system', 0, 'Dc/Battery/Power'), netBatteryW);
  emit(topic('system', 0, 'Dc/Battery/Temperature'), BATTERY_TEMP_C);
  if (timeToGoS !== null) emit(topic('system', 0, 'Dc/Battery/TimeToGo'), timeToGoS);

  // ── AC / DC system ─────────────────────────────────────────────────────────
  emit(topic('system', 0, 'Ac/Consumption/L1/Power'), acLoadW);
  emit(topic('system', 0, 'Ac/ActiveIn/L1/Power'), 0); // no shore power in sim
  emit(topic('system', 0, 'Dc/System/Power'), dcLoadW);

  // ── Tanks ──────────────────────────────────────────────────────────────────
  // Fresh water: slow drain over 7 days, 0→100 % level, cycles at 7-day period
  const freshLevelPct = 60 + 35 * Math.sin(tSec / (7 * 86400)); // 25–95 %
  emit(topic('tank', 0, 'Level'), freshLevelPct); // Victron Level is a percentage
  emit(topic('tank', 0, 'FluidType'), 1); // Fresh water
  emit(topic('tank', 0, 'Capacity'), TANK_FRESH_CAPACITY_L / 1000); // m³

  // Fuel: drains faster, 3-day period
  const fuelLevelPct = 55 + 40 * Math.sin(tSec / (3 * 86400) + 0.5);
  emit(topic('tank', 1, 'Level'), fuelLevelPct);
  emit(topic('tank', 1, 'FluidType'), 0); // Fuel
  emit(topic('tank', 1, 'Capacity'), TANK_FUEL_CAPACITY_L / 1000); // m³

  // ── Temperatures ───────────────────────────────────────────────────────────
  // Engine room: warmer when solar is high (proxy for ambient heat)
  const engineRoomC = 28 + 8 * (totalSolarW / (SOLAR_PEAK_KW * 1000));
  emit(topic('temperature', 0, 'Temperature'), engineRoomC);
  emit(topic('temperature', 0, 'CustomName'), 'Engine Room');

  // Fridge: stable-ish, slight diurnal swing
  const fridgeC = 4.5 + 1.5 * Math.sin(tSec / 7200);
  emit(topic('temperature', 1, 'Temperature'), fridgeC);
  emit(topic('temperature', 1, 'CustomName'), 'Fridge');

  return pairs;
}

// ---------------------------------------------------------------------------
// Simulator driver
// ---------------------------------------------------------------------------

export interface VictronSimOpts {
  registry: VictronRegistry;
  bus: Bus;
  tickMs?: number;
  now?: () => number;
}

/**
 * Start the Victron simulator tick loop.
 * Returns a teardown function that clears the interval.
 */
export function startVictronSim({
  registry,
  bus,
  tickMs = 1000,
  now = Date.now,
}: VictronSimOpts): () => void {
  const tick = (): void => {
    try {
      const pairs = simSnapshotAt(now() / 1000);
      for (const [t, value] of pairs) {
        registry.update(t, JSON.stringify({ value }));
      }
      registry.setConnected(true);
      publishVictronToBus(bus, registry.snapshot());
    } catch {
      // never throw — the caller (setInterval) ignores return values
    }
  };

  tick(); // fire immediately on start
  const handle = setInterval(tick, tickMs);
  return () => clearInterval(handle);
}
