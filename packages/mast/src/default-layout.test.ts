import { describe, it, expect } from 'vitest';
import { DEFAULT_MAST_LAYOUT } from './default-layout.js';
import { validateMastLayout, knownChannelSet } from './validate.js';

describe('DEFAULT_MAST_LAYOUT', () => {
  it('passes validation against the real channel registry', () => {
    const r = validateMastLayout(DEFAULT_MAST_LAYOUT, knownChannelSet());
    expect(r.ok).toBe(true);
  });
  it('has at least one always-on page', () => {
    expect(DEFAULT_MAST_LAYOUT.pages.some((p) => p.condition && 'always' in p.condition)).toBe(
      true,
    );
  });
});
