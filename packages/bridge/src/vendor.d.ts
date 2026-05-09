/**
 * Ambient declaration for @canboat/canboatjs, which ships no TypeScript types.
 * We type only the subset we use; the full cast happens in decoder.ts.
 */
declare module '@canboat/canboatjs' {
  const canboat: Record<string, unknown>;
  export default canboat;
}
