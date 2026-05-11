import { getSourceModeController } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface StartBody {
  sessionId: string;
  paceMode: 'realtime' | 'asap';
}

export async function POST(req: Request): Promise<Response> {
  const c = getSourceModeController();
  if (!c) {
    return Response.json({ error: 'SourceModeController not initialised' }, { status: 503 });
  }
  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body.sessionId || !body.paceMode) {
    return Response.json({ error: 'sessionId and paceMode required' }, { status: 400 });
  }
  if (body.paceMode !== 'realtime' && body.paceMode !== 'asap') {
    return Response.json({ error: 'paceMode must be realtime or asap' }, { status: 400 });
  }
  try {
    await c.startReplay(body);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
  return Response.json(c.getStatus());
}
