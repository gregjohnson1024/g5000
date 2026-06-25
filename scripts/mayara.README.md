# mayara-server — install & run guide (Pi `sula-bassana`)

[mayara-server](https://github.com/MarineYachtRadar/mayara-server) is the open-source
bridge that exposes a Navico/B&G radar over a WebSocket API. The g5000 radar overlay
connects to it on port 6502.

---

## 1. Download the binary

SSH to the Pi and run:

```bash
mkdir -p /home/greg/mayara
cd /home/greg/mayara

# Download the aarch64 musl release (static binary, no libc dependency):
gh release download v3.6.0 \
  --repo MarineYachtRadar/mayara-server \
  --pattern '*aarch64-unknown-linux-musl*'

# Extract and make executable:
tar xzf mayara-server-*-aarch64-unknown-linux-musl.tar.gz
chmod +x mayara-server
```

Alternatively, build on another machine and `scp` the binary:

```bash
scp mayara-server greg@100.64.0.117:/home/greg/mayara/mayara-server
```

---

## 2. Install the systemd unit

From the g5000 repo on the Pi:

```bash
sudo cp /home/greg/autopilot/scripts/mayara.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mayara
```

By default the unit starts in **emulator mode** (`--emulator -p 6502`) — safe when no
radar is physically connected.

---

## 3. Switch to the real radar (drop-in override)

Create a drop-in to replace the `MAYARA_ARGS` environment variable:

```bash
sudo mkdir -p /etc/systemd/system/mayara.service.d
sudo tee /etc/systemd/system/mayara.service.d/override.conf <<'EOF'
[Service]
Environment=MAYARA_ARGS=-p 6502 -b navico -i <iface>
EOF
sudo systemctl daemon-reload
sudo systemctl restart mayara
```

Replace `<iface>` with the network interface on the Navico Ethernet segment (e.g.
`eth0`, `eth1`, or a VLAN interface). Use `ip link` to list interfaces; the radar
multicast traffic arrives on the interface directly connected to the Navico network
switch. The exact subnet and multicast group depend on the physical install — **confirm
when the radar is physically connected to the Pi**.

Tip: run `mayara-server --list-interfaces` (if supported by your release) to see which
interfaces receive radar multicast beacons.

---

## 4. Verify

```bash
systemctl status mayara          # should be "active (running)"
journalctl -u mayara -f          # tail logs
```

In emulator mode you will see something like:

```
mayara-server listening on ws://0.0.0.0:6502
radar: emulator active
```

---

## 5. Reachability from the g5000 web UI

The g5000 chart overlay derives the mayara WebSocket URL from the page's own hostname
on port 6502 — no `/settings` field is needed in phase 1.

| Access path                            | Protocol | Works?                       |
| -------------------------------------- | -------- | ---------------------------- |
| `http://sula-bassana.local:3000`       | `ws://`  | Yes                          |
| `http://100.64.0.117:3000` (Tailscale) | `ws://`  | Yes                          |
| `https://g5000.sulabassana.net`        | `wss://` | Needs extra step — see below |

### `wss://` over the public URL

Browsers block mixed-content (`wss://` from an `https://` page requires TLS on port
6502). Use `tailscale serve` to put TLS in front of mayara on the Pi:

```bash
# On the Pi — expose mayara as a TLS endpoint on the Tailscale network:
sudo tailscale serve --bg --https=6502 http://localhost:6502
```

This makes `https://<pi-tailscale-hostname>:6502` work as `wss://`. There is **no
cloudflared tunnel for radar** — Cloudflare terminates WebSocket connections in a way
that is incompatible with the radar stream. Use Tailscale for encrypted remote access.

---

## 6. Server-side status channels (optional)

The g5000 app includes a background poller that reads `radar.connected` and
`radar.range.m` channels via a server-side mayara connection. To activate it, set the
mayara base URL in the ConfigStore:

- Open `/settings` in the g5000 UI.
- Set **Radar › mayara base URL** to `http://localhost:6502` (or the appropriate host
  if mayara runs on a different machine).

If this is left blank the status channels stay dark, but the chart overlay still works
via the browser-derived URL.
