/**
 * Stale-build (version-skew) error detection + one-shot recovery.
 *
 * After a deploy, browsers that were already open hold prefetched RSC
 * payloads and chunk URLs from the previous build. Next 16's segment cache
 * serves those navigations without touching the server (its build-id
 * self-heal only runs on live fetches), so React imports a content-hashed
 * chunk that no longer exists on disk → ChunkLoadError → the built-in
 * "This page couldn't load" screen. The fix is a hard reload, which pulls
 * the new document and chunk manifest; these helpers let the error
 * boundaries do that automatically exactly once.
 */

const RELOAD_KEY = 'g5000:stale-build-reload';
/** Minimum gap between automatic reloads — guards against a reload loop
 *  when the server is genuinely broken rather than just redeployed. */
const RELOAD_WINDOW_MS = 30_000;

/** Client-side loader failures that a hard reload fixes. Server errors
 *  carry a digest and are never chunk-staleness — exclude them. */
export function isStaleBuildError(error: {
  name?: string;
  message?: string;
  digest?: string;
}): boolean {
  if (error.digest) return false;
  if (error.name === 'ChunkLoadError') return true;
  const m = error.message ?? '';
  return (
    /Loading chunk [\w-]+ failed/.test(m) ||
    /Loading CSS chunk/.test(m) ||
    /Failed to fetch dynamically imported module/.test(m)
  );
}

/**
 * Hard-reload if we haven't just done so. Returns true when a reload was
 * initiated (callers can render a quiet "reloading…" state instead of the
 * error card).
 */
export function attemptStaleBuildReload(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage unavailable (private mode) — reload anyway; the boat
    // UI being stuck is worse than a rare double reload.
  }
  window.location.reload();
  return true;
}
