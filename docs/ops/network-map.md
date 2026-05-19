# Network Map — Sula

Last verified: 2026-05-13 (~16:10 UTC, off Bermuda en route Newport).

> **Evidence rule:** an IP is named here only on direct probe evidence
> (HTTP banner, TLS cert subject, NMEA sentence, redirect target).
> Devices seen but not identified are listed under `Unidentified`.

---

## SulaStarlink (Wi-Fi)

Subnet `192.168.1.0/24` · Gateway `192.168.1.1` · DHCP from gateway.

| IP              | Name                                                                                                                                             | Known services                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `192.168.1.1`   | Starlink router                                                                                                                                  | 80/http (web UI, title `Starlink`)                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `192.168.1.64`  | PredictWind DataHub (mfr Remote Data Sensing LLC) — bridges to boat LAN as `…bd:a0`. Default LAN IP is `10.10.10.1`; this unit has been re-IP'd. | 22/ssh (Dropbear; **no documented user access** per official manual), 53/dns, 80/http → `cgi-bin/luci/` (OpenWrt LuCI, admin/admin), 443/https (cert `O=Remote Data Sensing, LLC`). **Wi-Fi-side has severe packet loss (~90% on SulaStarlink path)**; reliable admin path is IPv6 link-local via eth0. NMEA0183 broadcast on UDP 11101 + TCP 11102 is documented but bound to the AP-side (SulaLocal) interface, not reachable from SulaStarlink or boat-LAN paths. |
| `192.168.1.100` | Yacht Devices YDWG (NMEA 2000 ↔ Wi-Fi gateway, ESP32-based)                                                                                      | 80/http (web UI, redirects to `/login.html`), **1456/tcp NMEA-0183 transmit-only**, **1457/tcp YD-RAW bidirectional**. Both feeds carry the full N2K bus content (GPS, AIS, wind, heading, pitch/roll, water temp, log).                                                                                                                                                                                                                                             |
| `192.168.1.129` | Victron Venus OS GX (Wi-Fi side; same MAC as `.14.187` on boat LAN)                                                                              | 80/http (`GX device login`), 443/https (cert `O=Victron Energy, OU=Venus OS, CN=venus.local`)                                                                                                                                                                                                                                                                                                                                                                        |
| `192.168.1.114` | Mac (`en0`)                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `192.168.1.157` | Greg's iPhone                                                                                                                                    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `192.168.1.232` | Pi `sula-bassana` (`wlan0`)                                                                                                                      | 22/ssh                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Unidentified

| IP                               | MAC                               | Notes                                                                                                                                           |
| -------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `192.168.1.136`, `192.168.1.181` | locally-administered (randomized) | iOS/macOS private-MAC clients — distinct from boat-LAN Zeus SR units that happen to share the `.136`/`.181` addresses on a different L2 segment |

---

## Boat ethernet LAN

Subnet `192.168.0.0/16` (flat) · Gateway `192.168.0.1` · DHCP from gateway.
**No internet uplink.** Verified 2026-05-13: Pi bound to eth0 cannot ping
`1.1.1.1` (100% loss) or reach `https://api.ipify.org` (timeout). The gateway
accepts the DHCP lease and advertises itself as default route but does not
forward traffic outbound. This is an instrument-only L2 segment.

**The PW Hub cannot be used as an alternative gateway from this side either:**
it has no IPv4 address on the boat-LAN bridge interface (verified via ARP probes
to common candidates including `10.10.10.1`, `192.168.0.254`, `.22.1`, `.50.1`),
and although it IS an IPv6 router for the local ULA prefix `fd6e:abac:e9f4::/64`,
it advertises no IPv6 default route — outbound IPv6 via eth0 returns
"Network is unreachable". The hub is configured as a one-way data uploader
for its own traffic, not a transit router for LAN/SulaLocal clients.

| IP(s)                            | Name                                                                                                | Known services                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `192.168.0.1`                    | Gateway / DHCP server (B&G NEP-1 per user; unverified — all TCP filtered)                           | —                                                                                             |
| `192.168.0.2`, `192.168.43.23`   | B&G H5000 CPU                                                                                       | 22/ssh, 80/http (web UI, title `B&G H5000 : Data`), 2053/tcp (H5000 WebSocket data feed)      |
| `192.168.58.78`, `192.168.1.181` | Navico chartplotter #1 (reported Zeus SR)                                                           | 8443/https (cert `O=C-Map`), 10110/tcp (NMEA-0183 stream)                                     |
| `192.168.57.31`, `192.168.1.136` | Navico chartplotter #2 (reported Zeus SR)                                                           | 8443/https (cert `O=C-Map`), 10110/tcp (NMEA-0183 stream)                                     |
| `192.168.60.181`                 | Victron Venus OS GX (wired)                                                                         | 80/http (`GX device login`), 443/https (cert `O=Victron Energy, OU=Venus OS, CN=venus.local`) |
| `192.168.14.187`                 | Victron Venus OS GX endpoint (Wi-Fi side; possibly same device as `.60.181`, not yet distinguished) | 80/http, 443/https (same Venus OS cert)                                                       |
| `192.168.2.2`                    | Pi `sula-bassana` (`eth0`)                                                                          | 22/ssh                                                                                        |

The PredictWind Hub's ethernet side is on this LAN as IPv6 link-local `fe80::20a:52ff:fe07:bda0` (MAC `00:0a:52:07:bd:a0`); no IPv4 address observed on this segment.

---

## SulaLocal (Wi-Fi, hosted by PredictWind Hub)

Observed (Mac briefly roamed onto it): client gets `192.168.22.x/16` —
SulaLocal shares the **same `192.168.0.0/16` pool as the boat ethernet LAN**,
so SulaLocal is L2-bridged through the PW Hub onto the boat LAN.

**No internet routing observed.** Although the PW Hub is a client of
SulaStarlink on its other radio, it does **not** forward SulaLocal client
traffic out through that uplink (no NAT/forwarding configured, or
intentionally blocked). SulaLocal gives you:

- ✅ Access to all boat LAN devices (H5000, Zeus SR, Cerbo, NEP-1, etc.) at L2
- ❌ No internet — Claude, web, etc. all unreachable from SulaLocal

If you need internet, switch the Mac to SulaStarlink. Macs auto-roam between
the two if both are in known networks; toggle Auto-Join off for the one you
don't want.

## B&G Zeus SR Wi-Fi

Each Zeus SR chart plotter broadcasts its own Wi-Fi AP for the B&G/Navico
GoFree mobile app. Observed in the Mac's "Known Networks" list:

| SSID               | Notes                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `B&G Zeus SR_8708` | Hosted by one of the two Zeus SR plotters on the boat LAN (the `8708` suffix is the unit's serial-number tail). Not joined this session — subnet and IP details TBD. |

The second Zeus SR likely broadcasts an analogous SSID but it was not visible
in the screenshot; check the full Wi-Fi scan list to confirm.

---

## Pi reach paths

| Path               | Address                                       |
| ------------------ | --------------------------------------------- |
| SulaStarlink Wi-Fi | `192.168.1.232`                               |
| Boat ethernet LAN  | `192.168.2.2`                                 |
| Tailscale          | `100.64.0.117` (also `sula-bassana.tailnet…`) |

### Pi routing policy

The eth0 NetworkManager profile (`"Wired connection 1"`) is set to
**`ipv4.never-default yes` / `ipv6.never-default yes`**. eth0 is fully usable
for the local `192.168.0.0/16` subnet (H5000, Zeus SR, Cerbo, NEP-1, etc.)
but **never installs a default route**, so all internet-bound traffic exits
via wlan0/SulaStarlink. This avoids the silent black hole that the boat-LAN
gateway (`192.168.0.1`, no internet uplink) would otherwise create.

Reverse with: `sudo nmcli connection modify "Wired connection 1" ipv4.never-default no ipv6.never-default no && sudo nmcli device reapply eth0`

---

## Refreshing this map

```sh
# Pi has nmap, arp-scan, openssl, curl pre-installed.
ssh greg@192.168.1.232

# L2 sweep on a segment that allows ARP broadcasts (boat LAN):
sudo arp-scan --interface=eth0 --retry=1 --ignoredups 192.168.0.0/16

# IP-layer sweep on segments with AP client isolation (SulaStarlink):
sudo nmap -sn --send-ip -e wlan0 192.168.1.0/24

# Identify a host:
curl -sk http://<ip>/
echo | openssl s_client -connect <ip>:443 2>&1 | grep -E "subject=|issuer="
```
