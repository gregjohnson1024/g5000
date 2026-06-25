export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ path: string[] }>;
}

/**
 * Same-origin proxy for mayara-server's REST API.
 *
 * The browser cannot fetch mayara directly: g5000 and mayara are always on
 * different origins (`:3000` vs `:6502`) and mayara sends no CORS headers (and
 * has no CORS option), so a cross-origin fetch is blocked. The radar UI instead
 * calls `/api/radar/...` on g5000 and this route forwards to mayara server-side.
 *
 * The high-rate spoke WebSocket is deliberately NOT proxied here — it connects
 * browser→mayara directly (WebSockets are not subject to CORS), so the stream
 * never enters g5000's event loop. Only the small/infrequent REST calls
 * (discover, capabilities, controls) pass through here.
 *
 * `/api/radar/<path>` → `${MAYARA_URL}/<path>`; the client builds the full
 * `signalk/v2/api/vessels/self/radars/...` path. MAYARA_URL defaults to mayara
 * on the same host as g5000 (the standard single-Pi deployment).
 */
const MAYARA_URL = (process.env.MAYARA_URL ?? 'http://127.0.0.1:6502').replace(/\/$/, '');

async function forward(req: Request, path: string[]): Promise<Response> {
  const search = new URL(req.url).search;
  const target = `${MAYARA_URL}/${path.join('/')}${search}`;
  const init: RequestInit = { method: req.method };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text();
    init.headers = { 'content-type': req.headers.get('content-type') ?? 'application/json' };
  }
  try {
    const upstream = await fetch(target, init);
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `radar proxy: ${(e as Error).message}` }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}

export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  return forward(req, (await params).path);
}

export async function PUT(req: Request, { params }: Ctx): Promise<Response> {
  return forward(req, (await params).path);
}
