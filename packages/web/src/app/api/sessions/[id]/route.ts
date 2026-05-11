import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { summarizeSession } from '@g5000/bridge';
import { sessionsDir } from '../dir.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

function safePath(id: string): string {
  if (id.includes('/') || id.includes('..') || id.length === 0) {
    throw new Error('invalid session id');
  }
  return path.join(sessionsDir(), `${id}.jsonl.gz`);
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  try {
    const summary = await summarizeSession(safePath(id));
    return Response.json(summary);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  try {
    await unlink(safePath(id));
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    );
  }
}
