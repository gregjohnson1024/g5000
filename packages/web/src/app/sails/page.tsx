'use client';

import { useEffect, useState } from 'react';
import type { Sail, SailCategory, SailWardrobe } from '@g5000/db';

const CATEGORIES: { key: SailCategory; label: string }[] = [
  { key: 'headsail', label: 'Headsails' },
  { key: 'main', label: 'Main / Reef' },
  { key: 'downwind', label: 'Downwind' },
];

function slug(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

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
      alert(`Save failed: ${body.error ?? res.statusText}`);
      return;
    }
    setWardrobe(next);
  }

  if (!wardrobe) return <div className="p-4">Loading…</div>;

  async function addSail(cat: SailCategory) {
    const name = draftName[cat].trim();
    if (!name) return;
    const id = slug(name);
    if (wardrobe!.sails.some((s) => s.id === id)) {
      alert(`Sail "${id}" already exists.`);
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
    if (!confirm(`Delete sail "${sailId}"? Its region will be lost.`)) return;
    await save({ ...wardrobe!, sails: wardrobe!.sails.filter((s) => s.id !== sailId) });
  }

  async function setActive(cat: SailCategory, sailId: string | null) {
    await fetch('/api/sails/active', {
      method: 'POST',
      body: JSON.stringify({ category: cat, sailId }),
    });
    await reload();
  }

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Sail Wardrobe</h1>
      {CATEGORIES.map(({ key, label }) => {
        const sailsInCat = wardrobe.sails.filter((s) => s.category === key);
        return (
          <section key={key}>
            <h2 className="text-lg font-medium mb-2">{label}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Name</th>
                  <th className="text-left">Area (m²)</th>
                  <th className="text-left">Cells</th>
                  <th className="text-left">Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sailsInCat.map((sail) => (
                  <tr key={sail.id}>
                    <td>{sail.name}</td>
                    <td>{sail.areaSqM ?? ''}</td>
                    <td>{sail.region.cells.length}</td>
                    <td>
                      <input
                        type="radio"
                        name={`active-${key}`}
                        checked={wardrobe.active[key] === sail.id}
                        onChange={() => setActive(key, sail.id)}
                      />
                    </td>
                    <td>
                      <button onClick={() => deleteSail(sail.id)} className="text-red-500">
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <input
                      value={draftName[key]}
                      onChange={(e) => setDraftName({ ...draftName, [key]: e.target.value })}
                      placeholder="new sail name"
                      className="border px-1"
                    />
                  </td>
                  <td>
                    <input
                      value={draftArea[key]}
                      onChange={(e) => setDraftArea({ ...draftArea, [key]: e.target.value })}
                      placeholder="m²"
                      className="border px-1 w-20"
                    />
                  </td>
                  <td colSpan={3}>
                    <button onClick={() => addSail(key)} className="text-blue-500">
                      add
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        );
      })}
      <p className="text-sm text-gray-500">
        Paint each sail&apos;s TWS/TWA region on the{' '}
        <a href="/sails/crossover" className="underline">
          crossover page
        </a>
        .
      </p>
    </div>
  );
}
