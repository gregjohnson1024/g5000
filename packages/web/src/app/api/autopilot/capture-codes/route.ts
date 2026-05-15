import { readCaptureCodes } from '@g5000/bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/autopilot/capture-codes — returns the contents of the
 * AP-TX capture-codes file (~/.g5000-router/ap-tx-codes.json) so the
 * /autopilot UI can grey out buttons whose Triton-captured frames
 * haven't been hand-added to the file yet.
 *
 * Returns an empty captures object when the file is missing or
 * unparseable. Always 200 — this is a UI hint, not an action.
 */
export async function GET(): Promise<Response> {
  const codes = await readCaptureCodes();
  return Response.json(codes);
}
