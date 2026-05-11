import { getSourceModeController } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const c = getSourceModeController();
  if (!c) {
    return Response.json(
      { error: 'SourceModeController not initialised — server is not running' },
      { status: 503 },
    );
  }
  return Response.json(c.getStatus());
}

interface PostBody {
  mode: 'live' | 'demo';
}

export async function POST(req: Request): Promise<Response> {
  const c = getSourceModeController();
  if (!c) {
    return Response.json({ error: 'SourceModeController not initialised' }, { status: 503 });
  }
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (body.mode !== 'live' && body.mode !== 'demo') {
    return Response.json({ error: 'mode must be live or demo' }, { status: 400 });
  }
  try {
    await c.setLiveOrDemo(body.mode);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
  return Response.json(c.getStatus());
}
