import { describe, it, expect } from 'vitest';
import { buildUsagesUrl, buildChartUrl, createEmporiaClient } from './client.js';

const BASE = 'https://api.emporiaenergy.com';

describe('buildUsagesUrl', () => {
  it('produces the correct getDeviceListUsages URL with CSV gids', () => {
    const url = buildUsagesUrl([111, 112], '1S', '2026-07-06T12:00:00Z');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(BASE + '/AppAPI');
    expect(u.searchParams.get('apiMethod')).toBe('getDeviceListUsages');
    expect(u.searchParams.get('deviceGids')).toBe('111,112');
    expect(u.searchParams.get('instant')).toBe('2026-07-06T12:00:00Z');
    expect(u.searchParams.get('scale')).toBe('1S');
    expect(u.searchParams.get('energyUnit')).toBe('KilowattHours');
  });

  it('single device gid works', () => {
    const url = buildUsagesUrl([42], '1H', '2026-01-01T00:00:00Z');
    expect(new URL(url).searchParams.get('deviceGids')).toBe('42');
  });

  it('includes all required params with no extras unaccounted for', () => {
    const url = buildUsagesUrl([1], '1MIN', '2026-07-06T00:00:00Z');
    const params = [...new URL(url).searchParams.keys()].sort();
    expect(params).toEqual(['apiMethod', 'deviceGids', 'energyUnit', 'instant', 'scale'].sort());
  });
});

describe('buildChartUrl', () => {
  it('produces the correct getChartUsage URL with deviceGid + channel', () => {
    const url = buildChartUrl(111, '1', '1H', '2026-07-01T00:00:00Z', '2026-07-06T00:00:00Z');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(BASE + '/AppAPI');
    expect(u.searchParams.get('apiMethod')).toBe('getChartUsage');
    expect(u.searchParams.get('deviceGid')).toBe('111');
    expect(u.searchParams.get('channel')).toBe('1');
    expect(u.searchParams.get('start')).toBe('2026-07-01T00:00:00Z');
    expect(u.searchParams.get('end')).toBe('2026-07-06T00:00:00Z');
    expect(u.searchParams.get('scale')).toBe('1H');
    expect(u.searchParams.get('energyUnit')).toBe('KilowattHours');
  });

  it('uses deviceGid (singular) not deviceGids', () => {
    const url = buildChartUrl(99, '2', '1D', 'A', 'B');
    const u = new URL(url);
    expect(u.searchParams.get('deviceGid')).toBe('99');
    expect(u.searchParams.has('deviceGids')).toBe(false);
  });

  it('includes all required params with no extras unaccounted for', () => {
    const url = buildChartUrl(1, '1', '1S', 'A', 'B');
    const params = [...new URL(url).searchParams.keys()].sort();
    expect(params).toEqual(
      ['apiMethod', 'channel', 'deviceGid', 'end', 'energyUnit', 'scale', 'start'].sort(),
    );
  });
});

describe('createEmporiaClient — Node compat rejection check', () => {
  it('can be constructed and rejects getDevices() with an auth/network error, not a ReferenceError', async () => {
    const client = createEmporiaClient('x@x.com', 'wrongpass');
    let caught: unknown;
    try {
      await client.getDevices();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    // Must NOT be a browser-global crash
    const msg = caught instanceof Error ? caught.message : String(caught);
    expect(msg).not.toMatch(/navigator is not defined/i);
    expect(msg).not.toMatch(/window is not defined/i);
    expect(msg).not.toMatch(/document is not defined/i);
    // MUST be a real Cognito auth rejection (proves SRP ran in Node)
    const errorCode = (caught as any)?.code ?? (caught as any)?.name ?? '';
    expect(String(errorCode)).toMatch(
      /NotAuthorizedException|UserNotFoundException|InvalidParameterException/,
    );
  }, 30_000);
});
