import { getSharedVictron } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET → the current Victron snapshot, or an offline shell when no driver is wired. */
export async function GET(): Promise<Response> {
  const reg = getSharedVictron();
  if (!reg) {
    return Response.json({ connected: false, offline: true }, { status: 200 });
  }
  return Response.json(reg.snapshot());
}
