import { parseN2kSource, friendlySourceLabel } from './friendly-source';

/** Minimal device shape needed to label a source — a subset of the bridge's DeviceInfo. */
export interface DeviceLabelInfo {
  src: number;
  manufacturerName?: string;
  modelId?: string;
  deviceFunctionName?: string;
}

/**
 * Human label for a Sample `source` tag, enriched with N2K device info when
 * available (manufacturer/model/function + hex address). Falls back to
 * `friendlySourceLabel()` for computed/unknown sources or unmatched devices.
 */
export function deviceLabel(source: string, devices: Map<number, DeviceLabelInfo>): string {
  const parsed = parseN2kSource(source);
  if (!parsed) return friendlySourceLabel(source); // computed:* or unparseable
  const dev = devices.get(parsed.src);
  if (!dev) return friendlySourceLabel(source); // no device row known
  const name = [dev.manufacturerName, dev.modelId].filter(Boolean).join(' ').trim();
  if (name) return `${name} (${parsed.srcHex})`;
  if (dev.deviceFunctionName) return `${dev.deviceFunctionName} (${parsed.srcHex})`;
  return friendlySourceLabel(source); // device row exists but carries no useful label
}
