'use client';

import { useEffect, useState } from 'react';
import type { Sail, SailCategory, SailWardrobe } from '@g5000/db';
import { CategoryRecommendation } from '../CategoryRecommendation';
import { SailOverlayChart } from '../SailOverlayChart';
import { SailRegionEditor } from '../SailRegionEditor';

type Mode = 'view' | 'edit';

export default function CrossoverPage() {
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [filter, setFilter] = useState<SailCategory | 'all'>('all');
  const [editSailId, setEditSailId] = useState<string | null>(null);

  async function reload() {
    setWardrobe(await (await fetch('/api/sails')).json());
  }
  useEffect(() => {
    void reload();
  }, []);

  if (!wardrobe) return <div className="p-4">Loading…</div>;

  const editSail: Sail | undefined = editSailId
    ? wardrobe.sails.find((s) => s.id === editSailId)
    : undefined;

  async function saveRegion(sailId: string, cells: string[]) {
    const res = await fetch(`/api/sails/${sailId}/region`, {
      method: 'POST',
      body: JSON.stringify({ cells }),
    });
    if (!res.ok) {
      const body = await res.json();
      alert(`Save failed: ${body.error ?? res.statusText}`);
      return;
    }
    await reload();
  }

  return (
    <div className="grid grid-cols-[260px_minmax(0,1fr)_220px] gap-4 p-4">
      <aside className="min-w-0">
        <CategoryRecommendation wardrobe={wardrobe} />
      </aside>
      <main className="min-w-0">
        <div className="flex gap-2 mb-2 text-sm">
          <button
            onClick={() => setMode('view')}
            className={mode === 'view' ? 'underline font-medium' : ''}
          >
            View all
          </button>
          <button
            onClick={() => setMode('edit')}
            className={mode === 'edit' ? 'underline font-medium' : ''}
          >
            Edit one
          </button>
          {mode === 'view' && (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as SailCategory | 'all')}
              className="border ml-4"
            >
              <option value="all">All categories</option>
              <option value="headsail">Headsails only</option>
              <option value="main">Main only</option>
              <option value="downwind">Downwind only</option>
            </select>
          )}
        </div>
        {mode === 'view' && <SailOverlayChart wardrobe={wardrobe} filterCategory={filter} />}
        {mode === 'edit' && editSail && (
          <SailRegionEditor sail={editSail} onSave={(cells) => saveRegion(editSail.id, cells)} />
        )}
        {mode === 'edit' && !editSail && (
          <div className="text-sm text-gray-500">Pick a sail to edit →</div>
        )}
      </main>
      <aside className="min-w-0">
        <h3 className="text-sm font-medium">Sails</h3>
        {wardrobe.sails.length === 0 && (
          <p className="mt-2 text-xs text-gray-500">
            No sails yet. Add them on the{' '}
            <a href="/sails" className="underline">
              Wardrobe page
            </a>{' '}
            first.
          </p>
        )}
        {(['headsail', 'main', 'downwind'] as SailCategory[]).map((cat) => {
          const sailsInCat = wardrobe.sails.filter((s) => s.category === cat);
          return (
            <div key={cat} className="mt-2">
              <div className="text-xs uppercase tracking-wide text-gray-500">{cat}</div>
              {sailsInCat.length === 0 ? (
                <div className="text-xs text-gray-400 italic">—</div>
              ) : (
                sailsInCat.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setMode('edit');
                      setEditSailId(s.id);
                    }}
                    className={`block w-full text-left px-1 ${
                      s.id === editSailId ? 'bg-blue-100' : ''
                    }`}
                  >
                    {s.name}{' '}
                    <span className="text-xs text-gray-400">({s.region.cells.length})</span>
                  </button>
                ))
              )}
            </div>
          );
        })}
      </aside>
    </div>
  );
}
