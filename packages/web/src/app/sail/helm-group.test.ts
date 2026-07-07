import { describe, it, expect } from 'vitest';
import { normalizeGroup, DEFAULT_GROUP, HELM_GROUPS, STORAGE_KEY } from './helm-group';

describe('helm-group', () => {
  it('default is navigating and key is stable', () => {
    expect(DEFAULT_GROUP).toBe('navigating');
    expect(STORAGE_KEY).toBe('g5000.helm.group');
    expect(HELM_GROUPS).toEqual(['starting', 'navigating', 'performance']);
  });
  it('passes through each valid group', () => {
    for (const g of HELM_GROUPS) expect(normalizeGroup(g)).toBe(g);
  });
  it('falls back to default for unknown / null / empty', () => {
    expect(normalizeGroup(null)).toBe(DEFAULT_GROUP);
    expect(normalizeGroup(undefined)).toBe(DEFAULT_GROUP);
    expect(normalizeGroup('')).toBe(DEFAULT_GROUP);
    expect(normalizeGroup('nope')).toBe(DEFAULT_GROUP);
  });
});
