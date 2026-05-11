import { describe, it, expect, beforeEach } from 'vitest';
import { Bus, Channels, type Sample } from '@g5000/core';
import { runBridge } from './bridge.js';
import { Ngt1Driver, type Ngt1Source } from './ngt-driver.js';
import { SerialPort0183Driver, type Sentence0183Source } from './nmea0183/serial-driver.js';

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

class Memory0183Source implements Sentence0183Source {
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

describe('runBridge — 0183 path', () => {
  it('publishes wind samples to the bus when an MWV sentence arrives', async () => {
    const bus = new Bus();
    const source = new Memory0183Source();
    const driver = new SerialPort0183Driver({ source, port: 0 });
    const stop = await runBridge({ bus, drivers: [driver] });

    const received: Sample[] = [];
    bus.subscribe('wind.**', (s) => received.push(s));

    // Use the verified checksum *29 (not *54 as the draft plan had).
    source.emit('$WIMWV,212.6,R,5.8,N,A*29\r\n');
    await new Promise((r) => setTimeout(r, 10));

    const channels = new Set(received.map((s) => s.channel));
    expect(channels.has(Channels.Wind.ApparentAngle)).toBe(true);
    expect(channels.has(Channels.Wind.ApparentSpeed)).toBe(true);

    await stop();
  });
});
