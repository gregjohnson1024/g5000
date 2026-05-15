import { describe, expect, it } from 'vitest';
import type { RawCanFrame } from '../wire-driver.js';
import { encodePgnToCanFrames } from './fast-packet.js';

describe('encodePgnToCanFrames', () => {
  it('splits PGN 130850 PropID=Autopilot Event=Standby into 2 ordered Fast Packet frames', () => {
    const frames: RawCanFrame[] = encodePgnToCanFrames({
      pgn: 130850,
      prio: 3,
      dst: 255,
      fields: {
        'Manufacturer Code': 'Simrad',
        'Industry Code': 'Marine Industry',
        Address: 0,
        'Proprietary ID': 'Autopilot',
        'Command Type': 'AP Command',
        Event: 'Standby',
      },
    });
    expect(frames).toHaveLength(2);
    frames.forEach((f, i) => {
      // Frame# is the low 5 bits of data[0]; strictly ascending starting at 0.
      expect(f.data[0]! & 0x1f).toBe(i);
      // All frames share the same CAN ID.
      expect(f.id).toBe(frames[0]!.id);
    });
    // Frame 0's byte 1 is the total payload length (11 bytes for this PGN).
    expect(frames[0]!.data[1]).toBe(11);
    // All frames are 8 bytes (CAN max).
    frames.forEach((f) => expect(f.data.length).toBe(8));
  });

  it('produces exactly 1 frame for single-frame PGN 60928 (ISO Address Claim)', () => {
    const frames = encodePgnToCanFrames({
      pgn: 60928,
      prio: 6,
      dst: 255,
      fields: {
        'Unique Number': 0,
        'Manufacturer Code': 'Simrad',
        'Device Instance Lower': 0,
        'Device Instance Upper': 0,
        'Device Function': 130,
        'Device Class': 'Steering and Control surfaces',
        'System Instance': 0,
        'Industry Group': 'Marine',
      },
    });
    expect(frames).toHaveLength(1);
    expect(frames[0]!.data.length).toBe(8);
  });

  it('throws when canboatjs cannot encode the PGN', () => {
    expect(() =>
      encodePgnToCanFrames({
        pgn: 99999999,
        fields: {},
      }),
    ).toThrow();
  });
});
