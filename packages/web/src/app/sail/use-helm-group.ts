'use client';

import { useCallback, useEffect, useState } from 'react';
import { normalizeGroup, DEFAULT_GROUP, STORAGE_KEY, type HelmGroup } from './helm-group';

/**
 * Persisted active helm group. SSR renders DEFAULT_GROUP, then hydrates to the
 * stored value in an effect (guarded for `window`), so `next build`/SSR never
 * touches localStorage during render.
 */
export function useHelmGroup(): [HelmGroup, (g: HelmGroup) => void] {
  const [group, setGroupState] = useState<HelmGroup>(DEFAULT_GROUP);

  useEffect(() => {
    try {
      setGroupState(normalizeGroup(window.localStorage.getItem(STORAGE_KEY)));
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, []);

  const setGroup = useCallback((g: HelmGroup) => {
    setGroupState(g);
    try {
      window.localStorage.setItem(STORAGE_KEY, g);
    } catch {
      /* ignore persistence failure */
    }
  }, []);

  return [group, setGroup];
}
