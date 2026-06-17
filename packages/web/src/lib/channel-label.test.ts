import { describe, it, expect } from 'vitest';
import { channelLabel, channelKind } from './channel-label';

describe('channelLabel', () => {
  it('prettifies a dotted path', () => {
    expect(channelLabel('boat.rudder.angle')).toBe('Boat rudder angle');
    expect(channelLabel('wind.true.direction')).toBe('Wind true direction');
  });

  it('upper-cases known acronyms', () => {
    expect(channelLabel('nav.gps.cog.magnetic')).toBe('Nav GPS COG magnetic');
    expect(channelLabel('performance.target.vmg')).toBe('Performance target VMG');
  });

  it('splits camelCase segments into words', () => {
    expect(channelLabel('groove.helmSource')).toBe('Groove helm source');
    expect(channelLabel('motion.rateOfTurn')).toBe('Motion rate of turn');
  });

  it('uses an override when present', () => {
    expect(channelLabel('nav.magvar')).toBe('Magnetic variation');
  });
});

describe('channelKind', () => {
  it('is measured when any source is n2k or 0183', () => {
    expect(channelKind(['n2k:127250@0x11'])).toBe('measured');
    expect(channelKind(['0183:port1'])).toBe('measured');
    expect(channelKind(['n2k:130306@0x02', 'computed:true_wind'])).toBe('measured');
  });

  it('is computed when no source is a device', () => {
    expect(channelKind(['computed:true_wind'])).toBe('computed');
    expect(channelKind([])).toBe('computed');
  });
});
