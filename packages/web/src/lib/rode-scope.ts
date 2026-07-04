export interface ScopeInput {
  chainCounter: number;
  droopDeduct: number;
  depthM: number;
  bowHeightM: number;
}
export interface ScopeResult {
  rode: number;
  totalPlusBow: number;
  scope: number | null;
}
export function computeScope(i: ScopeInput): ScopeResult {
  const rode = Math.max(0, i.chainCounter - i.droopDeduct);
  const totalPlusBow = i.depthM + i.bowHeightM;
  return { rode, totalPlusBow, scope: totalPlusBow > 0 ? rode / totalPlusBow : null };
}
