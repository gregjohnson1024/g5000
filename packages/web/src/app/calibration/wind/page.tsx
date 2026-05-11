'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AwsAwaCalTable } from '@h6000/db';
import { CalHeatmap } from './CalHeatmap';
import { CellEditor } from './CellEditor';
import { TackTestWizard } from './TackTestWizard';

export default function CalibrationWindPage() {
  const [cal, setCal] = useState<AwsAwaCalTable | null>(null);
  const [selected, setSelected] = useState<{ awsIdx: number; awaIdx: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/config/aws-awa');
      if (!res.ok) {
        setErr(`reload failed: ${res.status}`);
        return;
      }
      const body = (await res.json()) as AwsAwaCalTable;
      setCal(body);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleApply = async (updated: AwsAwaCalTable): Promise<void> => {
    const res = await fetch('/api/config/aws-awa', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PUT failed: ${res.status} ${body}`);
    }
    await reload();
  };

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">AWS/AWA wind calibration</h1>
      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      {cal && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Calibration grid</h2>
            <CalHeatmap
              cal={cal}
              selected={selected ?? undefined}
              onSelect={(c) => setSelected(c)}
            />
            {selected && <CellEditor cal={cal} cell={selected} onApply={handleApply} />}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Tack test</h2>
            <TackTestWizard cal={cal} onApply={handleApply} />
          </section>
        </>
      )}

      {!cal && !err && <p className="text-slate-400">Loading…</p>}
    </main>
  );
}
