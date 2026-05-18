import { describe, expect, it } from 'vitest';
import { getConfigColor } from './config-color';

describe('getConfigColor', () => {
  it('returns a stable HSL color for the same id', () => {
    const a = getConfigColor('full-j1');
    const b = getConfigColor('full-j1');
    expect(a).toBe(b);
    expect(a).toMatch(/^hsl\(/);
  });

  it('produces different colors for different ids in the same wardrobe', () => {
    const ids = ['full-j1', 'reef1-a2', 'storm-jib', 'code-0'];
    const colors = new Set(ids.map(getConfigColor));
    expect(colors.size).toBe(ids.length);
  });

  it('handles empty string safely', () => {
    const c = getConfigColor('');
    expect(c).toMatch(/^hsl\(/);
  });
});
