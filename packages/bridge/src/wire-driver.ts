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

export interface DriverHealth {
  connected: boolean;
  bytesPerSecond: number;
  framesPerSecond: number;
  errorCount: number;
}

/**
 * Phase-stable driver contract. Phase 0 implementations: Ngt1Driver,
 * SerialPort0183Driver, Bno085Driver. Phase 1: a single McuDriver.
 *
 * Observables are hot — subscribers receive only frames produced AFTER they
 * subscribe. Drivers must not buffer input.
 */
export interface WireDriver {
  rxCan: Observable<RawCanFrame>;
  txCan(frame: RawCanFrame): Promise<void>;
  health: Observable<DriverHealth>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
