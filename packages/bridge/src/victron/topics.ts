import type { VictronSnapshot, VictronCharger, VictronTank, VictronTemperature } from '@g5000/core';

export interface RawVictronState {
  byKey: Map<string, number | string | null>;
}

export function parseTopic(
  topic: string,
): { service: string; instance: string; path: string } | null {
  const parts = topic.split('/');
  // N / <portal> / <service> / <instance> / <path…>
  if (parts.length < 5 || parts[0] !== 'N') return null;
  const service = parts[2]!;
  const instance = parts[3]!;
  const path = parts.slice(4).join('/');
  if (!service || !instance || !path) return null;
  return { service, instance, path };
}

export function applyMessage(state: RawVictronState, topic: string, payloadJson: string): void {
  const parsed = parseTopic(topic);
  if (!parsed) return;
  let value: number | string | null;
  try {
    const obj = JSON.parse(payloadJson) as { value?: unknown };
    if (!obj || typeof obj !== 'object' || !('value' in obj)) return;
    const v = obj.value;
    if (v !== null && typeof v !== 'number' && typeof v !== 'string') return;
    value = v as number | string | null;
  } catch {
    return;
  }
  state.byKey.set(`${parsed.service}/${parsed.instance}/${parsed.path}`, value);
}

const num = (state: RawVictronState, key: string): number | null => {
  const v = state.byKey.get(key);
  return typeof v === 'number' ? v : null;
};
const str = (state: RawVictronState, key: string): string | null => {
  const v = state.byKey.get(key);
  if (typeof v === 'string') return v;
  // Absent (undefined) or explicit null → null. Guards against String(undefined)
  // leaking the literal "undefined" (e.g. generator.state on a system with no genset).
  return v == null ? null : String(v);
};
/** Non-blank string, else null — so an empty CustomName falls back to a default name. */
const nonEmpty = (s: string | null): string | null => (s && s.trim() !== '' ? s : null);

// Victron numeric enums → labels (partial; unknowns fall back to the number).
const CHARGER_STATE: Record<number, string> = {
  0: 'Off',
  3: 'Bulk',
  4: 'Absorption',
  5: 'Float',
  7: 'Equalize',
  245: 'Wake-up',
  252: 'ESS',
};
const FLUID_TYPE: Record<number, string> = {
  0: 'Fuel',
  1: 'Fresh water',
  2: 'Waste water',
  3: 'Live well',
  4: 'Oil',
  5: 'Black water',
};

function instancesFor(state: RawVictronState, service: string): string[] {
  const seen = new Set<string>();
  for (const key of state.byKey.keys()) {
    const [svc, inst] = key.split('/');
    if (svc === service && inst) seen.add(inst);
  }
  return [...seen].sort();
}

export function deriveSnapshot(
  state: RawVictronState,
  now: number,
  connected: boolean,
): VictronSnapshot {
  const chargers: VictronCharger[] = instancesFor(state, 'solarcharger').map((inst) => {
    const p = `solarcharger/${inst}`;
    const stateNum = num(state, `${p}/State`);
    return {
      id: p,
      name:
        nonEmpty(str(state, `${p}/CustomName`)) ??
        nonEmpty(str(state, `${p}/ProductName`)) ??
        `MPPT ${inst}`,
      power: num(state, `${p}/Yield/Power`) ?? 0,
      voltage: num(state, `${p}/Dc/0/Voltage`) ?? 0,
      current: num(state, `${p}/Dc/0/Current`) ?? 0,
      state: stateNum !== null ? (CHARGER_STATE[stateNum] ?? String(stateNum)) : '—',
      yieldTodayKwh: num(state, `${p}/History/Daily/0/Yield`) ?? 0,
      dayMaxPower: num(state, `${p}/History/Daily/0/MaxPower`) ?? 0,
    };
  });
  const tanks: VictronTank[] = instancesFor(state, 'tank').map((inst) => {
    const p = `tank/${inst}`;
    const lvl = num(state, `${p}/Level`);
    const ft = num(state, `${p}/FluidType`);
    const capM3 = num(state, `${p}/Capacity`);
    return {
      id: p,
      fluidType: ft !== null ? (FLUID_TYPE[ft] ?? String(ft)) : '—',
      level: lvl !== null ? lvl / 100 : 0, // Victron Level is a percentage
      capacityL: capM3 !== null ? capM3 * 1000 : null,
    };
  });
  const temperatures: VictronTemperature[] = instancesFor(state, 'temperature').map((inst) => {
    const p = `temperature/${inst}`;
    return {
      id: p,
      name: nonEmpty(str(state, `${p}/CustomName`)) ?? `Temp ${inst}`,
      celsius: num(state, `${p}/Temperature`) ?? 0,
    };
  });

  return {
    connected,
    updatedAt: now,
    battery: {
      soc: num(state, 'system/0/Dc/Battery/Soc'),
      voltage: num(state, 'system/0/Dc/Battery/Voltage'),
      current: num(state, 'system/0/Dc/Battery/Current'),
      power: num(state, 'system/0/Dc/Battery/Power'),
      temperatureC: num(state, 'system/0/Dc/Battery/Temperature'),
      timeToGoS: num(state, 'system/0/Dc/Battery/TimeToGo'),
    },
    solar: { totalPower: num(state, 'system/0/Dc/Pv/Power'), chargers },
    dc: { power: num(state, 'system/0/Dc/System/Power') },
    ac: {
      inputPower: num(state, 'system/0/Ac/ActiveIn/L1/Power'),
      outputPower: num(state, 'system/0/Ac/Consumption/L1/Power'),
      consumptionPower: num(state, 'system/0/Ac/Consumption/L1/Power'),
    },
    tanks,
    temperatures,
    generator: {
      state: str(state, 'generator/0/State'),
      runtimeH: num(state, 'generator/0/Runtime'),
    },
  };
}
