'use client';

import { useEffect, useState } from 'react';

interface AlarmsConfig {
  enabled: Record<string, boolean>;
  thresholds: {
    anchor: {
      armed: boolean;
      point?: { lat: number; lon: number };
      droppedAt?: string;
      radiusM: number;
    };
    shallowWater: { thresholdM?: number; holdMs: number };
    overSpeed: { thresholdKn?: number; holdMs: number };
    lowBattery: { thresholdV?: number; holdMs: number };
    highWind: { thresholdKn?: number; holdMs: number };
  };
  push?: { ntfyTopic: string | null; ntfyUrl: string | null };
}

const ALARM_LABELS: Record<string, string> = {
  mob: 'MOB',
  'anchor-watch': 'Anchor Watch',
  'ais-cpa': 'AIS Collision (CPA)',
  'shallow-water': 'Shallow Water',
  'over-speed': 'Over Speed',
  'low-battery': 'Low Battery',
  'high-wind': 'High Wind',
};

export function SettingsForm() {
  const [cfg, setCfg] = useState<AlarmsConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/alarms/config')
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => setCfg(null));
  }, []);

  if (!cfg) return <p>Loading...</p>;

  async function save(next: AlarmsConfig) {
    setSaving(true);
    setCfg(next);
    await fetch('/api/alarms/config', { method: 'PUT', body: JSON.stringify(next) });
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold mb-2">Per-alarm enable</h2>
        {Object.entries(ALARM_LABELS).map(([id, label]) => (
          <label key={id} className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={cfg.enabled[id] ?? true}
              onChange={(e) =>
                save({ ...cfg, enabled: { ...cfg.enabled, [id]: e.target.checked } })
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Thresholds</h2>
        <NumberField
          label="Shallow water (m)"
          value={cfg.thresholds.shallowWater.thresholdM ?? 3}
          onChange={(v) =>
            save({
              ...cfg,
              thresholds: {
                ...cfg.thresholds,
                shallowWater: { ...cfg.thresholds.shallowWater, thresholdM: v },
              },
            })
          }
        />
        <NumberField
          label="Over speed (kn)"
          value={cfg.thresholds.overSpeed.thresholdKn ?? 12}
          onChange={(v) =>
            save({
              ...cfg,
              thresholds: {
                ...cfg.thresholds,
                overSpeed: { ...cfg.thresholds.overSpeed, thresholdKn: v },
              },
            })
          }
        />
        <NumberField
          label="Low battery (V)"
          value={cfg.thresholds.lowBattery.thresholdV ?? 11.8}
          onChange={(v) =>
            save({
              ...cfg,
              thresholds: {
                ...cfg.thresholds,
                lowBattery: { ...cfg.thresholds.lowBattery, thresholdV: v },
              },
            })
          }
        />
        <NumberField
          label="High wind (kn)"
          value={cfg.thresholds.highWind?.thresholdKn ?? 30}
          onChange={(v) =>
            save({
              ...cfg,
              thresholds: {
                ...cfg.thresholds,
                highWind: { holdMs: 60000, ...cfg.thresholds.highWind, thresholdKn: v },
              },
            })
          }
        />
        <NumberField
          label="Anchor radius (m)"
          value={cfg.thresholds.anchor.radiusM}
          onChange={(v) =>
            save({
              ...cfg,
              thresholds: { ...cfg.thresholds, anchor: { ...cfg.thresholds.anchor, radiusM: v } },
            })
          }
        />
      </section>

      <NotificationsCard cfg={cfg} save={save} />

      {saving && <p className="text-sm text-gray-500">Saving…</p>}
    </div>
  );
}

function NotificationsCard({
  cfg,
  save,
}: {
  cfg: AlarmsConfig;
  save: (next: AlarmsConfig) => Promise<void>;
}) {
  const [topic, setTopic] = useState(cfg.push?.ntfyTopic ?? '');
  const [url, setUrl] = useState(cfg.push?.ntfyUrl ?? '');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  function commit() {
    const next = {
      ntfyTopic: topic.trim() === '' ? null : topic.trim(),
      ntfyUrl: url.trim() === '' ? null : url.trim(),
    };
    if (
      next.ntfyTopic === (cfg.push?.ntfyTopic ?? null) &&
      next.ntfyUrl === (cfg.push?.ntfyUrl ?? null)
    )
      return;
    void save({ ...cfg, push: next });
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/alarms/push-test', { method: 'POST' });
      const body = (await res.json()) as { ok: boolean; error?: { message: string } };
      setTestResult(
        body.ok ? 'Test push sent — check your phone.' : `Failed: ${body.error?.message}`,
      );
    } catch (e) {
      setTestResult(`Failed: ${String(e)}`);
    }
    setTesting(false);
  }

  return (
    <section>
      <h2 className="text-lg font-semibold mb-2">Notifications</h2>
      <p className="text-sm text-gray-500 mb-2">
        WARN/CRITICAL alarms are pushed to this ntfy topic. The topic is a secret — anyone who knows
        it can subscribe.
      </p>
      <label className="flex items-center justify-between gap-2 py-1">
        <span>Topic</span>
        <input
          type="text"
          value={topic}
          placeholder="e.g. sula-alarms"
          onChange={(e) => setTopic(e.target.value)}
          onBlur={commit}
          className="border rounded px-2 py-1 w-64"
        />
      </label>
      <label className="flex items-center justify-between gap-2 py-1">
        <span>Server URL</span>
        <input
          type="text"
          value={url}
          placeholder="https://ntfy.sh"
          onChange={(e) => setUrl(e.target.value)}
          onBlur={commit}
          className="border rounded px-2 py-1 w-64"
        />
      </label>
      <div className="flex items-center gap-3 py-2">
        <button
          type="button"
          onClick={sendTest}
          disabled={testing}
          className="border rounded px-3 py-1 text-sm hover:bg-gray-100 disabled:opacity-50"
        >
          {testing ? 'Sending…' : 'Send test'}
        </button>
        {testResult && <span className="text-sm text-gray-500">{testResult}</span>}
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-1">
      <span>{label}</span>
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="border rounded px-2 py-1 w-32"
      />
    </label>
  );
}
