/**
 * ntfy push transport (server-only — plain global fetch, no browser use).
 *
 * One small reusable function shared by the alarm-push wrapper in the g5000
 * app and the POST /api/alarms/push-test route. Never throws: every failure
 * (HTTP error, network, 5 s timeout) comes back as { ok: false, ... } so a
 * dead internet link can never touch the alarm path.
 */

export interface NtfyPushRequest {
  /** ntfy server base URL. Null/blank falls back to https://ntfy.sh. */
  url?: string | null;
  /** ntfy topic name (already validated by the caller). */
  topic: string;
  title: string;
  body: string;
  priority: 'urgent' | 'high' | 'default';
  /** ntfy Tags header (emoji shortcodes). Defaults to 'warning'. */
  tags?: string;
}

export interface NtfyPushResult {
  ok: boolean;
  status?: number;
  error?: string;
}

const DEFAULT_NTFY_URL = 'https://ntfy.sh';
const TIMEOUT_MS = 5000;

export async function sendNtfyPush(req: NtfyPushRequest): Promise<NtfyPushResult> {
  const base = (req.url && req.url.trim() !== '' ? req.url : DEFAULT_NTFY_URL).replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/${req.topic}`, {
      method: 'POST',
      headers: {
        Title: req.title,
        Priority: req.priority,
        Tags: req.tags ?? 'warning',
      },
      body: req.body,
      signal: ctrl.signal,
    });
    return r.ok
      ? { ok: true, status: r.status }
      : { ok: false, status: r.status, error: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}
