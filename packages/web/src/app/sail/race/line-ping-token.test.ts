/**
 * line-ping-token.test.ts
 *
 * Unit tests for the portStbdToken() helper in LinePingPanel.tsx.
 *
 * Verifies:
 *   - 'port' maps to port-token classes (text-port, bg-port/*)
 *   - 'stbd' maps to stbd-token classes (text-stbd, bg-stbd/*)
 *   - The mapping is symmetric (only two valid values, each distinct)
 *   - No raw hex / no slate-/rose-/emerald- classes leak through
 */

import { describe, it, expect } from 'vitest';
import { portStbdToken } from './LinePingPanel';

describe('portStbdToken', () => {
  it("returns port token classes for 'port'", () => {
    const tok = portStbdToken('port');
    expect(tok.text).toContain('text-port');
    expect(tok.bg).toContain('bg-port');
    // Must not use raw slate/emerald/rose classes
    expect(tok.text).not.toMatch(/emerald|rose|green|red|slate/);
    expect(tok.bg).not.toMatch(/emerald|rose|green|red|slate/);
  });

  it("returns stbd token classes for 'stbd'", () => {
    const tok = portStbdToken('stbd');
    expect(tok.text).toContain('text-stbd');
    expect(tok.bg).toContain('bg-stbd');
    // Must not use raw slate/emerald/rose classes
    expect(tok.text).not.toMatch(/emerald|rose|green|red|slate/);
    expect(tok.bg).not.toMatch(/emerald|rose|green|red|slate/);
  });

  it('port and stbd tokens are distinct', () => {
    const port = portStbdToken('port');
    const stbd = portStbdToken('stbd');
    expect(port.text).not.toBe(stbd.text);
    expect(port.bg).not.toBe(stbd.bg);
  });
});
