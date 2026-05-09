import { Subject } from 'rxjs';
import type { Sample, Channel } from './types.js';

/**
 * In-process pub/sub for sailing data.
 *
 * Subscriptions accept a channel name or pattern:
 *   - exact:        "wind.apparent.angle"
 *   - one segment:  "wind.*.angle"          (any single dot-separated token)
 *   - many:         "wind.**"               (any number of trailing tokens)
 *
 * Implementation: a single RxJS Subject<Sample> with per-subscriber filtering.
 * Sufficient for our scale (≤ a few thousand samples/sec, dozens of
 * subscribers).
 */
export class Bus {
  private readonly subject = new Subject<Sample>();

  publish(sample: Sample): void {
    this.subject.next(sample);
  }

  subscribe(pattern: Channel, handler: (sample: Sample) => void): () => void {
    const matcher = compilePattern(pattern);
    const sub = this.subject.subscribe((sample) => {
      if (matcher(sample.channel)) handler(sample);
    });
    return () => sub.unsubscribe();
  }
}

/**
 * Compile a channel pattern into a predicate. Patterns use dots as segment
 * separators, `*` matches any single segment, `**` matches any number of
 * trailing segments (must appear last).
 */
function compilePattern(pattern: string): (channel: string) => boolean {
  if (!pattern.includes('*')) {
    return (ch) => ch === pattern;
  }
  const segs = pattern.split('.');
  const trailingDoubleStar = segs[segs.length - 1] === '**';
  const fixed = trailingDoubleStar ? segs.slice(0, -1) : segs;
  return (ch) => {
    const chSegs = ch.split('.');
    if (trailingDoubleStar) {
      if (chSegs.length < fixed.length) return false;
    } else if (chSegs.length !== fixed.length) {
      return false;
    }
    for (let i = 0; i < fixed.length; i++) {
      const f = fixed[i];
      const c = chSegs[i];
      if (f === '*') continue;
      if (f !== c) return false;
    }
    return true;
  };
}
