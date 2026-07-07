/**
 * usePoll — URL-keyed polling hook with refcounting.
 *
 * Multiple callers of usePoll(url, ms) with the SAME url share exactly ONE
 * setInterval and ONE in-flight fetch. State is promoted to all subscribers
 * simultaneously. The interval is torn down only when the LAST subscriber
 * unmounts (refcount → 0).
 *
 * Design goals:
 *  - SSR-safe (no window/setInterval in module scope; registry only used inside
 *    useEffect which never runs on the server).
 *  - Transient errors are swallowed and reflected as `error: true` rather than
 *    thrown, matching the existing shell-poller pattern.
 *  - A new URL always gets its own independent entry in the registry.
 */

'use client';

import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PollState<T> {
  data: T | null;
  error: boolean;
  loading: boolean;
}

// Subscriber callback — receives the latest parsed JSON or an error signal.
type Listener<T> = (state: PollState<T>) => void;

interface RegistryEntry<T = unknown> {
  refcount: number;
  intervalId: ReturnType<typeof setInterval>;
  listeners: Set<Listener<T>>;
  latest: PollState<T>;
  /** True while a fetch is in-flight so we don't stack calls. */
  fetching: boolean;
}

// ---------------------------------------------------------------------------
// Module-level registry (intentionally not exported — tests reach it via the
// exported _registryForTests helper).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry = new Map<string, RegistryEntry<any>>();

/**
 * Exposed for tests ONLY. Returns a read-only view of the registry.
 * Do not call from application code.
 */
export function _registryForTests(): ReadonlyMap<string, RegistryEntry<unknown>> {
  return registry;
}

/**
 * Exposed for tests ONLY. Drive the subscribe path without a React component.
 * Accepts an untyped listener so test mocks (vi.fn()) satisfy the parameter.
 * Do not call from application code.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function _subscribe(
  url: string,
  ms: number,
  listener: (state: PollState<any>) => void,
): void {
  subscribe(url, ms, listener);
}

/**
 * Exposed for tests ONLY. Drive the unsubscribe path without a React component.
 * Do not call from application code.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function _unsubscribe(url: string, listener: (state: PollState<any>) => void): void {
  unsubscribe(url, listener);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function notify<T>(entry: RegistryEntry<T>, state: PollState<T>): void {
  entry.latest = state;
  for (const listener of entry.listeners) {
    listener(state);
  }
}

async function doFetch<T>(url: string, entry: RegistryEntry<T>): Promise<void> {
  if (entry.fetching) return;
  entry.fetching = true;
  try {
    const r = await fetch(url);
    const data = (await r.json()) as T;
    notify(entry, { data, error: false, loading: false });
  } catch {
    notify(entry, { data: entry.latest.data, error: true, loading: false });
  } finally {
    entry.fetching = false;
  }
}

function subscribe<T>(url: string, ms: number, listener: Listener<T>): void {
  let entry = registry.get(url) as RegistryEntry<T> | undefined;

  if (!entry) {
    const initial: PollState<T> = { data: null, error: false, loading: true };
    const newEntry: RegistryEntry<T> = {
      refcount: 0,
      intervalId: undefined as unknown as ReturnType<typeof setInterval>,
      listeners: new Set(),
      latest: initial,
      fetching: false,
    };
    // Kick off the first fetch immediately, then repeat.
    void doFetch(url, newEntry);
    newEntry.intervalId = setInterval(() => void doFetch(url, newEntry), ms);
    registry.set(url, newEntry);
    entry = newEntry;
  }

  entry.refcount++;
  entry.listeners.add(listener as Listener<unknown>);

  // Deliver the latest known state to the new subscriber immediately (avoids
  // a render cycle where the new subscriber shows stale defaults).
  listener(entry.latest);
}

function unsubscribe<T>(url: string, listener: Listener<T>): void {
  const entry = registry.get(url) as RegistryEntry<T> | undefined;
  if (!entry) return;

  entry.listeners.delete(listener as Listener<unknown>);
  entry.refcount--;

  if (entry.refcount <= 0) {
    clearInterval(entry.intervalId);
    registry.delete(url);
  }
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

/**
 * usePoll(url, ms) — shared periodic fetcher.
 *
 * Multiple components calling usePoll with the same `url` share a single
 * interval and in-flight fetch; the interval lives until the last caller
 * unmounts.
 *
 * @param url  URL to GET. Must be stable between renders (use a constant or
 *             useMemo) — changing `url` re-creates the subscription.
 * @param ms   Poll interval in milliseconds. Changing `ms` after the first
 *             mount of a given URL has no effect while any subscriber is
 *             active (the interval was already created with the initial value).
 *             Use a constant.
 */
export function usePoll<T>(url: string, ms: number): PollState<T> {
  const [state, setState] = useState<PollState<T>>({
    data: null,
    error: false,
    loading: true,
  });

  useEffect(() => {
    // listener is stable for this effect instance — React may call it with a
    // new function reference on re-render, but the effect only runs when url
    // or ms changes (both are expected to be constants from the call site).
    const listener: Listener<T> = (s) => setState(s);
    subscribe(url, ms, listener);
    return () => {
      unsubscribe(url, listener);
    };
  }, [url, ms]);

  return state;
}
