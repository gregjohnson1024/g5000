'use client';

/**
 * SseStoreProvider — owns the lifetime of the single app-wide EventSource.
 *
 * The actual store lives in `lib/sse-store.ts` as a module-level singleton so
 * consumers can use `useSyncExternalStore` and re-render only when the slice
 * they select changes (see that file for the perf rationale). This provider is
 * therefore LIFECYCLE-ONLY: it holds no React state and never re-renders its
 * children — it just opens the connection on mount (ref-counted) and closes it
 * on unmount.
 *
 * Kept as a component (rather than a bare import) so mounting/unmounting is tied
 * to the React tree and StrictMode's double-invoke is handled by the ref count.
 */

import { useEffect, type ReactNode } from 'react';
import { connect } from '../lib/sse-store';

export type { SseStoreContextValue } from '../hooks/use-sse-store';

export function SseStoreProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // connect() returns a ref-counted disconnect fn.
    return connect();
  }, []);

  return <>{children}</>;
}
