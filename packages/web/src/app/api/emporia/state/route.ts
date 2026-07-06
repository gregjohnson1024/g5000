import { getSharedEmporia } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET → the current Emporia snapshot, or an offline shell when no driver is wired. */
export async function GET(): Promise<Response> {
  const reg = getSharedEmporia();
  if (!reg) {
    return Response.json({ connected: false, offline: true }, { status: 200 });
  }
  return Response.json(reg.snapshot());
}
