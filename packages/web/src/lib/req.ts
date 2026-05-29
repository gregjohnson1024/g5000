/**
 * Shared request-body parsing for POST/PUT route handlers.
 *
 * Many handlers repeat the same `try { body = await req.json() } catch { return 400 }`
 * boilerplate. `parseJsonBody` collapses that into one call while preserving the
 * exact 400 envelope each handler produced before.
 *
 * The standard 400 envelope is `{ ok: false, error: { kind?, message } }` with
 * `message: 'invalid JSON'`. Two variants exist in the codebase and both are
 * supported here, byte-for-byte:
 *   - with kind:    `{ ok: false, error: { kind: 'bad_request', message: 'invalid JSON' } }`
 *   - without kind: `{ ok: false, error: { message: 'invalid JSON' } }`
 *
 * Pass the `kind` argument to get the first form; omit it for the second. The
 * helper owns the `Response.json(...)` construction so the call site is just a
 * parse + early-return on failure.
 *
 * NOTE: Routes whose 400 uses a different envelope (e.g. `{ error: 'invalid JSON' }`
 * or a string `error`) are intentionally NOT migrated to this helper — converting
 * them would change client-visible bytes.
 */
export type JsonParseResult<T> = { ok: true; body: T } | { ok: false; response: Response };

export async function parseJsonBody<T>(req: Request, kind?: string): Promise<JsonParseResult<T>> {
  try {
    return { ok: true, body: (await req.json()) as T };
  } catch {
    const error = kind ? { kind, message: 'invalid JSON' } : { message: 'invalid JSON' };
    return { ok: false, response: Response.json({ ok: false, error }, { status: 400 }) };
  }
}
