'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { SailWardrobe } from '@g5000/db';
import { useSse } from '../../hooks/use-sse';
import { AudibleAlarm } from '../../components/AudibleAlarm';
import { AnnotationDropper } from '../../components/AnnotationDropper';
import { RaceMiniTimer } from './RaceMiniTimer';
import { AlertsPanel } from './AlertsPanel';
import { CoreStrip } from './CoreStrip';
import { HelmTabs } from './HelmTabs';
import { useHelmGroup } from './use-helm-group';
import { StartingGroup } from './groups/StartingGroup';
import { NavigatingGroup } from './groups/NavigatingGroup';
import { PerformanceGroup } from './groups/PerformanceGroup';

export default function HelmPage(): React.ReactElement {
  const { channels, connected } = useSse();
  const [group, setGroup] = useHelmGroup();
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);

  const reloadWardrobe = useCallback(async () => {
    try {
      const r = await fetch('/api/sails', { cache: 'no-store' });
      if (!r.ok) return;
      setWardrobe((await r.json()) as SailWardrobe);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    void reloadWardrobe();
  }, [reloadWardrobe]);

  return (
    <main className="page-main p-4 flex-1 overflow-y-auto bg-canvas relative">
      {/* Page header — tokens only, no slate-* */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-ink">Helm</h1>
        <div className="flex items-center gap-3">
          <RaceMiniTimer />
          <div className="text-xs text-ink-3">{connected ? 'Live' : 'Reconnecting…'}</div>
        </div>
      </div>

      <AlertsPanel />

      {/* Sails wardrobe strip — tokens only */}
      {wardrobe && (
        <div className="flex items-center gap-3 mb-3 text-sm bg-surface border border-hairline rounded px-3 py-2">
          <span className="text-ink-2">Sails:</span>
          {(['headsail', 'main', 'downwind'] as const).map((cat) => {
            const activeId = wardrobe.active[cat];
            const sail = activeId ? wardrobe.sails.find((s) => s.id === activeId) : undefined;
            return (
              <span key={cat} className="text-xs text-ink">
                <span className="text-ink-3">{cat}:</span>{' '}
                <span className="text-ink-value">{sail?.name ?? '—'}</span>
              </span>
            );
          })}
          <Link href="/boat/sails" className="text-xs text-ink-3 hover:text-ink underline">
            manage
          </Link>
        </div>
      )}

      <CoreStrip channels={channels} />
      <HelmTabs group={group} onChange={setGroup} />

      {group === 'starting' && <StartingGroup channels={channels} />}
      {group === 'navigating' && <NavigatingGroup channels={channels} />}
      {group === 'performance' && <PerformanceGroup channels={channels} />}

      <AudibleAlarm />
      <div className="absolute top-2 right-2 z-20">
        <AnnotationDropper variant="icon" />
      </div>
    </main>
  );
}
