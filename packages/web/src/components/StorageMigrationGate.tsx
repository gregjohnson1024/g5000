'use client';

import { useEffect } from 'react';
import { migrateLegacyStorage } from '../lib/storage';

/**
 * Null-rendering client component that runs the one-time localStorage migration
 * shim on first mount. Mount it high in the component tree (layout.tsx) so it
 * runs before any page code reads localStorage.
 *
 * The shim itself is idempotent — safe to call every page load; it returns early
 * once the g5000:__migrated_v1 sentinel is present.
 *
 * Renders nothing; exists purely for its side-effect.
 */
export function StorageMigrationGate(): null {
  useEffect(() => {
    migrateLegacyStorage();
  }, []);

  return null;
}
