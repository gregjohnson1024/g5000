import path from 'node:path';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { sessionsDir } from '../../dir.js';

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
  let filePath: string;
  try {
    filePath = safePath(id);
    await stat(filePath);
  } catch {
    return new Response('not found', { status: 404 });
  }
  const stream = createReadStream(filePath) as unknown as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${id}.jsonl.gz"`,
    },
  });
}
