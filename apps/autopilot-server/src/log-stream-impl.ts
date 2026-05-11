import { format } from 'node:util';
import {
  setLogStream,
  type LogEntry,
  type LogLevel,
  type LogStream,
} from '@g5000/core';

const MAX_BUFFER = 500;

interface InternalImpl extends LogStream {
  /** Test helper: restore the original `console.log/warn/error` methods. */
  _uninstall(): void;
  /** Test helper: clear the ring buffer and subscribers. */
  _clear(): void;
}

/**
 * Install a console wrapper that captures `console.log/warn/error` into a
 * 500-entry ring buffer and fans out new entries to subscribers. Original
 * console methods are still invoked so stdout/stderr keep working.
 *
 * Registers the resulting LogStream via setLogStream(). Safe to call once.
 */
export function installLogStream(): LogStream {
  const buffer: LogEntry[] = [];
  const subscribers = new Set<(entry: LogEntry) => void>();

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  const push = (level: LogLevel, args: unknown[]): void => {
    const entry: LogEntry = {
      t: Date.now(),
      level,
      message: format(...(args as Parameters<typeof format>)),
    };
    buffer.push(entry);
    if (buffer.length > MAX_BUFFER) {
      // Drop oldest. shift() is O(n) but n is small (capped at 500) and
      // pushes are infrequent enough that this never matters.
      buffer.shift();
    }
    for (const sub of subscribers) {
      try {
        sub(entry);
      } catch {
        /* never let a misbehaving subscriber break logging */
      }
    }
  };

  // Monkey-patch. We re-bind the originals back to `console` so anything
  // that captured them before this point (unlikely) still works.
  console.log = (...args: unknown[]): void => {
    push('info', args);
    originalLog(...args);
  };
  console.warn = (...args: unknown[]): void => {
    push('warn', args);
    originalWarn(...args);
  };
  console.error = (...args: unknown[]): void => {
    push('error', args);
    originalError(...args);
  };

  const impl: InternalImpl = {
    getRecent(limit = MAX_BUFFER): LogEntry[] {
      if (limit >= buffer.length) return buffer.slice();
      return buffer.slice(buffer.length - limit);
    },
    subscribe(handler) {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },
    _uninstall(): void {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    },
    _clear(): void {
      buffer.length = 0;
      subscribers.clear();
    },
  };

  setLogStream(impl);
  return impl;
}
