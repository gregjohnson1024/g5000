import { describe, expect, it } from 'vitest';
import { parseJsonBody } from './req';

// These tests pin the exact 400 bytes produced for malformed JSON, both for the
// helper directly and for two representative route handlers (one with a `kind`
// in its envelope, one without). The goal is a byte-level regression guard for
// the parse-helper migration: the envelope must not drift.

const badJsonRequest = () =>
  new Request('http://x/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{', // invalid JSON
  });

describe('parseJsonBody', () => {
  it('parses valid JSON into { ok: true, body }', async () => {
    const req = new Request('http://x/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    const r = await parseJsonBody<{ a: number }>(req);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toEqual({ a: 1 });
  });

  it('with kind: produces { ok:false, error:{ kind, message } } @ 400 (byte-exact)', async () => {
    const r = await parseJsonBody(badJsonRequest(), 'bad_request');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(400);
    expect(r.response.headers.get('content-type')).toBe('application/json');
    expect(await r.response.text()).toBe(
      '{"ok":false,"error":{"kind":"bad_request","message":"invalid JSON"}}',
    );
  });

  it('without kind: produces { ok:false, error:{ message } } @ 400 (byte-exact)', async () => {
    const r = await parseJsonBody(badJsonRequest());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(400);
    expect(r.response.headers.get('content-type')).toBe('application/json');
    expect(await r.response.text()).toBe('{"ok":false,"error":{"message":"invalid JSON"}}');
  });
});

describe('route handler 400 envelopes (byte-level regression guard)', () => {
  it('Group A route (alerts/acknowledge) keeps kind in its 400', async () => {
    const { POST } = await import('../app/api/alerts/acknowledge/route');
    const res = await POST(badJsonRequest());
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.text()).toBe(
      '{"ok":false,"error":{"kind":"bad_request","message":"invalid JSON"}}',
    );
  });

  it('Group B route (boat-state) keeps the no-kind 400', async () => {
    const { POST } = await import('../app/api/boat-state/route');
    const res = await POST(badJsonRequest());
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.text()).toBe('{"ok":false,"error":{"message":"invalid JSON"}}');
  });
});
