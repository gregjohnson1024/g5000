'use client';

/**
 * Open an `EventSource` that survives the server restarting underneath it.
 *
 * The browser retries on its own only while `readyState` is `CONNECTING`. Once
 * it gives up and moves to `CLOSED` nothing reconnects, and a long-lived page
 * renders stale state indefinitely with no visible error.
 *
 * This is not hypothetical: on 2026-09-06 a g5000 deploy restarted the service
 * under the mast panel. The brightness agent recovered (systemd restarts it)
 * but the kiosk page did not — it sat on a dead stream, ignoring every layout,
 * night-mode and colour change until the kiosk was restarted by hand.
 *
 * Returns a dispose function; call it from an effect cleanup.
 */
export interface ReconnectingSseOptions {
  /** Fired on every successful (re)connection. */
  onOpen?: () => void;
  /** Fired on every error, including ones the browser will retry itself. */
  onError?: () => void;
  /** Named SSE events to subscribe to. */
  listeners: Record<string, (ev: MessageEvent) => void>;
  /** Upper bound for the exponential backoff. Default 15s. */
  maxDelayMs?: number;
}

export function openReconnectingSse(url: string, opts: ReconnectingSseOptions): () => void {
  const maxDelayMs = opts.maxDelayMs ?? 15_000;
  let es: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let attempt = 0;

  const connect = (): void => {
    if (disposed) return;
    const source = new EventSource(url);
    es = source;

    source.onopen = () => {
      attempt = 0;
      opts.onOpen?.();
    };

    source.onerror = () => {
      opts.onError?.();
      // Leave CONNECTING alone — the browser is already retrying. Only step in
      // once it has given up, otherwise we would race its own reconnect.
      if (disposed || source.readyState !== EventSource.CLOSED) return;
      source.close();
      if (es === source) es = null;
      const delay = Math.min(1000 * 2 ** attempt, maxDelayMs);
      attempt += 1;
      retry = setTimeout(connect, delay);
    };

    for (const [name, handler] of Object.entries(opts.listeners)) {
      source.addEventListener(name, (ev) => handler(ev as MessageEvent));
    }
  };

  connect();

  return () => {
    disposed = true;
    if (retry !== null) clearTimeout(retry);
    es?.close();
    es = null;
  };
}
