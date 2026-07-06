/**
 * Deterministic Emporia simulator — produces raw JSON in the exact shapes
 * that `parseDevices` and `deriveSnapshot` consume. No `Date.now()` or
 * `Math.random()` inside exported functions; time is an explicit parameter
 * so callers can reproduce any instant identically.
 *
 * Circuit wattages vary sinusoidally over a simulated 24-hour day so the
 * dashboard looks alive at any time of day.
 */

import type { EmporiaScale } from '@g5000/core';

// ── Simulated device constants ────────────────────────────────────────────────

const DEVICE_GID = 1001;
const MODEL = 'VUE003';
const FIRMWARE = 'Vue-1.7.3';

/**
 * Simulated branch circuits. Each entry describes a breaker slot:
 *   channelNum — matches the Emporia API `channelNum` field
 *   name        — human-readable label
 *   channelMultiplier — 2 for 240 V double-pole, 1 for 120 V
 *   baseW       — mean power draw in watts (at the physical load, before multiplier)
 *   ampW        — amplitude of the sinusoidal variation (watts)
 *   phaseFrac   — phase offset as a fraction of 2π (keeps circuits out of sync)
 */
const CIRCUITS: ReadonlyArray<{
  channelNum: string;
  name: string;
  channelMultiplier: number;
  baseW: number;
  ampW: number;
  phaseFrac: number;
}> = [
  { channelNum: '1', name: 'Galley', channelMultiplier: 1, baseW: 350, ampW: 200, phaseFrac: 0.0 },
  {
    channelNum: '2',
    name: 'AC',
    channelMultiplier: 2,
    baseW: 800,
    ampW: 600,
    phaseFrac: 0.15,
  },
  {
    channelNum: '3',
    name: 'Watermaker',
    channelMultiplier: 1,
    baseW: 180,
    ampW: 160,
    phaseFrac: 0.3,
  },
  {
    channelNum: '4',
    name: 'Outlets',
    channelMultiplier: 1,
    baseW: 120,
    ampW: 80,
    phaseFrac: 0.45,
  },
  {
    channelNum: '5',
    name: 'Starlink',
    channelMultiplier: 1,
    baseW: 65,
    ampW: 15,
    phaseFrac: 0.6,
  },
  {
    channelNum: '6',
    name: 'Fridge',
    channelMultiplier: 1,
    baseW: 90,
    ampW: 70,
    phaseFrac: 0.75,
  },
];

/** One full oscillation period = 24 simulated hours in seconds. */
const DAY_S = 86_400;

/**
 * Compute instantaneous watts for a circuit at time `tSec`.
 * Uses a sine wave over a 24-hour cycle, clamped to ≥1 W.
 */
function circuitWatts(baseW: number, ampW: number, phaseFrac: number, tSec: number): number {
  const phase = phaseFrac * 2 * Math.PI;
  const angle = (2 * Math.PI * tSec) / DAY_S + phase;
  return Math.max(1, baseW + ampW * Math.sin(angle));
}

/**
 * Convert instantaneous watts to kWh for the `1S` scale (1-second bucket).
 * watts × 1 s / 3 600 000 ms/kWh = watts / 3_600_000.
 */
function wattsToKwh1S(watts: number): number {
  return watts / 3_600_000;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the raw JSON shapes the Emporia client would return, frozen at
 * `tSec` seconds since the Unix epoch. Feed the result directly to
 * `parseDevices(sim.devices)` and `deriveSnapshot(devices, sim.usages, '1S', tSec * 1000)`.
 *
 * This function is PURE — same `tSec` always returns an equal value.
 */
export function simSnapshotAt(tSec: number): { devices: unknown; usages: unknown } {
  // ── Devices shape (matches /customers/devices) ────────────────────────────
  const devices = {
    customerGid: 9001,
    devices: [
      {
        deviceGid: DEVICE_GID,
        model: MODEL,
        firmware: FIRMWARE,
        channels: [
          { channelNum: '1,2,3', channelMultiplier: 1, name: 'Main' },
          { channelNum: 'Balance', channelMultiplier: 1, name: 'Balance' },
          ...CIRCUITS.map((c) => ({
            channelNum: c.channelNum,
            channelMultiplier: c.channelMultiplier,
            name: c.name,
          })),
        ],
      },
    ],
  };

  // ── Circuit usages ────────────────────────────────────────────────────────
  const circuitUsages = CIRCUITS.map((c) => ({
    name: c.name,
    channelNum: c.channelNum,
    usage: wattsToKwh1S(circuitWatts(c.baseW, c.ampW, c.phaseFrac, tSec)),
    nestedDevices: [],
  }));

  // Mains = sum of all branch watts (physical, before multiplier for 240V)
  const totalBranchW = CIRCUITS.reduce(
    (sum, c) => sum + circuitWatts(c.baseW, c.ampW, c.phaseFrac, tSec) * c.channelMultiplier,
    0,
  );
  const mainsW = totalBranchW * 1.02; // ~2% balance overhead
  const balanceW = mainsW - totalBranchW;

  // ── Usages shape (matches getDeviceListUsages) ────────────────────────────
  const usages = {
    deviceListUsages: {
      instant: new Date(tSec * 1000).toISOString(),
      scale: '1S',
      energyUnit: 'KilowattHours',
      devices: [
        {
          deviceGid: DEVICE_GID,
          channelUsages: [
            { name: 'Main', channelNum: '1,2,3', usage: wattsToKwh1S(mainsW), nestedDevices: [] },
            {
              name: 'Balance',
              channelNum: 'Balance',
              usage: wattsToKwh1S(balanceW),
              nestedDevices: [],
            },
            ...circuitUsages,
          ],
        },
      ],
    },
  };

  return { devices, usages };
}

/**
 * Simulated history provider — returns a plausible `{ firstUsageInstant, usageList }`
 * for the given device/channel/scale/time-range. Deterministic: same arguments
 * → same result. No network I/O.
 */
export async function simHistory(
  _gid: number,
  channel: string,
  scale: EmporiaScale,
  startIso: string,
  endIso: string,
): Promise<{ firstUsageInstant: string; usageList: Array<number | null> }> {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);

  const scaleMs: Record<EmporiaScale, number> = {
    '1S': 1_000,
    '1MIN': 60_000,
    '15MIN': 900_000,
    '1H': 3_600_000,
    '1D': 86_400_000,
    '1W': 604_800_000,
    '1MON': 2_592_000_000,
    '1Y': 31_536_000_000,
  };
  const bucketMs = scaleMs[scale];
  const count = Math.max(1, Math.round((endMs - startMs) / bucketMs));

  // Pick the circuit by channel — fall back to mains parameters if not found
  const circuit = CIRCUITS.find((c) => c.channelNum === channel);
  const baseW = circuit?.baseW ?? 1800;
  const ampW = circuit?.ampW ?? 400;
  const phaseFrac = circuit?.phaseFrac ?? 0;
  const scaleSec = bucketMs / 1000;

  const usageList: Array<number | null> = Array.from({ length: count }, (_, i) => {
    const tSec = (startMs + i * bucketMs) / 1000;
    const w = circuitWatts(baseW, ampW, phaseFrac, tSec);
    // kWh for this bucket duration
    return (w * scaleSec) / 3_600_000;
  });

  return { firstUsageInstant: startIso, usageList };
}
