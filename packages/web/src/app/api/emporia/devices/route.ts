import { getSharedEmporia } from '@g5000/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET → list of connected Emporia devices. */
export async function GET(): Promise<Response> {
  return Response.json({ devices: getSharedEmporia()?.devices() ?? [] });
}
