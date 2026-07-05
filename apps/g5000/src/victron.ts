import type { Bus } from '@g5000/core';
import { createVictronRegistry, startVictronMqttDriver, startVictronSim } from '@g5000/bridge';

/**
 * Start the Victron subsystem. Live driver when VICTRON_MQTT_HOST is set
 * (and not 'none'); deterministic simulator under VICTRON_SIM=1 or DEMO_MODE=1;
 * otherwise the registry exists but stays empty (UI shows "Cerbo offline").
 * Never throws — a Cerbo that's off must not affect boot.
 */
export function startVictron(bus: Bus): () => void {
  const registry = createVictronRegistry();
  const host = process.env.VICTRON_MQTT_HOST;
  const sim = process.env.VICTRON_SIM === '1' || process.env.DEMO_MODE === '1';
  try {
    if (host && host !== 'none') {
      const stop = startVictronMqttDriver({
        host,
        port: Number(process.env.VICTRON_MQTT_PORT ?? 1883),
        portalId: process.env.VICTRON_PORTAL_ID,
        username: process.env.VICTRON_MQTT_USER,
        password: process.env.VICTRON_MQTT_PASS,
        registry,
        bus,
      });
      // eslint-disable-next-line no-console
      console.log(`[g5000] victron driver online (mqtt://${host})`);
      return stop;
    }
    if (sim) {
      const stop = startVictronSim({ registry, bus });
      // eslint-disable-next-line no-console
      console.log('[g5000] victron simulator online');
      return stop;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[g5000] victron start failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return () => {};
}
