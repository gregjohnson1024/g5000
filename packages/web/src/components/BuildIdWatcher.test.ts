import { describe, expect, it } from 'vitest';
import { shouldReloadForBuildId } from './BuildIdWatcher';

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
