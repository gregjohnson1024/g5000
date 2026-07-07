'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Sail, SailCategory, SailWardrobe } from '@g5000/db';
import { CategoryRecommendation } from '../sails/CategoryRecommendation';
import { SailOverlayChart } from '../sails/SailOverlayChart';
import { SailRegionEditor } from '../sails/SailRegionEditor';
import { Button, Dialog, Panel, SegmentedControl } from '../../../components/ui';

type Mode = 'view' | 'edit';

export default function CrossoverPage() {
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [filter, setFilter] = useState<SailCategory | 'all'>('all');
  const [editSailId, setEditSailId] = useState<string | null>(null);
  const [errDlg, setErrDlg] = useState<string | null>(null);

  async function reload() {
    setWardrobe(await (await fetch('/api/sails')).json());
  }
  useEffect(() => {
    void reload();
  }, []);

  if (!wardrobe) return <div className="p-4 text-ink-3">Loading…</div>;

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
      setErrDlg(`Save failed: ${body.error ?? res.statusText}`);
      return;
    }
    await reload();
  }

  const modeSegments = [
    { value: 'view' as Mode, label: 'View all' },
    { value: 'edit' as Mode, label: 'Edit one' },
  ];

  const filterOptions: { value: SailCategory | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'headsail', label: 'Headsails' },
    { value: 'main', label: 'Main' },
    { value: 'downwind', label: 'Downwind' },
  ];

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold text-ink">Sail Crossover</h1>

      <div className="grid grid-cols-[240px_minmax(0,1fr)_200px] gap-4">
        {/* Left aside — recommendation */}
        <aside className="min-w-0">
          <Panel label="Recommendation">
            <CategoryRecommendation wardrobe={wardrobe} />
          </Panel>
        </aside>

        {/* Main editing / view area */}
        <main className="min-w-0 space-y-3">
          {/* Mode + filter controls */}
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              segments={modeSegments}
              value={mode}
              onChange={setMode}
              aria-label="View or edit mode"
              size="sm"
            />
            {mode === 'view' && (
              <SegmentedControl
                segments={filterOptions}
                value={filter}
                onChange={setFilter}
                aria-label="Category filter"
                size="sm"
              />
            )}
          </div>

          <Panel label={mode === 'view' ? 'All sails overlay' : 'Sail region editor'}>
            {mode === 'view' && <SailOverlayChart wardrobe={wardrobe} filterCategory={filter} />}
            {mode === 'edit' && editSail && (
              <SailRegionEditor
                sail={editSail}
                onSave={(cells) => saveRegion(editSail.id, cells)}
              />
            )}
            {mode === 'edit' && !editSail && (
              <p className="text-sm text-ink-3 py-4">Pick a sail to edit from the list →</p>
            )}
          </Panel>
        </main>

        {/* Right aside — sail list */}
        <aside className="min-w-0">
          <Panel label="Sails">
            {wardrobe.sails.length === 0 ? (
              <p className="text-caption text-ink-3">
                No sails yet. Add them on the{' '}
                <Link href="/boat/sails" className="underline text-ink-2 hover:text-ink">
                  Wardrobe page
                </Link>{' '}
                first.
              </p>
            ) : (
              <div className="space-y-3">
                {(['headsail', 'main', 'downwind'] as SailCategory[]).map((cat) => {
                  const sailsInCat = wardrobe.sails.filter((s) => s.category === cat);
                  return (
                    <div key={cat}>
                      <div className="text-caption uppercase tracking-wide text-ink-3 mb-1">
                        {cat}
                      </div>
                      {sailsInCat.length === 0 ? (
                        <div className="text-caption text-ink-4 italic">—</div>
                      ) : (
                        <div className="space-y-0.5">
                          {sailsInCat.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                setMode('edit');
                                setEditSailId(s.id);
                              }}
                              className={[
                                'block w-full text-left px-2 py-1 text-sm [border-radius:var(--r-control)]',
                                'hover:bg-surface-raised transition-colors',
                                s.id === editSailId ? 'bg-surface-raised text-ink' : 'text-ink-2',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              {s.name}{' '}
                              <span className="text-caption text-ink-3">
                                ({s.region.cells.length})
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </aside>
      </div>

      {/* Error dialog (replaces browser alert) */}
      <Dialog
        open={errDlg !== null}
        onClose={() => setErrDlg(null)}
        title="Save failed"
        actions={
          <Button variant="secondary" onClick={() => setErrDlg(null)}>
            OK
          </Button>
        }
      >
        <p className="text-ink">{errDlg}</p>
      </Dialog>
    </div>
  );
}
