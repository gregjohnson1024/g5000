import { listSessions } from '@g5000/bridge';
import { sessionsDir } from './dir.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const sessions = await listSessions(sessionsDir());
  return Response.json({ sessions });
}
