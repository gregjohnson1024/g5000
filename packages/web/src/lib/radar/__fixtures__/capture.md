# Radar test fixtures (captured from mayara `--emulator`)

These are real payloads captured from `mayara-server v3.6.0 --emulator`, used so the
radar unit tests run against ground-truth shapes rather than invented data.

- `radars.json` — `GET /signalk/v2/api/vessels/self/radars` (map keyed by radar id;
  the emulator id is `emu0001`).
- `capabilities.json` — `GET …/radars/emu0001/capabilities` (spokesPerRevolution 2048,
  maxSpokeLength 1024, supportedRanges, and the `legend.pixels[]` colour table).
- `spoke-frame.bin` — one binary protobuf `RadarMessage` frame from the
  `…/radars/emu0001/spokes` WebSocket (32 spokes, 1024 cells each; this frame contains
  real echoes).

## Reproduce

```bash
# 1. Run the emulator (downloads the binary on first run)
bash scripts/mayara-emulator.sh &        # serves REST + spoke WS on :6502

# 2. Discovery + capabilities
FX=packages/web/src/lib/radar/__fixtures__
curl -s http://127.0.0.1:6502/signalk/v2/api/vessels/self/radars -o "$FX/radars.json"
curl -s http://127.0.0.1:6502/signalk/v2/api/vessels/self/radars/emu0001/capabilities -o "$FX/capabilities.json"

# 3. One spoke frame that contains echoes (Node 22+ has a built-in WebSocket)
node -e '
const fs=require("fs");
const ws=new WebSocket("ws://127.0.0.1:6502/signalk/v2/api/vessels/self/radars/emu0001/spokes");
ws.binaryType="arraybuffer"; let saved=false,seen=0;
ws.addEventListener("message",ev=>{ if(saved||typeof ev.data==="string")return; seen++;
  const b=Buffer.from(ev.data); if([...b].some((v,i)=>v>0&&i>16)||seen>200){
    fs.writeFileSync("'"$FX"'/spoke-frame.bin",b); saved=true; ws.close(); process.exit(0);} });
setTimeout(()=>process.exit(1),10000);'
```
