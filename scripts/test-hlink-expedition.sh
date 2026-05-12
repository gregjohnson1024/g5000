#!/usr/bin/env bash
# scripts/test-hlink-expedition.sh
#
# Emulate an Expedition-shaped H-LINK session against a running G5000
# autopilot-server, verifying that the read path Expedition uses works
# end-to-end. PASS/FAIL per check; non-zero exit on any FAIL.
#
# Usage:
#   ./scripts/test-hlink-expedition.sh                  # localhost:5050
#   ./scripts/test-hlink-expedition.sh g5000-pi 5050    # remote
#
# Expects the server to be running in DEMO_MODE so all expected channels
# are publishing. Against a live (no-NGT-1) server, BSP/wind functions
# would stream empty values; the script accepts that as PASS with a note.

set -u

HOST="${1:-localhost}"
PORT="${2:-5050}"
TIMEOUT="${3:-3}"

FAIL=0
PASS=0

pass() { echo "  ✅ $*"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $*"; FAIL=$((FAIL + 1)); }

# XOR-8 checksum of a string, uppercase hex
hl_cs() {
  python3 -c "
import sys
data = sys.argv[1].encode()
cs = 0
for b in data: cs ^= b
print(f'{cs:02X}')
" "$1"
}

# Format an H-LINK line: body + '*' + checksum + CRLF
hl_line() {
  local body="$1"
  printf "%s*%s\r\n" "$body" "$(hl_cs "$body")"
}

echo "Targeting G5000 H-LINK at $HOST:$PORT (timeout ${TIMEOUT}s)"
echo

# Quick reachability probe.
if ! nc -z -w 2 "$HOST" "$PORT" 2>/dev/null; then
  fail "Cannot reach $HOST:$PORT — is the autopilot-server running?"
  exit 1
fi
pass "TCP port $HOST:$PORT is open"
echo

# Build the input stream Expedition would send: enable a handful of
# common functions, then start streaming. Read ~$TIMEOUT seconds of output.
#
# IMPORTANT: pipe DIRECTLY into nc rather than via a temp file. The
# subshell's sleep then happens IN-LINE with nc consuming stdin, keeping
# the TCP connection open during the streaming window. Writing the script
# to a file first caused the sleep to elapse before nc started, so the
# server saw start+stop almost instantly.
OUTPUT=$(mktemp)
trap "rm -f '$OUTPUT'" EXIT

(
  hl_line '#OV,,1,65,1'   # BSP
  hl_line '#OV,,1,77,1'   # AWS
  hl_line '#OV,,1,81,1'   # AWA
  hl_line '#OV,,1,85,1'   # TWS
  hl_line '#OV,,1,89,1'   # TWA
  hl_line '#OV,,1,109,1'  # TWD
  hl_line '#OV,,1,233,1'  # COG
  hl_line '#OV,,1,235,1'  # SOG
  hl_line '#OS,1'         # start streaming
  sleep "$TIMEOUT"        # collect for TIMEOUT seconds while nc is reading
  hl_line '#OS,0'         # stop
  # Give the server a moment to flush the last frame before nc closes.
  sleep 0.2
) | nc -w "$((TIMEOUT + 3))" "$HOST" "$PORT" > "$OUTPUT" 2>/dev/null || true

LINES=$(wc -l < "$OUTPUT" | tr -d ' ')
if [ "$LINES" -lt 5 ]; then
  fail "Received only $LINES output lines (expected dozens of V frames)"
  cat "$OUTPUT"
  exit 1
fi
pass "Received $LINES output lines"

# Check we got V frames for each enabled function.
for fn in 65 77 81 85 89 109 233 235; do
  count=$(grep -c "^V001,001,$(printf '%03d' $fn)," "$OUTPUT" || true)
  if [ "$count" -gt 0 ]; then
    pass "Function $fn streamed $count V frames"
  else
    # In live mode (no NGT-1) the wind/depth functions won't have data —
    # that's expected, not a failure of the server.
    case "$fn" in
      65|77|81|85|89|109|193) echo "  ⚠️  Function $fn had no frames (acceptable in live mode without sensors)" ;;
      *) fail "Function $fn streamed no V frames" ;;
    esac
  fi
done

# Validate checksums on every V frame.
INVALID_CS=$(python3 <<PY
import sys
with open("$OUTPUT", "r", encoding="ascii", errors="replace") as f:
    body_lines = [l.strip() for l in f if l.startswith("V")]
bad = 0
for line in body_lines:
    if "*" not in line:
        bad += 1
        continue
    body, cs = line.rsplit("*", 1)
    cs = cs.strip()
    expected = 0
    for b in body.encode():
        expected ^= b
    if f"{expected:02X}" != cs:
        bad += 1
print(bad)
PY
)
if [ "$INVALID_CS" = "0" ]; then
  pass "All V-frame checksums verify"
else
  fail "$INVALID_CS V frame(s) had invalid checksums"
fi

# Sanity-check rate: BSP at 5 Hz over $TIMEOUT seconds = ~5 * TIMEOUT frames
BSP_COUNT=$(grep -c "^V001,001,065," "$OUTPUT" || true)
EXPECTED_MAX=$((TIMEOUT * 5 + 3))  # 5 Hz throttle + small grace
if [ "$BSP_COUNT" -le "$EXPECTED_MAX" ] && [ "$BSP_COUNT" -gt 0 ]; then
  pass "BSP rate-limited: $BSP_COUNT frames (≤ $EXPECTED_MAX @ 5Hz over ${TIMEOUT}s)"
elif [ "$BSP_COUNT" -gt "$EXPECTED_MAX" ]; then
  fail "BSP not rate-limited: $BSP_COUNT frames (exceeds $EXPECTED_MAX)"
fi

echo
if [ "$FAIL" -gt 0 ]; then
  echo "FAILED: $FAIL check(s)"
  exit 1
fi
echo "PASSED: $PASS check(s)"
