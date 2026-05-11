import { getSourceModeController } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  const c = getSourceModeController();
  if (!c) {
    return Response.json({ error: 'SourceModeController not initialised' }, { status: 503 });
  }
  await c.stopReplay();
  return Response.json(c.getStatus());
}
