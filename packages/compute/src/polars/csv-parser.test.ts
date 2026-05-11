import { describe, it, expect } from 'vitest';
import { parseExpeditionPolar } from './csv-parser.js';

const KNOTS_TO_MS = 0.514444;
const DEG_TO_RAD = Math.PI / 180;

describe('parseExpeditionPolar', () => {
  it('parses a minimal tab-separated polar with one row', () => {
    const csv = 'twa/tws\t4\t8\n45\t3.0\t5.0\n';
    const polar = parseExpeditionPolar(csv);
    expect(polar.twsBins.map((v) => v / KNOTS_TO_MS)).toEqual([4, 8]);
    expect(polar.twaBins).toEqual([Math.round(45 * DEG_TO_RAD * 1e6) / 1e6]);
    expect(polar.boatSpeed[0]![0]).toBeCloseTo(3.0 * KNOTS_TO_MS, 4);
    expect(polar.boatSpeed[1]![0]).toBeCloseTo(5.0 * KNOTS_TO_MS, 4);
  });

  it('parses comma-separated input', () => {
    const csv = 'twa/tws,4,8\n45,3.0,5.0\n';
    const polar = parseExpeditionPolar(csv);
    expect(polar.twsBins.length).toBe(2);
    expect(polar.twaBins.length).toBe(1);
  });

  it('parses a multi-row polar', () => {
    const csv = [
      'twa/tws\t4\t8\t12',
      '30\t2.5\t4.0\t5.0',
      '60\t3.8\t5.5\t6.8',
      '90\t3.5\t5.0\t6.5',
    ].join('\n');
    const polar = parseExpeditionPolar(csv);
    expect(polar.twsBins.length).toBe(3);
    expect(polar.twaBins.length).toBe(3);
    expect(polar.boatSpeed[0]!.length).toBe(3); // 3 TWA bins for TWS index 0
    expect(polar.boatSpeed[1]!.length).toBe(3);
  });

  it('ignores blank lines and trailing whitespace', () => {
    const csv = '\n\ntwa/tws\t4\t8\n\n45\t3.0\t5.0\n\n';
    const polar = parseExpeditionPolar(csv);
    expect(polar.twaBins.length).toBe(1);
  });

  it('skips comment lines starting with #', () => {
    const csv = ['# Boat: J/70', 'twa/tws\t4\t8', '45\t3.0\t5.0'].join('\n');
    const polar = parseExpeditionPolar(csv);
    expect(polar.twsBins.length).toBe(2);
  });

  it('throws on malformed input (missing header)', () => {
    const csv = '45\t3.0\t5.0\n';
    expect(() => parseExpeditionPolar(csv)).toThrow();
  });

  it('throws on inconsistent row length', () => {
    const csv = 'twa/tws\t4\t8\n45\t3.0\n';
    expect(() => parseExpeditionPolar(csv)).toThrow();
  });

  it('rounds TWA bin to 6 decimal places (avoid floating-point noise)', () => {
    const csv = 'twa/tws\t4\n45\t3.0\n';
    const polar = parseExpeditionPolar(csv);
    // 45° in radians has many decimal places; we just verify it's close.
    expect(polar.twaBins[0]).toBeCloseTo(0.7853982, 6);
  });

  it('converts TWS knots → m/s and TWA degrees → radians correctly', () => {
    const csv = 'twa/tws\t10\n90\t5.0\n';
    const polar = parseExpeditionPolar(csv);
    expect(polar.twsBins[0]).toBeCloseTo(10 * KNOTS_TO_MS, 4); // ~5.144 m/s
    expect(polar.twaBins[0]).toBeCloseTo(Math.PI / 2, 6); // 90° = π/2
    expect(polar.boatSpeed[0]![0]).toBeCloseTo(5.0 * KNOTS_TO_MS, 4);
  });
});
