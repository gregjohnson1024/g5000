import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setSharedChannelHistory,
  _resetChannelHistoryForTests,
  type ChannelHistory,
  type ChannelHistorySnapshot,
} from '@g5000/core';
import { GET } from './route';

/** A stub ChannelHistory that records the args it was called with. */
function makeStub(snapshot: ChannelHistorySnapshot): {
  history: ChannelHistory;
  calls: { windowMs?: number; channels?: string[] }[];
} {
  const calls: { windowMs?: number; channels?: string[] }[] = [];
  const history: ChannelHistory = {
    snapshot(windowMs, channels) {
      calls.push({ windowMs, channels });
      return snapshot;
    },
  };
  return { history, calls };
}

beforeEach(() => {
  _resetChannelHistoryForTests();
});

afterEach(() => {
  _resetChannelHistoryForTests();
});

describe('wind-diag/history route — empty singleton', () => {
  it('returns an empty series with the requested window when the tracker is absent', async () => {
    const res = await GET(new Request('http://x/api/wind-diag/history?windowMs=60000'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChannelHistorySnapshot;
    expect(body).toEqual({ windowMs: 60000, series: [] });
  });

  it('defaults windowMs to 300000 when the param is omitted (tracker absent)', async () => {
    const res = await GET(new Request('http://x/api/wind-diag/history'));
    const body = (await res.json()) as ChannelHistorySnapshot;
    expect(body).toEqual({ windowMs: 300000, series: [] });
  });
});

describe('wind-diag/history route — populated singleton', () => {
  it('returns the tracker snapshot and forwards windowMs', async () => {
    const snapshot: ChannelHistorySnapshot = {
      windowMs: 120000,
      series: [
        {
          channel: 'wind.true.direction',
          source: 'computed:true_wind',
          points: [
            { tMs: 1000, v: 3.14 },
            { tMs: 2000, v: 3.2 },
          ],
        },
      ],
    };
    const { history, calls } = makeStub(snapshot);
    setSharedChannelHistory(history);

    const res = await GET(new Request('http://x/api/wind-diag/history?windowMs=120000'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChannelHistorySnapshot;
    expect(body).toEqual(snapshot);
    expect(calls).toEqual([{ windowMs: 120000, channels: undefined }]);
  });

  it('splits and trims the channels CSV and passes it through', async () => {
    const { history, calls } = makeStub({ windowMs: 300000, series: [] });
    setSharedChannelHistory(history);

    await GET(
      new Request(
        'http://x/api/wind-diag/history?channels=wind.true.angle%2C%20wind.true.direction%2C%20boat.heading.magnetic',
      ),
    );
    expect(calls).toEqual([
      {
        windowMs: 300000,
        channels: ['wind.true.angle', 'wind.true.direction', 'boat.heading.magnetic'],
      },
    ]);
  });

  it('treats an empty channels param as no filter (undefined)', async () => {
    const { history, calls } = makeStub({ windowMs: 300000, series: [] });
    setSharedChannelHistory(history);

    await GET(new Request('http://x/api/wind-diag/history?channels='));
    expect(calls).toEqual([{ windowMs: 300000, channels: undefined }]);
  });
});
