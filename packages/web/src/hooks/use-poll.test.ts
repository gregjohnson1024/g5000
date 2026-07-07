/**
 * usePoll refcount / dedupe tests.
 *
 * These tests exercise the module-level registry directly via the exported
 * test helpers (_subscribe, _unsubscribe, _registryForTests).
 *
 * Invariants verified:
 *  1. Two subscribers to the SAME url share exactly ONE setInterval.
 *  2. Both subscribers receive state updates from that shared interval.
 *  3. When one of two subscribers unmounts, the interval keeps running.
 *  4. When the LAST subscriber unmounts, the interval is cleared and the
 *     registry entry is removed.
 *  5. Two subscribers to DIFFERENT urls get independent intervals.
 *  6. The initial fetch fires immediately on first subscribe (no timer tick
 *     required) and delivers parsed data to the listener.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PollState } from './use-poll';
import { _subscribe, _unsubscribe, _registryForTests } from './use-poll';

// ---------------------------------------------------------------------------
// Setup — fake timers + mock fetch
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ ok: true }),
  });
});

afterEach(() => {
  // Clean up any registry entries that tests leave behind (e.g. if a test
  // throws before its own unsubscribe calls).  The registry is a Map<string,
  // RegistryEntry> — we can iterate and delete without knowing the entry shape.
  const reg = _registryForTests();
  for (const url of [...reg.keys()]) {
    // Access intervalId through the opaque unknown value; cast is safe here
    // because we own the source and know the shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clearInterval((reg.get(url) as any).intervalId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reg as any).delete(url);
  }

  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A vi mock that accepts a PollState argument (typed loosely for test use). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeListener(): ReturnType<typeof vi.fn> & ((state: PollState<any>) => void) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return vi.fn<any>();
}

// ---------------------------------------------------------------------------
// Same-URL sharing
// ---------------------------------------------------------------------------

describe('same URL — shared interval', () => {
  it('two subscribers share ONE setInterval call', () => {
    const url = '/api/test-a';
    const ms = 1000;
    const l1 = makeListener();
    const l2 = makeListener();
    const spy = vi.spyOn(globalThis, 'setInterval');

    _subscribe(url, ms, l1);
    _subscribe(url, ms, l2);

    expect(spy).toHaveBeenCalledTimes(1);

    _unsubscribe(url, l1);
    _unsubscribe(url, l2);
  });

  it('both subscribers receive updates when the interval fires', async () => {
    const url = '/api/test-b';
    const ms = 500;
    const l1 = makeListener();
    const l2 = makeListener();

    _subscribe(url, ms, l1);
    _subscribe(url, ms, l2);

    // Drain the initial-fetch microtasks.
    await vi.advanceTimersByTimeAsync(0);

    const countL1Before = l1.mock.calls.length;
    const countL2Before = l2.mock.calls.length;

    // Advance one interval tick.
    await vi.advanceTimersByTimeAsync(ms);

    expect(l1.mock.calls.length).toBeGreaterThan(countL1Before);
    expect(l2.mock.calls.length).toBeGreaterThan(countL2Before);

    _unsubscribe(url, l1);
    _unsubscribe(url, l2);
  });

  it('interval keeps running when one of two subscribers unsubscribes', () => {
    const url = '/api/test-c';
    const ms = 500;
    const l1 = makeListener();
    const l2 = makeListener();
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');

    _subscribe(url, ms, l1);
    _subscribe(url, ms, l2);

    // Unsub l1 — refcount 2 → 1.
    _unsubscribe(url, l1);

    // clearInterval must NOT have been called — l2 is still subscribed.
    expect(clearSpy).not.toHaveBeenCalled();
    expect(_registryForTests().has(url)).toBe(true);

    // Unsub l2 — last subscriber; clearInterval must fire, entry removed.
    _unsubscribe(url, l2);
    expect(clearSpy).toHaveBeenCalled();
    expect(_registryForTests().has(url)).toBe(false);
  });

  it('last unmount clears the interval and removes the registry entry', () => {
    const url = '/api/test-d';
    const ms = 500;
    const l1 = makeListener();
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');

    _subscribe(url, ms, l1);
    _unsubscribe(url, l1);

    expect(clearSpy).toHaveBeenCalled();
    expect(_registryForTests().has(url)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Distinct URLs — independent intervals
// ---------------------------------------------------------------------------

describe('distinct URLs — independent intervals', () => {
  it('two different URLs each get their own setInterval', () => {
    const url1 = '/api/distinct-1';
    const url2 = '/api/distinct-2';
    const ms = 500;
    const l1 = makeListener();
    const l2 = makeListener();
    const spy = vi.spyOn(globalThis, 'setInterval');

    _subscribe(url1, ms, l1);
    _subscribe(url2, ms, l2);

    // One setInterval per URL.
    expect(spy).toHaveBeenCalledTimes(2);

    _unsubscribe(url1, l1);
    _unsubscribe(url2, l2);
  });

  it('clearing one URL leaves the other intact', () => {
    const url1 = '/api/ind-a';
    const url2 = '/api/ind-b';
    const ms = 500;
    const l1 = makeListener();
    const l2 = makeListener();

    _subscribe(url1, ms, l1);
    _subscribe(url2, ms, l2);

    _unsubscribe(url1, l1);

    expect(_registryForTests().has(url1)).toBe(false);
    expect(_registryForTests().has(url2)).toBe(true);

    _unsubscribe(url2, l2);
  });
});

// ---------------------------------------------------------------------------
// Initial fetch behaviour
// ---------------------------------------------------------------------------

describe('initial fetch', () => {
  it('fires immediately on first subscribe (no timer tick needed)', async () => {
    const url = '/api/init-fetch';
    const ms = 5000;
    const l1 = makeListener();

    _subscribe(url, ms, l1);
    await vi.advanceTimersByTimeAsync(0);

    expect(global.fetch).toHaveBeenCalledWith(url);

    _unsubscribe(url, l1);
  });

  it('delivers parsed data to the listener after the initial fetch resolves', async () => {
    const url = '/api/init-data';
    const ms = 5000;
    const l1 = makeListener();

    _subscribe(url, ms, l1);
    await vi.advanceTimersByTimeAsync(0);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const lastCall = l1.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ data: { ok: true }, error: false, loading: false });

    _unsubscribe(url, l1);
  });
});
