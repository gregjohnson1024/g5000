import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Bus, Sample, ChannelValue } from '@g5000/core';
import { createDamper } from '@g5000/core';
import { CHANNEL_TO_FUNCTIONS, FUNCTION_TABLE, hlinkFormat } from './function-table.js';
import { formatP, formatV, parseHlinkLine } from './protocol.js';

/** Minimum gap between successive emissions of the same function to one client. */
const STREAM_THROTTLE_MS = 200; // → 5 Hz max per function per client

export interface HlinkServerOptions {
  bus: Bus;
  /**
   * Port to listen on. Pass 0 for an ephemeral port (used in tests; the
   * actual port is returned via `getAddress()`).
   */
  port: number;
  /** Listen host. Defaults to `0.0.0.0`. */
  host?: string;
  /**
   * Optional "now" function (ms since epoch). Tests can stub this to
   * deterministically drive the throttle. Defaults to `Date.now`.
   */
  now?: () => number;
  /**
   * Optional getter returning the current per-channel damping config
   * (channel name → time constant in seconds). Looked up on each sample;
   * missing or 0/undefined entries mean no damping for that channel.
   *
   * When omitted, no damping is applied — useful for tests and minimal
   * deployments. The autopilot-server boot wires this to the ConfigStore's
   * `getDampingConfig()`.
   */
  getDamping?: () => Record<string, number>;
}

export interface HlinkServerHandle {
  /** Resolve only once the server is actually listening. */
  readonly listening: Promise<void>;
  /** Tear down: close the listener and all open sockets. */
  teardown: () => Promise<void>;
  /** Bound address (host/port) once `listening` has resolved. */
  getAddress: () => AddressInfo;
}

interface ClientState {
  socket: net.Socket;
  /** Function numbers enabled for streaming on this connection. */
  enabledFns: Set<number>;
  /** Position streaming flag (set by #OL,1). */
  posStreaming: boolean;
  /** Global `#OS,1` master switch. */
  streamingOn: boolean;
  /** Last emission timestamp per function (for throttle). */
  lastEmitMs: Map<number, number>;
  /** Last position-emit timestamp (for throttle). */
  lastPosEmitMs: number;
  /** Line-buffered read (data may arrive in fragments). */
  rxBuffer: string;
}

/**
 * Start the H-LINK TCP server.
 *
 * Each connection has its own enabled-function set, master streaming flag,
 * position-streaming flag, and per-function throttle clock. A single bus
 * subscription serves every client; per-connection state is consulted on
 * each sample.
 */
export function startHlinkServer(opts: HlinkServerOptions): HlinkServerHandle {
  const { bus, port, host = '0.0.0.0', now = Date.now, getDamping } = opts;
  const clients = new Set<ClientState>();

  // ─── Damping ────────────────────────────────────────────────────────
  // One damper shared across all clients: damping is a property of the
  // outgoing-display layer, not per-connection. Reconnects therefore see
  // already-warmed state, which is fine because the EMA self-warms in a
  // single sample anyway. Memory cost is one entry per channel that's
  // ever been touched.
  //
  // The damper is also consulted before populating `lastValueCache`, so
  // one-shot #OV reads return the same damped value the streaming path
  // would produce.
  const damper = createDamper();

  // ─── Last-value cache ────────────────────────────────────────────────
  // Per-channel cache so #OV one-shot reads can answer with real data
  // immediately instead of waiting for the next sample. Populated by
  // `onSample` below with the DAMPED value (so one-shot reads match
  // what the streaming path would produce). Memory cost is trivial.
  const lastValueCache = new Map<string, ChannelValue>();

  // ─── Bus subscription ────────────────────────────────────────────────
  // One subscription, fan out to all clients on every sample. Cheaper
  // than N subscriptions when N grows; correct because each client filters
  // its own function set.
  const unsubscribe = bus.subscribe('**', (sample: Sample) => {
    onSample(sample);
  });

  function onSample(rawSample: Sample): void {
    // Apply damping FIRST, on every sample, so the EMA's Δt corresponds to
    // real sample spacing. Doing it later (e.g. inside the per-client
    // throttle gate) would mean the EMA only advances at the throttle rate
    // and α = exp(-Δt/τ) would be wrong.
    const tau = getDamping?.()[rawSample.channel];
    const sample = damper(rawSample, tau);

    // Cache the (damped) value so #OV one-shot reads return the same value
    // a streaming client would see.
    lastValueCache.set(sample.channel, sample.value);

    if (clients.size === 0) return;
    const t = now();

    // Position has its own path — geo samples don't fit the V<...> envelope.
    if (sample.channel === 'nav.gps.position' && sample.value.kind === 'geo') {
      const { lat, lon } = sample.value.value;
      const posLine = formatP(lat, lon);
      for (const c of clients) {
        if (!c.streamingOn || !c.posStreaming) continue;
        if (t - c.lastPosEmitMs < STREAM_THROTTLE_MS) continue;
        c.lastPosEmitMs = t;
        try {
          c.socket.write(posLine);
        } catch {
          /* socket may have closed mid-write; cleaned up by 'close' handler */
        }
      }
      return;
    }

    const fns = CHANNEL_TO_FUNCTIONS.get(sample.channel);
    if (!fns) return;

    for (const fn of fns) {
      const payload = formatValueForFn(fn, sample.value);
      if (payload === null) continue;
      const line = formatV(fn, payload);

      for (const c of clients) {
        if (!c.streamingOn) continue;
        if (!c.enabledFns.has(fn)) continue;
        const last = c.lastEmitMs.get(fn) ?? 0;
        if (t - last < STREAM_THROTTLE_MS) continue;
        c.lastEmitMs.set(fn, t);
        try {
          c.socket.write(line);
        } catch {
          /* socket may have closed; ignore */
        }
      }
    }
  }

  // ─── TCP server ──────────────────────────────────────────────────────
  const server = net.createServer((socket) => {
    socket.setNoDelay(true);
    socket.setEncoding('utf8');

    const state: ClientState = {
      socket,
      enabledFns: new Set<number>(),
      posStreaming: false,
      streamingOn: false,
      lastEmitMs: new Map<number, number>(),
      lastPosEmitMs: 0,
      rxBuffer: '',
    };
    clients.add(state);

    socket.on('data', (chunk: string) => {
      state.rxBuffer += chunk;
      // Split on either CR, LF, or CRLF. tactical software is inconsistent.
      let nlIdx: number;
      while ((nlIdx = findLineEnd(state.rxBuffer)) >= 0) {
        const rawLine = state.rxBuffer.slice(0, nlIdx);
        // skip the line ending (1 or 2 chars)
        const eol = state.rxBuffer.slice(nlIdx, nlIdx + 2);
        const consumed = eol.startsWith('\r\n') ? 2 : 1;
        state.rxBuffer = state.rxBuffer.slice(nlIdx + consumed);
        if (rawLine.length === 0) continue;
        handleLine(state, rawLine);
      }
      // Safety: a client that sends megabytes without a newline is buggy.
      // Cap the buffer to avoid unbounded growth.
      if (state.rxBuffer.length > 4096) {
        state.rxBuffer = '';
      }
    });

    const cleanup = (): void => {
      clients.delete(state);
    };
    socket.on('close', cleanup);
    socket.on('error', () => {
      // Don't crash the server on per-client errors (e.g. ECONNRESET).
      cleanup();
      socket.destroy();
    });
  });

  function handleLine(state: ClientState, rawLine: string): void {
    const cmd = parseHlinkLine(rawLine);
    switch (cmd.kind) {
      case 'ov-once': {
        // Reply once with the latest cached value — but we don't keep a
        // cache. Best effort: emit an empty V line for unmapped, or
        // wait for the next sample. Since the spec wants a reply NOW,
        // we synthesize from the function-table presence: if we know
        // the function we emit `V001,001,FFF,` (empty value) — clients
        // can either ignore that or call back via streaming.
        //
        // Better: keep a simple "last seen sample per channel" cache so
        // one-shot reads return real numbers. Implemented below via
        // lastValueCache.
        const row = FUNCTION_TABLE.get(cmd.fn);
        if (!row) {
          // Unmapped: empty value as agreed.
          state.socket.write(formatV(cmd.fn, ''));
          return;
        }
        const cached = lastValueCache.get(row.channel);
        if (cached) {
          const payload = formatValueForFn(cmd.fn, cached);
          state.socket.write(formatV(cmd.fn, payload ?? ''));
        } else {
          // No data yet for this channel: emit empty so the client
          // gets *some* answer rather than hanging.
          state.socket.write(formatV(cmd.fn, ''));
        }
        return;
      }
      case 'ov-enable': {
        if (FUNCTION_TABLE.has(cmd.fn)) state.enabledFns.add(cmd.fn);
        // Unmapped functions: don't enable, don't reply (spec silent).
        return;
      }
      case 'ov-disable': {
        state.enabledFns.delete(cmd.fn);
        state.lastEmitMs.delete(cmd.fn);
        return;
      }
      case 'ol-once': {
        const cached = lastValueCache.get('nav.gps.position');
        if (cached && cached.kind === 'geo') {
          state.socket.write(formatP(cached.value.lat, cached.value.lon));
        }
        return;
      }
      case 'ol-enable': {
        state.posStreaming = true;
        return;
      }
      case 'ol-disable': {
        state.posStreaming = false;
        state.lastPosEmitMs = 0;
        return;
      }
      case 'os-start': {
        state.streamingOn = true;
        return;
      }
      case 'os-stop': {
        state.streamingOn = false;
        // Reset throttles so a subsequent #OS,1 doesn't replay buffered
        // samples but also doesn't have to wait 200 ms.
        state.lastEmitMs.clear();
        state.lastPosEmitMs = 0;
        return;
      }
      case 'ignore': {
        // Silent drop, per spec.
        return;
      }
    }
  }

  // ─── Listen ──────────────────────────────────────────────────────────
  let resolveListening!: () => void;
  let rejectListening!: (err: Error) => void;
  const listening = new Promise<void>((resolve, reject) => {
    resolveListening = resolve;
    rejectListening = reject;
  });

  server.once('error', (err) => rejectListening(err));
  server.listen(port, host, () => resolveListening());

  // ─── Teardown ────────────────────────────────────────────────────────
  const teardown = async (): Promise<void> => {
    unsubscribe();
    // Close server then destroy any remaining sockets.
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      for (const c of clients) c.socket.destroy();
      clients.clear();
    });
  };

  return {
    listening,
    teardown,
    getAddress: () => server.address() as AddressInfo,
  };
}

/** Find index of CR or LF in `s`, or −1 if none. */
function findLineEnd(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 10 || c === 13) return i;
  }
  return -1;
}

/** Apply the function-table formatter to a bus ChannelValue. */
function formatValueForFn(fn: number, value: ChannelValue): string | null {
  return hlinkFormat(fn, value);
}
