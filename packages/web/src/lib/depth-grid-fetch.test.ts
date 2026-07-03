import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseGriddapCsv,
  elevGridToDepthTile,
  griddapCsvUrl,
  fetchElevChunk,
  type Fetcher,
} from './depth-grid-fetch';
import { loadDepthField, writeDepthGrid, NODATA } from './depth-grid';

/** Synthetic griddap CSV: header + units rows, descending latitude. */
function syntheticCsv(): string {
  const lines = ['latitude,longitude,z', 'degrees_north,degrees_east,meters'];
  // lat 31 → 30 (descending, as some datasets serve), lon -70 → -69.
  for (const lat of [31, 30.5, 30]) {
    for (const lon of [-70, -69.5, -69]) {
      // Elevation: -100 m at the SW corner, shoaling east+north; land at NE.
      const elev = lat === 31 && lon === -69 ? 5 : -100 + (lon + 70) * 80 + (lat - 30) * 40;
      lines.push(`${lat},${lon},${elev}`);
    }
  }
  return lines.join('\n');
}

describe('parseGriddapCsv', () => {
  it('parses data rows, skips header/units, sorts axes ascending', () => {
    const g = parseGriddapCsv(syntheticCsv());
    expect(g.lats).toEqual([30, 30.5, 31]);
    expect(g.lons).toEqual([-70, -69.5, -69]);
    expect(g.elev[0]![0]).toBe(-100); // lat 30, lon -70
    expect(g.elev[2]![2]).toBe(5); // lat 31, lon -69 (land)
  });

  it('throws on an empty / data-free response', () => {
    expect(() => parseGriddapCsv('')).toThrow();
    expect(() => parseGriddapCsv('latitude,longitude,z\nunits,units,units')).toThrow();
  });
});

describe('elevGridToDepthTile', () => {
  it('converts elevation to positive-down depth with land as NODATA', () => {
    const tile = elevGridToDepthTile(parseGriddapCsv(syntheticCsv()), 't');
    expect(tile.meta).toEqual({
      name: 't',
      latMin: 30,
      lonMin: -70,
      dLat: 0.5,
      dLon: 0.5,
      rows: 3,
      cols: 3,
    });
    expect(tile.data[0]).toBe(100); // -100 m elevation → 100 m depth
    expect(tile.data[2 * 3 + 2]).toBe(NODATA); // land (elev +5)
  });

  it('marks missing samples as NODATA', () => {
    const g = parseGriddapCsv(
      'latitude,longitude,z\n30,-70,-50\n30,-69,-60\n31,-70,-70\n31,-69,NaN',
    );
    const tile = elevGridToDepthTile(g, 't');
    expect(tile.data[1 * 2 + 1]).toBe(NODATA);
  });
});

describe('fetchElevChunk', () => {
  it('builds the documented griddap CSV subset URL with the stride', () => {
    expect(griddapCsvUrl('https://x/erddap/griddap/etopo', 30, 31, -70, -69, 4)).toBe(
      'https://x/erddap/griddap/etopo.csv?z[(30):4:(31)][(-70):4:(-69)]',
    );
  });

  it('retries failures, then round-trips through the tile store', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 502, text: async () => '' };
      return { ok: true, status: 200, text: async () => syntheticCsv() };
    };
    const grid = await fetchElevChunk('https://x/etopo', 30, 31, -70, -69, 15, fetcher, 3, 1);
    expect(calls).toBe(2);

    const dir = await mkdtemp(join(tmpdir(), 'depth-fetch-'));
    try {
      await writeDepthGrid(dir, 15, [elevGridToDepthTile(grid, 't_30_-70')]);
      const f = await loadDepthField({ latMin: 30, latMax: 31, lonMin: -70, lonMax: -69 }, dir);
      expect(f).not.toBeNull();
      expect(f!.depthAt(30, -70)).toBe(100);
      expect(f!.depthAt(31, -69)).toBeNull(); // land
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws after exhausting retries', async () => {
    const fetcher: Fetcher = async () => ({ ok: false, status: 500, text: async () => '' });
    await expect(
      fetchElevChunk('https://x/etopo', 30, 31, -70, -69, 15, fetcher, 1, 1),
    ).rejects.toThrow(/HTTP 500/);
  });
});
