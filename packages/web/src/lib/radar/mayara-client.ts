import { decodeRadarMessage } from './proto.js';
import type { Capabilities, ControlValue, DecodedSpoke, RadarInfo } from './types.js';

const API = '/signalk/v2/api/vessels/self/radars';

export type WebSocketCtor = new (url: string) => {
  binaryType: string;
  onmessage: ((e: { data: unknown }) => void) | null;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
};

/** Rewrite a server-reported spoke URL to reach `baseUrl`'s host, with wss when base is https. */
export function wsUrlFor(spokeDataUrl: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  const u = new URL(spokeDataUrl);
  u.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  u.host = base.host;
  return u.toString();
}

export class MayaraClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly wsImpl: WebSocketCtor;

  constructor(opts: { baseUrl: string; fetchImpl?: typeof fetch; wsImpl?: WebSocketCtor }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.wsImpl = opts.wsImpl ?? (globalThis.WebSocket as unknown as WebSocketCtor);
  }

  async discover(): Promise<{ id: string; info: RadarInfo }> {
    const res = await this.fetchImpl(`${this.baseUrl}${API}`);
    const map = (await res.json()) as Record<string, RadarInfo>;
    const id = Object.keys(map)[0];
    if (!id) throw new Error('no radar');
    return { id, info: map[id]! };
  }

  async capabilities(id: string): Promise<Capabilities> {
    const res = await this.fetchImpl(`${this.baseUrl}${API}/${id}/capabilities`);
    return (await res.json()) as Capabilities;
  }

  async setControl(id: string, controlId: string, body: ControlValue): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}${API}/${id}/controls/${controlId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`control ${controlId}: ${res.status} ${await res.text()}`);
  }

  /** Connect to the spoke stream; returns a disposer. Reconnects with backoff. */
  connectSpokes(
    spokeDataUrl: string,
    onSpokes: (s: DecodedSpoke[]) => void,
    onState: (s: 'open' | 'closed' | 'error') => void,
  ): () => void {
    const url = wsUrlFor(spokeDataUrl, this.baseUrl);
    let closed = false;
    let backoff = 500;
    let ws: InstanceType<WebSocketCtor> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const open = (): void => {
      ws = new this.wsImpl(url);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        backoff = 500;
        onState('open');
      };
      ws.onmessage = (e) => {
        const d = e.data;
        if (typeof d === 'string') return;
        const bytes =
          d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d as ArrayBufferLike);
        onSpokes(decodeRadarMessage(bytes));
      };
      ws.onerror = () => onState('error');
      ws.onclose = () => {
        onState('closed');
        if (closed) return;
        timer = setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, 10_000);
      };
    };
    open();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }
}
