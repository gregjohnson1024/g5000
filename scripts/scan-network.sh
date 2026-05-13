#!/usr/bin/env bash
# scan-network.sh — Map the network(s) the host is currently attached to.
# Designed to run on macOS while connected to SulaLocal (no internet).
# Writes a markdown report alongside the script.
#
# Usage:
#   ./scan-network.sh                     # auto-detect active interfaces
#   ./scan-network.sh en0                 # scan only en0
#   ./scan-network.sh 192.168.10.0/24     # scan a specific CIDR
#
# Output: network-scan-<timestamp>.md (markdown report to share with Claude later)

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="${SCRIPT_DIR}/network-scan-${TS}.md"

# ─── argument parsing ────────────────────────────────────────────────────────

TARGET="${1:-auto}"

# ─── helpers ─────────────────────────────────────────────────────────────────

log()  { printf '%s\n' "$*" | tee -a "$OUT"; }
log_  () { printf '%s' "$*" | tee -a "$OUT"; }

# OUI→vendor lookup for the vendors we know are on Sula. Anything else: print
# the raw OUI and let the user (or Claude) resolve it from the IEEE registry.
oui_vendor() {
  # macOS default bash is 3.2 — no ${var,,} support. Use tr for portability.
  local mac
  mac="$(echo "$1" | tr 'A-Z' 'a-z')"
  local oui="${mac:0:8}"
  case "$oui" in
    00:0a:52) echo "AsiaRF (PredictWind Hub chipset)" ;;
    00:0e:91) echo "Navico Auckland (B&G / Zeus / H5000)" ;;
    00:42:42) echo "?? (locally-assigned; B&G NEP-1 candidate)" ;;
    c0:61:9a) echo "Victron Energy" ;;
    f0:b0:40) echo "Hunan FN-Link (Wi-Fi chipset — e.g. Victron Cerbo Wi-Fi)" ;;
    74:24:9f) echo "Tibro (Starlink router)" ;;
    d8:3a:dd) echo "Raspberry Pi Trading" ;;
    10:7d:c8) echo "Apple Inc." ;;
    ae:d8:22) echo "(randomized — likely Apple privacy MAC)" ;;
    *)        # locally-administered if second-LSB of first byte is set
              local first_byte="${mac:0:2}"
              local nibble="${first_byte:1:1}"
              case "$nibble" in
                2|3|6|7|a|b|e|f) echo "(locally-administered / private MAC)" ;;
                *)               echo "OUI $oui (look up at oui.ieee.org)" ;;
              esac
              ;;
  esac
}

# Identify a host by probing HTTP / TLS. Returns one line, max ~80 chars.
identify() {
  local ip="$1"
  local out=""

  # HTTP title (port 80) — follow redirects to get the real page's title
  local title
  title="$(curl -sk -L --max-time 4 "http://${ip}/" 2>/dev/null \
           | grep -i -o '<title>[^<]*</title>' \
           | head -1 \
           | sed -E 's/<\/?title>//gi; s/&amp;/\&/g; s/^[[:space:]]*//; s/[[:space:]]*$//')"
  # Discard generic HTTP-status titles that aren't device-identifying
  case "$title" in
    "302 Found"|"301 Moved Permanently"|"401 Unauthorized"|"403 Forbidden"|"404 Not Found"|"") title="" ;;
  esac
  [[ -n "$title" ]] && out+="HTTP title: ${title}"

  # HTTP redirect target (some devices like LuCI redirect)
  local redirect
  redirect="$(curl -sk --max-time 3 -I "http://${ip}/" 2>/dev/null \
              | awk -F': ' 'tolower($1)=="location"{print $2}' | tr -d '\r\n')"
  if [[ -z "$title" && -n "$redirect" ]]; then
    out+="HTTP→${redirect}"
  fi

  # TLS cert subject (port 443)
  local cert
  cert="$(echo | openssl s_client -connect "${ip}:443" -servername "${ip}" 2>/dev/null \
          </dev/null \
          | openssl x509 -noout -subject 2>/dev/null \
          | sed -E 's/^subject= ?//; s/subject=//')"
  if [[ -n "$cert" ]]; then
    [[ -n "$out" ]] && out+=" | "
    out+="TLS: ${cert}"
  fi

  echo "$out"
}

# Port profile: list which of a curated set of ports are open.
# Uses `nc -z -w 1` which is available on both macOS (BSD nc) and Linux.
port_profile() {
  local ip="$1"
  local ports=(22 53 80 443 502 1457 2053 4444 5000 8080 8443 10110 11101 11102)
  local open=()
  for p in "${ports[@]}"; do
    if nc -z -w 1 "$ip" "$p" >/dev/null 2>&1; then
      open+=("$p")
    fi
  done
  if [[ ${#open[@]} -gt 0 ]]; then
    IFS=,; echo "${open[*]}"; unset IFS
  fi
}

# ping one host with a short timeout, cross-platform.
# macOS ping: -W is in milliseconds; Linux ping: -W is in seconds.
ping_once() {
  local target="$1"
  if [[ $PLATFORM == mac ]]; then
    ping -c 1 -W 1000 -t 1 "$target" >/dev/null 2>&1
  else
    ping -c 1 -W 1 "$target" >/dev/null 2>&1
  fi
}

# ─── platform detection ──────────────────────────────────────────────────────

case "$(uname -s)" in
  Darwin) PLATFORM=mac   ;;
  Linux)  PLATFORM=linux ;;
  *)      echo "Unsupported platform: $(uname -s)"; exit 1 ;;
esac

# ─── work out which subnet(s) to scan ────────────────────────────────────────

# Collect (interface, ipv4, cidr) tuples for active non-loopback interfaces.
get_interfaces() {
  if [[ $PLATFORM == mac ]]; then
    for iface in $(ifconfig -l); do
      [[ "$iface" == lo* || "$iface" == utun* || "$iface" == awdl* || \
         "$iface" == llw*  || "$iface" == anpi* || "$iface" == ap*   || \
         "$iface" == gif*  || "$iface" == stf*  || "$iface" == bridge* ]] && continue
      local info ip mask
      info=$(ifconfig "$iface" 2>/dev/null | awk '/inet /{print $2, $4; exit}')
      ip="${info% *}"
      mask="${info#* }"
      [[ -z "$ip" || -z "$mask" ]] && continue
      # convert hex netmask (0xffffff00) to prefix length
      local hex="${mask#0x}"
      local bits=0 byte
      for ((i=0; i<8; i+=2)); do
        byte=$((16#${hex:i:2}))
        while (( byte )); do bits=$((bits + (byte & 1))); byte=$((byte >> 1)); done
      done
      # CIDR network address
      local n1 n2 n3 n4
      IFS=. read -r n1 n2 n3 n4 <<<"$ip"
      local m1 m2 m3 m4
      m1=$((16#${hex:0:2})); m2=$((16#${hex:2:2}))
      m3=$((16#${hex:4:2})); m4=$((16#${hex:6:2}))
      printf '%s %s %d.%d.%d.%d/%d\n' "$iface" "$ip" \
        $((n1 & m1)) $((n2 & m2)) $((n3 & m3)) $((n4 & m4)) "$bits"
    done
  else
    ip -o -4 addr show \
      | awk '$2!~/^(lo|tailscale|docker|veth)/ {print $2, $4}' \
      | while read -r iface cidr; do
          local ip="${cidr%/*}"
          local net
          net=$(ip -o route show | awk -v i="$iface" '$3==i && $1!="default"{print $1; exit}')
          printf '%s %s %s\n' "$iface" "$ip" "$net"
        done
  fi
}

# ─── read ARP cache and return "ip mac" pairs for an interface ───────────────

read_arp() {
  local iface="$1"
  if [[ $PLATFORM == mac ]]; then
    arp -a -n -i "$iface" 2>/dev/null \
      | awk '/at [0-9a-f:]+/ {
          gsub(/[()]/,"",$2);
          ip=$2;
          # skip multicast (224.0.0.0/4) and broadcast addresses
          split(ip,octets,".");
          if (octets[1]+0 >= 224) next;
          if (ip ~ /\.255$/) next;
          mac=$4;
          n=split(mac,parts,":");
          out="";
          for(i=1;i<=n;i++){
            if(length(parts[i])==1) parts[i]="0" parts[i];
            out=(i==1)?parts[i]:out":"parts[i];
          }
          if (mac!="ff:ff:ff:ff:ff:ff" && mac!="(incomplete)") print ip, out
        }'
  else
    ip neigh show dev "$iface" \
      | awk '$1!~/^fe80/ && $1!~/^ff/ && /lladdr/ {
          ip=$1;
          split(ip,octets,".");
          if (octets[1]+0 >= 224) next;
          print ip, $3
        }'
  fi
}

# ─── main flow ───────────────────────────────────────────────────────────────

# Truncate output
: > "$OUT"

log "# Network Scan — $(hostname) — $(date '+%Y-%m-%d %H:%M:%S %Z')"
log
log "_Generated by \`scripts/scan-network.sh\`. Share this file with Claude to update the network map._"
log

# Build list of (iface, ip, cidr) tuples to scan
declare -a TARGETS=()

if [[ "$TARGET" == auto ]]; then
  while read -r iface ip cidr; do
    TARGETS+=("$iface|$ip|$cidr")
  done < <(get_interfaces)
elif [[ "$TARGET" == *.*.*.*/* ]]; then
  TARGETS+=("(custom)|?|$TARGET")
else
  # Interface name passed directly — look it up
  while read -r iface ip cidr; do
    [[ "$iface" == "$TARGET" ]] && TARGETS+=("$iface|$ip|$cidr")
  done < <(get_interfaces)
fi

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  log "No interfaces or targets found."
  exit 1
fi

for entry in "${TARGETS[@]}"; do
  IFS='|' read -r iface ip cidr <<<"$entry"
  log
  log "## ${iface}  (${ip}  →  ${cidr})"
  log

  # We always sweep the /24 the host itself sits in — accurate for /24 nets,
  # and for /16 nets like the boat LAN this still catches the DHCP cluster.
  local_third=$(echo "$ip" | awk -F. '{print $1"."$2"."$3}')
  log "_Pinging ${local_third}.1–254 to prime ARP …_"
  for i in $(seq 1 254); do
    (ping_once "${local_third}.${i}") &
  done
  wait
  sleep 1   # let ARP cache settle

  log
  log "| IP | MAC | Vendor (OUI) | Identity | Open ports |"
  log "|---|---|---|---|---|"

  # Collect ip/mac pairs, skip self
  while read -r line; do
    [[ -z "$line" ]] && continue
    set -- $line
    host_ip="$1"
    host_mac="$2"
    [[ "$host_ip" == "$ip" ]] && continue

    vendor="$(oui_vendor "$host_mac")"
    identity="$(identify "$host_ip" 2>/dev/null)"
    ports="$(port_profile "$host_ip" 2>/dev/null)"

    # Escape pipe chars for markdown table
    identity="${identity//|/\\|}"
    log "| \`${host_ip}\` | \`${host_mac}\` | ${vendor} | ${identity:-—} | ${ports:-—} |"
  done < <(read_arp "$iface" | sort -t. -k4,4n)

  # Also include this host's own line for the record
  self_mac=""
  if [[ $PLATFORM == mac ]]; then
    self_mac=$(ifconfig "$iface" 2>/dev/null | awk '/ether/{print $2; exit}')
  else
    self_mac=$(cat "/sys/class/net/${iface}/address" 2>/dev/null)
  fi
  log "| \`${ip}\` | \`${self_mac}\` | (this host) | $(hostname) | — |"
done

log
log "---"
log "_Scan complete. Output: \`$(basename "$OUT")\`._"

echo
echo "Done.  Report written to: $OUT"
