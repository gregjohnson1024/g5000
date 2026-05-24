import { describe, expect, it } from 'vitest';
import { sailGroups } from './sail-groups';

const wardrobe = {
  schemaVersion: 3 as const,
  boatId: 'sula',
  activeMode: 'default',
  sails: [
    { id: 'j1', name: 'J1', category: 'headsail', region: { cells: [] } },
    { id: 'j2', name: 'J2', category: 'headsail', region: { cells: [] } },
    { id: 'main', name: 'Main', category: 'main', region: { cells: [] } },
    { id: 'a2', name: 'A2', category: 'downwind', region: { cells: [] } },
  ],
  active: { headsail: 'j2', main: 'main' },
};

describe('sailGroups', () => {
  it('returns headsail/main/downwind in order with sails + active id', () => {
    const g = sailGroups(wardrobe as never);
    expect(g.map((x) => x.category)).toEqual(['headsail', 'main', 'downwind']);
    const head = g[0]!;
    expect(head.label).toBe('Headsail');
    expect(head.sails.map((s) => s.id)).toEqual(['j1', 'j2']);
    expect(head.activeId).toBe('j2');
  });
  it('marks main active, downwind has no active', () => {
    const g = sailGroups(wardrobe as never);
    expect(g[1]!.activeId).toBe('main');
    expect(g[2]!.activeId).toBeUndefined();
    expect(g[2]!.sails.map((s) => s.id)).toEqual(['a2']);
  });
  it('empty category yields an empty sails list, not an error', () => {
    const g = sailGroups({ ...wardrobe, sails: [], active: {} } as never);
    expect(g.every((x) => x.sails.length === 0)).toBe(true);
    expect(g.every((x) => x.activeId === undefined)).toBe(true);
  });
});
