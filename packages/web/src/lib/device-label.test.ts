import { describe, it, expect } from 'vitest';
import { deviceLabel, type DeviceLabelInfo } from './device-label';
import { friendlySourceLabel } from './friendly-source';

const mk = (entries: DeviceLabelInfo[]): Map<number, DeviceLabelInfo> =>
  new Map(entries.map((e) => [e.src, e]));

describe('deviceLabel', () => {
  it('uses manufacturer + model + address when both present', () => {
    const devices = mk([{ src: 0x11, manufacturerName: 'Garmin', modelId: 'gWind' }]);
    expect(deviceLabel('n2k:130306@0x11', devices)).toBe('Garmin gWind (0x11)');
  });

  it('uses manufacturer alone when model is missing', () => {
    const devices = mk([{ src: 0x11, manufacturerName: 'Garmin' }]);
    expect(deviceLabel('n2k:130306@0x11', devices)).toBe('Garmin (0x11)');
  });

  it('uses model alone when manufacturer is missing', () => {
    const devices = mk([{ src: 0x11, modelId: 'gWind' }]);
    expect(deviceLabel('n2k:130306@0x11', devices)).toBe('gWind (0x11)');
  });

  it('falls back to device function name when no product info', () => {
    const devices = mk([{ src: 0x15, deviceFunctionName: 'Wind' }]);
    expect(deviceLabel('n2k:130306@0x15', devices)).toBe('Wind (0x15)');
  });

  it('falls back to friendlySourceLabel when the device row is empty', () => {
    const devices = mk([{ src: 0x15 }]);
    const tag = 'n2k:130306@0x15';
    expect(deviceLabel(tag, devices)).toBe(friendlySourceLabel(tag));
  });

  it('falls back to friendlySourceLabel when no device row is known', () => {
    const tag = 'n2k:130306@0x11';
    expect(deviceLabel(tag, new Map())).toBe(friendlySourceLabel(tag));
  });

  it('labels computed sources via friendlySourceLabel', () => {
    expect(deviceLabel('computed:true_wind', new Map())).toBe('computed: true wind');
  });

  it('labels an unparseable tag via friendlySourceLabel', () => {
    expect(deviceLabel('demo', new Map())).toBe('demo');
  });
});
