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
  };
}

const ALARM_LABELS: Record<string, string> = {
  mob: 'MOB',
  'anchor-watch': 'Anchor Watch',
  'shallow-water': 'Shallow Water',
  'over-speed': 'Over Speed',
  'low-battery': 'Low Battery',
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

      {saving && <p className="text-sm text-gray-500">Saving…</p>}
    </div>
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
