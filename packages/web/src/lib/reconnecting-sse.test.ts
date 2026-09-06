import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { openReconnectingSse } from './reconnecting-sse';

/** Minimal EventSource stand-in that lets a test drive readyState + events. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private readonly handlers = new Map<string, (ev: MessageEvent) => void>();

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, fn: (ev: MessageEvent) => void): void {
    this.handlers.set(name, fn);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  /** Simulate the server accepting the connection. */
  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  /** Simulate an error, choosing whether the browser gave up. */
  fail(state: number): void {
    this.readyState = state;
    this.onerror?.();
  }

  emit(name: string, data: unknown): void {
    this.handlers.get(name)?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('openReconnectingSse', () => {
  it('delivers named events to their listeners', () => {
    const seen: unknown[] = [];
    openReconnectingSse('/api/mast/stream', {
      listeners: { daybasecolor: (ev) => seen.push(JSON.parse(ev.data)) },
    });
    FakeEventSource.instances[0]!.emit('daybasecolor', 'red');
    expect(seen).toEqual(['red']);
  });

  it('does NOT reconnect while the browser is still retrying (CONNECTING)', () => {
    openReconnectingSse('/api/mast/stream', { listeners: {} });
    FakeEventSource.instances[0]!.fail(FakeEventSource.CONNECTING);
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('reconnects after the browser gives up (CLOSED) — the deploy-restart case', () => {
    openReconnectingSse('/api/mast/stream', { listeners: {} });
    FakeEventSource.instances[0]!.fail(FakeEventSource.CLOSED);
    expect(FakeEventSource.instances).toHaveLength(1); // backoff not elapsed yet
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]!.url).toBe('/api/mast/stream');
  });

  it('backs off exponentially and caps at maxDelayMs', () => {
    openReconnectingSse('/api/mast/stream', { listeners: {}, maxDelayMs: 4000 });
    const failNow = (): void => {
      const es = FakeEventSource.instances[FakeEventSource.instances.length - 1]!;
      es.fail(FakeEventSource.CLOSED);
    };
    failNow();
    vi.advanceTimersByTime(1000); // 1s
    expect(FakeEventSource.instances).toHaveLength(2);
    failNow();
    vi.advanceTimersByTime(1999);
    expect(FakeEventSource.instances).toHaveLength(2); // 2s not yet elapsed
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(3);
    failNow();
    vi.advanceTimersByTime(4000); // would be 4s, capped at 4s
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it('resets the backoff after a successful reconnect', () => {
    openReconnectingSse('/api/mast/stream', { listeners: {} });
    FakeEventSource.instances[0]!.fail(FakeEventSource.CLOSED);
    vi.advanceTimersByTime(1000);
    FakeEventSource.instances[1]!.open(); // reconnected successfully
    FakeEventSource.instances[1]!.fail(FakeEventSource.CLOSED);
    vi.advanceTimersByTime(1000); // back to the 1s step, not 2s
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it('stops reconnecting once disposed', () => {
    const dispose = openReconnectingSse('/api/mast/stream', { listeners: {} });
    FakeEventSource.instances[0]!.fail(FakeEventSource.CLOSED);
    dispose();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('closes the live source on dispose', () => {
    const dispose = openReconnectingSse('/api/mast/stream', { listeners: {} });
    FakeEventSource.instances[0]!.open();
    dispose();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });

  it('reports connect and error transitions to the caller', () => {
    const onOpen = vi.fn();
    const onError = vi.fn();
    openReconnectingSse('/api/mast/stream', { listeners: {}, onOpen, onError });
    FakeEventSource.instances[0]!.open();
    expect(onOpen).toHaveBeenCalledTimes(1);
    FakeEventSource.instances[0]!.fail(FakeEventSource.CLOSED);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
