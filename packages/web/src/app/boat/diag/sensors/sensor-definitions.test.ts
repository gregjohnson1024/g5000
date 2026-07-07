import { describe, it, expect } from 'vitest';
import { Channels } from '@g5000/core';
import { SENSOR_DEFS } from './sensor-definitions';

function flatChannelValues(node: unknown, acc: string[]): string[] {
  if (typeof node === 'string') {
    acc.push(node);
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node)) flatChannelValues(v, acc);
  }
  return acc;
}

const ALL_KNOWN_CHANNELS = new Set(flatChannelValues(Channels, []));

describe('SENSOR_DEFS', () => {
  it('lists exactly the seven v1 sensors in order', () => {
    expect(SENSOR_DEFS.map((s) => s.id)).toEqual([
      'heading',
      'bsp',
      'apparent-wind',
      'gps',
      'depth',
      'motion',
      'battery',
    ]);
  });

  it('every channel maps to a known constant in @g5000/core Channels', () => {
    for (const def of SENSOR_DEFS) {
      for (const ch of def.channels) {
        expect(ALL_KNOWN_CHANNELS.has(ch), `${def.id}: channel "${ch}"`).toBe(true);
      }
    }
  });

  it('sensor ids are unique', () => {
    const ids = SENSOR_DEFS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every sensor has at least one channel', () => {
    for (const def of SENSOR_DEFS) {
      expect(def.channels.length, def.id).toBeGreaterThan(0);
    }
  });

  it('motion card has no usedBy entries (display-only)', () => {
    const motion = SENSOR_DEFS.find((s) => s.id === 'motion');
    expect(motion).toBeDefined();
    expect(motion!.usedBy).toEqual([]);
  });
});
