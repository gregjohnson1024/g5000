import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_ALARMS_CONFIG, type AlarmsConfig } from '@g5000/db';
import { POST } from './route.js';

type G = { __g5000_alarms_config_ref__?: { current: AlarmsConfig } };

function setRef(push: { ntfyTopic: string | null; ntfyUrl: string | null }) {
  const cfg = structuredClone(DEFAULT_ALARMS_CONFIG);
  cfg.push = push;
  (globalThis as G).__g5000_alarms_config_ref__ = { current: cfg };
}

describe('POST /api/alarms/push-test', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    (globalThis as G).__g5000_alarms_config_ref__ = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    (globalThis as G).__g5000_alarms_config_ref__ = undefined;
  });

  it('reports the no-topic-configured case without sending anything', async () => {
    vi.stubEnv('G5000_NTFY_TOPIC', '');
    setRef({ ntfyTopic: null, ntfyUrl: null });
    const body = await (await POST()).json();
    expect(body.ok).toBe(false);
    expect(body.error.message).toContain('no ntfy topic configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a test push to the configured topic with boat id + ship-clock time in the body', async () => {
    vi.stubEnv('G5000_BOAT_ID', 'sula');
    setRef({ ntfyTopic: 'sula-alarms', ntfyUrl: 'https://push.example.com' });
    const body = await (await POST()).json();
    expect(body).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://push.example.com/sula-alarms');
    expect(String(init.body)).toContain('boat sula');
    // No ConfigStore under vitest → the server clock degrades to UTC ('Z').
    expect(String(init.body)).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z/);
  });

  it('falls back to env G5000_NTFY_TOPIC when the config ref is unbound', async () => {
    vi.stubEnv('G5000_NTFY_TOPIC', 'env-topic');
    const body = await (await POST()).json();
    expect(body).toEqual({ ok: true });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://ntfy.sh/env-topic');
  });

  it('surfaces an HTTP failure from the ntfy server', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502 });
    setRef({ ntfyTopic: 'sula-alarms', ntfyUrl: null });
    const body = await (await POST()).json();
    expect(body.ok).toBe(false);
    expect(body.error.message).toBe('HTTP 502');
  });

  it('surfaces a network failure as {ok:false, error:{message}}', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    setRef({ ntfyTopic: 'sula-alarms', ntfyUrl: null });
    const body = await (await POST()).json();
    expect(body.ok).toBe(false);
    expect(body.error.message).toContain('offline');
  });
});
