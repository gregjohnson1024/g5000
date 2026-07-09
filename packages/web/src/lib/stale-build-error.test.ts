import { describe, expect, it } from 'vitest';
import { isStaleBuildError } from './stale-build-error';

describe('isStaleBuildError', () => {
  it('matches webpack ChunkLoadError by name regardless of message', () => {
    expect(isStaleBuildError({ name: 'ChunkLoadError', message: 'whatever' })).toBe(true);
  });

  it('matches chunk / CSS-chunk / dynamic-import failure messages', () => {
    expect(
      isStaleBuildError({
        name: 'Error',
        message: 'Loading chunk 4523 failed. (error: http://x/_next/static/chunks/4523-ab12.js)',
      }),
    ).toBe(true);
    expect(isStaleBuildError({ name: 'Error', message: 'Loading CSS chunk 91 failed' })).toBe(true);
    expect(
      isStaleBuildError({
        name: 'TypeError',
        message: 'Failed to fetch dynamically imported module: http://x/chunk.js',
      }),
    ).toBe(true);
  });

  it('never matches server errors (digest present)', () => {
    expect(
      isStaleBuildError({
        name: 'ChunkLoadError',
        message: 'Loading chunk 1 failed',
        digest: '123456',
      }),
    ).toBe(false);
  });

  it('does not match ordinary render errors', () => {
    expect(
      isStaleBuildError({ name: 'TypeError', message: 'Cannot read properties of null' }),
    ).toBe(false);
    expect(isStaleBuildError({})).toBe(false);
  });
});
