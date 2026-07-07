'use client';

import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { HELM_GROUPS, type HelmGroup } from './helm-group';

const LABEL: Record<HelmGroup, string> = {
  starting: 'Starting',
  navigating: 'Navigate',
  performance: 'Performance',
};

/** Full-width SegmentedControl (44px) for the helm task tabs. */
export function HelmTabs({
  group,
  onChange,
}: {
  group: HelmGroup;
  onChange: (g: HelmGroup) => void;
}): React.ReactElement {
  const segments = HELM_GROUPS.map((g) => ({ value: g, label: LABEL[g] }));

  return (
    <SegmentedControl
      segments={segments}
      value={group}
      onChange={onChange}
      aria-label="Helm task group"
      size="md"
      className="w-full mb-3"
    />
  );
}
