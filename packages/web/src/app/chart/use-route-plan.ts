import { useState, useCallback } from 'react';
import * as rp from '../../lib/route-plan';

export interface RoutePlan {
  ids: string[];
  /** Bulk-replace escape hatch — used when loading a saved route (all ids at once). */
  setIds: (ids: string[]) => void;
  append: (id: string) => void;
  removeId: (id: string) => void;
  insertAt: (index: number, id: string) => void;
  setStart: (id: string) => void;
  setEnd: (id: string) => void;
  clear: () => void;
}

/** Single source of truth for the in-progress route's ordered waypoint IDs. */
export function useRoutePlan(): RoutePlan {
  const [ids, setIds] = useState<string[]>([]);
  return {
    ids,
    setIds,
    append: useCallback((id) => setIds((cur) => rp.append(cur, id)), []),
    removeId: useCallback((id) => setIds((cur) => rp.removeId(cur, id)), []),
    insertAt: useCallback((index, id) => setIds((cur) => rp.insertAt(cur, index, id)), []),
    setStart: useCallback((id) => setIds((cur) => rp.setStart(cur, id)), []),
    setEnd: useCallback((id) => setIds((cur) => rp.setEnd(cur, id)), []),
    clear: useCallback(() => setIds([]), []),
  };
}
