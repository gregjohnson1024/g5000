export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  /** Time the entry was captured, in ms since epoch. */
  t: number;
  level: LogLevel;
  /** Already joined to a single string (like Node's console does). */
  message: string;
}

export interface LogStream {
  /** Return up to `limit` most-recent entries, oldest first. */
  getRecent(limit?: number): LogEntry[];
  /** Subscribe to live entries. Returns unsubscribe. */
  subscribe(handler: (entry: LogEntry) => void): () => void;
}

declare const globalThis: { __g5000_logStream__?: LogStream };

export function getLogStream(): LogStream | undefined {
  return globalThis.__g5000_logStream__;
}

export function setLogStream(s: LogStream): void {
  globalThis.__g5000_logStream__ = s;
}

export function _resetLogStreamForTests(): void {
  globalThis.__g5000_logStream__ = undefined;
}
