import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { CaptureCodes } from './autopilot-commands.js';

export const DEFAULT_CAPTURE_CODES_PATH = path.join(
  process.env.G5000_ROUTER_ROOT ?? path.join(os.homedir(), '.g5000-router'),
  'ap-tx-codes.json',
);

/**
 * Read the AP transmit capture-codes file. Returns an empty CaptureCodes
 * object (rather than throwing) when the file is missing or unparseable,
 * so the API route can treat "missing capture" as a normal state.
 */
export async function readCaptureCodes(
  filePath: string = DEFAULT_CAPTURE_CODES_PATH,
): Promise<CaptureCodes> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return { version: 1, captures: {} };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CaptureCodes>;
    return {
      version: 1,
      captures: parsed.captures ?? {},
    };
  } catch (e) {
    console.warn('[capture-codes] failed to parse file, treating as empty:', (e as Error).message);
    return { version: 1, captures: {} };
  }
}
