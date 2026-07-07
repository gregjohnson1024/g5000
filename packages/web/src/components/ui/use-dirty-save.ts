/**
 * use-dirty-save — Tier-1 hook.
 *
 * Generalises /damping's dirty-tracking into a reusable hook. Maintains
 * draft state, dirty detection, busy/error/ok state for async saves, and
 * a route-leave guard.
 *
 * Transport-agnostic: the caller supplies a `save(draft)` async function.
 *
 * Features (keep-list: /damping dirty-tracked save):
 *   - Dirty count (number of changed keys vs committed state)
 *   - Save button disabled when clean or busy
 *   - Route-leave guard via beforeunload (browser) — prevents accidental
 *     navigation with unsaved changes
 *   - Commit on success: sets committed = draft so dirty resets to 0
 *
 * Usage:
 *   const { draft, setDraft, dirtyCount, busy, err, ok, save, reset } =
 *     useDirtySave({ initial: cfg, onSave: async (d) => PUT(d) });
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseDirtySaveOptions<T extends object> {
  /** The committed (server) state — changes from this are "dirty". */
  initial: T | null;
  /**
   * Async save function. Called with the current draft.
   * Should throw on failure.
   */
  onSave: (draft: T) => Promise<void>;
  /** How long to show the "Saved" ok state (ms). Default 2000. */
  okDurationMs?: number;
}

export interface UseDirtySaveResult<T extends object> {
  /** Current draft state */
  draft: T | null;
  /** Set the entire draft (replaces). Also available: setDraftKey for partial updates. */
  setDraft: (draft: T) => void;
  /** Set a single key on the draft (type-safe) */
  setDraftKey: <K extends keyof T>(key: K, value: T[K]) => void;
  /** Number of keys that differ from the committed state */
  dirtyCount: number;
  /** True if any key is dirty */
  isDirty: boolean;
  /** True while the save is in flight */
  busy: boolean;
  /** Error message from the last save attempt, or null */
  err: string | null;
  /** True for okDurationMs after a successful save */
  ok: boolean;
  /** Trigger a save. No-op if clean or busy. */
  save: () => Promise<void>;
  /** Reset draft to committed state (discards unsaved changes) */
  reset: () => void;
}

export function useDirtySave<T extends object>({
  initial,
  onSave,
  okDurationMs = 2000,
}: UseDirtySaveOptions<T>): UseDirtySaveResult<T> {
  const [committed, setCommitted] = useState<T | null>(initial);
  const [draft, setDraftState] = useState<T | null>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const okTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update committed + draft when initial changes (e.g. data reloaded from server)
  useEffect(() => {
    setCommitted(initial);
    setDraftState(initial);
  }, [initial]);

  const setDraft = useCallback((next: T) => {
    setDraftState(next);
    setErr(null);
  }, []);

  const setDraftKey = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setDraftState((prev) => {
      if (!prev) return prev;
      return { ...prev, [key]: value };
    });
    setErr(null);
  }, []);

  // Dirty detection: count keys where draft differs from committed
  const dirtyCount = useMemo(() => {
    if (!committed || !draft) return 0;
    let count = 0;
    const allKeys = new Set([...Object.keys(committed), ...Object.keys(draft)]) as Set<keyof T>;
    for (const k of allKeys) {
      // Deep-equal for primitives. For objects, JSON comparison (simple).
      const cv = committed[k];
      const dv = draft[k];
      if (cv !== dv) {
        if (typeof cv === 'object' || typeof dv === 'object') {
          if (JSON.stringify(cv) !== JSON.stringify(dv)) count++;
        } else {
          count++;
        }
      }
    }
    return count;
  }, [committed, draft]);

  const isDirty = dirtyCount > 0;

  // Route-leave guard (browser beforeunload)
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const save = useCallback(async () => {
    if (!draft || busy || !isDirty) return;
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      await onSave(draft);
      setCommitted(draft);
      setOk(true);
      if (okTimerRef.current) clearTimeout(okTimerRef.current);
      okTimerRef.current = setTimeout(() => setOk(false), okDurationMs);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, isDirty, onSave, okDurationMs]);

  const reset = useCallback(() => {
    setDraftState(committed);
    setErr(null);
    setOk(false);
  }, [committed]);

  return { draft, setDraft, setDraftKey, dirtyCount, isDirty, busy, err, ok, save, reset };
}
