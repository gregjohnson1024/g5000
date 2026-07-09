import { afterEach, describe, expect, it, vi } from 'vitest';

// HIT_MISS_CACHE_CONTROL is computed at module load from NODE_ENV, so each
// branch needs a fresh module registry + stubbed env before the dynamic import.
// The route char tests compare against the exported constant, which under
// vitest (NODE_ENV=test) resolves to 'no-store' on both sides — these tests
// are what pin the actual production value.

describe('HIT_MISS_CACHE_CONTROL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is a 30-day public cache in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { HIT_MISS_CACHE_CONTROL } = await import('./tile-proxy');
    expect(HIT_MISS_CACHE_CONTROL).toBe('public, max-age=2592000');
  });

  it('is no-store in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const { HIT_MISS_CACHE_CONTROL } = await import('./tile-proxy');
    expect(HIT_MISS_CACHE_CONTROL).toBe('no-store');
  });

  it('is no-store under vitest (NODE_ENV=test)', async () => {
    vi.resetModules();
    const { HIT_MISS_CACHE_CONTROL } = await import('./tile-proxy');
    expect(HIT_MISS_CACHE_CONTROL).toBe('no-store');
  });
});
