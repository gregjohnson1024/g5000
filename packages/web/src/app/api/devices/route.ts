import { getSharedDeviceRegistry, type DeviceInfo } from '@g5000/bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const registry = getSharedDeviceRegistry();
  const snap = registry.snapshot();
  // Sort by source address for stable JSON ordering.
  const devices: DeviceInfo[] = Array.from(snap.values()).sort(
    (a, b) => a.src - b.src,
  );
  return Response.json({ devices });
}
