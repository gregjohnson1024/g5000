import { Channels, type Bus } from '@g5000/core';

/**
 * Poll mayara's SignalK radar endpoint on a fixed interval and publish
 * `radar.connected` (1|0) onto the bus.
 *
 * Non-blocking: the interval callback is fully async and never awaited by the
 * caller. Fetch errors are swallowed; connected=0 is published instead so
 * consumers always see a definitive liveness value.
 *
 * @returns A stop function that cancels the interval.
 */
export function startRadarStatusPoller(
  bus: Bus,
  opts: { baseUrl: string; intervalMs?: number; fetchImpl?: typeof fetch },
): () => void {
  const fetchFn = opts.fetchImpl ?? fetch;
  const intervalMs = opts.intervalMs ?? 5_000;
  const base = opts.baseUrl.replace(/\/$/, '');
  let stopped = false;

  const publish = (channel: string, value: number): void => {
    bus.publish({
      channel,
      t_ns: BigInt(Date.now()) * 1_000_000n,
      value: { kind: 'scalar', value, unit: '' },
      source: 'radar:mayara',
    });
  };

  const tick = async (): Promise<void> => {
    try {
      const res = await fetchFn(`${base}/signalk/v2/api/vessels/self/radars`);
      const map = (await res.json()) as Record<string, unknown>;
      const radars = Object.values(map);
      publish(Channels.Radar.Connected, radars.length > 0 ? 1 : 0);
    } catch {
      publish(Channels.Radar.Connected, 0);
    }
  };

  const timer = setInterval(() => {
    if (!stopped) void tick();
  }, intervalMs);

  // Fire immediately so the first value appears without waiting one full interval.
  void tick();

  return (): void => {
    stopped = true;
    clearInterval(timer);
  };
}
