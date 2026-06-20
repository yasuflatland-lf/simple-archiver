#!/usr/bin/env bash
# Verify macOS bundle code signatures. Signing itself is done by Tauri at build
# time; this script only verifies. Critically, it mounts the .dmg and verifies
# the .app INSIDE it — the artifact users actually run — not just the external
# .app and the dmg wrapper. Uses codesign only (never spctl: a self-signed
# cert always fails Gatekeeper assessment).
#
# Args: <app-path> [dmg-path]
set -euo pipefail

app="${1:?usage: verify-macos-bundles.sh <app-path> [dmg-path]}"
dmg="${2:-}"

echo "Verifying standalone .app: $app"
codesign --verify --deep --strict --verbose=2 "$app"
codesign -dvv "$app" 2>&1 | grep -E 'Authority|Identifier=' || true

if [ -n "$dmg" ]; then
  echo "Verifying .dmg wrapper: $dmg"
  codesign --verify --verbose=2 "$dmg" || echo "note: .dmg wrapper signature not present (continuing)"

  echo "Mounting .dmg to verify the embedded .app (the shipped artifact)"
  mount_point="$(mktemp -d)"
  detach() { hdiutil detach "$mount_point" >/dev/null 2>&1 || true; rmdir "$mount_point" 2>/dev/null || true; }
  trap detach EXIT
  hdiutil attach -nobrowse -readonly -mountpoint "$mount_point" "$dmg" >/dev/null

  inner_app="$(find "$mount_point" -maxdepth 1 -name '*.app' -type d | head -n1 || true)"
  if [ -z "$inner_app" ]; then
    echo "::error::No .app found inside the mounted .dmg"
    exit 1
  fi
  echo "Verifying embedded .app: $inner_app"
  codesign --verify --deep --strict --verbose=2 "$inner_app"
  codesign -dvv "$inner_app" 2>&1 | grep -E 'Authority' || true
fi

echo "macOS signature verification complete."
