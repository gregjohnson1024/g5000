import { describe, it, expect } from 'vitest';
import {
  append,
  removeId,
  removeAt,
  insertAt,
  setStart,
  setEnd,
  startOf,
  endOf,
  viaOf,
} from './route-plan.js';

describe('route-plan mutators', () => {
  it('append adds to the end', () => {
    expect(append(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });
  it('removeId removes the first occurrence, no-op if absent', () => {
    expect(removeId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(removeId(['a', 'b'], 'z')).toEqual(['a', 'b']);
  });
  it('removeAt removes by index', () => {
    expect(removeAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });
  it('insertAt inserts at a clamped index', () => {
    expect(insertAt(['a', 'c'], 1, 'b')).toEqual(['a', 'b', 'c']);
    expect(insertAt(['a'], 9, 'b')).toEqual(['a', 'b']);
    expect(insertAt(['a'], -3, 'b')).toEqual(['b', 'a']);
  });
  it('setStart moves an existing id to front, else prepends', () => {
    expect(setStart(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(setStart(['a', 'b'], 'z')).toEqual(['z', 'a', 'b']);
  });
  it('setEnd moves an existing id to last, else appends', () => {
    expect(setEnd(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
    expect(setEnd(['a', 'b'], 'z')).toEqual(['a', 'b', 'z']);
  });
  it('derived start/end/via', () => {
    expect(startOf(['a', 'b', 'c'])).toBe('a');
    expect(endOf(['a', 'b', 'c'])).toBe('c');
    expect(viaOf(['a', 'b', 'c'])).toEqual(['b']);
    expect(viaOf(['a', 'b'])).toEqual([]);
    expect(viaOf(['a'])).toEqual([]);
    expect(viaOf([])).toEqual([]);
    expect(startOf([])).toBeUndefined();
  });
});
