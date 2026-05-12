import { positionStreamUrl } from '../../../../lib/g5000-client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    const upstream = await fetch(positionStreamUrl(), {
      headers: { accept: 'text/event-stream' },
    });
    if (!upstream.ok || !upstream.body) {
      return new Response(`event: error\ndata: {"kind":"unavailable"}\n\n`, {
        status: 503,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return new Response(upstream.body, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  } catch {
    return new Response(`event: error\ndata: {"kind":"network"}\n\n`, {
      status: 503,
      headers: { 'content-type': 'text/event-stream' },
    });
  }
}
