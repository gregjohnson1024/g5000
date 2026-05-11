import { describe, it, expect, afterEach } from 'vitest';
import { _resetLogStreamForTests, type LogEntry } from '@g5000/core';
import { installLogStream } from './log-stream-impl.js';

// Cast back to the internal impl so we can call `_uninstall` / `_clear` in tests.
interface TestImpl {
  getRecent(limit?: number): LogEntry[];
  subscribe(handler: (e: LogEntry) => void): () => void;
  _uninstall(): void;
  _clear(): void;
}

let installed: TestImpl | null = null;

afterEach(() => {
  installed?._uninstall();
  installed = null;
  _resetLogStreamForTests();
});

describe('installLogStream', () => {
  it('captures console.log output into the ring buffer', () => {
    installed = installLogStream() as TestImpl;
    console.log('hello', 'world', 42);
    const recent = installed.getRecent();
    expect(recent.length).toBe(1);
    expect(recent[0].level).toBe('info');
    expect(recent[0].message).toBe('hello world 42');
  });

  it('captures console.warn and console.error with the right levels', () => {
    installed = installLogStream() as TestImpl;
    console.warn('careful');
    console.error('boom');
    const recent = installed.getRecent();
    expect(recent.map((e) => e.level)).toEqual(['warn', 'error']);
    expect(recent.map((e) => e.message)).toEqual(['careful', 'boom']);
  });

  it('drops oldest when the ring buffer exceeds 500 entries', () => {
    installed = installLogStream() as TestImpl;
    for (let i = 0; i < 600; i++) console.log(`line ${i}`);
    const recent = installed.getRecent();
    expect(recent.length).toBe(500);
    expect(recent[0].message).toBe('line 100');
    expect(recent[recent.length - 1].message).toBe('line 599');
  });

  it('delivers new entries to subscribers', () => {
    installed = installLogStream() as TestImpl;
    const received: LogEntry[] = [];
    const unsub = installed.subscribe((e) => received.push(e));
    console.log('one');
    console.warn('two');
    unsub();
    expect(received.length).toBe(2);
    expect(received[0].message).toBe('one');
    expect(received[1].level).toBe('warn');
  });

  it('subscribers can unsubscribe and stop receiving entries', () => {
    installed = installLogStream() as TestImpl;
    const received: LogEntry[] = [];
    const unsub = installed.subscribe((e) => received.push(e));
    console.log('before');
    unsub();
    console.log('after');
    expect(received.length).toBe(1);
    expect(received[0].message).toBe('before');
  });

  it('getRecent(N) returns the most-recent N entries, oldest first', () => {
    installed = installLogStream() as TestImpl;
    for (let i = 0; i < 10; i++) console.log(`m${i}`);
    const recent = installed.getRecent(3);
    expect(recent.map((e) => e.message)).toEqual(['m7', 'm8', 'm9']);
  });

  it('formats objects the same way util.format does', () => {
    installed = installLogStream() as TestImpl;
    console.log({ a: 1, b: 'x' });
    const [entry] = installed.getRecent();
    expect(entry.message).toContain("a: 1");
    expect(entry.message).toContain("b: 'x'");
  });
});
