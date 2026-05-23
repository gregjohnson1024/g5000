import { describe, expect, it } from 'vitest';
import { reorder } from './reorder';
describe('reorder', () => {
  it('moves an item from one index to another', () => {
    expect(reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(reorder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
  it('is a no-op for equal indices', () => {
    expect(reorder(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});
