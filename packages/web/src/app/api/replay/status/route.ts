import { getSourceModeController } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const c = getSourceModeController();
  if (!c) {
    return Response.json({ error: 'SourceModeController not initialised' }, { status: 503 });
  }
  return Response.json(c.getStatus());
}
