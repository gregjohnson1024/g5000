import type { EmporiaScale, EmporiaDevice, EmporiaSnapshot, EmporiaCircuit } from '@g5000/core';

const SECONDS: Record<EmporiaScale, number> = {
  '1S': 1,
  '1MIN': 60,
  '15MIN': 900,
  '1H': 3600,
  '1D': 86400,
  '1W': 604800,
  '1MON': 2592000,
  '1Y': 31536000,
};
export function scaleSeconds(scale: EmporiaScale): number {
  return SECONDS[scale];
}

export function usageToWatts(
  usageKwh: number | null,
  scale: EmporiaScale,
  multiplier: number,
): number | null {
  if (usageKwh === null || !Number.isFinite(usageKwh)) return null;
  return usageKwh * (3600 / scaleSeconds(scale)) * 1000 * multiplier;
}

export function parseDevices(raw: unknown): EmporiaDevice[] {
  const r = raw as {
    devices?: Array<{
      deviceGid: number;
      model?: string;
      firmware?: string;
      channels?: Array<{ channelNum: string; channelMultiplier?: number; name?: string }>;
    }>;
  };
  return (r.devices ?? []).map((d) => ({
    deviceGid: d.deviceGid,
    model: d.model ?? '',
    firmware: d.firmware ?? '',
    channels: (d.channels ?? []).map((c) => ({
      channelNum: c.channelNum,
      name: c.name ?? c.channelNum,
      multiplier: typeof c.channelMultiplier === 'number' ? c.channelMultiplier : 1,
    })),
  }));
}

export function deriveSnapshot(
  devices: EmporiaDevice[],
  usagesRaw: unknown,
  scale: EmporiaScale,
  now: number,
): EmporiaSnapshot {
  const usages = usagesRaw as {
    deviceListUsages?: {
      devices?: Array<{
        deviceGid: number;
        channelUsages?: Array<{ name?: string; usage: number | null; channelNum: string }>;
      }>;
    };
  };
  const dev = usages.deviceListUsages?.devices?.[0];
  if (!dev) {
    return {
      connected: true,
      updatedAt: now,
      deviceGid: null,
      model: null,
      circuits: [],
      mainsW: null,
      balanceW: null,
    };
  }
  const meta = devices.find((d) => d.deviceGid === dev.deviceGid);
  const multOf = (channelNum: string): number =>
    meta?.channels.find((c) => c.channelNum === channelNum)?.multiplier ?? 1;
  const nameOf = (channelNum: string, fallback: string): string =>
    meta?.channels.find((c) => c.channelNum === channelNum)?.name?.trim() || fallback;

  let mainsW: number | null = null;
  let balanceW: number | null = null;
  const circuits: EmporiaCircuit[] = [];
  for (const cu of dev.channelUsages ?? []) {
    const mult = multOf(cu.channelNum);
    const watts = usageToWatts(cu.usage, scale, mult);
    if (cu.channelNum === '1,2,3') {
      mainsW = watts;
      continue;
    }
    if (cu.channelNum === 'Balance') {
      balanceW = watts;
      continue;
    }
    circuits.push({
      channelNum: cu.channelNum,
      name: nameOf(cu.channelNum, cu.name ?? cu.channelNum),
      watts,
      multiplier: mult,
    });
  }
  return {
    connected: true,
    updatedAt: now,
    deviceGid: dev.deviceGid,
    model: meta?.model ?? null,
    circuits,
    mainsW,
    balanceW,
  };
}
