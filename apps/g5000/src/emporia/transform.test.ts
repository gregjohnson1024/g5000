import { describe, it, expect } from 'vitest';
import { scaleSeconds, usageToWatts, parseDevices, deriveSnapshot } from './transform.js';

describe('usageToWatts', () => {
  it('converts 1S kWh to Watts (×3,600,000) with multiplier', () => {
    expect(usageToWatts(0.001, '1S', 1)).toBeCloseTo(3600, 6); // 0.001 kWh/s = 3.6 kW
    expect(usageToWatts(0.001, '1S', 2)).toBeCloseTo(7200, 6);
  });
  it('converts 1MIN kWh to Watts (×60,000)', () => {
    expect(usageToWatts(0.01, '1MIN', 1)).toBeCloseTo(600, 6);
  });
  it('null usage → null', () => {
    expect(usageToWatts(null, '1S', 1)).toBeNull();
  });
  it('scaleSeconds maps the enum', () => {
    expect(scaleSeconds('1S')).toBe(1);
    expect(scaleSeconds('1MIN')).toBe(60);
    expect(scaleSeconds('1H')).toBe(3600);
  });
});

const DEVICES = {
  customerGid: 1,
  devices: [
    {
      deviceGid: 111,
      model: 'VUE003',
      firmware: 'Vue-x',
      channels: [
        { channelNum: '1,2,3', channelMultiplier: 1, name: 'Main' },
        { channelNum: '1', channelMultiplier: 1, name: 'Galley' },
        { channelNum: '2', channelMultiplier: 2, name: 'AC' }, // 240V paired
      ],
    },
  ],
};
const USAGES = {
  deviceListUsages: {
    instant: '2026-07-06T12:00:00Z',
    scale: '1S',
    energyUnit: 'KilowattHours',
    devices: [
      {
        deviceGid: 111,
        channelUsages: [
          { name: 'Main', usage: 0.05, channelNum: '1,2,3', nestedDevices: [] },
          { name: 'Galley', usage: 0.001, channelNum: '1', nestedDevices: [] },
          { name: 'AC', usage: 0.002, channelNum: '2', nestedDevices: [] },
          { name: 'Balance', usage: 0.047, channelNum: 'Balance', nestedDevices: [] },
        ],
      },
    ],
  },
};

describe('parseDevices + deriveSnapshot', () => {
  it('parses the device list into channels with multipliers', () => {
    const d = parseDevices(DEVICES);
    expect(d[0]?.deviceGid).toBe(111);
    expect(d[0]?.channels.find((c) => c.channelNum === '2')?.multiplier).toBe(2);
  });
  it('splits mains/balance/branches and converts to Watts with multipliers', () => {
    const snap = deriveSnapshot(parseDevices(DEVICES), USAGES, '1S', 1000);
    expect(snap.connected).toBe(true);
    expect(snap.deviceGid).toBe(111);
    expect(snap.mainsW).toBeCloseTo(180000, 0); // 0.05 × 3.6e6
    expect(snap.balanceW).toBeCloseTo(169200, 0); // 0.047 × 3.6e6
    const ac = snap.circuits.find((c) => c.channelNum === '2');
    expect(ac?.name).toBe('AC');
    expect(ac?.watts).toBeCloseTo(0.002 * 3_600_000 * 2, 0); // multiplier 2 applied
    expect(snap.circuits.find((c) => c.channelNum === '1,2,3')).toBeUndefined(); // mains excluded
    expect(snap.circuits.find((c) => c.channelNum === 'Balance')).toBeUndefined(); // balance excluded
    expect(snap.updatedAt).toBe(1000);
  });
  it('null usage on a circuit → watts null (not 0)', () => {
    const u = JSON.parse(JSON.stringify(USAGES));
    u.deviceListUsages.devices[0].channelUsages[1].usage = null;
    const snap = deriveSnapshot(parseDevices(DEVICES), u, '1S', 1);
    expect(snap.circuits.find((c) => c.channelNum === '1')?.watts).toBeNull();
  });
});
