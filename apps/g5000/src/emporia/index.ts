/**
 * startEmporia() — wires the Emporia power-monitor into the g5000 boot sequence.
 *
 * Three modes, selected by environment variables:
 *   1. EMPORIA_EMAIL + EMPORIA_PASSWORD — live Cognito-authenticated polling.
 *   2. EMPORIA_SIM=1 OR DEMO_MODE=1     — deterministic simulator.
 *   3. Neither                           — registry created but left offline.
 *
 * Never throws. Returns a teardown function that clears all timers.
 */

import { setSharedEmporiaHistory } from '@g5000/core';
import { createEmporiaClient } from './client.js';
import { parseDevices, deriveSnapshot } from './transform.js';
import { createEmporiaRegistry } from './registry.js';
import { simSnapshotAt, simHistory } from './sim.js';

/**
 * Parse EMPORIA_POLL_S into a poll interval in milliseconds.
 * Falls back to 15 000 ms when the value is NaN, zero, or negative to prevent
 * a setInterval(fn, NaN) tight-loop that would hammer the rate-limited API.
 * Exported for unit-testing.
 */
export function parsePollMs(raw: string | undefined): number {
  const n = Number(raw);
  return (Number.isFinite(n) && n > 0 ? n : 15) * 1000;
}

export function startEmporia(): () => void {
  try {
    const registry = createEmporiaRegistry();

    const email = process.env.EMPORIA_EMAIL ?? '';
    const password = process.env.EMPORIA_PASSWORD ?? '';
    const pollMs = parsePollMs(process.env.EMPORIA_POLL_S);
    const simMode = process.env.EMPORIA_SIM === '1' || process.env.DEMO_MODE === '1';

    // ── Mode 1: live client ────────────────────────────────────────────────
    if (email && password) {
      const client = createEmporiaClient(email, password);
      const timers: ReturnType<typeof setInterval>[] = [];

      let devices = registry.devices();

      // Fetch devices once at start, then refresh every hour.
      const fetchDevices = (): void => {
        client
          .getDevices()
          .then((raw) => {
            devices = parseDevices(raw);
            registry.setDevices(devices);
          })
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.warn('[g5000] emporia: device fetch failed', err);
          });
      };
      fetchDevices();
      timers.push(setInterval(fetchDevices, 60 * 60 * 1000));

      // Poll usages on the configured interval.
      // Phase 1: single-primary-device — request only the first device's gid.
      // deriveSnapshot() likewise reads only devices[0] from the response.
      // Multi-device support is a documented future enhancement.
      const pollUsages = (): void => {
        const gids = devices.length ? [devices[0]!.deviceGid] : [];
        if (gids.length === 0) return;
        client
          .getDeviceListUsages(gids, '1S')
          .then((usagesRaw) => {
            registry.setSnapshot(deriveSnapshot(devices, usagesRaw, '1S', Date.now()));
          })
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.warn('[g5000] emporia: usage poll failed', err);
            registry.markStale();
          });
      };
      timers.push(setInterval(pollUsages, pollMs));

      setSharedEmporiaHistory((gid, ch, scale, s, e) => client.getChartUsage(gid, ch, scale, s, e));

      // eslint-disable-next-line no-console
      console.log('[g5000] emporia driver online');

      return (): void => {
        for (const t of timers) clearInterval(t);
      };
    }

    // ── Mode 2: simulator ──────────────────────────────────────────────────
    if (simMode) {
      const timers: ReturnType<typeof setInterval>[] = [];

      const runSim = (): void => {
        const sim = simSnapshotAt(Date.now() / 1000);
        const devices = parseDevices(sim.devices);
        registry.setDevices(devices);
        registry.setSnapshot(deriveSnapshot(devices, sim.usages, '1S', Date.now()));
      };
      runSim();
      timers.push(setInterval(runSim, pollMs));

      setSharedEmporiaHistory(simHistory);

      // eslint-disable-next-line no-console
      console.log('[g5000] emporia simulator online');

      return (): void => {
        for (const t of timers) clearInterval(t);
      };
    }

    // ── Mode 3: offline (no-op) ────────────────────────────────────────────
    // Registry is created but stays at EMPORIA_OFFLINE_SNAPSHOT. No timers.
    return (): void => {};
  } catch (err) {
    // Safety net — startEmporia must never block boot.
    // eslint-disable-next-line no-console
    console.warn('[g5000] emporia: startup error (ignored)', err);
    return (): void => {};
  }
}
