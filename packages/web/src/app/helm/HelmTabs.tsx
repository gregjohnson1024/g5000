'use client';

import { HELM_GROUPS, type HelmGroup } from './helm-group';

const LABEL: Record<HelmGroup, string> = {
  starting: 'Starting',
  navigating: 'Navigating',
  performance: 'Performance',
};

/** Full-width segmented control; large touch targets for helm use. */
export function HelmTabs({
  group,
  onChange,
}: {
  group: HelmGroup;
  onChange: (g: HelmGroup) => void;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-3 gap-1 mb-3 bg-slate-900 border border-slate-800 rounded p-1">
      {HELM_GROUPS.map((g) => {
        const active = g === group;
        return (
          <button
            key={g}
            type="button"
            onClick={() => onChange(g)}
            aria-pressed={active}
            className={`py-3 rounded text-sm font-semibold uppercase tracking-wide transition-colors ${
              active ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'
            }`}
          >
            {LABEL[g]}
          </button>
        );
      })}
    </div>
  );
}
