/** Lower-case tokens to render upper-case in channel labels. */
const ACRONYMS = new Set([
  'gps', 'cog', 'sog', 'vmg', 'twa', 'tws', 'twd', 'awa', 'aws', 'ais', 'imu', 'eta', 'hdg',
  'xte', 'rpm', 'utc',
]);

/** Channels whose path-derived label reads poorly. */
export const CHANNEL_LABEL_OVERRIDES: Record<string, string> = {
  'nav.magvar': 'Magnetic variation',
};

/** Split a segment on camelCase boundaries into lower-case words. */
function splitWords(segment: string): string[] {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/**
 * Human-readable label for a channel id: prettify the dotted path
 * (`boat.rudder.angle` → "Boat rudder angle"), splitting camelCase and
 * upper-casing known acronyms (GPS, COG, VMG, …). `CHANNEL_LABEL_OVERRIDES`
 * wins for ids that don't prettify cleanly.
 */
export function channelLabel(channel: string): string {
  const override = CHANNEL_LABEL_OVERRIDES[channel];
  if (override) return override;
  const words = channel
    .split('.')
    .flatMap(splitWords)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w));
  if (words.length === 0) return channel;
  const first = words[0]!;
  words[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(' ');
}

/**
 * Classify a channel by its source tags: 'measured' if any source is from a
 * device (`n2k:`/`0183:`), else 'computed'.
 */
export function channelKind(sourcesForChannel: string[]): 'measured' | 'computed' {
  return sourcesForChannel.some((s) => s.startsWith('n2k:') || s.startsWith('0183:'))
    ? 'measured'
    : 'computed';
}
