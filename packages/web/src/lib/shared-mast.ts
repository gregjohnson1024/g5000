import type { MastRuntime } from '@g5000/mast';

// Store the singleton on globalThis so that module re-evaluations within the
// same process (e.g. Next.js / Turbopack loading the package a second time)
// still resolve the instance set by g5000 app during boot.
const GLOBAL_KEY = '__g5000_mastRuntime__';

declare global {
  // eslint-disable-next-line no-var
  var __g5000_mastRuntime__: MastRuntime | undefined;
}

/**
 * Returns the process-wide shared MastRuntime. Throws if not yet set.
 * Set by g5000 app during boot via `setSharedMastRuntime`.
 */
export function getSharedMastRuntime(): MastRuntime {
  const runtime = globalThis[GLOBAL_KEY];
  if (!runtime) {
    throw new Error(
      'MastRuntime not initialized — g5000 app must call setSharedMastRuntime() during boot',
    );
  }
  return runtime;
}

export function setSharedMastRuntime(runtime: MastRuntime): void {
  globalThis[GLOBAL_KEY] = runtime;
}
