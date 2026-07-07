'use client';
import { useCallback, useEffect, useState } from 'react';
import { SENSOR_DEFS } from './sensor-definitions';
import { SensorCard } from './SensorCard';
import { AllChannels } from './AllChannels';
import type { SourcePriorityRule } from '@g5000/core';
import type { ObservedEntry } from './sensors-types';
import type { DeviceLabelInfo } from '../../../../lib/device-label';

interface ObservedResponse {
  entries: ObservedEntry[];
  windowMs: number;
}

interface DevicesResponse {
  devices: Array<{
    src: number;
    manufacturerName?: string;
    modelId?: string;
    deviceFunctionName?: string;
  }>;
}

const DEVICES_POLL_MS = 15000;

const POLL_MS = 1000;

export default function SensorsPage() {
  const [observed, setObserved] = useState<ObservedEntry[]>([]);
  const [observedErr, setObservedErr] = useState<string | null>(null);
  const [rules, setRules] = useState<SourcePriorityRule[]>([]);
  const [rulesErr, setRulesErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState<Map<number, DeviceLabelInfo>>(new Map());

  // Poll observed sources.
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/sources/observed', { cache: 'no-store' });
        if (!res.ok) throw new Error(`GET observed: ${res.status}`);
        const body = (await res.json()) as ObservedResponse;
        if (!alive) return;
        setObserved(body.entries);
        setObservedErr(null);
      } catch (e) {
        if (alive) setObservedErr(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // Load the N2K device registry (for friendly source names). Best-effort:
  // on failure, source labels just fall back to PGN+address.
  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/api/devices', { cache: 'no-store' });
        if (!res.ok) throw new Error(`GET devices: ${res.status}`);
        const body = (await res.json()) as DevicesResponse;
        if (!alive) return;
        const map = new Map<number, DeviceLabelInfo>();
        for (const d of body.devices) {
          map.set(d.src, {
            src: d.src,
            manufacturerName: d.manufacturerName,
            modelId: d.modelId,
            deviceFunctionName: d.deviceFunctionName,
          });
        }
        setDevices(map);
      } catch {
        // Non-fatal — labels fall back to PGN+address.
      }
    };
    void load();
    const id = window.setInterval(() => void load(), DEVICES_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // Load priority rules once.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/config/source-priority', { cache: 'no-store' });
        if (!res.ok) throw new Error(`GET config: ${res.status}`);
        const body = (await res.json()) as SourcePriorityRule[];
        if (alive) setRules(body);
      } catch (e) {
        if (alive) setRulesErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onSaveRules = useCallback(async (next: SourcePriorityRule[]): Promise<void> => {
    setSaving(true);
    try {
      const res = await fetch('/api/config/source-priority', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`PUT config: ${res.status}`);
      setRules(next);
      setRulesErr(null);
    } catch (e) {
      setRulesErr(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Sensors</h1>
        <p className="text-sm text-slate-400 mt-1">
          Live readings for connected sensors. When a channel has more than one source, pick the one
          to use with the radios under its value &mdash; or leave it on &ldquo;Auto&rdquo; (most
          recent).
        </p>
      </header>

      {observedErr && (
        <div className="text-sm text-rose-400 border border-rose-900 bg-rose-950/40 rounded p-2">
          Could not load live data: {observedErr}
        </div>
      )}
      {rulesErr && (
        <div className="text-sm text-rose-400 border border-rose-900 bg-rose-950/40 rounded p-2">
          Could not load source priorities: {rulesErr}
        </div>
      )}

      {SENSOR_DEFS.map((def) => (
        <SensorCard
          key={def.id}
          def={def}
          observed={observed}
          rules={rules}
          devices={devices}
          saving={saving}
          onSaveRules={onSaveRules}
        />
      ))}

      <AllChannels
        observed={observed}
        rules={rules}
        devices={devices}
        saving={saving}
        onSaveRules={onSaveRules}
      />
    </main>
  );
}
