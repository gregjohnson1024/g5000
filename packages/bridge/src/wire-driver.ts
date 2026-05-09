import type { Observable } from 'rxjs';

/**
 * A raw extended-frame CAN message. The driver layer emits these unmodified;
 * fast-packet reassembly happens above the driver in the decoder layer. This
 * keeps the contract identical between Phase 0 (NGT-1) and Phase 1 (custom MCU).
 */
export interface RawCanFrame {
  /** 29-bit extended CAN identifier (priority + PGN + source addr packed). */
  id: number;
  /** Always true for N2K (J1939 uses 29-bit IDs). */
  ext: true;
  /** Up to 8 data bytes. */
  data: Uint8Array;
  /** Capture time on the host, ns since Unix epoch. */
  rxTimestamp: bigint;
}

/**
 * One NMEA 0183 sentence as received on the wire, before parsing.
 * `text` is the raw ASCII line minus its trailing CR/LF; `port` identifies
 * which physical RS-422 port produced it (so multi-port drivers can
 * disambiguate sources).
 */
export interface Raw0183Sentence {
  text: string;
  port: number;
  rxTimestamp: bigint;
}

export interface DriverHealth {
  connected: boolean;
  bytesPerSecond: number;
  framesPerSecond: number;
  errorCount: number;
}

export interface OutgoingPgn {
  pgn: number;
  /** Priority 0–7. Default 6 if undefined. */
  prio?: number;
  /** Destination address. Default 255 (broadcast) if undefined. */
  dst?: number;
  /** Field name → value, matching canboat's database. */
  fields: Record<string, unknown>;
}

/**
 * Phase-stable driver contract. Phase 0 implementations: Ngt1Driver,
 * SerialPort0183Driver, ReplayDriver. Phase 1: a single McuDriver.
 *
 * Drivers expose every input stream they care about. Drivers that don't
 * produce a given stream type return rxjs `EMPTY`. The bridge orchestrator
 * merges streams across drivers without special-casing source types.
 */
export interface WireDriver {
  rxCan: Observable<RawCanFrame>;
  rx0183: Observable<Raw0183Sentence>;
  txCan(frame: RawCanFrame): Promise<void>;
  tx0183(port: number, text: string): Promise<void>;
  /**
   * Transmit a typed PGN object onto the bus. The driver is responsible for
   * encoding it appropriately (Actisense ASCII for NGT-1, raw CAN for the
   * Phase 1 MCU driver).
   */
  txPgn(pgn: OutgoingPgn): Promise<void>;
  health: Observable<DriverHealth>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
