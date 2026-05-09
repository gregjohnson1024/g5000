import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import {
  SerialPort0183Driver,
  type Sentence0183Source,
} from './serial-driver.js';

class MemorySource implements Sentence0183Source {
  private listener: ((c: Buffer) => void) | null = null;
  on(event: 'data', cb: (c: Buffer) => void): this {
    if (event === 'data') this.listener = cb;
    return this;
  }
  off(): this {
    this.listener = null;
    return this;
  }
  emit(text: string): void {
    this.listener?.(Buffer.from(text, 'utf8'));
  }
}

describe('SerialPort0183Driver', () => {
  let source: MemorySource;
  let driver: SerialPort0183Driver;

  beforeEach(async () => {
    source = new MemorySource();
    driver = new SerialPort0183Driver({ source, port: 1 });
    await driver.start();
  });

  it('emits one Raw0183Sentence per line received', async () => {
    const promised = firstValueFrom(driver.rx0183);
    source.emit('$WIMWV,212.6,R,5.8,N,A*54\r\n');
    const sentence = await promised;
    expect(sentence.text).toBe('$WIMWV,212.6,R,5.8,N,A*54');
    expect(sentence.port).toBe(1);
    expect(sentence.rxTimestamp).toBeTypeOf('bigint');
  });

  it('strips trailing CR but keeps the line otherwise verbatim', async () => {
    const promised = firstValueFrom(driver.rx0183);
    source.emit('$HCHDG,98.3,1.2,W,5.6,E*32\n');
    const sentence = await promised;
    expect(sentence.text).toBe('$HCHDG,98.3,1.2,W,5.6,E*32');
  });

  it('handles split chunks across the newline boundary', async () => {
    const collected = firstValueFrom(driver.rx0183.pipe(take(2), toArray()));
    source.emit('$WIMWV,212.6,R,5');
    source.emit('.8,N,A*54\n$HCHDG,98.3,1.2,W,5.6,E*32\n');
    const out = await collected;
    expect(out.map((s) => s.text)).toEqual([
      '$WIMWV,212.6,R,5.8,N,A*54',
      '$HCHDG,98.3,1.2,W,5.6,E*32',
    ]);
  });

  it('exposes EMPTY rxCan and throwing txCan', async () => {
    const seen: unknown[] = [];
    const sub = driver.rxCan.subscribe((f) => seen.push(f));
    source.emit('$WIMWV,212.6,R,5.8,N,A*54\n');
    await new Promise((r) => setTimeout(r, 5));
    sub.unsubscribe();
    expect(seen).toHaveLength(0);

    await expect(
      driver.txCan({
        id: 0,
        ext: true,
        data: new Uint8Array(),
        rxTimestamp: 0n,
      }),
    ).rejects.toThrow();
  });
});
