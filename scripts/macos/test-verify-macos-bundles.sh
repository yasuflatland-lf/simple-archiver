#!/usr/bin/env bash
# Local test for verify-macos-bundles.sh. Signs a minimal .app with a throwaway
# self-signed cert, builds a .dmg around it, and asserts the verifier passes;
# then asserts it FAILS for a .dmg whose embedded .app is unsigned.
# Run on macOS: ./scripts/macos/test-verify-macos-bundles.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
KC="$WORK/test.keychain-db"
ORIG="$(security list-keychains -d user | sed 's/"//g')"
cleanup() {
  # shellcheck disable=SC2086
  security list-keychains -d user -s $ORIG >/dev/null 2>&1 || true
  security delete-keychain "$KC" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

CN="Developer ID Application: Test Identity"
P12_PASSWORD="test-p12-pass"

# 1. Generate a throwaway cert via the admin generator (prefixed CN + OU).
P12_PASSWORD="$P12_PASSWORD" CERT_CN="$CN" CERT_OU="TESTOU" CERT_O="Test" \
  OUT_DIR="$WORK/cert-out" "$HERE/generate-self-signed-cert.sh" >/dev/null

# 2. Import into a temp keychain and add to the user search list (so codesign
#    can resolve the identity by name without trust).
security create-keychain -p kcpass "$KC" >/dev/null
security set-keychain-settings "$KC" >/dev/null
security unlock-keychain -p kcpass "$KC" >/dev/null
security import "$WORK/cert-out/cert.p12" -k "$KC" -P "$P12_PASSWORD" -T /usr/bin/codesign >/dev/null 2>&1
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k kcpass "$KC" >/dev/null 2>&1
# shellcheck disable=SC2086
security list-keychains -d user -s "$KC" $ORIG >/dev/null

mk_app() { # $1 = .app path
  mkdir -p "$1/Contents/MacOS"
  cp /bin/echo "$1/Contents/MacOS/Sample"
  printf '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Sample</string><key>CFBundleIdentifier</key><string>com.simplearchiver.test</string></dict></plist>' > "$1/Contents/Info.plist"
}

# 3. POSITIVE: signed .app inside a .dmg -> verifier must pass.
SDIR="$WORK/signed"; mkdir -p "$SDIR"; mk_app "$SDIR/Sample.app"
codesign --force --deep --timestamp=none --keychain "$KC" --sign "$CN" "$SDIR/Sample.app" >/dev/null 2>&1
hdiutil create -volname Sample -srcfolder "$SDIR" -ov -format UDZO "$WORK/signed.dmg" >/dev/null
"$HERE/verify-macos-bundles.sh" "$SDIR/Sample.app" "$WORK/signed.dmg"
echo "PASS: positive (embedded .app verifies)"

# 4. NEGATIVE: unsigned .app inside a .dmg -> verifier must fail (nonzero).
UDIR="$WORK/unsigned"; mkdir -p "$UDIR"; mk_app "$UDIR/Sample.app"
hdiutil create -volname SampleU -srcfolder "$UDIR" -ov -format UDZO "$WORK/unsigned.dmg" >/dev/null
if "$HERE/verify-macos-bundles.sh" "$SDIR/Sample.app" "$WORK/unsigned.dmg" >/dev/null 2>&1; then
  echo "FAIL: verifier passed an unsigned embedded .app"; exit 1
fi
echo "PASS: negative (unsigned embedded .app rejected)"

echo "ALL TESTS PASSED"
