import protobuf from 'protobufjs';
import type { DecodedSpoke } from './types.js';

// Mirrors mayara src/lib/protos/RadarMessage.proto (proto3).
const PROTO_SRC = `
syntax = "proto3";
message RadarMessage {
  uint32 radar = 1;
  message Spoke {
    uint32 angle = 1;
    optional uint32 bearing = 2;
    uint32 range = 3;
    optional uint64 time = 4;
    optional double lat = 6;
    optional double lon = 7;
    bytes data = 5;
  }
  repeated Spoke spokes = 2;
}`;

const RadarMessage = protobuf.parse(PROTO_SRC).root.lookupType('RadarMessage');

export function decodeRadarMessage(buf: Uint8Array): DecodedSpoke[] {
  const msg = RadarMessage.decode(buf) as unknown as {
    spokes?: Array<{
      angle?: number; bearing?: number; range?: number;
      time?: number | bigint; lat?: number; lon?: number; data?: Uint8Array;
    }>;
  };
  return (msg.spokes ?? []).map((s) => ({
    angle: s.angle ?? 0,
    bearing: s.bearing,
    range: s.range ?? 0,
    time: s.time === undefined ? undefined : Number(s.time),
    lat: s.lat,
    lon: s.lon,
    data: s.data ?? new Uint8Array(0),
  }));
}
