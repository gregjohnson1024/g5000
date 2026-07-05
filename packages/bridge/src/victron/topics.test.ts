import { describe, it, expect } from 'vitest';
import { parseTopic, applyMessage, deriveSnapshot, type RawVictronState } from './topics.js';

const PORTAL = 'c0619ab58146';
const N = (svc: string) => `N/${PORTAL}/${svc}`;

function feed(pairs: Array<[string, unknown]>): RawVictronState {
  const state: RawVictronState = { byKey: new Map() };
  for (const [topic, value] of pairs) applyMessage(state, topic, JSON.stringify({ value }));
  return state;
}

describe('parseTopic', () => {
  it('parses a value topic into service/instance/path', () => {
    expect(parseTopic(`N/${PORTAL}/battery/512/Dc/0/Voltage`)).toEqual({
      service: 'battery',
      instance: '512',
      path: 'Dc/0/Voltage',
    });
  });
  it('returns null for non-N topics', () => {
    expect(parseTopic(`R/${PORTAL}/keepalive`)).toBeNull();
    expect(parseTopic('garbage')).toBeNull();
  });
});

describe('deriveSnapshot null/empty handling', () => {
  it('generator.state is null (not the string "undefined") when no genset is present', () => {
    const snap = deriveSnapshot(feed([[`${N('system')}/0/Dc/Battery/Soc`, 80]]), 1, true);
    expect(snap.generator.state).toBeNull();
  });
  it('falls back to a default name when CustomName is empty', () => {
    const snap = deriveSnapshot(
      feed([
        [`${N('temperature')}/20/Temperature`, 33.9],
        [`${N('temperature')}/20/CustomName`, ''],
      ]),
      1,
      true,
    );
    expect(snap.temperatures[0]?.name).toBe('Temp 20');
    expect(snap.temperatures[0]?.celsius).toBeCloseTo(33.9, 5);
  });
});

describe('applyMessage + deriveSnapshot', () => {
  it('derives battery/solar/tanks/temps from system + device services', () => {
    const state = feed([
      [`${N('system')}/0/Dc/Battery/Soc`, 68],
      [`${N('system')}/0/Dc/Battery/Voltage`, 26.73],
      [`${N('system')}/0/Dc/Battery/Current`, 5.0],
      [`${N('system')}/0/Dc/Battery/Power`, 133],
      [`${N('system')}/0/Dc/Pv/Power`, 1946],
      [`${N('system')}/0/Ac/Consumption/L1/Power`, 843],
      [`${N('solarcharger')}/279/Dc/0/Voltage`, 26.8],
      [`${N('solarcharger')}/279/Dc/0/Current`, 18.5],
      [`${N('solarcharger')}/279/Yield/Power`, 507],
      [`${N('solarcharger')}/279/State`, 3],
      [`${N('tank')}/20/Level`, 63],
      [`${N('tank')}/20/FluidType`, 1],
      [`${N('tank')}/20/Capacity`, 0.6],
      [`${N('temperature')}/24/Temperature`, 25.0],
      [`${N('temperature')}/24/CustomName`, 'Cockpit'],
    ]);
    const snap = deriveSnapshot(state, 1_000, true);
    expect(snap.battery.soc).toBe(68);
    expect(snap.battery.power).toBe(133);
    expect(snap.solar.totalPower).toBe(1946);
    expect(snap.solar.chargers[0]?.power).toBe(507);
    expect(snap.tanks[0]?.level).toBeCloseTo(0.63, 5); // Victron Level is a percentage → fraction
    expect(snap.temperatures[0]).toMatchObject({ name: 'Cockpit', celsius: 25 });
    expect(snap.connected).toBe(true);
    expect(snap.updatedAt).toBe(1_000);
  });

  it('ignores non-N topics and malformed payloads', () => {
    const state: RawVictronState = { byKey: new Map() };
    applyMessage(state, `R/${PORTAL}/keepalive`, '');
    applyMessage(state, `${N('battery')}/512/Dc/0/Voltage`, 'not json');
    expect(state.byKey.size).toBe(0);
  });
});
