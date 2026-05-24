import { describe, expect, it } from 'vitest';
import { parseWaypointForm } from './waypoint-form.js';

describe('parseWaypointForm', () => {
  it('parses a valid name + DMM position + notes', () => {
    const r = parseWaypointForm({ name: 'Newport', positionRaw: '41 29.2n 71 19.5w', notes: 'fuel' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch.name).toBe('Newport');
      expect(r.patch.lat).toBeCloseTo(41.4867, 3);
      expect(r.patch.lon).toBeCloseTo(-71.325, 3);
      expect(r.patch.notes).toBe('fuel');
    }
  });
  it('omits notes when blank', () => {
    const r = parseWaypointForm({ name: 'X', positionRaw: '41 0n 71 0w', notes: '   ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.notes).toBeUndefined();
  });
  it('rejects an empty name', () => {
    const r = parseWaypointForm({ name: '  ', positionRaw: '41 0n 71 0w', notes: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name/i);
  });
  it('rejects an unparseable position', () => {
    const r = parseWaypointForm({ name: 'X', positionRaw: 'not coords', notes: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/position|coordinate/i);
  });
});
