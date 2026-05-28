#!/usr/bin/env bash
# Download the GEBCO 2024 global grid once and verify its checksum.
#
# The grid is ~7.5 GB and static, so this is a one-time step. The download
# URL, target path and (optional) expected sha256 all come from
# config/levels.json so this script needs no editing.
#
# Usage:
#   scripts/acquire.sh              # download to grid.path, verify sha256
#   scripts/acquire.sh --verify     # only re-verify an existing file
#
# To pin a checksum: download once, run `shasum -a 256 <file>`, paste the
# digest into config/levels.json -> grid.sha256, and future runs will verify.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="python3 $DIR/scripts/gebco_levels.py"
CFG="$DIR/config/levels.json"

URL="$($PY get grid.url --config "$CFG")"
REL_PATH="$($PY get grid.path --config "$CFG")"
SHA="$($PY get grid.sha256 --config "$CFG")"
DEST="$DIR/$REL_PATH"

verify() {
  if [[ -z "$SHA" || "$SHA" == "None" ]]; then
    echo "acquire: no grid.sha256 pinned in config — skipping checksum verify."
    echo "         (run 'shasum -a 256 $DEST' and paste the digest into config to enable.)"
    return 0
  fi
  echo "acquire: verifying sha256…"
  local got
  got="$(shasum -a 256 "$DEST" | awk '{print $1}')"
  if [[ "$got" != "$SHA" ]]; then
    echo "acquire: CHECKSUM MISMATCH" >&2
    echo "  expected $SHA" >&2
    echo "  got      $got" >&2
    return 1
  fi
  echo "acquire: checksum OK."
}

if [[ "${1:-}" == "--verify" ]]; then
  [[ -f "$DEST" ]] || { echo "acquire: $DEST not found" >&2; exit 1; }
  verify
  exit $?
fi

mkdir -p "$(dirname "$DEST")"
if [[ -f "$DEST" ]]; then
  echo "acquire: $DEST already present ($(du -h "$DEST" | cut -f1)). Skipping download."
else
  echo "acquire: downloading GEBCO grid from:"
  echo "  $URL"
  echo "  -> $DEST   (~7.5 GB, expect tens of minutes on shore wifi)"
  # The BODC open_download endpoint returns a zip; -L follows redirects.
  tmp="$DEST.download"
  curl -fSL --retry 3 -o "$tmp" "$URL"
  case "$tmp" in
    *.zip|*) # content may be a zip regardless of suffix; detect and extract
      if file "$tmp" | grep -qi 'zip archive'; then
        echo "acquire: extracting zip…"
        unzip -o "$tmp" -d "$(dirname "$DEST")"
        rm -f "$tmp"
        # Expect a GEBCO_2024*.nc inside; move it to the configured path.
        found="$(find "$(dirname "$DEST")" -maxdepth 1 -iname 'GEBCO_2024*.nc' | head -1)"
        [[ -n "$found" ]] && [[ "$found" != "$DEST" ]] && mv "$found" "$DEST"
      else
        mv "$tmp" "$DEST"
      fi
      ;;
  esac
  echo "acquire: downloaded $(du -h "$DEST" | cut -f1)."
fi

verify
echo "acquire: ready -> $DEST"
