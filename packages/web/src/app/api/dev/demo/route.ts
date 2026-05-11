export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return Response.json({ demoMode: process.env.DEMO_MODE === '1' });
}
