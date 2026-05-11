import type { PolarTable } from '@g5000/db';

const KNOTS_TO_MS = 0.514444;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Parse an Expedition-style polar CSV/TSV into a typed PolarTable.
 *
 * Format:
 *   - First non-blank, non-comment line is the header: `twa/tws<sep>tws1<sep>tws2<sep>...`
 *     (TWS values in knots).
 *   - Subsequent lines: `twa<sep>bsp1<sep>bsp2<sep>...` (TWA in degrees, boat speed in knots).
 *   - Separator can be tab or comma; both are accepted on every line.
 *   - Blank lines and lines starting with `#` are skipped.
 *   - All values are converted to SI: TWS m/s, TWA radians, boat speed m/s.
 */
export function parseExpeditionPolar(csv: string): PolarTable {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length < 2) {
    throw new Error('parseExpeditionPolar: need at least a header line and one data row');
  }
  const headerTokens = splitLine(lines[0]!);
  if (headerTokens.length < 2) {
    throw new Error(`parseExpeditionPolar: header has too few columns: "${lines[0]}"`);
  }
  const headerLabel = headerTokens[0]!.toLowerCase().replace(/\s/g, '');
  // Accept any header that includes "twa" or "tws" or starts with a label
  // followed by numeric TWS values. We tolerate "twa/tws", "twa\\tws", etc.
  if (!/twa|tws|^[a-z]/.test(headerLabel)) {
    throw new Error(`parseExpeditionPolar: header doesn't look like a polar header: "${lines[0]}"`);
  }
  const twsBinsKn = headerTokens.slice(1).map((s) => {
    const n = Number(s);
    if (!Number.isFinite(n)) {
      throw new Error(`parseExpeditionPolar: non-numeric TWS in header: "${s}"`);
    }
    return n;
  });

  const twaBinsDeg: number[] = [];
  const boatSpeedKnByTwa: number[][] = [];

  for (let i = 1; i < lines.length; i++) {
    const tokens = splitLine(lines[i]!);
    if (tokens.length !== twsBinsKn.length + 1) {
      throw new Error(
        `parseExpeditionPolar: row ${i + 1} has ${tokens.length} cols, expected ${twsBinsKn.length + 1}: "${lines[i]}"`,
      );
    }
    const twaDeg = Number(tokens[0]);
    if (!Number.isFinite(twaDeg)) {
      throw new Error(`parseExpeditionPolar: row ${i + 1} TWA is not numeric: "${tokens[0]}"`);
    }
    twaBinsDeg.push(twaDeg);
    boatSpeedKnByTwa.push(
      tokens.slice(1).map((s, j) => {
        const n = Number(s);
        if (!Number.isFinite(n)) {
          throw new Error(`parseExpeditionPolar: row ${i + 1} col ${j + 2} is not numeric: "${s}"`);
        }
        return n;
      }),
    );
  }

  // Convert to SI and reshape to [twsIdx][twaIdx].
  const twsBins = twsBinsKn.map((kn) => kn * KNOTS_TO_MS);
  const twaBins = twaBinsDeg.map((deg) => Math.round(deg * DEG_TO_RAD * 1e6) / 1e6);
  const boatSpeed: number[][] = twsBins.map((_, twsIdx) =>
    boatSpeedKnByTwa.map((row) => row[twsIdx]! * KNOTS_TO_MS),
  );

  return { twsBins, twaBins, boatSpeed };
}

function splitLine(line: string): string[] {
  // Try tab first, fall back to comma if there are no tabs.
  return line.includes('\t') ? line.split(/\t+/) : line.split(/,+/);
}
