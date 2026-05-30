/** Pure mutators over an ordered list of waypoint IDs: [start, ...via, end].
 *  Each returns a new array; callers feed the result back into state. */
export function append(ids: string[], id: string): string[] {
  return [...ids, id];
}
export function removeId(ids: string[], id: string): string[] {
  const i = ids.indexOf(id);
  return i === -1 ? ids : removeAt(ids, i);
}
export function removeAt(ids: string[], index: number): string[] {
  if (index < 0 || index >= ids.length) return ids;
  return [...ids.slice(0, index), ...ids.slice(index + 1)];
}
export function insertAt(ids: string[], index: number, id: string): string[] {
  const i = Math.max(0, Math.min(index, ids.length));
  return [...ids.slice(0, i), id, ...ids.slice(i)];
}
export function setStart(ids: string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)];
}
export function setEnd(ids: string[], id: string): string[] {
  return [...ids.filter((x) => x !== id), id];
}
export function startOf(ids: string[]): string | undefined {
  return ids[0];
}
export function endOf(ids: string[]): string | undefined {
  return ids[ids.length - 1];
}
export function viaOf(ids: string[]): string[] {
  return ids.slice(1, -1);
}
