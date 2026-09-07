# Network map — moved

The boat's network documentation now lives with the rest of the vessel's
reference material, not in this software repo:

| Layer                          | Authority                                     |
| ------------------------------ | --------------------------------------------- |
| **IP / Wi-Fi / ethernet**      | `~/code/sulabassana/reference/ip-network.md`  |
| **NMEA 2000 / instrument bus** | `~/code/sulabassana/reference/n2k-network.md` |

Both were re-surveyed from the boat itself (IP 2026-09-06, N2K 2026-09-07) and
carry topology diagrams, a schematic plan view, per-device detail and the
survey gotchas.

## What you need from inside this repo

Reaching the Pi (`g5000`, SSH user **`greg`**, repo at `/home/greg/autopilot`):

| Path               | Address                                       |
| ------------------ | --------------------------------------------- |
| Wired LAN          | `10.10.10.10` (DHCP reservation)              |
| SulaStarlink Wi-Fi | `192.168.1.232`                               |
| Tailscale          | `100.64.0.117` — node `g5000-pi`              |
| Public             | `https://g5000.sulabassana.net` (cloudflared) |
| mDNS               | `g5000.local`                                 |

The mast panel is **`g5000-mast`**, SSH user **`pi`**, key-only, at
`10.10.10.11` / `g5000-mast.local`, and `mast.sulabassana.net` via its own
tunnel.

> **The boat is dismasted** (rig lost November 2025). Masthead sensors are
> silent or feeding placeholders, so anything g5000 derives from apparent wind
> is currently meaningless. The Halo radar went with the rig.

For debugging technique — and the traps that cost a day on 2026-09-06 — see
[`diagnosing.md`](./diagnosing.md).
