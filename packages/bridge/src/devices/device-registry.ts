import canboat from '@canboat/canboatjs';
import type { DecodedPgn } from '../decoder.js';
import type { OutgoingPgn } from '../wire-driver.js';

const { lookupEnumerationName } = canboat as unknown as {
  lookupEnumerationName: (enumName: string, value: number) => string | undefined;
};

export interface DeviceInfo {
  src: number;
  lastSeenMs: number;
  // From PGN 60928 (ISO Address Claim)
  uniqueNumber?: number;
  manufacturerCode?: number;
  manufacturerName?: string;
  deviceFunction?: number;
  deviceFunctionName?: string;
  deviceClass?: number;
  deviceClassName?: string;
  industryGroup?: string;
  // From PGN 126996 (Product Information)
  nmea2000Version?: number;
  productCode?: number;
  modelId?: string;
  softwareVersionCode?: string;
  modelVersion?: string;
  modelSerialCode?: string;
  certificationLevel?: number;
  loadEquivalency?: number;
}

export type DeviceTxer = (pgn: OutgoingPgn) => Promise<void>;

/**
 * Watches decoded PGNs for ISO Address Claim (60928) and Product Information
 * (126996), maintains a per-source-address registry of who's on the bus.
 *
 * `observe` updates state; `snapshot` returns a read-only view; `refresh`
 * issues ISO Request (PGN 59904) to ask devices to re-announce themselves.
 */
export class DeviceRegistry {
  private readonly devices = new Map<number, DeviceInfo>();
  private txer: DeviceTxer | null = null;

  observe(pgn: DecodedPgn): void {
    const existing = this.devices.get(pgn.src);
    const next: DeviceInfo = existing ?? { src: pgn.src, lastSeenMs: Date.now() };
    next.lastSeenMs = Date.now();

    if (pgn.pgn === 60928) {
      this.applyAddressClaim(next, pgn.fields);
    } else if (pgn.pgn === 126996) {
      this.applyProductInformation(next, pgn.fields);
    }

    this.devices.set(pgn.src, next);
  }

  snapshot(): Map<number, DeviceInfo> {
    // Shallow copy to prevent callers mutating internal state.
    return new Map(Array.from(this.devices.entries(), ([k, v]) => [k, { ...v }]));
  }

  registerTxer(fn: DeviceTxer): void {
    this.txer = fn;
  }

  unregisterTxer(fn?: DeviceTxer): void {
    // If a specific txer is provided, only clear when it matches (avoids
    // clobbering a newer registration). With no arg, unconditionally clear.
    if (fn === undefined || this.txer === fn) {
      this.txer = null;
    }
  }

  /**
   * Issue ISO Request (PGN 59904) to prompt devices to re-broadcast their
   * identity. With no `target`, broadcasts for PGN 60928 (all devices reply).
   * With a `target`, sends separately for both 60928 and 126996 to that
   * specific source address.
   */
  async refresh(target?: number): Promise<void> {
    if (!this.txer) {
      throw new Error(
        'DeviceRegistry.refresh: no txer registered (g5000 app must call registerTxer at boot)',
      );
    }
    if (target === undefined) {
      await this.txer({
        pgn: 59904,
        prio: 6,
        dst: 255,
        fields: { PGN: 60928 },
      });
    } else {
      await this.txer({
        pgn: 59904,
        prio: 6,
        dst: target,
        fields: { PGN: 60928 },
      });
      await this.txer({
        pgn: 59904,
        prio: 6,
        dst: target,
        fields: { PGN: 126996 },
      });
    }
  }

  private applyAddressClaim(info: DeviceInfo, fields: Record<string, unknown>): void {
    if (typeof fields['Unique Number'] === 'number') info.uniqueNumber = fields['Unique Number'];
    if (typeof fields['Manufacturer Code'] === 'number') {
      info.manufacturerCode = fields['Manufacturer Code'] as number;
      info.manufacturerName =
        safeLookup('MANUFACTURER_CODE', info.manufacturerCode) ??
        `Unknown (${info.manufacturerCode})`;
    }
    if (typeof fields['Device Function'] === 'number') {
      info.deviceFunction = fields['Device Function'] as number;
      info.deviceFunctionName = safeLookup('DEVICE_FUNCTION', info.deviceFunction);
    }
    if (typeof fields['Device Class'] === 'number') {
      info.deviceClass = fields['Device Class'] as number;
      info.deviceClassName = safeLookup('DEVICE_CLASS', info.deviceClass);
    }
    if (typeof fields['Industry Group'] === 'string') info.industryGroup = fields['Industry Group'];
  }

  private applyProductInformation(info: DeviceInfo, fields: Record<string, unknown>): void {
    if (typeof fields['NMEA 2000 Version'] === 'number')
      info.nmea2000Version = fields['NMEA 2000 Version'] as number;
    if (typeof fields['Product Code'] === 'number')
      info.productCode = fields['Product Code'] as number;
    if (typeof fields['Model ID'] === 'string')
      info.modelId = (fields['Model ID'] as string).trim();
    if (typeof fields['Software Version Code'] === 'string')
      info.softwareVersionCode = (fields['Software Version Code'] as string).trim();
    if (typeof fields['Model Version'] === 'string')
      info.modelVersion = (fields['Model Version'] as string).trim();
    if (typeof fields['Model Serial Code'] === 'string')
      info.modelSerialCode = (fields['Model Serial Code'] as string).trim();
    if (typeof fields['Certification Level'] === 'number')
      info.certificationLevel = fields['Certification Level'] as number;
    if (typeof fields['Load Equivalency'] === 'number')
      info.loadEquivalency = fields['Load Equivalency'] as number;
  }
}

function safeLookup(enumName: string, value: number): string | undefined {
  try {
    return lookupEnumerationName(enumName, value);
  } catch {
    return undefined;
  }
}
