'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DeviceInfo } from '@g5000/bridge';

interface DevicesResponse {
  devices: DeviceInfo[];
}

interface SourceModeStatus {
  mode: 'live' | 'demo' | 'replay';
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<SourceModeStatus['mode']>('live');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/devices', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/devices: ${res.status}`);
      const body = (await res.json()) as DevicesResponse;
      setDevices(body.devices);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadMode = useCallback(async () => {
    const res = await fetch('/api/source-mode', { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as SourceModeStatus;
    if (body.mode) setMode(body.mode);
  }, []);

  useEffect(() => {
    void load();
    void loadMode();
    const id = setInterval(loadMode, 2000);
    return () => clearInterval(id);
  }, [load, loadMode]);

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await fetch('/api/devices/refresh', { method: 'POST' });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`POST /api/devices/refresh: ${res.status} ${body}`);
      }
      // Give devices a moment to reply, then reload.
      await new Promise((r) => setTimeout(r, 500));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();
  const fmtAge = (ms: number): string => `${((now - ms) / 1000).toFixed(1)}s`;
  const fmt = (s: string | undefined, fallback = '—'): string => (s && s.length > 0 ? s : fallback);
  const fmtNum = (n: number | undefined, fallback = '—'): string =>
    typeof n === 'number' ? String(n) : fallback;
  const hexSrc = (n: number): string => `0x${n.toString(16).padStart(2, '0')}`;

  const canRefresh = mode === 'live';

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">N2K devices</h1>
        <button
          onClick={refresh}
          disabled={busy || !canRefresh}
          title={canRefresh ? '' : `Refresh sends an ISO Request on the N2K bus — available in live mode only (currently ${mode}).`}
          className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Refreshing…' : 'Refresh devices'}
        </button>
      </div>
      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      {devices === null && !err && <p className="text-slate-400">Loading…</p>}

      {devices !== null && devices.length === 0 && (
        <p className="text-slate-400 text-sm">
          {canRefresh
            ? 'No devices observed yet. Click “Refresh devices” to send an ISO Request, or wait for devices to announce themselves.'
            : `Device discovery requires live mode (current mode: ${mode}). Switch via the chip in the navbar to enumerate N2K devices.`}
        </p>
      )}

      {devices !== null && devices.length > 0 && (
        <table className="w-full text-sm font-mono">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="py-2 pr-4">Src</th>
              <th className="py-2 pr-4">Manufacturer</th>
              <th className="py-2 pr-4">Model</th>
              <th className="py-2 pr-4">S/N</th>
              <th className="py-2 pr-4">Function</th>
              <th className="py-2 pr-4">Class</th>
              <th className="py-2 pr-4">SW</th>
              <th className="py-2">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.src} className="border-b border-slate-900">
                <td className="py-1 pr-4">{hexSrc(d.src)}</td>
                <td className="py-1 pr-4">{fmt(d.manufacturerName)}</td>
                <td className="py-1 pr-4">{fmt(d.modelId)}</td>
                <td className="py-1 pr-4">{fmt(d.modelSerialCode)}</td>
                <td className="py-1 pr-4">{fmt(d.deviceFunctionName, fmtNum(d.deviceFunction))}</td>
                <td className="py-1 pr-4">{fmt(d.deviceClassName, fmtNum(d.deviceClass))}</td>
                <td className="py-1 pr-4">{fmt(d.softwareVersionCode)}</td>
                <td className="py-1 text-slate-500">{fmtAge(d.lastSeenMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
