/**
 * URL/id slug helper.
 *
 * Copied verbatim from the canonical `slugify` in lib/routes.ts so
 * behaviour is byte-identical to the local copy this replaces.
 */

/** Lowercase, trim, collapse non-alphanumerics to single hyphens, strip edges. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
