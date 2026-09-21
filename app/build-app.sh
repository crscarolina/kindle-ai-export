#!/usr/bin/env bash
#
# Assemble KindleExport.app.
#
# Xcode isn't required: SwiftPM builds the binary and this script wraps it in
# a bundle by hand. `xcodebuild` would need a full Xcode install, which the
# Command Line Tools alone don't provide.
set -euo pipefail

CONFIG="${1:-release}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/build/KindleExport.app"

swift build -c "$CONFIG" --package-path "$ROOT"
BIN="$(swift build -c "$CONFIG" --package-path "$ROOT" --show-bin-path)/KindleExport"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/KindleExport"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Kindle Export</string>
  <key>CFBundleDisplayName</key><string>Kindle Export</string>
  <key>CFBundleIdentifier</key><string>com.kindle-ai-export.app</string>
  <key>CFBundleExecutable</key><string>KindleExport</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>MIT</string>
</dict>
</plist>
PLIST

# Ad-hoc signature: enough for the Keychain to scope entries to this app and
# for Gatekeeper to run it locally. Distribution would need a real identity.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || {
  echo "warning: ad-hoc codesign failed; the app may not keep Keychain entries" >&2
}

echo "built $APP"
