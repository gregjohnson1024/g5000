'use client';

/**
 * boat-status.ts — client-side hook for the /api/boat-status endpoint.
 *
 * Fetches structured status for the three card groups on the /boat hub page.
 * Degrades honestly: unknown/offline fields show '—', never a fake 0.
 */

import { useCallback, useEffect, useState } from 'react';
import type { BoatStatusResponse, BoatStatusCard } from '../api/boat-status/route';

export type { BoatStatusResponse, BoatStatusCard };

export type BoatStatusState =
  | { status: 'loading' }
  | { status: 'ok'; data: BoatStatusResponse }
  | { status: 'error'; message: string };

/** Fetch the boat hub status once on mount. No polling — data is coarse-grained. */
export function useBoatStatus(): BoatStatusState {
  const [state, setState] = useState<BoatStatusState>({ status: 'loading' });

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch('/api/boat-status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as BoatStatusResponse;
      setState({ status: 'ok', data });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void fetch_();
  }, [fetch_]);

  return state;
}
