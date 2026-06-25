# Halo Radar Chart Overlay (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render live Navico/B&G Halo radar echoes as a georeferenced overlay on g5000's `/chart`, fed by a `mayara-server` sidecar, controllable (range/gain/sea/rain/opacity), built and demoed against mayara's `--emulator`.

**Architecture:** `mayara-server` runs as its own systemd service on the Pi and does the hard work (Halo discovery + Navico spoke decode), exposing a Signal-K HTTP API + a binary-protobuf spoke WebSocket on `:6502`. The browser decodes spokes with protobufjs, paints them into an offscreen radar-centric canvas, and blits that onto MapLibre as a corner-pinned `CanvasSource`. The heavy stream never touches g5000's Node process; only a tiny server-side status poller and the React UI do.

**Tech Stack:** TypeScript (ESM, strict), Next.js 16 / React 19 + MapLibre (`@g5000/web`), `protobufjs ^7`, vitest (`pool: 'forks'`), Drizzle/SQLite `ConfigStore` (`@g5000/db`), RxJS `Bus` + channels (`@g5000/core`), systemd.

## Global Constraints

- Node ≥22, ESM-only, strict TS (`noUncheckedIndexedAccess`). Prettier: 100 cols, single quotes, trailing commas all, 2-space.
- mayara default port **6502**; API base path `/signalk/v2/api/vessels/self/radars`; spoke WS field is **`spokeDataUrl`**; controls path is constructed as `${base}/${radarId}/controls/${controlId}` (there is **no** controlsUrl field).
- Spoke `data[i]` is a **legend index** (0..255); colour = `legend.pixels[data[i]].color` as `#rrggbbaa`; **byte 0 is transparent**; unmapped indices default to opaque red `[255,0,0,255]`.
- Cell `i` distance from radar = `i / data.length * spoke.range` metres; spoke direction = `spoke.bearing` (true, when present) else `spoke.angle` from bow + boat heading; both are in units of `[0..spokesPerRevolution)`.
- The radar pixel stream must NOT go on the `Bus` or `/api/stream` (scalar/JSON/≤20 Hz). Only scalar radar _status_ may.
- Reachability is **Tailscale-only**: browser → mayara at the Pi's tailnet address:6502. HTTPS-served pages require `wss://` (mixed-content); derive `ws`/`wss` from `location.protocol`.
- All UI times UTC; lat/lon display is compact DMM (not relevant to most radar UI but applies to any coordinate readout).
- New chart-layer components follow the `WindOverlay.tsx` pattern: props `{ map, ...data, hidden }`, idempotent `ensure()` guarding every `addSource`/`addLayer`, retry on `map.on('styledata', ensure)`, **do not** gate on `map.isStyleLoaded()`, push live visual changes via `map.setPaintProperty`.

## File Structure

Created under `packages/web/src/lib/radar/` (pure logic, unit-tested), `packages/web/src/components/` + `packages/web/src/app/chart/` (UI), `apps/g5000/src/radar/` (server status), `packages/db` + `packages/core` (config + channels), `scripts/` (deploy).

| Path                                                    | Responsibility                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/web/src/lib/radar/proto.ts`                   | inlined `RadarMessage.proto` source + protobufjs `decodeRadarMessage(buf)`      |
| `packages/web/src/lib/radar/types.ts`                   | TS types: `RadarInfo`, `Capabilities`, `Legend`, `DecodedSpoke`, `ControlValue` |
| `packages/web/src/lib/radar/legend.ts`                  | `buildColorLut(legend) → Uint8ClampedArray(256*4)`                              |
| `packages/web/src/lib/radar/geo.ts`                     | `rangeBboxCorners(centerLat, centerLon, rangeM)` for CanvasSource               |
| `packages/web/src/lib/radar/geometry.ts`                | pure spoke→canvas pixel math                                                    |
| `packages/web/src/lib/radar/renderer.ts`                | `RadarCanvas`: paint spoke batches onto an offscreen canvas                     |
| `packages/web/src/lib/radar/mayara-client.ts`           | `MayaraClient`: discovery, capabilities, controls, spoke WS + reconnect         |
| `packages/web/src/components/RadarOverlay.tsx`          | MapLibre layer (CanvasSource corner-pin), owns client+renderer lifecycle        |
| `packages/web/src/app/chart/RadarControls.tsx`          | range/gain/sea/rain/opacity control panel                                       |
| `packages/web/src/app/chart/LayersControl.tsx` (modify) | add `radar` toggle                                                              |
| `packages/web/src/app/chart/ChartToolbar.tsx` (modify)  | add `radar` to the onToggle key union                                           |
| `packages/web/src/app/chart/page.tsx` (modify)          | mount `RadarOverlay`, `chart:layers.radar` + `chart:radar` localStorage         |
| `packages/db/src/...` (modify)                          | `radar.mayaraBaseUrl` + defaults config                                         |
| `packages/core/src/channels.ts` (modify)                | `radar.connected`, `radar.range.m` channels                                     |
| `apps/g5000/src/radar/status-poller.ts`                 | poll mayara state → publish status channels                                     |
| `apps/g5000/src/index.ts` (modify)                      | start the status poller                                                         |
| `scripts/mayara.service` + `scripts/mayara.README.md`   | systemd unit + install/run docs                                                 |
| `packages/web/src/lib/radar/__fixtures__/*`             | captured emulator `radars.json`, `capabilities.json`, `spoke-frame.bin`         |

---

### Task 1: mayara emulator + captured fixtures + deps

Stand up the emulator and capture real API/protobuf payloads so every later task tests against ground truth (no invented bytes).

**Files:**

- Create: `packages/web/src/lib/radar/__fixtures__/radars.json`, `capabilities.json`, `spoke-frame.bin`, `capture.md`
- Create: `scripts/mayara-emulator.sh` (download + run helper)
- Modify: `packages/web/package.json` (add `protobufjs` dependency)

**Interfaces:**

- Produces: fixture files consumed by Tasks 2–6; `protobufjs` available to `@g5000/web`.

- [ ] **Step 1: Download the macOS emulator binary and run it**

```bash
mkdir -p /tmp/mayara && cd /tmp/mayara
gh release download v3.6.0 --repo MarineYachtRadar/mayara-server \
  --pattern 'mayara-server-*-universal-apple-darwin.tar.gz' --clobber
tar xzf mayara-server-*-universal-apple-darwin.tar.gz
./mayara-server --emulator -p 6502 &   # serves REST + spoke WS on :6502
sleep 2
```

Expected: log lines showing an emulator radar registered and an HTTP server on `:6502`.

- [ ] **Step 2: Capture the discovery + capabilities JSON fixtures**

```bash
cd /Users/gregjohnson/code/g5000/packages/web/src/lib/radar/__fixtures__   # mkdir -p first
curl -s http://127.0.0.1:6502/signalk/v2/api/vessels/self/radars | tee radars.json
RID=$(curl -s http://127.0.0.1:6502/signalk/v2/api/vessels/self/radars | python3 -c 'import sys,json;print(list(json.load(sys.stdin))[0])')
curl -s "http://127.0.0.1:6502/signalk/v2/api/vessels/self/radars/$RID/capabilities" | tee capabilities.json
```

Expected: `radars.json` is a map with one radar carrying `spokeDataUrl`; `capabilities.json` carries `spokesPerRevolution`, `maxSpokeLength`, and `legend.pixels[]`.

- [ ] **Step 3: Capture one binary spoke frame**

```bash
SPOKE_URL=$(python3 -c 'import json;d=json.load(open("radars.json"));r=d[list(d)[0]];print(r["spokeDataUrl"].replace("0.0.0.0","127.0.0.1"))')
node -e 'const WebSocket=require("/tmp/mayara/node_modules/ws")||require("ws");' 2>/dev/null || npm --prefix /tmp/mayara i ws >/dev/null 2>&1
node -e '
const fs=require("fs"); const WebSocket=require("/tmp/mayara/node_modules/ws");
const ws=new WebSocket(process.argv[1]); ws.binaryType="arraybuffer";
ws.on("message",d=>{ if(typeof d!=="string"){ fs.writeFileSync("spoke-frame.bin",Buffer.from(d)); console.log("wrote",Buffer.from(d).length,"bytes"); ws.close(); process.exit(0);} });
setTimeout(()=>{console.error("no binary frame");process.exit(1)},5000);
' "$SPOKE_URL"
```

Expected: `wrote <N> bytes` and a non-empty `spoke-frame.bin`.

- [ ] **Step 4: Record how to reproduce + add the dependency**

Write `__fixtures__/capture.md` documenting the four commands above. Then:

```bash
cd /Users/gregjohnson/code/g5000
npm install protobufjs@^7 --workspace @g5000/web
```

Create `scripts/mayara-emulator.sh` wrapping Step 1 (download-if-missing + run `--emulator`) for repeatable local dev.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/radar/__fixtures__ scripts/mayara-emulator.sh packages/web/package.json package-lock.json
git commit -m "feat(radar): mayara emulator fixtures + protobufjs dep"
```

---

### Task 2: Spoke types + protobuf decode

**Files:**

- Create: `packages/web/src/lib/radar/types.ts`
- Create: `packages/web/src/lib/radar/proto.ts`
- Test: `packages/web/src/lib/radar/proto.test.ts`

**Interfaces:**

- Produces:
  - `interface DecodedSpoke { angle: number; bearing?: number; range: number; time?: number; lat?: number; lon?: number; data: Uint8Array }`
  - `decodeRadarMessage(buf: Uint8Array): DecodedSpoke[]`

- [ ] **Step 1: Write the failing test (decode the captured frame)**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { decodeRadarMessage } from './proto.js';

const frame = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./__fixtures__/spoke-frame.bin', import.meta.url))),
);

describe('decodeRadarMessage', () => {
  it('decodes spokes with angle/range/data', () => {
    const spokes = decodeRadarMessage(frame);
    expect(spokes.length).toBeGreaterThan(0);
    const s = spokes[0]!;
    expect(s.angle).toBeGreaterThanOrEqual(0);
    expect(s.range).toBeGreaterThan(0);
    expect(s.data.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run packages/web/src/lib/radar/proto.test.ts`
Expected: FAIL — `decodeRadarMessage` not found.

- [ ] **Step 3: Implement `types.ts` and `proto.ts`**

`types.ts`:

```ts
export interface DecodedSpoke {
  angle: number;
  bearing?: number;
  range: number;
  time?: number;
  lat?: number;
  lon?: number;
  data: Uint8Array;
}

export interface LegendPixel {
  color: string;
  type: string;
}
export interface Legend {
  pixels: LegendPixel[];
  lowReturn?: number;
  mediumReturn?: number;
  strongReturn?: number;
  pixelColors?: number;
  historyStart?: number;
}
export interface Capabilities {
  spokesPerRevolution: number;
  maxSpokeLength: number;
  maxRange: number;
  minRange: number;
  supportedRanges: number[];
  legend: Legend;
  hasDoppler?: boolean;
}
export interface RadarInfo {
  name: string;
  brand: string;
  model?: string;
  spokeDataUrl: string;
  streamUrl?: string;
  radarIpAddress?: string;
  replay?: boolean;
}
export interface ControlValue {
  value: number | string;
  auto?: boolean;
}
```

`proto.ts` (inline the proto so it works in both node tests and the browser — no fs / no codegen step):

```ts
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
      angle?: number;
      bearing?: number;
      range?: number;
      time?: number | bigint;
      lat?: number;
      lon?: number;
      data?: Uint8Array;
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
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run packages/web/src/lib/radar/proto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/radar/types.ts packages/web/src/lib/radar/proto.ts packages/web/src/lib/radar/proto.test.ts
git commit -m "feat(radar): protobuf spoke decode + types"
```

---

### Task 3: Legend → colour lookup table

**Files:**

- Create: `packages/web/src/lib/radar/legend.ts`
- Test: `packages/web/src/lib/radar/legend.test.ts`

**Interfaces:**

- Consumes: `Legend` (Task 2).
- Produces: `buildColorLut(legend: Legend): Uint8ClampedArray` — length `256*4`, RGBA per byte value; byte 0 transparent; unmapped → `[255,0,0,255]`.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildColorLut } from './legend.js';
import type { Capabilities } from './types.js';

const caps: Capabilities = JSON.parse(
  readFileSync(fileURLToPath(new URL('./__fixtures__/capabilities.json', import.meta.url)), 'utf8'),
);

describe('buildColorLut', () => {
  it('maps byte 0 to transparent and known indices to legend colours', () => {
    const lut = buildColorLut(caps.legend);
    expect(lut.length).toBe(256 * 4);
    expect(lut[3]).toBe(0); // byte 0 alpha = transparent
    const idx = caps.legend.pixels.findIndex((p, i) => i > 0 && p.color !== '#00000000');
    expect(lut[idx * 4 + 3]).toBeGreaterThan(0); // a real return is opaque
  });

  it('defaults unmapped indices to opaque red', () => {
    const lut = buildColorLut({ pixels: [{ color: '#00000000', type: 'normal' }] });
    expect([lut[255 * 4], lut[255 * 4 + 1], lut[255 * 4 + 2], lut[255 * 4 + 3]]).toEqual([
      255, 0, 0, 255,
    ]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run packages/web/src/lib/radar/legend.test.ts`
Expected: FAIL — `buildColorLut` not found.

- [ ] **Step 3: Implement `legend.ts`**

```ts
import type { Legend } from './types.js';

/** Parse "#rrggbbaa" | "#rrggbb" | "#rgb[a]" into [r,g,b,a] (0-255). */
export function hexToRgba(hex: string): [number, number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const bytes: number[] = [];
  for (let i = 0; i < h.length; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16));
  while (bytes.length < 3) bytes.push(0);
  while (bytes.length < 4) bytes.push(255);
  return [bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!];
}

/** 256-entry RGBA lookup; unmapped indices default to opaque red. */
export function buildColorLut(legend: Legend): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    lut[i * 4] = 255;
    lut[i * 4 + 1] = 0;
    lut[i * 4 + 2] = 0;
    lut[i * 4 + 3] = 255;
  }
  legend.pixels.slice(0, 256).forEach((p, i) => {
    const [r, g, b, a] = hexToRgba(p.color);
    lut[i * 4] = r;
    lut[i * 4 + 1] = g;
    lut[i * 4 + 2] = b;
    lut[i * 4 + 3] = a;
  });
  return lut;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run packages/web/src/lib/radar/legend.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/radar/legend.ts packages/web/src/lib/radar/legend.test.ts
git commit -m "feat(radar): legend byte->colour lookup"
```

---

### Task 4: Geo bbox + spoke render geometry (pure math)

**Files:**

- Create: `packages/web/src/lib/radar/geo.ts`, `packages/web/src/lib/radar/geometry.ts`
- Test: `packages/web/src/lib/radar/geo.test.ts`, `packages/web/src/lib/radar/geometry.test.ts`

**Interfaces:**

- Produces:
  - `rangeBboxCorners(lat, lon, rangeM): [[lon,lat],[lon,lat],[lon,lat],[lon,lat]]` — TL, TR, BR, BL for MapLibre `CanvasSource.coordinates`.
  - `spokeToCanvas(angleOrBearing, spokesPerRev, cellIndex, cellCount, range, sizePx): { x, y }` — north-up canvas pixel (centre = `sizePx/2`, range edge = `sizePx/2`).

- [ ] **Step 1: Write failing tests**

`geo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rangeBboxCorners } from './geo.js';

describe('rangeBboxCorners', () => {
  it('returns TL,TR,BR,BL square centred on the radar', () => {
    const [tl, tr, br, bl] = rangeBboxCorners(40, -70, 1852); // 1 nm
    expect(tl[1]).toBeGreaterThan(br[1]); // top lat > bottom lat
    expect(tr[0]).toBeGreaterThan(tl[0]); // right lon > left lon
    expect(tl[0]).toBeCloseTo(bl[0], 6); // left edge shares lon
    // ~1nm half-extent in latitude ≈ 1852/111320 deg
    expect(tl[1] - 40).toBeCloseTo(1852 / 111320, 3);
  });
});
```

`geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { spokeToCanvas } from './geometry.js';

describe('spokeToCanvas', () => {
  const N = 2048,
    SIZE = 512;
  it('angle 0 (north/up) at full range points straight up', () => {
    const { x, y } = spokeToCanvas(0, N, 1023, 1024, 1000, SIZE);
    expect(x).toBeCloseTo(SIZE / 2, 0);
    expect(y).toBeCloseTo(0, 0); // top edge
  });
  it('quarter turn points to the right (east)', () => {
    const { x, y } = spokeToCanvas(N / 4, N, 1023, 1024, 1000, SIZE);
    expect(x).toBeCloseTo(SIZE, 0);
    expect(y).toBeCloseTo(SIZE / 2, 0);
  });
  it('cell at half index sits at half radius', () => {
    const { y } = spokeToCanvas(0, N, 511, 1024, 1000, SIZE);
    // dir=0 → straight up; cell 511/1023 ≈ half radius → ~SIZE/4 above centre.
    expect(y).toBeCloseTo(SIZE / 2 - SIZE / 4, 0);
  });
});
```

- [ ] **Step 2: Run them, verify they fail**

Run: `npx vitest run packages/web/src/lib/radar/geo.test.ts packages/web/src/lib/radar/geometry.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `geo.ts` and `geometry.ts`**

`geo.ts`:

```ts
const M_PER_DEG_LAT = 111_320;

/** Square bbox of half-extent `rangeM` around (lat,lon). Order: TL, TR, BR, BL. */
export function rangeBboxCorners(
  lat: number,
  lon: number,
  rangeM: number,
): [[number, number], [number, number], [number, number], [number, number]] {
  const dLat = rangeM / M_PER_DEG_LAT;
  const dLon = rangeM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat + dLat], // TL
    [lon + dLon, lat + dLat], // TR
    [lon + dLon, lat - dLat], // BR
    [lon - dLon, lat - dLat], // BL
  ];
}
```

`geometry.ts`:

```ts
/**
 * North-up canvas pixel for a spoke cell. `dir` is the spoke direction in
 * [0..spokesPerRev) units (bearing if true-north, else angle from bow). The
 * canvas is square `sizePx`; centre = sizePx/2; the range edge = sizePx/2.
 * 0 = up (north/bow), increasing clockwise.
 */
export function spokeToCanvas(
  dir: number,
  spokesPerRev: number,
  cellIndex: number,
  cellCount: number,
  _range: number,
  sizePx: number,
): { x: number; y: number } {
  const theta = (dir / spokesPerRev) * 2 * Math.PI; // 0 = up, CW
  const r = (cellCount <= 1 ? 0 : cellIndex / (cellCount - 1)) * (sizePx / 2);
  const cx = sizePx / 2;
  const cy = sizePx / 2;
  return { x: cx + r * Math.sin(theta), y: cy - r * Math.cos(theta) };
}
```

- [ ] **Step 4: Run them, verify they pass**

Run: `npx vitest run packages/web/src/lib/radar/geo.test.ts packages/web/src/lib/radar/geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/radar/geo.ts packages/web/src/lib/radar/geometry.ts packages/web/src/lib/radar/geo.test.ts packages/web/src/lib/radar/geometry.test.ts
git commit -m "feat(radar): geo bbox + spoke->canvas geometry"
```

---

### Task 5: Canvas renderer

Paint spoke batches onto an offscreen canvas using the legend LUT + geometry. Persistence = overwrite each spoke's angular slice as it arrives (mayara's ring-buffer model); no per-frame fade.

**Files:**

- Create: `packages/web/src/lib/radar/renderer.ts`
- Test: `packages/web/src/lib/radar/renderer.test.ts`

**Interfaces:**

- Consumes: `buildColorLut` (T3), `spokeToCanvas` (T4), `DecodedSpoke`/`Capabilities` (T2).
- Produces:
  - `class RadarCanvas { constructor(ctx: CanvasRenderingContext2D-like, caps: Capabilities, sizePx: number); drawSpokes(spokes: DecodedSpoke[]): void; clear(): void }`
  - Drawing is injected a 2D-context-like object (`{ fillStyle, fillRect, clearRect, canvas:{width,height} }`) so it is testable in node with a fake context.

- [ ] **Step 1: Write the failing test (fake 2D context records fills)**

```ts
import { describe, it, expect } from 'vitest';
import { RadarCanvas } from './renderer.js';
import type { Capabilities, DecodedSpoke } from './types.js';

function fakeCtx(size: number) {
  const fills: Array<{ x: number; y: number; style: string }> = [];
  return {
    canvas: { width: size, height: size },
    fillStyle: '' as string,
    set _s(v: string) {
      /* noop */
    },
    clearRect() {},
    fillRect(x: number, y: number) {
      fills.push({ x, y, style: (this as any).fillStyle });
    },
    _fills: fills,
  } as unknown as CanvasRenderingContext2D & { _fills: typeof fills };
}

const caps: Capabilities = {
  spokesPerRevolution: 2048,
  maxSpokeLength: 4,
  maxRange: 1000,
  minRange: 50,
  supportedRanges: [1000],
  legend: {
    pixels: [
      { color: '#00000000', type: 'normal' }, // 0 transparent
      { color: '#0000ffff', type: 'normal' }, // 1 blue
      { color: '#00ff00ff', type: 'normal' }, // 2 green
      { color: '#ff0000ff', type: 'normal' }, // 3 red
    ],
  },
};

describe('RadarCanvas', () => {
  it('draws a fill for each non-zero cell and skips byte 0', () => {
    const ctx = fakeCtx(256) as any;
    const rc = new RadarCanvas(ctx, caps, 256);
    const spoke: DecodedSpoke = { angle: 0, range: 1000, data: new Uint8Array([0, 1, 2, 3]) };
    rc.drawSpokes([spoke]);
    expect(ctx._fills.length).toBe(3); // byte 0 skipped, 3 painted
    expect(ctx._fills.every((f: any) => f.style.startsWith('rgba'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run packages/web/src/lib/radar/renderer.test.ts`
Expected: FAIL — `RadarCanvas` not found.

- [ ] **Step 3: Implement `renderer.ts`**

```ts
import { buildColorLut } from './legend.js';
import { spokeToCanvas } from './geometry.js';
import type { Capabilities, DecodedSpoke } from './types.js';

type Ctx = Pick<CanvasRenderingContext2D, 'clearRect' | 'fillRect' | 'canvas'> & {
  fillStyle: string | CanvasGradient | CanvasPattern;
};

export class RadarCanvas {
  private readonly lut: Uint8ClampedArray;
  private readonly spokesPerRev: number;
  /** width in px of one painted cell, ~ so adjacent spokes don't gap at the rim. */
  private readonly cell: number;

  constructor(
    private readonly ctx: Ctx,
    caps: Capabilities,
    private readonly size: number,
  ) {
    this.lut = buildColorLut(caps.legend);
    this.spokesPerRev = caps.spokesPerRevolution;
    this.cell = Math.max(2, Math.ceil((Math.PI * size) / caps.spokesPerRevolution));
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.size, this.size);
  }

  drawSpokes(spokes: DecodedSpoke[]): void {
    for (const s of spokes) {
      const dir = s.bearing ?? s.angle; // true-north when present, else from bow
      const n = s.data.length;
      for (let i = 0; i < n; i++) {
        const v = s.data[i]!;
        if (v === 0) continue; // transparent
        const r = v * 4;
        this.ctx.fillStyle = `rgba(${this.lut[r]},${this.lut[r + 1]},${this.lut[r + 2]},${this.lut[r + 3]! / 255})`;
        const { x, y } = spokeToCanvas(dir, this.spokesPerRev, i, n, s.range, this.size);
        this.ctx.fillRect(x - this.cell / 2, y - this.cell / 2, this.cell, this.cell);
      }
    }
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run packages/web/src/lib/radar/renderer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/radar/renderer.ts packages/web/src/lib/radar/renderer.test.ts
git commit -m "feat(radar): offscreen canvas spoke renderer"
```

---

### Task 6: MayaraClient (discovery, capabilities, controls, spoke WS)

**Files:**

- Create: `packages/web/src/lib/radar/mayara-client.ts`
- Test: `packages/web/src/lib/radar/mayara-client.test.ts`

**Interfaces:**

- Consumes: `decodeRadarMessage` (T2), types (T2).
- Produces:
  - `class MayaraClient { constructor(opts: { baseUrl: string; fetchImpl?: typeof fetch; wsImpl?: WebSocketCtor }); discover(): Promise<{ id: string; info: RadarInfo }>; capabilities(id: string): Promise<Capabilities>; setControl(id: string, controlId: string, body: ControlValue): Promise<void>; connectSpokes(spokeDataUrl: string, onSpokes: (s: DecodedSpoke[]) => void, onState: (s: 'open'|'closed'|'error') => void): () => void }`
  - `type WebSocketCtor = new (url: string) => { binaryType: string; onmessage: ((e: { data: unknown }) => void) | null; onopen: (() => void) | null; onclose: (() => void) | null; onerror: (() => void) | null; close(): void }`
  - URL helper `wsUrlFor(spokeDataUrl: string, baseUrl: string): string` — rewrite host to `baseUrl`'s host, and force `wss` when `baseUrl` is `https`.

- [ ] **Step 1: Write the failing test (injected fetch + fake WebSocket)**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { MayaraClient, wsUrlFor } from './mayara-client.js';

const radars = JSON.parse(
  readFileSync(fileURLToPath(new URL('./__fixtures__/radars.json', import.meta.url)), 'utf8'),
);
const frame = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./__fixtures__/spoke-frame.bin', import.meta.url))),
);

describe('MayaraClient', () => {
  it('discovers the first radar id and its info', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(radars)),
    ) as unknown as typeof fetch;
    const c = new MayaraClient({ baseUrl: 'http://pi:6502', fetchImpl });
    const { id, info } = await c.discover();
    expect(id).toBe(Object.keys(radars)[0]);
    expect(info.spokeDataUrl).toContain('/spokes');
  });

  it('PUTs control body {value, auto}', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
    const c = new MayaraClient({ baseUrl: 'http://pi:6502', fetchImpl });
    await c.setControl('r1', 'gain', { value: 50, auto: false });
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(String(url)).toMatch(/\/radars\/r1\/controls\/gain$/);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ value: 50, auto: false });
  });

  it('decodes spoke frames to the callback', async () => {
    const sockets: any[] = [];
    class FakeWS {
      binaryType = 'blob';
      onmessage: any;
      onopen: any;
      onclose: any;
      onerror: any;
      constructor(public url: string) {
        sockets.push(this);
      }
      close() {
        this.onclose?.();
      }
    }
    const c = new MayaraClient({ baseUrl: 'http://pi:6502', wsImpl: FakeWS as any });
    const got: number[] = [];
    c.connectSpokes(
      'ws://radar/spokes',
      (s) => got.push(s.length),
      () => {},
    );
    sockets[0].onopen?.();
    sockets[0].onmessage?.({ data: frame.buffer });
    expect(got[0]).toBeGreaterThan(0);
  });

  it('forces wss when base is https and rewrites host', () => {
    expect(wsUrlFor('ws://10.0.0.5:6502/x/spokes', 'https://pi.ts.net:6502')).toBe(
      'wss://pi.ts.net:6502/x/spokes',
    );
    expect(wsUrlFor('ws://10.0.0.5:6502/x/spokes', 'http://pi.lan:6502')).toBe(
      'ws://pi.lan:6502/x/spokes',
    );
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run packages/web/src/lib/radar/mayara-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mayara-client.ts`**

```ts
import { decodeRadarMessage } from './proto.js';
import type { Capabilities, ControlValue, DecodedSpoke, RadarInfo } from './types.js';

const API = '/signalk/v2/api/vessels/self/radars';

export type WebSocketCtor = new (url: string) => {
  binaryType: string;
  onmessage: ((e: { data: unknown }) => void) | null;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
};

/** Rewrite a server-reported spoke URL to reach `baseUrl`'s host, with wss when base is https. */
export function wsUrlFor(spokeDataUrl: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  const u = new URL(spokeDataUrl);
  u.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  u.host = base.host;
  return u.toString();
}

export class MayaraClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly wsImpl: WebSocketCtor;

  constructor(opts: { baseUrl: string; fetchImpl?: typeof fetch; wsImpl?: WebSocketCtor }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.wsImpl = opts.wsImpl ?? (globalThis.WebSocket as unknown as WebSocketCtor);
  }

  async discover(): Promise<{ id: string; info: RadarInfo }> {
    const res = await this.fetchImpl(`${this.baseUrl}${API}`);
    const map = (await res.json()) as Record<string, RadarInfo>;
    const id = Object.keys(map)[0];
    if (!id) throw new Error('no radar');
    return { id, info: map[id]! };
  }

  async capabilities(id: string): Promise<Capabilities> {
    const res = await this.fetchImpl(`${this.baseUrl}${API}/${id}/capabilities`);
    return (await res.json()) as Capabilities;
  }

  async setControl(id: string, controlId: string, body: ControlValue): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}${API}/${id}/controls/${controlId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`control ${controlId}: ${res.status} ${await res.text()}`);
  }

  /** Connect to the spoke stream; returns a disposer. Reconnects with backoff. */
  connectSpokes(
    spokeDataUrl: string,
    onSpokes: (s: DecodedSpoke[]) => void,
    onState: (s: 'open' | 'closed' | 'error') => void,
  ): () => void {
    const url = wsUrlFor(spokeDataUrl, this.baseUrl);
    let closed = false;
    let backoff = 500;
    let ws: InstanceType<WebSocketCtor> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const open = (): void => {
      ws = new this.wsImpl(url);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        backoff = 500;
        onState('open');
      };
      ws.onmessage = (e) => {
        const d = e.data;
        if (typeof d === 'string') return;
        const bytes =
          d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d as ArrayBufferLike);
        onSpokes(decodeRadarMessage(bytes));
      };
      ws.onerror = () => onState('error');
      ws.onclose = () => {
        onState('closed');
        if (closed) return;
        timer = setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, 10_000);
      };
    };
    open();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run packages/web/src/lib/radar/mayara-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/radar/mayara-client.ts packages/web/src/lib/radar/mayara-client.test.ts
git commit -m "feat(radar): mayara client (discover/capabilities/controls/spokes)"
```

---

### Task 7: ConfigStore radar config

Store the mayara base URL + defaults server-side. Follow the existing `(id, value JSON)` table pattern; read the live ConfigStore code first to match the getter/setter/observable shape (e.g. how `sourcePriority` / `crossoverSettings` are defined and exposed as `store.*$`).

**Files:**

- Modify: `packages/db/src/` — the schema + `ConfigStore` (locate the file defining other config getters; mirror it).
- Test: a `*.test.ts` beside the ConfigStore, mirroring an existing ConfigStore test.

**Interfaces:**

- Produces: `ConfigStore.getRadarConfig(): RadarConfig | null`, `ConfigStore.setRadarConfig(c: RadarConfig): void`, `store.radarConfig$` observable.
  - `interface RadarConfig { mayaraBaseUrl: string; defaultRangeM?: number }`

- [ ] **Step 1: Read the pattern, write the failing test**

Read an existing config accessor (e.g. `grep -n "sourcePriority" packages/db/src/*.ts`) and its test. Then write `radar-config.test.ts` mirroring it:

```ts
// (mirror the existing ConfigStore test harness: open an in-memory/tmp store, set, read back, assert)
it('round-trips radar config', () => {
  const store = openTestStore();
  store.setRadarConfig({ mayaraBaseUrl: 'http://pi:6502', defaultRangeM: 4000 });
  expect(store.getRadarConfig()).toEqual({ mayaraBaseUrl: 'http://pi:6502', defaultRangeM: 4000 });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run packages/db` (or the specific test path)
Expected: FAIL — `setRadarConfig` not defined.

- [ ] **Step 3: Implement following the existing config-accessor pattern**

Add a `radar_config` row id with `RadarConfig` JSON, a getter/setter, and a `radarConfig$` BehaviorSubject exactly as the neighbouring accessors do (same serialization helpers, same `(id, value JSON)` table). Do not invent a new storage mechanism.

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run packages/db`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(radar): ConfigStore radar.mayaraBaseUrl + defaults"
```

---

### Task 8: Radar status channels + server poller

The only server-side radar code: poll mayara's HTTP for liveness/range and publish two scalar channels. Async, non-blocking (watchdog-safe).

**Files:**

- Modify: `packages/core/src/channels.ts` (add `Radar.Connected = 'radar.connected'`, `Radar.RangeM = 'radar.range.m'`)
- Create: `apps/g5000/src/radar/status-poller.ts`
- Modify: `apps/g5000/src/index.ts` (start the poller after the web server)
- Test: `apps/g5000/src/radar/status-poller.test.ts`

**Interfaces:**

- Consumes: `Bus` (`@g5000/core`), `MayaraClient` (T6) or a minimal fetch.
- Produces: `startRadarStatusPoller(bus: Bus, opts: { baseUrl: string; intervalMs?: number; fetchImpl?: typeof fetch }): () => void` — publishes `radar.connected` (enum/scalar 1|0) and `radar.range.m` (scalar) each tick; on fetch failure publishes connected=0.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { Bus } from '@g5000/core';
import { startRadarStatusPoller } from './status-poller.js';

describe('startRadarStatusPoller', () => {
  it('publishes connected=1 + range when mayara responds', async () => {
    const bus = new Bus();
    const seen: Record<string, number> = {};
    bus.subscribe('radar.**', (s) => { if (s.value.kind === 'scalar') seen[s.channel] = s.value.value; });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ r1: { spokeDataUrl: 'ws://x/spokes' } })))
      as unknown as typeof fetch;
    const stop = startRadarStatusPoller(bus, { baseUrl: 'http://pi:6502', intervalMs: 10, fetchImpl });
    await new Promise((r) => setTimeout(r, 30));
    stop();
    expect(seen['radar.connected']).toBe(1);
  });

  it('publishes connected=0 when mayara is down', async () => {
    const bus = new Bus();
    let v = -1;
    bus.subscribe('radar.connected', (s) => { if (s.value.kind === 'scalar') v = s.value.value; });
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const stop = startRadarStatusPoller(bus, { baseUrl: 'http://pi:6502', intervalMs: 10, fetchImpl });
    await new Promise((r) => setTimeout(r, 30));
    stop();
    expect(v).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run apps/g5000/src/radar/status-poller.test.ts`; Expected: FAIL.

- [ ] **Step 3: Implement the channels + poller**

In `packages/core/src/channels.ts` add a `Radar` group (`Connected: 'radar.connected'`, `RangeM: 'radar.range.m'`) mirroring the existing `Channels` object shape. Then `status-poller.ts`:

```ts
import { Channels, type Bus } from '@g5000/core';

export function startRadarStatusPoller(
  bus: Bus,
  opts: { baseUrl: string; intervalMs?: number; fetchImpl?: typeof fetch },
): () => void {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const intervalMs = opts.intervalMs ?? 5000;
  const base = opts.baseUrl.replace(/\/$/, '');
  let stopped = false;
  const publish = (channel: string, value: number): void =>
    bus.publish({
      channel,
      t_ns: 0n,
      value: { kind: 'scalar', value, unit: '' },
      source: 'radar:mayara',
    });

  const tick = async (): Promise<void> => {
    try {
      const res = await fetchImpl(`${base}/signalk/v2/api/vessels/self/radars`);
      const map = (await res.json()) as Record<string, unknown>;
      publish(Channels.Radar.Connected, Object.keys(map).length > 0 ? 1 : 0);
    } catch {
      publish(Channels.Radar.Connected, 0);
    }
  };
  const timer = setInterval(() => {
    if (!stopped) void tick();
  }, intervalMs);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
```

(Confirm the exact `bus.publish` Sample shape against `packages/core/src/types.ts`; use a real `t_ns` via the same clock the other publishers use rather than `0n` if one is available.) Then in `apps/g5000/src/index.ts`, after `startWebServer(...)`, read `getRadarConfig()` and, if set, `startRadarStatusPoller(bus, { baseUrl: cfg.mayaraBaseUrl })`.

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run apps/g5000/src/radar/status-poller.test.ts`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/channels.ts apps/g5000/src/radar/status-poller.ts apps/g5000/src/radar/status-poller.test.ts apps/g5000/src/index.ts
git commit -m "feat(radar): status channels + server poller"
```

---

### Task 9: RadarOverlay MapLibre layer component

Wire client → renderer → MapLibre `CanvasSource`. Mirror `WindOverlay.tsx`'s lifecycle exactly.

**Files:**

- Create: `packages/web/src/components/RadarOverlay.tsx`
- Test: `packages/web/src/components/RadarOverlay.test.tsx` (light: mock map asserts source/layer creation)

**Interfaces:**

- Consumes: `MayaraClient` (T6), `RadarCanvas` (T5), `rangeBboxCorners` (T4), `RadarConfig` (T7), `LivePos` (from `LiveBoatMarker`).
- Props: `{ map: maplibregl.Map | null; pos: LivePos | null; baseUrl: string; opacity: number; hidden: boolean }`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { RadarOverlay } from './RadarOverlay.js';

function fakeMap() {
  return {
    getSource: vi.fn(() => undefined),
    addSource: vi.fn(),
    getLayer: vi.fn(() => undefined),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    removeSource: vi.fn(),
    setPaintProperty: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    isStyleLoaded: () => true,
  } as any;
}

describe('RadarOverlay', () => {
  it('adds a canvas source + raster layer when mounted with a map', () => {
    const map = fakeMap();
    render(
      <RadarOverlay
        map={map}
        pos={{ lat: 40, lon: -70, cog: 0, sog: 0, hdg: null, t: 0 }}
        baseUrl="http://pi:6502"
        opacity={0.7}
        hidden={false}
      />,
    );
    expect(map.addSource).toHaveBeenCalledWith(
      'radar',
      expect.objectContaining({ type: 'canvas' }),
    );
    expect(map.addLayer).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run packages/web/src/components/RadarOverlay.test.tsx`; Expected: FAIL.

- [ ] **Step 3: Implement `RadarOverlay.tsx`**

Mirror `WindOverlay.tsx`. Skeleton (fill bodies following that file):

```tsx
'use client';
import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { MayaraClient } from '../lib/radar/mayara-client.js';
import { RadarCanvas } from '../lib/radar/renderer.js';
import { rangeBboxCorners } from '../lib/radar/geo.js';
import type { LivePos } from './LiveBoatMarker.js';

const SRC = 'radar';
const LAYER = 'radar-layer';
const SIZE = 1024; // offscreen canvas px

export function RadarOverlay(props: {
  map: maplibregl.Map | null;
  pos: LivePos | null;
  baseUrl: string;
  opacity: number;
  hidden: boolean;
}): null {
  const { map, pos, baseUrl, opacity, hidden } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rcRef = useRef<RadarCanvas | null>(null);
  const rangeRef = useRef<number>(2000);
  const posRef = useRef<LivePos | null>(pos);
  posRef.current = pos;

  // 1) offscreen canvas + source/layer (idempotent ensure(), styledata retry, no isStyleLoaded gate)
  useEffect(() => {
    if (!map) return;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    canvasRef.current = canvas;
    const ensure = () => {
      try {
        if (!map.getSource(SRC) && posRef.current) {
          const corners = rangeBboxCorners(
            posRef.current.lat,
            posRef.current.lon,
            rangeRef.current,
          );
          map.addSource(SRC, {
            type: 'canvas',
            canvas,
            coordinates: corners,
            animate: true,
          } as any);
        }
        if (map.getSource(SRC) && !map.getLayer(LAYER)) {
          map.addLayer({
            id: LAYER,
            type: 'raster',
            source: SRC,
            paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 },
          });
        }
      } catch {
        /* retry on styledata */
      }
    };
    ensure();
    map.on('styledata', ensure);
    return () => {
      map.off('styledata', ensure);
    };
  }, [map]);

  // 2) connect mayara → renderer (capabilities → RadarCanvas → drawSpokes)
  useEffect(() => {
    if (!map || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d')!;
    const client = new MayaraClient({ baseUrl });
    let dispose = () => {};
    (async () => {
      const { info } = await client.discover();
      const caps = await client.capabilities((await client.discover()).id);
      rangeRef.current = caps.supportedRanges[0] ?? 2000;
      rcRef.current = new RadarCanvas(ctx, caps, SIZE);
      dispose = client.connectSpokes(
        info.spokeDataUrl,
        (spokes) => rcRef.current?.drawSpokes(spokes),
        () => {},
      );
    })().catch(() => {});
    return () => dispose();
  }, [map, baseUrl]);

  // 3) live opacity + visibility + re-pin to boat position
  useEffect(() => {
    if (!map || !map.getLayer(LAYER)) return;
    map.setPaintProperty(LAYER, 'raster-opacity', hidden ? 0 : opacity);
  }, [map, opacity, hidden]);

  useEffect(() => {
    if (!map || !pos) return;
    const src = map.getSource(SRC) as maplibregl.CanvasSource | undefined;
    src?.setCoordinates(rangeBboxCorners(pos.lat, pos.lon, rangeRef.current));
  }, [map, pos]);

  return null;
}
```

Notes: `raster-fade-duration: 0` avoids MapLibre cross-fading the live canvas; `animate: true` makes MapLibre re-sample the canvas each frame. Confirm `LivePos` import path against `LiveBoatMarker.tsx`.

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run packages/web/src/components/RadarOverlay.test.tsx`; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/RadarOverlay.tsx packages/web/src/components/RadarOverlay.test.tsx
git commit -m "feat(radar): RadarOverlay MapLibre canvas layer"
```

---

### Task 10: Layers toggle wiring + mount

**Files:**

- Modify: `packages/web/src/app/chart/LayersControl.tsx` (add `radar` to `LayersState` + a `Row`)
- Modify: `packages/web/src/app/chart/ChartToolbar.tsx` (add `radar` to the `onToggle` key union)
- Modify: `packages/web/src/app/chart/page.tsx` (default `radar: false` in `chart:layers`; new `chart:radar` object `{ opacity }`; mount `RadarOverlay`)

**Interfaces:**

- Consumes: `RadarOverlay` (T9), `RadarConfig.mayaraBaseUrl` (via a settings fetch or page prop), `livePos`.

- [ ] **Step 1: Add `radar` to LayersState + a toggle Row**

In `LayersControl.tsx`: add `radar: boolean` to `LayersState`; add `<Row label="Radar" pressed={state.radar} onClick={() => onToggle('radar')} />` in the Misc section; add `'radar'` to the `onToggle` key union here and in `ChartToolbar.tsx`.

- [ ] **Step 2: Default + persist in page.tsx**

Add `radar: false` to the `chart:layers` default object and merge. Add a `chart:radar` localStorage object `{ opacity: 0.7 }` (mirror `chart:settings` load/persist at the existing lines). Read `mayaraBaseUrl` from settings (`GET /api/settings` or the page's settings prop).

- [ ] **Step 3: Mount the overlay**

In the `<Map>` children, beside the other layers:

```tsx
{
  layers.radar && mayaraBaseUrl && (
    <RadarOverlay
      map={mapInstance}
      pos={livePos}
      baseUrl={mayaraBaseUrl}
      opacity={radarUi.opacity}
      hidden={false}
    />
  );
}
```

- [ ] **Step 4: Verify build + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (no type errors; prettier clean).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/chart/LayersControl.tsx packages/web/src/app/chart/ChartToolbar.tsx packages/web/src/app/chart/page.tsx
git commit -m "feat(radar): chart layers toggle + mount RadarOverlay"
```

---

### Task 11: RadarControls panel

Range/gain/sea/rain/opacity. Range/gain/sea/rain are PUT to mayara (radar is source of truth); opacity is local (`chart:radar`).

**Files:**

- Create: `packages/web/src/app/chart/RadarControls.tsx`
- Modify: `packages/web/src/app/chart/page.tsx` (render when `layers.radar`)

**Interfaces:**

- Consumes: `MayaraClient.setControl` (T6), capabilities `supportedRanges` (T6), control snapshot `GET …/controls`.
- Props: `{ baseUrl: string; opacity: number; onOpacity: (v: number) => void }`.

- [ ] **Step 1: Implement the panel**

A compact panel: a range stepper bound to `supportedRanges` (PUT `{ value: rangeM }` to control `range`); gain/sea/rain each an auto-toggle + slider (PUT `{ value, auto }` to controls `gain`/`sea`/`rain`); an opacity slider calling `onOpacity`. On mount, `GET …/controls` to seed current values. Use `MayaraClient` (instantiate with `baseUrl`). Keep state minimal; the radar's read-back is authoritative — re-fetch the control after a PUT.

- [ ] **Step 2: Wire into page.tsx**

```tsx
{
  layers.radar && mayaraBaseUrl && (
    <RadarControls
      baseUrl={mayaraBaseUrl}
      opacity={radarUi.opacity}
      onOpacity={(v) => setRadarUi((s) => ({ ...s, opacity: v }))}
    />
  );
}
```

- [ ] **Step 3: Verify build + lint** — `npm run typecheck && npm run lint`; Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/chart/RadarControls.tsx packages/web/src/app/chart/page.tsx
git commit -m "feat(radar): range/gain/clutter/opacity control panel"
```

---

### Task 12: mayara systemd unit + deploy docs

Deployment artifact (verified on the Pi, not unit-tested).

**Files:**

- Create: `scripts/mayara.service`
- Create: `scripts/mayara.README.md`

- [ ] **Step 1: Write the unit**

`scripts/mayara.service` (mirror `g5000-autopilot.service` conventions — `User=greg`, `Restart=on-failure`):

```ini
[Unit]
Description=mayara-server (radar bridge)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=greg
# Interface/port/emulator come from the drop-in override (see mayara.README.md).
ExecStart=/home/greg/mayara/mayara-server -p 6502 -b navico -i %i
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

And an `override.conf` example in the README setting the real interface or `--emulator`.

- [ ] **Step 2: Write `mayara.README.md`**

Document: download the `aarch64-unknown-linux-musl` release to `/home/greg/mayara/`, install the unit, the `override.conf` for the radar interface (or `--emulator` for testing), `systemctl enable --now mayara`, how to find the radar interface, exposing `:6502` over Tailscale (`tailscale serve` for `wss` if accessing g5000 over https), and setting `radar.mayaraBaseUrl` in g5000 `/settings`.

- [ ] **Step 3: Commit**

```bash
git add scripts/mayara.service scripts/mayara.README.md
git commit -m "feat(radar): mayara systemd unit + deploy docs"
```

---

### Task 13: Emulator integration + visual acceptance

End-to-end check against the emulator (the de-risk for the corner-pinned canvas).

- [ ] **Step 1: Run the emulator + dev server**

```bash
bash scripts/mayara-emulator.sh &        # mayara --emulator on :6502
cd /Users/gregjohnson/code/g5000 && npm run dev --workspace @g5000/app
```

Set `radar.mayaraBaseUrl=http://127.0.0.1:6502` in `/settings` (or seed ConfigStore).

- [ ] **Step 2: Visual check**

Open `/chart`, toggle **Radar** on. Expected: a coloured radar disk centred on the boat marker, sweeping; opacity slider dims it; toggling off removes it; range stepper changes the disk extent. Confirm no console errors and the chart stays responsive.

- [ ] **Step 3: Full suite + typecheck**

```bash
npm test && npm run typecheck && npm run lint
```

Expected: radar tests green; baseline pre-existing failures unchanged (per CLAUDE.md ~4 known-env failures only).

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "test(radar): emulator integration verified"
```

---

## Self-Review

**Spec coverage:** mayara service (T12), remote/wss reachability (`wsUrlFor` T6 + T12 docs), browser spoke decode (T2), legend incl. Doppler colours (T3), corner-pinned canvas renderer (T4/T5/T9), core controls range/gain/sea/rain + opacity (T11), ConfigStore endpoint (T7), status channels (T8), layers toggle (T10), emulator-based testing (T1/T13). ARPA/guard-zones/PPI page correctly excluded (phases 2/3). No gaps.

**Placeholder scan:** logic tasks (T2–T8) carry complete code + tests. Integration tasks (T7, T9–T12) reference exact existing patterns (`WindOverlay`, the ConfigStore accessors, `LayersControl`) the executor must read to match — those files' internals are the ground truth, not invented here; this is deliberate, not a placeholder.

**Type consistency:** `DecodedSpoke`, `Capabilities`, `Legend`, `RadarInfo`, `ControlValue` defined in T2 and reused verbatim downstream; `MayaraClient`/`RadarCanvas`/`rangeBboxCorners`/`spokeToCanvas`/`buildColorLut` signatures match across T3–T9; `radar.connected`/`radar.range.m` consistent T8↔. `spokeDataUrl`, `spokesPerRevolution`, `maxSpokeLength`, `legend.pixels`, `{value,auto}` match the captured mayara shapes.

**Risk note:** T9 (canvas/MapLibre) and T11 (controls) are the least unit-testable; T13's visual acceptance against the emulator is their real gate.
