import type { Bus } from '@g5000/core';
import { getSharedDeviceRegistry, type DeviceInfo } from '@g5000/bridge';

const SOURCE_RE = /^n2k:\d+@0x([0-9a-fA-F]+)$/;

/**
 * Per-target ISO Request agent.
 *
 * Many N2K devices ignore broadcast (dst=255) ISO Requests for PGN 60928 /
 * 126996 — they only respond when addressed directly. This subscriber
 * watches every sample on the bus, and for each new source address that
 * lacks identifying info in the DeviceRegistry, sends a per-target ISO
 * Request after a short delay. Rate-limited so a single src is requeried
 * at most once per `refreshIntervalMs`.
 *
 * @param bus                  The shared Bus.
 * @param refreshIntervalMs    Minimum interval between requeries of the
 *                             same src that's still unidentified. Default
 *                             60_000 (1 minute).
 * @param initialDelayMs       Delay between observing a new src and sending
 *                             its first ISO Request — gives passive Address
 *                             Claim a chance to arrive on its own. Default
 *                             2_000.
 * @returns                    Teardown function.
 */
export function installDeviceDiscovery(
  bus: Bus,
  refreshIntervalMs = 60_000,
  initialDelayMs = 2_000,
): () => void {
  // src (number) → last time we asked, ms. 0 means "never asked".
  const lastRequest = new Map<number, number>();
  const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();

  function isIdentified(d: DeviceInfo | undefined): boolean {
    if (!d) return false;
    // We consider a device identified if Product Info has arrived (modelId
    // present). Address Claim alone gives manufacturer code but no model,
    // so users still see "Unknown (1439)" — keep asking.
    return typeof d.modelId === 'string' && d.modelId.length > 0;
  }

  function queueRequest(src: number): void {
    const now = Date.now();
    const last = lastRequest.get(src) ?? 0;
    if (now - last < refreshIntervalMs) return;
    if (pendingTimers.has(src)) return;
    const registry = getSharedDeviceRegistry();
    if (isIdentified(registry.snapshot().get(src))) return;
    const timer = setTimeout(() => {
      pendingTimers.delete(src);
      const reg = getSharedDeviceRegistry();
      if (isIdentified(reg.snapshot().get(src))) return;
      lastRequest.set(src, Date.now());
      reg.refresh(src).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[device-discovery] refresh(0x${src.toString(16).padStart(2, '0')}) failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, initialDelayMs);
    pendingTimers.set(src, timer);
  }

  const unsubscribe = bus.subscribe('**', (s) => {
    const m = SOURCE_RE.exec(s.source);
    if (!m) return;
    const src = parseInt(m[1]!, 16);
    if (!Number.isFinite(src)) return;
    queueRequest(src);
  });

  return () => {
    unsubscribe();
    for (const t of pendingTimers.values()) clearTimeout(t);
    pendingTimers.clear();
    lastRequest.clear();
  };
}
