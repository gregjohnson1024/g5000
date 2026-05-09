import { describe, it, expect, beforeEach } from 'vitest';
import { Bus, Channels, type Sample } from '@h6000/core';
import { runBridge } from './bridge.js';
import { Ngt1Driver, type Ngt1Source } from './ngt-driver.js';

class MemorySource implements Ngt1Source {
  private listener: ((c: Buffer) => void) | null = null;
  on(event: 'data', cb: (c: Buffer) => void) {
    if (event === 'data') this.listener = cb;
    return this;
  }
  off() {
    this.listener = null;
    return this;
  }
  emit(text: string) {
    this.listener?.(Buffer.from(text, 'utf8'));
  }
}

describe('runBridge', () => {
  let bus: Bus;
  let source: MemorySource;
  let driver: Ngt1Driver;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    bus = new Bus();
    source = new MemorySource();
    driver = new Ngt1Driver({ source });
    stop = await runBridge({ bus, drivers: [driver] });
  });

  it('publishes wind samples to the bus when an NGT-1 line arrives', async () => {
    const received: Sample[] = [];
    bus.subscribe('wind.**', (s) => received.push(s));

    source.emit('2024-01-01-12:00:00.000,2,130306,17,255,8,a0,16,02,fe,7f,02,fa,fa\n');

    // Allow the RxJS chain to settle.
    await new Promise((r) => setTimeout(r, 10));

    expect(received.length).toBeGreaterThan(0);
    const channels = new Set(received.map((s) => s.channel));
    expect(channels.has(Channels.Wind.ApparentAngle)).toBe(true);
    expect(channels.has(Channels.Wind.ApparentSpeed)).toBe(true);

    await stop();
  });
});
