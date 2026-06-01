export type HelmGroup = 'starting' | 'navigating' | 'performance';

export const HELM_GROUPS: readonly HelmGroup[] = ['starting', 'navigating', 'performance'];
export const DEFAULT_GROUP: HelmGroup = 'navigating';
export const STORAGE_KEY = 'g5000.helm.group';

export function normalizeGroup(raw: string | null | undefined): HelmGroup {
  return (HELM_GROUPS as readonly string[]).includes(raw ?? '')
    ? (raw as HelmGroup)
    : DEFAULT_GROUP;
}
