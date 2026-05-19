import { describe, it, expect } from 'vitest';
import { hlinkChecksum, parseHlinkLine, formatV, formatP } from './protocol.js';

describe('hlinkChecksum', () => {
  it('matches the manual example: #OV,1,1,73 → 12', () => {
    // From the H5000 manual, ch. 11, p. 114.
    expect(hlinkChecksum('#OV,1,1,73')).toBe('12');
  });
  it('zero-pads single-digit values to 2 chars', () => {
    // '\x07' alone XORs to 0x07 — pad to "07".
    expect(hlinkChecksum('\x07')).toBe('07');
  });
  it('is uppercase hex', () => {
    // 0xAB = 'A' XOR ... cooked example: build a string whose XOR is 0xAB.
    expect(hlinkChecksum('\xab')).toBe('AB');
  });
});

describe('parseHlinkLine — OV', () => {
  it('parses #OV,1,1,73 (no checksum) as a one-shot read', () => {
    expect(parseHlinkLine('#OV,1,1,73')).toEqual({ kind: 'ov-once', fn: 73 });
  });
  it('parses #OV,1,1,73*12 (with checksum) as a one-shot read', () => {
    expect(parseHlinkLine('#OV,1,1,73*12')).toEqual({ kind: 'ov-once', fn: 73 });
  });
  it('parses #OV,1,1,73*12\\r\\n (with line ending)', () => {
    expect(parseHlinkLine('#OV,1,1,73*12\r\n')).toEqual({ kind: 'ov-once', fn: 73 });
  });
  it('tolerates an empty fastnet node number: #OV,,1,65', () => {
    expect(parseHlinkLine('#OV,,1,65')).toEqual({ kind: 'ov-once', fn: 65 });
  });
  it('parses #OV,1,1,89,1 as enable-streaming', () => {
    expect(parseHlinkLine('#OV,1,1,89,1')).toEqual({ kind: 'ov-enable', fn: 89 });
  });
  it('parses #OV,1,1,89,0 as disable-streaming', () => {
    expect(parseHlinkLine('#OV,1,1,89,0')).toEqual({ kind: 'ov-disable', fn: 89 });
  });
  it('ignores OV with too few fields', () => {
    expect(parseHlinkLine('#OV,1,1').kind).toBe('ignore');
  });
});

describe('parseHlinkLine — OL', () => {
  it('parses bare #OL as one-shot position', () => {
    expect(parseHlinkLine('#OL')).toEqual({ kind: 'ol-once' });
  });
  it('parses #OL,1 as enable position streaming', () => {
    expect(parseHlinkLine('#OL,1')).toEqual({ kind: 'ol-enable' });
  });
  it('parses #OL,0 as disable position streaming', () => {
    expect(parseHlinkLine('#OL,0')).toEqual({ kind: 'ol-disable' });
  });
});

describe('parseHlinkLine — OS', () => {
  it('parses #OS,1 as start streaming', () => {
    expect(parseHlinkLine('#OS,1')).toEqual({ kind: 'os-start' });
  });
  it('parses #OS,0 as stop streaming', () => {
    expect(parseHlinkLine('#OS,0')).toEqual({ kind: 'os-stop' });
  });
});

describe('parseHlinkLine — error paths', () => {
  it('ignores empty lines', () => {
    expect(parseHlinkLine('').kind).toBe('ignore');
  });
  it('ignores lines without # prefix', () => {
    expect(parseHlinkLine('OV,1,1,73').kind).toBe('ignore');
  });
  it('ignores bad-checksum lines silently', () => {
    expect(parseHlinkLine('#OV,1,1,73*00').kind).toBe('ignore');
  });
  it('ignores unknown #-commands', () => {
    // #IV is "input value (write)" — out of scope for our read-only server.
    expect(parseHlinkLine('#IV,1,1,65,4.5').kind).toBe('ignore');
  });
  it('ignores garbage', () => {
    expect(parseHlinkLine('hello world').kind).toBe('ignore');
  });
});

describe('formatV', () => {
  it('produces the V<NNN>,<MMM>,<FFF>,value*XX\\r\\n envelope', () => {
    const line = formatV(65, '4.37');
    expect(line.endsWith('\r\n')).toBe(true);
    expect(line.startsWith('V001,001,065,4.37*')).toBe(true);
  });
  it('round-trips: checksum we emit verifies', () => {
    const line = formatV(89, '-45.00');
    const noNl = line.replace(/\r\n$/, '');
    const star = noNl.lastIndexOf('*');
    const payload = noNl.slice(0, star);
    const cs = noNl.slice(star + 1);
    expect(hlinkChecksum(payload)).toBe(cs);
  });
  it('accepts empty value for unmapped functions', () => {
    const line = formatV(999, '');
    expect(line.startsWith('V001,001,999,*')).toBe(true);
  });
});

describe('formatP', () => {
  it('produces P001,<lat>,<lon>*XX\\r\\n with 6 dp', () => {
    const line = formatP(48.123456, -123.987654);
    expect(line).toMatch(/^P001,48\.123456,-123\.987654\*[0-9A-F]{2}\r\n$/);
  });
});
