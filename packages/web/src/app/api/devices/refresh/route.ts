import { getSharedDeviceRegistry } from '@g5000/bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const registry = getSharedDeviceRegistry();
  let target: number | undefined;
  try {
    const body = (await req.json().catch(() => null)) as { target?: number } | null;
    if (body && typeof body.target === 'number') target = body.target;
  } catch {
    /* empty body is fine — broadcast */
  }
  try {
    await registry.refresh(target);
    return Response.json({ ok: true, target: target ?? 'broadcast' });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
