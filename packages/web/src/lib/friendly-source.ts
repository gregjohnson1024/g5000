/**
 * Human-readable labels for the raw `Sample.source` strings emitted by the
 * bridge (e.g. `n2k:127250@0x11` → "Heading · 0x11"). Used on the /sources
 * page so users don't have to memorize PGN numbers.
 */

/** Canonical N2K PGN → friendly label. Add entries here as channels land. */
const PGN_LABELS: Record<number, string> = {
  59904: 'ISO Request',
  60160: 'TP Data',
  60416: 'TP Connection',
  60928: 'Address Claim',
  126992: 'System Time',
  126996: 'Product Info',
  126998: 'Config Info',
  127237: 'Heading/Track Control',
  127245: 'Rudder',
  127250: 'Heading',
  127251: 'Rate of Turn',
  127252: 'Heave',
  127257: 'Attitude',
  127258: 'Magnetic Variation',
  128259: 'Boat Speed',
  128267: 'Depth',
  128275: 'Distance Log',
  129025: 'GPS Position',
  129026: 'COG/SOG',
  129029: 'GNSS Position Data',
  129038: 'AIS Class A Position',
  129039: 'AIS Class B Position',
  129040: 'AIS Class B Extended',
  129283: 'XTE',
  129284: 'Navigation Data',
  129539: 'GNSS DOPs',
  129540: 'Satellites in View',
  129793: 'AIS UTC and Date',
  129794: 'AIS Class A Static',
  129809: 'AIS Class B Static A',
  129810: 'AIS Class B Static B',
  130306: 'Wind',
  130311: 'Environmental',
  130312: 'Temperature',
  130316: 'Temperature Ext',
  130824: 'B&G Performance',
  130860: 'B&G Proprietary',
  65305: 'Mfr Proprietary 65305',
  65341: 'Mfr Proprietary 65341',
  65350: 'Mfr Proprietary 65350',
};

/**
 * Parse a `n2k:<pgn>@0x<src>` tag into its parts. Returns null for non-N2K
 * tags (e.g. `computed:true_wind`, `demo`).
 */
export function parseN2kSource(
  tag: string,
): { pgn: number; srcHex: string; src: number } | null {
  const m = /^n2k:(\d+)@0x([0-9a-fA-F]+)$/.exec(tag);
  if (!m) return null;
  return { pgn: Number(m[1]), srcHex: `0x${m[2]!.toLowerCase()}`, src: parseInt(m[2]!, 16) };
}

/**
 * Format a JSON-safe ChannelValue for inline display next to a source.
 * Rad → degrees, m/s → knots, geo → lat/lon, enum → string.
 */
export function formatChannelValue(v: unknown): string {
  if (!v || typeof v !== 'object') return '—';
  const o = v as { kind?: string; value?: unknown; unit?: string };
  if (o.kind === 'scalar' && typeof o.value === 'number') {
    if (o.unit === 'rad') {
      // No 0-360 wrap — heel/pitch are signed, headings already arrive in
      // [0, 2π]. A small negative for heel reads better as -1° than 359°.
      const deg = (o.value * 180) / Math.PI;
      return `${deg.toFixed(0)}°`;
    }
    if (o.unit === 'rad/s') {
      const dps = (o.value * 180) / Math.PI;
      return `${dps.toFixed(1)}°/s`;
    }
    if (o.unit === 'm/s') return `${(o.value / 0.514444).toFixed(1)} kn`;
    if (o.unit === '%') return `${o.value.toFixed(1)}%`;
    return o.unit ? `${o.value.toFixed(2)} ${o.unit}` : o.value.toFixed(2);
  }
  if (o.kind === 'enum' && typeof o.value === 'string') return o.value;
  if (o.kind === 'geo' && o.value && typeof o.value === 'object') {
    const g = o.value as { lat?: number; lon?: number };
    if (typeof g.lat === 'number' && typeof g.lon === 'number') {
      const latH = g.lat >= 0 ? 'N' : 'S';
      const lonH = g.lon >= 0 ? 'E' : 'W';
      return `${Math.abs(g.lat).toFixed(4)}°${latH} ${Math.abs(g.lon).toFixed(4)}°${lonH}`;
    }
  }
  return JSON.stringify(o.value);
}

/**
 * Human-friendly label for any Sample.source tag.
 *
 * - `n2k:127250@0x11` → `Heading · 0x11`
 * - `n2k:99999@0x05`  → `PGN 99999 · 0x05` (unknown PGN falls back to the number)
 * - `computed:true_wind` → `computed: true wind`
 * - `demo` → `demo`
 */
export function friendlySourceLabel(tag: string): string {
  const n2k = parseN2kSource(tag);
  if (n2k) {
    const name = PGN_LABELS[n2k.pgn] ?? `PGN ${n2k.pgn}`;
    return `${name} · ${n2k.srcHex}`;
  }
  if (tag.startsWith('computed:')) {
    return `computed: ${tag.slice('computed:'.length).replace(/_/g, ' ')}`;
  }
  return tag;
}
