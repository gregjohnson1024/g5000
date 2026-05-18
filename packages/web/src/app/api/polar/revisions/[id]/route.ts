import { getSharedConfigStore } from '@g5000/db';

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: Context): Promise<Response> {
  const { id } = await ctx.params;
  const store = getSharedConfigStore();
  const revision = store.getRevision(id);
  if (!revision) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ revision });
}
