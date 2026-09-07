import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markConverged, shouldReloadForBuildId, takeReloadBudget } from './BuildIdWatcher';

const OWN = '996eeca';

describe('shouldReloadForBuildId', () => {
  it('reloads when the server has moved to a different build', () => {
    expect(shouldReloadForBuildId(OWN, JSON.stringify('abc1234'))).toBe(true);
  });

  it('does not reload when the ids match', () => {
    expect(shouldReloadForBuildId(OWN, JSON.stringify(OWN))).toBe(false);
  });

  // Everything below is a "we cannot tell" case. On an unattended masthead
  // display a reload loop is worse than staleness, so all of them must be false.
  it('does not reload when this bundle has no id of its own', () => {
    expect(shouldReloadForBuildId(undefined, JSON.stringify('abc1234'))).toBe(false);
    expect(shouldReloadForBuildId('', JSON.stringify('abc1234'))).toBe(false);
  });

  it('does not reload when the server reports null', () => {
    expect(shouldReloadForBuildId(OWN, 'null')).toBe(false);
  });

  it('does not reload on a non-string payload', () => {
    for (const p of ['42', 'true', '{"a":1}', '["x"]']) {
      expect(shouldReloadForBuildId(OWN, p)).toBe(false);
    }
  });

  it('does not reload on malformed JSON', () => {
    expect(shouldReloadForBuildId(OWN, 'not json')).toBe(false);
    expect(shouldReloadForBuildId(OWN, '')).toBe(false);
  });
});

describe('reload budget', () => {
  // These exercise the exported helpers through sessionStorage, which is what
  // survives a reload — the counter has to accumulate ACROSS reloads or it
  // cannot bound a loop at all.
  const KEY = 'g5000:build-reload-budget';

  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('allows three non-converging reloads then stops', () => {
    expect(takeReloadBudget()).toBe(true);
    expect(takeReloadBudget()).toBe(true);
    expect(takeReloadBudget()).toBe(true);
    expect(takeReloadBudget()).toBe(false);
    expect(takeReloadBudget()).toBe(false);
  });

  it('converging resets the budget, so frequent real deploys never exhaust it', () => {
    takeReloadBudget();
    takeReloadBudget();
    markConverged();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(takeReloadBudget()).toBe(true);
  });

  it('allows reloads when storage is unavailable rather than blocking updates', () => {
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: () => {
          throw new Error('private mode');
        },
        setItem: () => {
          throw new Error('private mode');
        },
        removeItem: () => {
          throw new Error('private mode');
        },
      },
    });
    expect(takeReloadBudget()).toBe(true);
  });
});
