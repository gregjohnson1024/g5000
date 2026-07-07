import { describe, it, expect } from 'vitest';
import { statusChipClasses, type StatusChipKind } from './status-chip-kind';

const ALL_KINDS: StatusChipKind[] = [
  'ok',
  'warn',
  'alarm',
  'info',
  'neutral',
  'live',
  'stale',
  'demo',
  'replay',
  'armed',
];

describe('statusChipClasses', () => {
  it('returns a result for all 10 kinds', () => {
    for (const kind of ALL_KINDS) {
      const result = statusChipClasses(kind);
      expect(result).toBeDefined();
      expect(typeof result.wrapper).toBe('string');
      expect(typeof result.pulse).toBe('boolean');
    }
  });

  it('live kind has pulse=true', () => {
    expect(statusChipClasses('live').pulse).toBe(true);
  });

  it('stale kind has pulse=false', () => {
    expect(statusChipClasses('stale').pulse).toBe(false);
  });

  it('armed kind has pulse=true', () => {
    expect(statusChipClasses('armed').pulse).toBe(true);
  });

  it('ok kind has pulse=false', () => {
    expect(statusChipClasses('ok').pulse).toBe(false);
  });

  it('all kinds use token classes (no slate-/rose-/emerald- utilities)', () => {
    const bannedPrefixes = ['slate-', 'rose-', 'emerald-'];
    for (const kind of ALL_KINDS) {
      const { wrapper } = statusChipClasses(kind);
      for (const prefix of bannedPrefixes) {
        expect(wrapper, `kind=${kind} must not contain "${prefix}"`).not.toContain(prefix);
      }
    }
  });

  it('all kinds use token classes (no raw hex)', () => {
    for (const kind of ALL_KINDS) {
      const { wrapper } = statusChipClasses(kind);
      expect(wrapper, `kind=${kind} must not contain "#"`).not.toContain('#');
    }
  });

  it('ok kind uses ok token classes', () => {
    const { wrapper } = statusChipClasses('ok');
    expect(wrapper).toContain('ok');
  });

  it('warn kind uses warn token classes', () => {
    const { wrapper } = statusChipClasses('warn');
    expect(wrapper).toContain('warn');
  });

  it('alarm kind uses danger token classes', () => {
    const { wrapper } = statusChipClasses('alarm');
    expect(wrapper).toContain('danger');
  });

  it('demo kind uses demo token classes', () => {
    const { wrapper } = statusChipClasses('demo');
    expect(wrapper).toContain('demo');
  });

  it('replay kind uses replay token classes', () => {
    const { wrapper } = statusChipClasses('replay');
    expect(wrapper).toContain('replay');
  });
});
