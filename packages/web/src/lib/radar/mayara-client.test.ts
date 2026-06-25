import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { MayaraClient, wsUrlFor } from './mayara-client';

const radars = JSON.parse(
  readFileSync(fileURLToPath(new URL('./__fixtures__/radars.json', import.meta.url)), 'utf8'),
);
const frame = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./__fixtures__/spoke-frame.bin', import.meta.url))),
);

describe('MayaraClient', () => {
  it('discovers the first radar id and its info', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(radars)),
    ) as unknown as typeof fetch;
    const c = new MayaraClient({ baseUrl: 'http://pi:6502', fetchImpl });
    const { id, info } = await c.discover();
    expect(id).toBe(Object.keys(radars)[0]);
    expect(info.spokeDataUrl).toContain('/spokes');
  });

  it('PUTs control body {value, auto}', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
    const c = new MayaraClient({ baseUrl: 'http://pi:6502', fetchImpl });
    await c.setControl('r1', 'gain', { value: 50, auto: false });
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(String(url)).toMatch(/\/radars\/r1\/controls\/gain$/);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ value: 50, auto: false });
  });

  it('decodes spoke frames to the callback', async () => {
    const sockets: any[] = [];
    class FakeWS {
      binaryType = 'blob';
      onmessage: any;
      onopen: any;
      onclose: any;
      onerror: any;
      constructor(public url: string) {
        sockets.push(this);
      }
      close() {
        this.onclose?.();
      }
    }
    const c = new MayaraClient({ baseUrl: 'http://pi:6502', wsImpl: FakeWS as any });
    const got: number[] = [];
    c.connectSpokes(
      'ws://radar/spokes',
      (s) => got.push(s.length),
      () => {},
    );
    sockets[0].onopen?.();
    sockets[0].onmessage?.({ data: frame.buffer });
    expect(got[0]).toBeGreaterThan(0);
  });

  it('forces wss when base is https and rewrites host', () => {
    expect(wsUrlFor('ws://10.0.0.5:6502/x/spokes', 'https://pi.ts.net:6502')).toBe(
      'wss://pi.ts.net:6502/x/spokes',
    );
    expect(wsUrlFor('ws://10.0.0.5:6502/x/spokes', 'http://pi.lan:6502')).toBe(
      'ws://pi.lan:6502/x/spokes',
    );
  });
});
