#!/usr/bin/env bash
# Hunt for a Yacht Devices YDWG-02 / YDEN / YDNR on SulaLocal.
# Run on the Mac while connected to SulaLocal. No internet needed.
set -u
SUBNETS=(192.168.0 192.168.22 192.168.60)   # add more if you find them

echo "== UDP/4444 broadcast listen (5s) =="
# YD RAW mode often UDP-broadcasts to 255.255.255.255:4444. nc -u doesn't
# join broadcasts cleanly on macOS, so use python's socket which does.
python3 - <<'PY' &
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
try:
    s.bind(('', 4444))
except Exception as e:
    print(f"  bind 4444 failed: {e}"); raise SystemExit
s.settimeout(5)
seen = {}
end = time.time() + 5
while time.time() < end:
    try:
        data, addr = s.recvfrom(4096)
        seen[addr[0]] = seen.get(addr[0], 0) + 1
    except socket.timeout:
        break
for ip, n in seen.items():
    print(f"  {ip:15s}  {n} pkts on udp/4444 -> likely YDWG RAW broadcast")
if not seen:
    print("  (no UDP/4444 broadcasts heard)")
PY
wait

echo
echo "== TCP probe (1457=YD raw, 10110=NMEA-0183, 80=web) on each /24 =="
for SUB in "${SUBNETS[@]}"; do
  echo "-- $SUB.0/24 --"
  for i in $(seq 1 254); do
    (
      for port in 1457 10110 80; do
        # /dev/tcp open with 0.4s timeout via bash; only print on success
        (timeout 0.4 bash -c "echo > /dev/tcp/$SUB.$i/$port" 2>/dev/null) && \
          echo "  $SUB.$i:$port open"
      done
    ) &
  done
  wait
done

echo
echo "== ARP MAC vendor scan for YD OUI 04:F4:BC =="
arp -a | grep -i "04:f4:bc\|4:f4:bc" || echo "  (none — populate ARP first with: ping -c1 -t1 \$ip)"

echo
echo "== HTTP titles of any /80 hits (likely YDWG admin UI) =="
for SUB in "${SUBNETS[@]}"; do
  for i in $(seq 1 254); do
    (
      title=$(curl -s --max-time 1 "http://$SUB.$i/" 2>/dev/null | grep -oiE "<title>[^<]*</title>" | head -1)
      [ -n "$title" ] && echo "  $SUB.$i  $title"
    ) &
  done
  wait
done

echo
echo "== PW Hub NMEA-0183 stream sample (UDP/11101 5s + TCP/11102 3s) =="
python3 - <<'PY'
import socket, time
from collections import Counter
def talkers(lines):
    c = Counter()
    for l in lines:
        m = l.lstrip().startswith
        if (m('$') or m('!')) and len(l) > 6:
            c[l[1:6]] += 1
    return c
# UDP 11101
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(('', 11101))
    s.settimeout(0.5)
    end = time.time() + 5
    lines = []; src_ip = None
    while time.time() < end:
        try:
            d, addr = s.recvfrom(4096)
            src_ip = addr[0]
            lines.extend(d.decode('ascii', 'replace').splitlines())
        except socket.timeout:
            pass
    print(f"  UDP/11101: {len(lines)} lines, src={src_ip}")
    for tag, n in talkers(lines).most_common(10):
        print(f"    {tag}  x{n}")
except Exception as e:
    print(f"  UDP/11101 failed: {e}")
# TCP 11102 — try gateway then any /80 hit you've seen above; default to gateway
import urllib.request
gw = '192.168.0.1'
try:
    ts = socket.create_connection((gw, 11102), timeout=2)
    ts.settimeout(3)
    buf = b''; end = time.time() + 3
    while time.time() < end:
        try: buf += ts.recv(4096)
        except socket.timeout: break
    ts.close()
    lines = buf.decode('ascii', 'replace').splitlines()
    print(f"  TCP/{gw}:11102: {len(lines)} lines")
    for tag, n in talkers(lines).most_common(10):
        print(f"    {tag}  x{n}")
except Exception as e:
    print(f"  TCP/{gw}:11102 failed: {e}")
PY

echo
echo "== Venus OS / Cerbo probe =="
for HOST in venus.local 192.168.60.181; do
  echo "-- $HOST --"
  # Web UI title
  title=$(curl -s --max-time 2 "http://$HOST/" 2>/dev/null | grep -oiE "<title>[^<]*</title>" | head -1)
  [ -n "$title" ] && echo "  / title: $title"
  # Venus OS REST (gx-v3 firmware exposes /v3/...). 401/403 means present-but-auth.
  for path in /v3/system /v3/services /v3/devices /api/v1/system; do
    code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 2 "http://$HOST$path" 2>/dev/null)
    [ "$code" != "000" ] && [ "$code" != "404" ] && echo "  $path → HTTP $code"
  done
  # MQTT broker (Mosquitto on Venus runs on 1883)
  (timeout 1 bash -c "echo > /dev/tcp/$HOST/1883" 2>/dev/null) && echo "  :1883 mqtt open"
done

echo
echo "== SignalK probe =="
# SignalK servers normally on :3000 with /signalk discovery doc; sometimes :8080
for HOST in venus.local 192.168.60.181 192.168.0.1; do
  for PORT in 3000 8080; do
    BASE="http://$HOST:$PORT"
    ROOT=$(curl -s --max-time 2 "$BASE/signalk" 2>/dev/null)
    if echo "$ROOT" | grep -q "endpoints"; then
      echo "-- SignalK at $BASE --"
      echo "  /signalk: $(echo "$ROOT" | head -c 200)"
      # Sources — N2K bus would show up here as e.g. n2k.0 / canbus0
      SRCS=$(curl -s --max-time 3 "$BASE/signalk/v1/api/sources/" 2>/dev/null)
      if [ -n "$SRCS" ]; then
        echo "  /sources keys:"
        # Pretty print top-level keys (no jq dep)
        echo "$SRCS" | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'    {k}') for k in d.keys()]" 2>/dev/null
      fi
      # Self vessel sample — first ~600 chars
      SELF=$(curl -s --max-time 3 "$BASE/signalk/v1/api/vessels/self" 2>/dev/null)
      [ -n "$SELF" ] && echo "  /vessels/self (head): $(echo "$SELF" | head -c 600)"
    fi
  done
done

echo
echo "== B&G H5000 probe =="
# (1) ARP for Navico/Lowrance OUIs. Navico uses several blocks; the most common
#     for current-gen H5000 / Zeus / Vulcan are 00:1A:2D, 00:0F:DD, 00:11:CD.
echo "-- Navico OUIs in ARP cache --"
arp -a | grep -iE "0:1a:2d|0:f:dd|0:11:cd|00:1a:2d|00:0f:dd|00:11:cd" || \
  echo "  (none — populate with sweep first)"

# (2) Broader mDNS dump (8s) to catch Navico/H5000-family advertisements.
#     We already know about _neondevice / _matros_net_service from earlier.
#     New things we want to see: _hlink, _navico, _gofree, _h5000.
echo
echo "-- mDNS service-type browse (8s) — looking for hlink / navico / gofree / h5000 --"
timeout 8 dns-sd -B _services._dns-sd._udp local 2>&1 | \
  grep -iE "hlink|navico|gofree|h5000|neon|matros" | sort -u

# (3) Targeted resolve of likely Navico mDNS service types.
echo
echo "-- mDNS resolve of Navico-family services (4s each) --"
for SVC in _hlink._tcp _navico-services._tcp _navico_dgw._tcp _gofree._tcp; do
  out=$(timeout 4 dns-sd -B "$SVC" local 2>&1 | grep -v "^DATE\|^Browsing\|^Timestamp\|^STARTING")
  if echo "$out" | grep -q "Add"; then
    echo "  $SVC FOUND:"
    echo "$out" | grep "Add" | awk '{$1=""; $2=""; print "   ", $0}'
  fi
done

# (4) Port probes for H-LINK over TCP. The H5000 CPU exposes H-LINK on port
#     2002 by default per B&G's manual. Also check 80 / 8080 for its web UI.
echo
echo "-- H5000 ports (2002=H-LINK, 80/8080=web) on each /24 --"
for SUB in "${SUBNETS[@]}"; do
  for i in $(seq 1 254); do
    (
      for port in 2002 8080; do
        (timeout 0.4 bash -c "echo > /dev/tcp/$SUB.$i/$port" 2>/dev/null) && \
          echo "  $SUB.$i:$port open"
      done
    ) &
  done
  wait
done

# (5) For any /2002 hit, sniff the banner — H-LINK responds to ASCII queries.
#     Sending '!\r\n' should produce a help/version response from a real H5000.
echo
echo "-- H-LINK banner probe on any /2002 hit --"
HLINK_HOSTS=$(for SUB in "${SUBNETS[@]}"; do
  for i in $(seq 1 254); do
    (timeout 0.3 bash -c "echo > /dev/tcp/$SUB.$i/2002" 2>/dev/null) && echo "$SUB.$i" &
  done
  wait
done)
for H in $HLINK_HOSTS; do
  echo "-- $H:2002 --"
  # Send a benign query and capture ~2s of response.
  python3 - "$H" <<'PY'
import socket, sys, time
host = sys.argv[1]
try:
    s = socket.create_connection((host, 2002), timeout=2)
    s.sendall(b"!\r\n")
    s.settimeout(2)
    buf = b""
    end = time.time() + 2
    while time.time() < end:
        try:
            chunk = s.recv(4096)
            if not chunk: break
            buf += chunk
        except socket.timeout:
            break
    s.close()
    print("  bytes=", len(buf))
    txt = buf.decode("ascii", "replace")
    for line in txt.splitlines()[:8]:
        print("   ", repr(line))
except Exception as e:
    print(f"  banner probe failed: {e}")
PY
done
