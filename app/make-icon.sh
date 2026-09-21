#!/usr/bin/env bash
#
# Build Resources/AppIcon.icns from Resources/AppIcon.png.
#
# The .icns is committed so that build-app.sh needs no extra tooling; this
# script only has to run when the artwork changes.
#
# AppIcon.png must already be the rounded-square artwork on a transparent
# surround. macOS does not clip an icon to the squircle for you, so a master
# with opaque corners shows up in the Dock as a square.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/Resources/AppIcon.png"
ICNS="$ROOT/Resources/AppIcon.icns"
SET="$(mktemp -d)/AppIcon.iconset"
trap 'rm -rf "$(dirname "$SET")"' EXIT

mkdir -p "$SET"
# Every size iconutil expects. The @2x variant is twice the nominal points,
# so icon_512x512@2x.png is the full 1024px master.
for size in 16 32 128 256 512; do
  sips -s format png -z "$size" "$size" "$SRC" --out "$SET/icon_${size}x${size}.png" >/dev/null
  sips -s format png -z "$((size*2))" "$((size*2))" "$SRC" --out "$SET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$SET" -o "$ICNS"
echo "built $ICNS ($(du -h "$ICNS" | cut -f1))"
