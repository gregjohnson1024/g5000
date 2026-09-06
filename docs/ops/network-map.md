# Network Map — Sula

Last verified: **2026-09-06** (~20:30 UTC, Newport RI). Full re-survey after the
wired network was rationalised onto a single DHCP server.

> **Evidence rule:** an IP is named here only on direct probe evidence
> (HTTP banner, TLS cert subject, mDNS record, SSH host key, NMEA sentence,
> redirect target). Devices seen but not identified are listed under
> `Unidentified`. Anything reported but not probed is marked _Reported_.

> **⚠️ Survey hazard — read before scanning.** Two things make scans lie:
>
> 1. **Tailscale subnet routes.** `g5000` advertises `10.10.10.0/24` and the RBR
>    `ottawa` node advertises `192.168.2.0/24`. With Tailscale up, an address in
>    either range can be answered by a machine in Ottawa rather than the boat.
>    This produced an hour of false conclusions on 2026-09-06 — a host at
>    `192.168.2.3` was simultaneously the mast panel (local) and an office Pi
>    (via tailnet). **Turn Tailscale off, or bind scans to an interface.**
> 2. **macOS Local Network privacy** (macOS 15+). The terminal app needs the
>    Local Network grant or _every_ on-subnet peer is unreachable with an
>    instant `No route to host`, while the gateway and internet still work and
>    ARP still resolves. See [Gotchas](#gotchas).

---

## Topology at a glance

Three Wi-Fi networks; **one** wired segment.

| Network          | Server / gateway                 | Range            | Internet                  |
| ---------------- | -------------------------------- | ---------------- | ------------------------- |
| **SulaStarlink** | Starlink router `192.168.1.1`    | `192.168.1.0/24` | ✅ the only internet path |
| **SulaLocal**    | PredictWind DataHub              | `10.10.10.0/24`  | ✅ via DataHub            |
| **Wired LAN**    | PredictWind DataHub `10.10.10.1` | `10.10.10.0/24`  | ✅ via DataHub            |
| ~~Sula B&G~~     | _removed 2026-09-06_             | —                | —                         |

The wired LAN and SulaLocal are the same `10.10.10.0/24`; the DataHub serves both.

---

## Wired LAN — `10.10.10.0/24`

Gateway / DNS / **sole DHCP server**: `10.10.10.1` (PredictWind DataHub).
DHCP pool `.100`–`.249`. Static/reserved band `.10`–`.99`.

| IP     | Name / device                                         | MAC                 | Services                                                                            |
| ------ | ----------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| `.1`   | **PredictWind DataHub** — gateway, DNS, DHCP          | `00:0a:52:07:bd:a0` | 22/ssh (dropbear), 80/http → `cgi-bin/luci/` (OpenWrt LuCI, admin/admin), 443, 8443 |
| `.2`   | **Navico GoFree** — transparent bridge                | `00:42:42:00:ee:5c` | 80/http (GoAhead-Webs, realm `Navico GoFree`), 23/telnet                            |
| `.10`  | **`g5000`** — Raspberry Pi 5, `eth0` (reserved)       | `d8:3a:dd:98:14:b4` | 22/ssh, 3000/http (g5000 web UI), 5050 (H-LINK), 111                                |
| `.11`  | **`g5000-mast`** — Chipsee mast panel (reserved)      | `88:a2:9e:4d:8b:34` | 22/ssh                                                                              |
| `.20`  | `zeus-port` — Zeus SR, port helm (reserved)           | `00:0e:91:0d:33:d1` | 1883/mqtt, 8443/https (C-Map), 10110/tcp NMEA-0183                                  |
| `.21`  | `zeus-starboard` — Zeus SR, starboard helm (reserved) | `00:0e:91:0c:f8:ff` | 1883/mqtt, 8443/https (C-Map), 10110/tcp NMEA-0183                                  |
| `.145` | **Victron Ekrano GX** — wired leg (reserved)          | `c0:61:9a:b6:82:36` | 22, 80, 443, 1883/mqtt, 3000 (SignalK), 8000, 10110                                 |
| `.208` | **B&G H5000 CPU** (reserved)                          | `00:0e:91:64:be:4d` | 21/ftp, 22/ssh, 23/telnet, 80/http (`B&G H5000 : Data`), 111, **2053 WebSocket**    |

Also reserved but not always present: `ydwg` `e8:db:84:4c:74:16` → `.245`
(the YDWG is Wi-Fi-only on SulaStarlink; this reservation only applies if it
ever joins SulaLocal), and `greg` `a0:9a:8e:2a:33:a1` → `.164` (Greg's Mac
**built-in Wi-Fi** MAC, i.e. only when the Mac joins SulaLocal — the USB
ethernet dongle is `a0:ce:c8:de:3e:5c` and is not reserved).

### Navico virtual interfaces

Navico MFDs present ~15 virtual NICs each: real MAC `00:0e:91:XX:YY:ZZ`, virtuals
`02:00:0N:XX:YY:ZZ` (N = 0..e). The virtuals normally hold `169.254.x.x`
link-local addresses — this is expected, not a fault.

---

## SulaStarlink (Wi-Fi) — `192.168.1.0/24`

Gateway / DHCP: `192.168.1.1` (Starlink router). **The only network with internet.**

| IP     | Name / device                                       | MAC                 | Services                                                                                    |
| ------ | --------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `.1`   | Starlink router                                     | `74:24:9f:22:ca:59` | 22/ssh (OpenSSH 7.4), 80/http (`<title>Starlink</title>`), 9000                             |
| `.64`  | PredictWind DataHub (Wi-Fi leg of `10.10.10.1`)     | `00:0a:52:07:bd:a1` | 22 (dropbear), 80, 443, 8443 (lighttpd)                                                     |
| `.100` | **Yacht Devices YDWG-02** — N2K ↔ IP gateway        | `e8:db:84:4c:74:16` | 80/http (`Server: YDWG`), **1456/tcp NMEA-0183 tx-only**, **1457/tcp YD-RAW bidirectional** |
| `.129` | **Victron Ekrano GX** (Wi-Fi leg of `10.10.10.145`) | `f0:b0:40:fc:96:09` | 22, 80, 443, 1883/mqtt, 3000 (SignalK), 8000, 10110                                         |
| `.136` | Zeus SR **port** helm (Wi-Fi leg)                   | randomised          | 1883, 8443, 10110                                                                           |
| `.181` | Zeus SR **starboard** helm (Wi-Fi leg)              | randomised          | 1883, 8443, 10110                                                                           |
| `.232` | **`g5000`** — Pi `wlan0`                            | `d8:3a:dd:98:14:b7` | 22/ssh, 3000, 5050, 111                                                                     |
| —      | Greg's Mac / iPhone                                 | randomised          | —                                                                                           |

`192.168.100.1` — the **Starlink dish** itself, reachable through the router
(80/http, 9200 gRPC). Off-subnet; not a DHCP client.

---

## Chart plotters

| Unit                    | Wired | SulaStarlink Wi-Fi | Notes                                                                                          |
| ----------------------- | ----- | ------------------ | ---------------------------------------------------------------------------------------------- |
| Zeus SR, **port** helm  | `.20` | `192.168.1.136`    | also holds APIPA on its virtual NICs                                                           |
| Zeus SR, **starboard**  | `.21` | `192.168.1.181`    |                                                                                                |
| Zeus 2, **nav station** | —     | —                  | **no ethernet cable and no Wi-Fi module — entirely off-network.** Can never be a g5000 client. |

Each Zeus SR also broadcasts its own GoFree app AP (e.g. `B&G Zeus SR_8708`).

**Radar:** physically absent as of 2026-09-06. Its absence is expected, not a gap.

---

## Victron / SignalK

The Ekrano GX runs **SignalK server 2.27.0** on `:3000` (redirects to `/admin/`),
publishing NMEA-0183 on `:10110` and MQTT on `:1883`, reachable on **both** legs
(`10.10.10.145` and `192.168.1.129`). mDNS names `ekrano.local` / `venus.local`.

It self-identifies as vessel **"Sula bassana", MMSI `232039022`**.
⚠️ **Greg believes the correct MMSI is `282039022`** — unresolved; if Greg is
right, SignalK is broadcasting a wrong MMSI.

The `_garmin-mrn-html._tcp` mDNS advert resolves to `venus.local:80/garmin/config.json`
— it is the **Victron's Marine-MFD integration**, not a Garmin device. There is
no Garmin on this boat.

---

## Reach paths — `g5000`

| Path               | Address                                                    |
| ------------------ | ---------------------------------------------------------- |
| Wired LAN          | `10.10.10.10` (DHCP reservation)                           |
| SulaStarlink Wi-Fi | `192.168.1.232`                                            |
| Tailscale          | `100.64.0.117` — node `g5000-pi` / `g5000-pi.rbr.internal` |
| Public             | `https://g5000.sulabassana.net` (cloudflared)              |
| mDNS               | `g5000.local`                                              |

SSH user is **`greg`**; repo at `/home/greg/autopilot`.
The mast panel is **`g5000-mast`**, SSH user **`pi`**, key-only, also at
`mast.sulabassana.net` via its own cloudflared tunnel and `g5000-mast.local`.

### Pi routing policy

`eth0` (`"Wired connection 1"`) is set **`ipv4.never-default yes` /
`ipv6.never-default yes`**, so it never installs a default route and all
internet traffic exits via `wlan0`. This was added when the wired gateway had
no uplink. **The wired LAN now has working internet via the DataHub**, so this
setting could be revisited — but leaving it is the safer default while the
DataHub's reliability is in question.

Reverse with:
`sudo nmcli connection modify "Wired connection 1" ipv4.never-default no ipv6.never-default no && sudo nmcli device reapply eth0`

---

## Gotchas

**macOS Local Network privacy (macOS 15+).** The responsible _app_ (iTerm, not
`ssh`) needs the Local Network grant. Without it: every on-subnet peer fails
instantly with `No route to host`, IPv6 link-local fails too, ARP still
resolves, the gateway and internet still work, and inbound pings still get
answered. Diagnostic tell: **if the peer can ping you, layer 2 is fine and it is
a host-side policy, not the network.** Fix in System Settings → Privacy &
Security → Local Network.

**`ping -W` on macOS is milliseconds**, not seconds. `ping -c1 -W120` reports
ARP-table entries as "live hosts" and manufactures false results. Use `-W1000`+.

**The GoFree is not an NEP-1.** It is a Navico GoFree wireless module
(RT3052 embedded switch, 2016 firmware) that was serving DHCP and NAT. It is now
in **Bridge mode** with `DHCP Type: Disable` and `IP Broadcast Block: Disable`,
and its SSID is off. Two settings that cost hours:

- `DHCP Type` lives on `http://10.10.10.2/internet/lan.asp`, a page **not in the
  left-hand navigation**. The visible "DHCP wireless only" toggle does not stop
  it serving.
- `IP Broadcast Block: Enable` silently kills **all** DHCP once the device is
  bridged, because DHCP is broadcast-based.

**Its old DHCP scope was misconfigured**: the device is `/24` but it handed
clients a `/16` mask from a pool spanning `192.168.0.10`–`192.168.77.254`. That
is why Navico devices appeared to "filter" traffic — a client at `192.168.58.x`
was off-subnet to `/24` neighbours, whose replies went to a non-forwarding
gateway. Not filtering; a netmask mismatch.

**The DataHub can hang while showing "good internet" (solid orange).** On
2026-09-06 it stopped answering ARP on both legs with a healthy-looking LED and
needed a power cycle. Afterwards its **IPv4** DHCP stayed dead while **DHCPv6
kept working** — the tell is an empty v4 lease table beside a live v6 lease. A
clean reboot restored it, most likely because it stands down when it boots
alongside another DHCP server.

**LuCI static leases only take effect after Save & Apply.** Hostnames shown in
the Active Leases table come from the clients (DHCP option 12), so they are _not_
evidence that reservations are loaded.

---

## Refreshing this map

```sh
# Turn Tailscale OFF first (subnet routes contaminate results).
# From the Mac, bind to the interface you mean:
for i in $(seq 1 254); do ping -c1 -W1000 -b en0 192.168.1.$i >/dev/null 2>&1 & done; wait
arp -an | grep 'on en0' | grep -v incomplete

# From g5000 (has nmap):
ssh greg@10.10.10.10
sudo nmap -sn -e eth0 10.10.10.0/24
sudo nmap --script broadcast-dhcp-discover -e eth0   # enumerate DHCP servers

# Identify a host:
curl -sk -D- http://<ip>/ | head
timeout 6 nc -w4 <ip> 22 </dev/null | head -1        # SSH banner
timeout 6 dns-sd -B _services._dns-sd._udp local     # mDNS service types
```
