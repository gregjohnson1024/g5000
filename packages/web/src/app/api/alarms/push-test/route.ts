import { NextResponse } from 'next/server';
import { sendNtfyPush } from '@g5000/compute';
import type { AlarmsConfig } from '@g5000/db';

/**
 * POST /api/alarms/push-test — send a test notification to the configured
 * ntfy topic so the user can verify the /alerts Notifications settings
 * end-to-end. Reads the live config ref (config wins); falls back to the
 * legacy G5000_NTFY_TOPIC / G5000_NTFY_URL env vars when the config values
 * are null/blank.
 */

interface ConfigRef {
  current: AlarmsConfig;
}

function getRef(): ConfigRef | null {
  const g = globalThis as { __g5000_alarms_config_ref__?: ConfigRef };
  return g.__g5000_alarms_config_ref__ ?? null;
}

const nonBlank = (s: string | null | undefined): string | null => (s && s.trim() !== '' ? s : null);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  const push = getRef()?.current.push;
  const topic = nonBlank(push?.ntfyTopic) ?? nonBlank(process.env.G5000_NTFY_TOPIC);
  if (!topic) {
    return NextResponse.json({
      ok: false,
      error: { message: 'no ntfy topic configured (set one above, then save)' },
    });
  }
  const url = nonBlank(push?.ntfyUrl) ?? nonBlank(process.env.G5000_NTFY_URL);

  const boatId = process.env.G5000_BOAT_ID ?? 'sula';
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const result = await sendNtfyPush({
    url,
    topic,
    title: 'g5000 test notification',
    body: `g5000 test notification from boat ${boatId} at ${now} UTC`,
    priority: 'default',
    tags: 'white_check_mark',
  });
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      error: { message: result.error ?? `HTTP ${result.status}` },
    });
  }
  return NextResponse.json({ ok: true });
}
