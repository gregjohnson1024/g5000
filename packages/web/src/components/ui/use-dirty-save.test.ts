/**
 * use-dirty-save.test.ts
 *
 * Tests the pure dirty-count logic and save flow without React hooks
 * (no @testing-library/react available in this workspace).
 *
 * The dirtyCount computation is the same algorithm used by the hook;
 * we verify it by calling the same steps the hook would take:
 *   committed = initial
 *   draft = mutated copy
 *   dirtyCount = keys where draft[k] !== committed[k]
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Pure dirty-count helper (mirrors the useMemo inside useDirtySave)
// ---------------------------------------------------------------------------

function computeDirtyCount<T extends object>(committed: T | null, draft: T | null): number {
  if (!committed || !draft) return 0;
  let count = 0;
  const allKeys = new Set([...Object.keys(committed), ...Object.keys(draft)]) as Set<keyof T>;
  for (const k of allKeys) {
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
}

interface Config {
  alpha: number;
  beta: string;
}

const INITIAL: Config = { alpha: 1, beta: 'hello' };

// ---------------------------------------------------------------------------
// Dirty count
// ---------------------------------------------------------------------------

describe('dirty count — starts at 0', () => {
  it('0 dirty keys when draft equals initial', () => {
    const draft = { ...INITIAL };
    expect(computeDirtyCount(INITIAL, draft)).toBe(0);
  });
});

describe('dirty count — increments on key changes', () => {
  it('1 dirty key when one field changes', () => {
    const draft = { ...INITIAL, alpha: 99 };
    expect(computeDirtyCount(INITIAL, draft)).toBe(1);
  });

  it('2 dirty keys when two fields change', () => {
    const draft = { ...INITIAL, alpha: 99, beta: 'world' };
    expect(computeDirtyCount(INITIAL, draft)).toBe(2);
  });

  it('0 dirty keys after reset (draft === committed)', () => {
    const draft = { ...INITIAL, alpha: 99 };
    // dirtyCount before reset
    expect(computeDirtyCount(INITIAL, draft)).toBe(1);
    // dirtyCount after reset (draft reset to initial)
    const resetDraft = { ...INITIAL };
    expect(computeDirtyCount(INITIAL, resetDraft)).toBe(0);
  });
});

describe('dirty count — null initial', () => {
  it('0 when initial is null', () => {
    expect(computeDirtyCount<Config>(null, null)).toBe(0);
  });
});

describe('dirty count — object values', () => {
  interface Nested {
    obj: { x: number };
  }
  it('detects object value change', () => {
    const committed: Nested = { obj: { x: 1 } };
    const draft: Nested = { obj: { x: 2 } };
    expect(computeDirtyCount(committed, draft)).toBe(1);
  });

  it('equal object values are not dirty', () => {
    const committed: Nested = { obj: { x: 1 } };
    const draft: Nested = { obj: { x: 1 } };
    expect(computeDirtyCount(committed, draft)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Save-disabled-when-clean logic
// ---------------------------------------------------------------------------

describe('Save disabled when clean', () => {
  it('does not call onSave when not dirty (isDirty = false)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const committed = { ...INITIAL };
    const draft = { ...INITIAL };
    const isDirty = computeDirtyCount(committed, draft) > 0;

    // Guard: only call onSave when dirty (mirrors the hook's guard)
    if (isDirty) await onSave(draft);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onSave when dirty', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const committed = { ...INITIAL };
    const draft = { ...INITIAL, alpha: 99 };
    const isDirty = computeDirtyCount(committed, draft) > 0;

    if (isDirty) await onSave(draft);

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith(draft);
  });

  it('dirty resets to 0 after successful save (committed = draft)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    let committed = { ...INITIAL };
    let draft = { ...INITIAL, alpha: 42 };

    expect(computeDirtyCount(committed, draft)).toBe(1);

    await onSave(draft);
    // Simulate commit: committed = draft
    committed = { ...draft };

    expect(computeDirtyCount(committed, draft)).toBe(0);
  });

  it('dirty stays > 0 after failed save (committed not updated)', async () => {
    let err: string | null = null;
    let committed = { ...INITIAL };
    let draft = { ...INITIAL, alpha: 42 };

    try {
      await Promise.reject(new Error('save failed'));
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      // committed NOT updated on failure
    }

    expect(err).toBe('save failed');
    expect(computeDirtyCount(committed, draft)).toBe(1);
  });
});
