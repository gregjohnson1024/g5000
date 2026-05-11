import { getSharedBus, toJsonSafe, createDamper, type Sample } from '@g5000/core';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/stream — Server-Sent Events feed of every Sample published to
 * the shared bus.
 *
 * Damping: per-channel EMA low-pass filter is applied to outgoing scalar
 * samples here, at the boundary. Internal compute pipelines see raw samples.
 * Each SSE connection gets its own damper so reconnects start with fresh
 * state — important because the damper's EMA self-warms in one sample, but
 * a long-paused tab shouldn't bring stale `t_ns` deltas into play.
 *
 * Throttling: we batch up to 50 ms of samples per channel and emit at most
 * one update per channel per batch. This caps fan-out to ~20 Hz per channel,
 * which is plenty for a UI inspector. CRITICAL: damping is applied on every
 * raw sample BEFORE batching, so the EMA's Δt corresponds to actual sample
 * spacing, not the throttle interval.
 */
export async function GET(req: Request): Promise<Response> {
  const bus = getSharedBus();
  const configStore = getSharedConfigStore();
  const encoder = new TextEncoder();
  const BATCH_MS = 50;

  const stream = new ReadableStream({
    start(controller) {
      const damp = createDamper();
      const latest = new Map<string, Sample>();
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const flush = (): void => {
        flushTimer = null;
        if (latest.size === 0) return;
        for (const [channel, sample] of latest) {
          const payload = JSON.stringify({ channel, sample: toJsonSafe(sample) });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        }
        latest.clear();
      };

      const unsub = bus.subscribe('**', (sample) => {
        // Damp on EVERY raw sample so the EMA sees real Δt between samples,
        // not the (longer) flush interval. The result is stored in the batch
        // map and the most-recent damped value wins per channel per flush.
        const tau = configStore.getDampingConfig()[sample.channel];
        const damped = damp(sample, tau);
        latest.set(sample.channel, damped);
        if (flushTimer === null) flushTimer = setTimeout(flush, BATCH_MS);
      });

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      }, 15_000);

      // Initial comment so the connection establishes immediately.
      controller.enqueue(encoder.encode(`: connected\n\n`));

      req.signal.addEventListener('abort', () => {
        unsub();
        clearInterval(heartbeat);
        if (flushTimer) clearTimeout(flushTimer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
