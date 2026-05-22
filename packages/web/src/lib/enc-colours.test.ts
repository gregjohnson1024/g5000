import { describe, it, expect } from 'vitest';
import { parsePrimaryColour } from './enc-colours';

describe('parsePrimaryColour', () => {
  it('extracts a single S-57 colour code as a number', () => {
    expect(parsePrimaryColour('3')).toBe(3);
    expect(parsePrimaryColour('1')).toBe(1);
    expect(parsePrimaryColour('13')).toBe(13);
  });

  it('returns the first token of a comma-separated list', () => {
    expect(parsePrimaryColour('3,1,3')).toBe(3);
    expect(parsePrimaryColour('4,1')).toBe(4);
    expect(parsePrimaryColour('2,1,2,1')).toBe(2);
  });

  it('returns 0 for missing / unparseable / out-of-range input', () => {
    expect(parsePrimaryColour(null)).toBe(0);
    expect(parsePrimaryColour(undefined)).toBe(0);
    expect(parsePrimaryColour('')).toBe(0);
    expect(parsePrimaryColour('abc')).toBe(0);
    expect(parsePrimaryColour('0')).toBe(0);
    expect(parsePrimaryColour('14')).toBe(0); // outside S-57 1..13
    expect(parsePrimaryColour('-1')).toBe(0);
  });

  it('trims surrounding whitespace from each token', () => {
    expect(parsePrimaryColour(' 3 , 1 ')).toBe(3);
  });
});
