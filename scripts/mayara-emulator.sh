#!/usr/bin/env bash
# Download (if missing) and run the mayara-server radar emulator for local dev.
# Serves the Signal-K REST API + binary spoke WebSocket on :6502 (no hardware).
#
# Usage: bash scripts/mayara-emulator.sh        # foreground
#        bash scripts/mayara-emulator.sh &       # background
# Env:   MAYARA_DIR (default /tmp/mayara), MAYARA_PORT (default 6502),
#        MAYARA_VERSION (default v3.6.0)
set -euo pipefail

VER="${MAYARA_VERSION:-v3.6.0}"
DIR="${MAYARA_DIR:-/tmp/mayara}"
PORT="${MAYARA_PORT:-6502}"
mkdir -p "$DIR"
cd "$DIR"

if [ ! -x "$DIR/mayara-server" ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-*) PAT='*universal-apple-darwin*' ;;
    Linux-aarch64 | Linux-arm64) PAT='*aarch64-unknown-linux-musl*' ;;
    Linux-x86_64) PAT='*x86_64-unknown-linux-musl*' ;;
    *) echo "unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
  esac
  echo "Downloading mayara-server $VER ($PAT)..." >&2
  gh release download "$VER" --repo MarineYachtRadar/mayara-server --pattern "$PAT" --clobber
  tar xzf mayara-server-*.tar.gz
  chmod +x mayara-server
  xattr -dr com.apple.quarantine mayara-server 2>/dev/null || true
fi

echo "Starting mayara-server --emulator on :$PORT" >&2
exec "$DIR/mayara-server" --emulator -p "$PORT"
