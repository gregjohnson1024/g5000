import { describe, it, expect } from 'vitest';
import { parseSentence, type ParsedSentence } from './sentence-parser.js';

const ok = (s: string): ParsedSentence => {
  const r = parseSentence(s);
  if (!r.ok) throw new Error(`expected ok parse, got ${r.error}`);
  return r.sentence;
};

describe('parseSentence — framing', () => {
  it('returns error on missing $', () => {
    const r = parseSentence('GPRMC,...,*1A');
    expect(r.ok).toBe(false);
  });

  it('returns error on missing checksum', () => {
    const r = parseSentence('$WIMWV,212.6,R,5.8,N,A');
    expect(r.ok).toBe(false);
  });

  it('returns error on bad checksum', () => {
    const r = parseSentence('$WIMWV,212.6,R,5.8,N,A*00');
    expect(r.ok).toBe(false);
  });

  it('parses a valid framing into talker, type, and fields', () => {
    const s = ok('$WIMWV,212.6,R,5.8,N,A*29');
    expect(s.talker).toBe('WI');
    expect(s.type).toBe('MWV');
    expect(s.fields).toEqual(['212.6', 'R', '5.8', 'N', 'A']);
  });
});

describe('parseSentence — MWV (wind)', () => {
  it('extracts apparent wind angle and speed', () => {
    const s = ok('$WIMWV,212.6,R,5.8,N,A*29');
    expect(s.type).toBe('MWV');
    expect(s.fields[0]).toBe('212.6');
    expect(s.fields[1]).toBe('R');
    expect(s.fields[4]).toBe('A');
  });
});

describe('parseSentence — VHW (water speed and heading)', () => {
  it('parses fields', () => {
    const s = ok('$VWVHW,,T,,M,5.2,N,9.6,K*5C');
    expect(s.type).toBe('VHW');
    expect(s.fields[4]).toBe('5.2');
    expect(s.fields[5]).toBe('N');
  });
});

describe('parseSentence — HDG (heading)', () => {
  it('parses heading and deviation', () => {
    const s = ok('$HCHDG,98.3,1.2,W,5.6,E*62');
    expect(s.type).toBe('HDG');
    expect(s.fields[0]).toBe('98.3');
    expect(s.fields[2]).toBe('W');
  });
});

describe('parseSentence — VTG (course over ground)', () => {
  it('parses course and speed', () => {
    const s = ok('$GPVTG,054.7,T,034.4,M,005.5,N,010.2,K*48');
    expect(s.type).toBe('VTG');
    expect(s.fields[0]).toBe('054.7');
    expect(s.fields[4]).toBe('005.5');
  });
});

describe('parseSentence — strips trailing CR/LF', () => {
  it('handles \\r\\n termination', () => {
    const s = ok('$WIMWV,212.6,R,5.8,N,A*29\r\n');
    expect(s.type).toBe('MWV');
  });
});

describe('parseSentence — calculates checksum correctly', () => {
  it('accepts known-good checksums', () => {
    expect(parseSentence('$WIMWV,212.6,R,5.8,N,A*29').ok).toBe(true);
    expect(parseSentence('$VWVHW,,T,,M,5.2,N,9.6,K*5C').ok).toBe(true);
    expect(parseSentence('$HCHDG,98.3,1.2,W,5.6,E*62').ok).toBe(true);
    expect(parseSentence('$GPVTG,054.7,T,034.4,M,005.5,N,010.2,K*48').ok).toBe(true);
  });
});
