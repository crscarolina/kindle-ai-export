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
# Stamped from the release tag in CI; a local build is just "dev" so a bundle
# built by hand is never mistaken for a published one.
VERSION="${VERSION:-dev}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
APP="$ROOT/build/KindleExport.app"
RESOURCES="$APP/Contents/Resources"

swift build -c "$CONFIG" --package-path "$ROOT"
BIN="$(swift build -c "$CONFIG" --package-path "$ROOT" --show-bin-path)/KindleExport"

# The .icns is committed, so this only fires when someone edits the artwork.
if [ "$ROOT/Resources/AppIcon.png" -nt "$ROOT/Resources/AppIcon.icns" ]; then
  "$ROOT/make-icon.sh"
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RESOURCES"
cp "$BIN" "$APP/Contents/MacOS/KindleExport"
cp "$ROOT/Resources/AppIcon.icns" "$RESOURCES/AppIcon.icns"

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
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>__VERSION__</string>
  <key>CFBundleVersion</key><string>__VERSION__</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>MIT</string>
  <!-- Exports run for hours, so the app reports completion by notification. -->
  <key>NSUserNotificationAlertStyle</key><string>alert</string>
</dict>
</plist>
PLIST

# Node goes in the bundle for a release, so a downloaded app does not also
# require the user to install a matching Node.
#
# Downloaded from nodejs.org rather than copied off PATH: Homebrew's `node` is
# a 40KB stub that loads libnode and twenty other dylibs, so copying it yields
# a bundle that cannot start. The official tarball's binary is self-contained.
NODE_VERSION="${NODE_VERSION:-v24.21.0}"

embed_node() {
  local arch tarball url cache

  case "$(uname -m)" in
    arm64) arch="darwin-arm64" ;;
    x86_64) arch="darwin-x64" ;;
    *) echo "warning: unknown architecture $(uname -m); not embedding node" >&2; return ;;
  esac

  tarball="node-${NODE_VERSION}-${arch}.tar.gz"
  url="https://nodejs.org/dist/${NODE_VERSION}/${tarball}"
  cache="${TMPDIR:-/tmp}/kindle-export-node"
  mkdir -p "$cache"

  if [ ! -f "$cache/$tarball" ]; then
    echo "downloading ${NODE_VERSION} for ${arch}..."
    curl -fsSL "$url" -o "$cache/$tarball" || {
      echo "error: could not download node from $url" >&2
      return 1
    }
  fi

  mkdir -p "$RESOURCES/bin"
  tar -xzf "$cache/$tarball" -C "$cache" \
    "node-${NODE_VERSION}-${arch}/bin/node"
  cp "$cache/node-${NODE_VERSION}-${arch}/bin/node" "$RESOURCES/bin/node"
  chmod +x "$RESOURCES/bin/node"

  # A bundle whose node cannot start is worse than one with no node at all:
  # the app would prefer it over a working one on PATH.
  local reported
  reported="$("$RESOURCES/bin/node" --version 2>&1)" || {
    echo "error: embedded node does not run: $reported" >&2
    rm -f "$RESOURCES/bin/node"
    return 1
  }

  echo "embedded node $reported ($arch)"
}

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
  embed_node
fi

# The plist heredoc is quoted so nothing expands inside it; the version is
# substituted here instead.
/usr/bin/sed -i '' "s/__VERSION__/${VERSION}/g" "$APP/Contents/Info.plist"

# Ad-hoc signature: enough for the Keychain to scope entries to this app and
# for Gatekeeper to run it locally. Distribution would need a real identity.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || {
  echo "warning: ad-hoc codesign failed; the app may not keep Keychain entries" >&2
}

echo "built $APP"
