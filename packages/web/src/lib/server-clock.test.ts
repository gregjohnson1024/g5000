import { describe, expect, it } from 'vitest';
import { getServerClock } from './server-clock';
import { UTC_CLOCK } from './tz';

describe('getServerClock', () => {
  it('degrades to UTC when the shared ConfigStore is not initialised', () => {
    // Under vitest no g5000-app boot has run, so getSharedConfigStore()
    // throws — the resolver must fall back to plain UTC, never guess.
    expect(getServerClock()).toEqual(UTC_CLOCK);
  });
});
