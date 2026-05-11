# Remote access for the boat Pi — Tailscale via Headscale

**Goal:** SSH into the G5000 RPi from Ottawa once the boat is anywhere with internet.

**Tool:** Tailscale, with our self-hosted Headscale coordinator at
`headscale.rbr-global.com`. The Pi becomes a node on the RBR tailnet;
machines in Ottawa also on the tailnet can reach it by hostname.

## Why this and not something else

| Option | Verdict |
|---|---|
| **Tailscale + Headscale** | ✅ Self-hosted coordinator (no Tailscale Inc. dependency), zero NAT/firewall config, works over any internet the boat finds, encrypted by default, free. |
| Cellular modem + static IP + port forward | Hardware + monthly cost + public attack surface. |
| Marina WiFi + DynDNS + port forward | Depends on marina NAT; usually fragile. |
| Reverse SSH to a jump host | Works but requires keeping a long-lived tunnel and dealing with reconnects manually. |

## Confirming the server is alive

```bash
curl -s https://headscale.rbr-global.com/health
# expect: {"status":"pass"}

curl -s 'https://headscale.rbr-global.com/key?v=2024-09-01'
# expect: 400 with "invalid capability version" body
# (The /key endpoint is the real Tailscale coordinator handshake. The 400 means
# the server is speaking the protocol; we're not sending a real capability
# version because we're just probing. A real `tailscale up` from a node will
# send the right version.)
```

Server endpoint: `35.182.13.8` (AWS `ca-central-1`).
TLS cert: Let's Encrypt, valid through 2026-07-29.

## Setup procedure for the boat RPi

### 1. Server side — generate a pre-auth key

This requires admin access to `headscale.rbr-global.com` (shell on the host
or a Headscale API key). One-line command on the server:

```bash
# As an admin user with shell on the headscale host:
headscale preauthkey create \
  --user g5000 \
  --expiration 24h \
  --reusable=false \
  --ephemeral=false \
  --tags tag:g5000
```

You can also create a long-lived non-expiring key for development if needed,
but a fresh short-lived key per setup is the cleaner habit.

Save the key string somewhere short-term (we won't store it in the repo).

### 2. Pi side — install Tailscale

```bash
# On the Pi (e.g. ssh greg@g5000-pi or the local IP):
curl -fsSL https://tailscale.com/install.sh | sh

# Authenticate against headscale, not Tailscale Inc.'s coordinator:
sudo tailscale up \
  --login-server=https://headscale.rbr-global.com \
  --authkey=<the-preauth-key-from-step-1> \
  --hostname=g5000-pi \
  --ssh \
  --accept-routes \
  --advertise-tags=tag:g5000
```

What each flag does:

- `--login-server=…` — point Tailscale at our coordinator instead of
  `controlplane.tailscale.com`. This is the line that makes it a Headscale
  client.
- `--authkey=…` — non-interactive auth via the pre-auth key. (Interactive
  flow also works: omit the flag and follow the URL the CLI prints.)
- `--hostname=g5000-pi` — stable name on the tailnet. SSH will use this
  (`ssh greg@g5000-pi`).
- `--ssh` — enable Tailscale SSH. The Pi becomes reachable as
  `ssh greg@g5000-pi` from any other tailnet node, with ACL-controlled
  permissions instead of relying solely on `authorized_keys`. The local
  `authorized_keys` still works for boat-side console fallback.
- `--accept-routes` — accept subnet routes other tailnet nodes advertise
  (e.g. RBR office subnets).
- `--advertise-tags=tag:g5000` — apply the `tag:g5000` ACL tag so Headscale
  ACLs can target this device.

### 3. Verify on the Pi

```bash
sudo tailscale status
# Should show g5000-pi with a 100.x.x.x IP and "online".

ip addr show tailscale0
# Should show the Tailscale interface with a 100.x.x.x address.
```

### 4. Mac / Ottawa side

The Mac App Store Tailscale.app (`/Applications/Tailscale.app`, v1.96.5+)
**does** support `--login-server` via its bundled CLI — earlier docs
(including an earlier version of this file) said otherwise. The CLI lives
at `/Applications/Tailscale.app/Contents/MacOS/Tailscale` and accepts the
same flags as the open-source `tailscaled`.

The flow:

```bash
TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale

# If you've authenticated to headscale before from this Mac, the profile is
# cached and this resumes it. Otherwise the CLI prints a registration URL
# (something like https://headscale.rbr-global.com/register/nodekey:...)
# that the headscale admin completes server-side with `headscale nodes
# register --user <you> --key <nodekey>`.
$TS up \
  --login-server=https://headscale.rbr-global.com \
  --hostname=$(hostname -s)

$TS status | head -5   # should show this Mac with a 100.64.x.x IP
$TS ip                 # your tailnet IPs (v4 + v6)
```

To leave the tailnet without breaking other Tailscale profiles:

```bash
$TS down               # stop the network, keep the profile
# or
$TS logout             # invalidate this node's key on headscale
```

Switching back to a different Tailscale account (e.g. a corporate/Inc.
tailnet) is done via the GUI app's account menu.

Verified working 2026-05-11 from this Mac: registration + `tailscale up`
succeeded, `tailscale status` returned the full RBR tailnet (~120 nodes,
~25 online at test time), `tailscale ping tailscale-ottawa` returned
**49 ms via DERP(tor)**, ICMP via `tailscale0` worked.

### 5. End-to-end test (from a tailnet-joined machine in Ottawa)

```bash
# From any machine that has joined the headscale tailnet:
ssh greg@g5000-pi 'uname -a; uptime; tailscale status | head -3'

# HTTP — port-forward the autopilot-server's web UI:
ssh -L 3000:localhost:3000 greg@g5000-pi
# Then browse http://localhost:3000 locally.
```

For continuous use, consider:

- `tailscale serve` on the Pi to expose `http://g5000-pi/` to tailnet members
  without needing the SSH port-forward.
- Tailscale ACLs in Headscale to restrict the `tag:g5000` device class
  (e.g. only allow `tag:g5000-admin` users to SSH; allow anyone in
  `tag:g5000-crew` to GET on HTTP 3000).
- **Do NOT** enable `tailscale funnel` (public internet exposure) unless the
  /helm UI has a password gate. The current G5000 build binds to LAN with no
  auth.

## Operational notes

- **Auto-start on boot**: `tailscale up …` configures systemd's
  `tailscaled.service` to come up on boot, so the Pi reconnects automatically
  when power-cycled or when WiFi/cellular flaps.
- **Reconnect resilience**: Tailscale tolerates underlying network changes
  (boat moves from marina WiFi to cellular) without intervention.
- **No-internet fallback**: when the boat has no internet at all, you
  obviously can't reach the Pi remotely — same as any solution. SSH over
  the boat's local LAN (`ssh greg@<boat-LAN-IP>`) still works as a console
  fallback because Tailscale doesn't interfere with the wired/wifi interfaces.
- **Locking out scenario**: keep the local `authorized_keys` on the Pi in
  addition to Tailscale SSH. If Headscale or Tailscale auth ever fails (cert
  expiry, account lockout, server outage), the boat-side console + local SSH
  remain working.
- **Rotation**: pre-auth keys can be set to expire (`--expiration 24h`) or
  be non-reusable to limit blast radius if exposed. For long-running nodes
  the node key itself (negotiated on first connect) keeps working past the
  pre-auth key's expiry — the pre-auth key is only used during initial
  registration.

## TODO when actually doing this

- [ ] Get the headscale admin to generate a pre-auth key with `tag:g5000`.
- [ ] Decide on the Ottawa-side connection method (option 1, 2, or 3 above).
- [ ] Install Tailscale on the Pi using the procedure in §2.
- [ ] Verify `sudo tailscale status` shows online + 100.x.x.x IP.
- [ ] Test SSH from Ottawa.
- [ ] Optional: `tailscale serve` for HTTP 3000.
- [ ] Document ACLs in this file once they're set in Headscale.
