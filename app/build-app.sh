#!/usr/bin/env bash
#
# Assemble KindleExport.app.
#
# Xcode isn't required: SwiftPM builds the binary and this script wraps it in
# a bundle by hand. `xcodebuild` would need a full Xcode install, which the
# Command Line Tools alone don't provide.
#
# The Node pipeline ships inside the bundle at Contents/Resources/repo:
#   debug   -> a symlink to the working checkout, so edits are live
#   release -> a real copy, so the app stands alone
set -euo pipefail

CONFIG="${1:-release}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
APP="$ROOT/build/KindleExport.app"
RESOURCES="$APP/Contents/Resources"

swift build -c "$CONFIG" --package-path "$ROOT"
BIN="$(swift build -c "$CONFIG" --package-path "$ROOT" --show-bin-path)/KindleExport"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RESOURCES"
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

if [ "$CONFIG" = "debug" ]; then
  # Live edits: the app runs the checkout you are working in.
  ln -s "$REPO" "$RESOURCES/repo"
  echo "linked $RESOURCES/repo -> $REPO"
else
  # `app` is excluded to avoid copying the bundle into itself, `out` because
  # it holds book working sets, and `.git` because history isn't runtime.
  echo "copying pipeline into the bundle (this takes a minute)..."
  rsync -a \
    --exclude '.git' \
    --exclude 'out' \
    --exclude 'app' \
    --exclude '.eslintcache' \
    --exclude '.env' \
    "$REPO/" "$RESOURCES/repo/"
  echo "copied $(du -sh "$RESOURCES/repo" | cut -f1) into the bundle"
fi

# Ad-hoc signature: enough for the Keychain to scope entries to this app and
# for Gatekeeper to run it locally. Distribution would need a real identity.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || {
  echo "warning: ad-hoc codesign failed; the app may not keep Keychain entries" >&2
}

echo "built $APP"
