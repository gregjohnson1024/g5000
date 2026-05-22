/**
 * Parse the S-57 COLOUR attribute (which may be a single code or
 * comma-separated list, e.g. "3" or "3,1,3") and return the leading
 * numeric code. Returns 0 when the input is missing or unparseable
 * — callers paint with a default colour in that case.
 *
 * Valid S-57 codes are 1..13 (white, black, red, green, blue, yellow,
 * grey, brown, amber, violet, orange, magenta, pink).
 */
export function parsePrimaryColour(raw: string | null | undefined): number {
  if (!raw) return 0;
  const head = raw.split(',')[0]?.trim();
  if (!head) return 0;
  const n = Number(head);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 13) return 0;
  return n;
}
