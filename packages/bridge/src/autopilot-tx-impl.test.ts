import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetAutopilotTxForTests, getSharedAutopilotTx } from '@g5000/core';
import {
  createAutopilotTx,
  registerAutopilotTxIfEnabled,
} from './autopilot-tx-impl.js';
import type { WireDriver } from './wire-driver.js';

function fakeDriver(): WireDriver & { txPgnSpy: ReturnType<typeof vi.fn> } {
  const txPgnSpy = vi.fn().mockResolvedValue(undefined);
  return {
    txPgnSpy,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    rxCan: { subscribe: () => ({ unsubscribe: () => {} }) } as never,
    rx0183: { subscribe: () => ({ unsubscribe: () => {} }) } as never,
    health: { subscribe: () => ({ unsubscribe: () => {} }) } as never,
    txCan: vi.fn().mockResolvedValue(undefined),
    tx0183: vi.fn().mockResolvedValue(undefined),
    txPgn: txPgnSpy,
  } as WireDriver & { txPgnSpy: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  _resetAutopilotTxForTests();
  delete process.env.G5000_ENABLE_AP_TX;
});

describe('createAutopilotTx', () => {
  it('sends standby through txPgn with PGN 130850 + Event=Standby', async () => {
    const driver = fakeDriver();
    const tx = createAutopilotTx({
      driver,
      readCaptureCodes: async () => ({ version: 1, captures: {} }),
    });
    const r = await tx.sendCommand({ event: 'standby' });
    expect(r.ok).toBe(true);
    expect(driver.txPgnSpy).toHaveBeenCalledOnce();
    const arg = driver.txPgnSpy.mock.calls[0]![0]!;
    expect(arg.pgn).toBe(130850);
    expect(arg.fields.Event).toBe('Standby');
  });

  it('returns missing_capture for course_+1 with no captures', async () => {
    const driver = fakeDriver();
    const tx = createAutopilotTx({
      driver,
      readCaptureCodes: async () => ({ version: 1, captures: {} }),
    });
    const r = await tx.sendCommand({ event: 'course_+1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error?.kind).toBe('missing_capture');
    expect(driver.txPgnSpy).not.toHaveBeenCalled();
  });

  it('returns tx_error when driver.txPgn rejects', async () => {
    const driver = fakeDriver();
    driver.txPgnSpy.mockRejectedValueOnce(new Error('socket dead'));
    const tx = createAutopilotTx({
      driver,
      readCaptureCodes: async () => ({ version: 1, captures: {} }),
    });
    const r = await tx.sendCommand({ event: 'standby' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error?.kind).toBe('tx_error');
      expect(r.error?.message).toContain('socket dead');
    }
  });

  it('serializes concurrent sendCommand calls', async () => {
    const driver = fakeDriver();
    let inflight = 0;
    let maxInflight = 0;
    driver.txPgnSpy.mockImplementation(async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight--;
    });
    const tx = createAutopilotTx({
      driver,
      readCaptureCodes: async () => ({ version: 1, captures: {} }),
    });
    await Promise.all([
      tx.sendCommand({ event: 'standby' }),
      tx.sendCommand({ event: 'auto' }),
      tx.sendCommand({ event: 'standby' }),
    ]);
    expect(maxInflight).toBe(1);
    expect(driver.txPgnSpy).toHaveBeenCalledTimes(3);
  });
});

describe('registerAutopilotTxIfEnabled', () => {
  it('does not register when G5000_ENABLE_AP_TX is unset', () => {
    delete process.env.G5000_ENABLE_AP_TX;
    registerAutopilotTxIfEnabled(fakeDriver());
    expect(getSharedAutopilotTx()).toBeUndefined();
  });

  it('does not register when G5000_ENABLE_AP_TX is set to something other than "1"', () => {
    process.env.G5000_ENABLE_AP_TX = '0';
    registerAutopilotTxIfEnabled(fakeDriver());
    expect(getSharedAutopilotTx()).toBeUndefined();
  });

  it('registers when G5000_ENABLE_AP_TX === "1"', () => {
    process.env.G5000_ENABLE_AP_TX = '1';
    registerAutopilotTxIfEnabled(fakeDriver());
    expect(getSharedAutopilotTx()).toBeDefined();
  });
});
