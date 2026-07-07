'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Sail, SailCategory, SailWardrobe } from '@g5000/db';
import { Panel, Button, ConfirmDialog, Dialog } from '../../../components/ui';

const CATEGORIES: { key: SailCategory; label: string }[] = [
  { key: 'headsail', label: 'Headsails' },
  { key: 'main', label: 'Main / Reef' },
  { key: 'downwind', label: 'Downwind' },
];

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

type AlertState = { kind: 'none' } | { kind: 'alert'; message: string } | { kind: 'confirm-delete'; sailId: string };

export default function SailsPage() {
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);
  const [draftName, setDraftName] = useState<Record<SailCategory, string>>({
    headsail: '',
    main: '',
    downwind: '',
  });
  const [draftArea, setDraftArea] = useState<Record<SailCategory, string>>({
    headsail: '',
    main: '',
    downwind: '',
  });
  const [dlg, setDlg] = useState<AlertState>({ kind: 'none' });

  async function reload() {
    setWardrobe(await (await fetch('/api/sails')).json());
  }
  useEffect(() => {
    void reload();
  }, []);

  async function save(next: SailWardrobe) {
    const res = await fetch('/api/sails', { method: 'PUT', body: JSON.stringify(next) });
    if (!res.ok) {
      const body = await res.json();
      setDlg({ kind: 'alert', message: `Save failed: ${body.error ?? res.statusText}` });
      return;
    }
    setWardrobe(next);
  }

  if (!wardrobe) return <div className="p-4 text-ink-3">Loading…</div>;

  async function addSail(cat: SailCategory) {
    const name = draftName[cat].trim();
    if (!name) return;
    const id = slug(name);
    if (wardrobe!.sails.some((s) => s.id === id)) {
      setDlg({ kind: 'alert', message: `Sail "${id}" already exists.` });
      return;
    }
    const areaSqM = draftArea[cat] ? Number(draftArea[cat]) : undefined;
    const newSail: Sail = {
      id,
      name,
      category: cat,
      region: { cells: [] },
      ...(Number.isFinite(areaSqM) && areaSqM ? { areaSqM } : {}),
    };
    await save({ ...wardrobe!, sails: [...wardrobe!.sails, newSail] });
    setDraftName({ ...draftName, [cat]: '' });
    setDraftArea({ ...draftArea, [cat]: '' });
  }

  async function deleteSail(sailId: string) {
    setDlg({ kind: 'confirm-delete', sailId });
  }

  async function commitDelete(sailId: string) {
    setDlg({ kind: 'none' });
    await save({ ...wardrobe!, sails: wardrobe!.sails.filter((s) => s.id !== sailId) });
  }

  async function setActive(cat: SailCategory, sailId: string | null) {
    await fetch('/api/sails/active', {
      method: 'POST',
      body: JSON.stringify({ category: cat, sailId }),
    });
    await reload();
  }

  const deletingSail = dlg.kind === 'confirm-delete'
    ? wardrobe.sails.find((s) => s.id === dlg.sailId)
    : undefined;

  return (
    <main className="p-4 space-y-6">
      <h1 className="text-xl font-semibold text-ink">Sail Wardrobe</h1>

      {CATEGORIES.map(({ key, label }) => {
        const sailsInCat = wardrobe.sails.filter((s) => s.category === key);
        return (
          <Panel key={key} label={label}>
            <table className="w-full text-sm text-ink">
              <thead>
                <tr className="text-ink-3 text-caption uppercase tracking-wide">
                  <th className="text-left py-1 pr-2 font-normal">Name</th>
                  <th className="text-left py-1 pr-2 font-normal">Area (m²)</th>
                  <th className="text-left py-1 pr-2 font-normal">Cells</th>
                  <th className="text-left py-1 pr-2 font-normal">Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sailsInCat.map((sail) => (
                  <tr key={sail.id} className="border-t border-hairline">
                    <td className="py-1 pr-2">{sail.name}</td>
                    <td className="py-1 pr-2 tabular-nums">{sail.areaSqM ?? '—'}</td>
                    <td className="py-1 pr-2 tabular-nums">{sail.region.cells.length}</td>
                    <td className="py-1 pr-2">
                      <input
                        type="radio"
                        name={`active-${key}`}
                        checked={wardrobe.active[key] === sail.id}
                        onChange={() => setActive(key, sail.id)}
                        className="accent-[--accent-ink]"
                      />
                    </td>
                    <td className="py-1">
                      <button
                        type="button"
                        onClick={() => deleteSail(sail.id)}
                        className="text-danger hover:underline text-caption"
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-hairline">
                  <td className="py-1 pr-2">
                    <input
                      value={draftName[key]}
                      onChange={(e) => setDraftName({ ...draftName, [key]: e.target.value })}
                      placeholder="new sail name"
                      className="border border-hairline bg-surface-sunken [border-radius:var(--r-control)] px-2 py-1 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus]"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      value={draftArea[key]}
                      onChange={(e) => setDraftArea({ ...draftArea, [key]: e.target.value })}
                      placeholder="m²"
                      className="border border-hairline bg-surface-sunken [border-radius:var(--r-control)] px-2 py-1 w-20 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus]"
                    />
                  </td>
                  <td colSpan={3} className="py-1">
                    <Button size="sm" variant="secondary" onClick={() => addSail(key)}>
                      Add sail
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </Panel>
        );
      })}

      <p className="text-sm text-ink-3">
        Paint each sail&apos;s TWS/TWA region on the{' '}
        <Link href="/boat/crossover" className="underline text-ink-2 hover:text-ink">
          crossover page
        </Link>
        .
      </p>

      {/* Alert dialog */}
      <Dialog
        open={dlg.kind === 'alert'}
        onClose={() => setDlg({ kind: 'none' })}
        title="Notice"
        actions={
          <Button variant="secondary" onClick={() => setDlg({ kind: 'none' })}>
            OK
          </Button>
        }
      >
        <p className="text-ink">{dlg.kind === 'alert' ? dlg.message : ''}</p>
      </Dialog>

      {/* Delete sail confirm */}
      <ConfirmDialog
        open={dlg.kind === 'confirm-delete'}
        onClose={() => setDlg({ kind: 'none' })}
        onConfirm={() => {
          if (dlg.kind === 'confirm-delete') void commitDelete(dlg.sailId);
        }}
        title="Delete sail?"
        message={
          deletingSail
            ? `Delete sail "${deletingSail.name}"? Its region will be lost.`
            : 'Delete this sail? Its region will be lost.'
        }
        confirmLabel="Delete"
        hold
      />
    </main>
  );
}
