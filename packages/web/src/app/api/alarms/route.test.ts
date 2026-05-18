import { describe, it, expect, beforeEach } from 'vitest';
import { createAlarmsRegistry, setSharedAlarms, _resetAlarmsForTests } from '@g5000/core';
import { GET, POST, PATCH } from './route.js';

describe('/api/alarms', () => {
  beforeEach(() => {
    _resetAlarmsForTests();
    setSharedAlarms(createAlarmsRegistry());
  });

  it('GET returns empty active + all', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.active).toEqual([]);
    expect(body.all).toEqual([]);
  });

  it('POST /api/alarms { id: "mob", action: "fire" } fires a sticky MOB alarm', async () => {
    const req = new Request('http://test/api/alarms', {
      method: 'POST',
      body: JSON.stringify({ id: 'mob', action: 'fire', context: { lat: 32.3, lon: -64.8 } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const list = await (await GET()).json();
    expect(list.active).toHaveLength(1);
    expect(list.active[0].id).toBe('mob');
    expect(list.active[0].sticky).toBe(true);
  });

  it('POST rejects fire of non-MOB ids (only MOB is manually fireable)', async () => {
    const req = new Request('http://test/api/alarms', {
      method: 'POST',
      body: JSON.stringify({ id: 'shallow-water', action: 'fire' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('PATCH { id, action: "ack" } acks an alarm', async () => {
    const fireReq = new Request('http://test/api/alarms', {
      method: 'POST',
      body: JSON.stringify({ id: 'mob', action: 'fire' }),
    });
    await POST(fireReq);

    const ackReq = new Request('http://test/api/alarms', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'mob', action: 'ack' }),
    });
    const res = await PATCH(ackReq);
    expect(res.status).toBe(200);

    const list = await (await GET()).json();
    expect(list.active).toHaveLength(0);
  });
});
