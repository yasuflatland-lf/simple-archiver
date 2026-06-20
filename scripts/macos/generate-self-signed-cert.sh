#!/usr/bin/env bash
# Generate a self-signed CODE-SIGNING certificate for macOS CI signing.
# One-off helper for repo admins. Outputs cert.pem, key.pem, cert.p12, and the
# base64 string to paste into the APPLE_CERTIFICATE GitHub Secret.
#
# The CN MUST start with an Apple prefix ("Developer ID Application: ") and the
# cert MUST carry an OU, because Tauri's signing-identity discovery only matches
# those prefixes and uses the OU as the Team id. This is a technical requirement
# of Tauri's self-signed code path; it does not assert any Apple relationship
# (the cert is self-signed and never notarized).
#
# Usage:
#   P12_PASSWORD='choose-a-password' ./scripts/macos/generate-self-signed-cert.sh
# Optional env:
#   CERT_CN   signing identity Common Name (default: "Developer ID Application: Simple Archiver")
#   CERT_OU   organizational unit / team    (default: "SELFSIGN")
#   CERT_O    organization                  (default: "Simple Archiver")
#   OUT_DIR   output directory              (default: ./cert-out)
set -euo pipefail

CN="${CERT_CN:-Developer ID Application: Simple Archiver}"
OU="${CERT_OU:-SELFSIGN}"
O="${CERT_O:-Simple Archiver}"
P12_PASSWORD="${P12_PASSWORD:?set P12_PASSWORD to the .p12 export password}"
OUT_DIR="${OUT_DIR:-./cert-out}"

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

# Code Signing EKU + digitalSignature + an OU are all mandatory for Tauri to
# discover and codesign to accept the cert.
cat > codesign.ext <<EOF
[req]
distinguished_name = dn
x509_extensions = codesign
prompt = no

[dn]
CN = ${CN}
OU = ${OU}
O = ${O}

[codesign]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
EOF

# Prefer Homebrew OpenSSL 3 (its .p12 needs -legacy to be importable by macOS
# `security`); fall back to system openssl/LibreSSL (which rejects -legacy).
OPENSSL="$(command -v /opt/homebrew/bin/openssl || command -v openssl)"
echo "Using OpenSSL: $OPENSSL ($("$OPENSSL" version))"

"$OPENSSL" req -x509 -newkey rsa:2048 -nodes \
  -keyout key.pem -out cert.pem -days 3650 \
  -config codesign.ext

# OpenSSL 3.x requires -legacy for a macOS-importable .p12; LibreSSL must omit it.
LEGACY=""
if "$OPENSSL" version | grep -qiE '^OpenSSL 3'; then
  LEGACY="-legacy"
fi

# shellcheck disable=SC2086  # $LEGACY is intentionally word-split (empty or -legacy).
"$OPENSSL" pkcs12 -export $LEGACY \
  -inkey key.pem -in cert.pem \
  -name "$CN" \
  -out cert.p12 -passout pass:"$P12_PASSWORD"

base64 -i cert.p12 | tr -d '\n' > cert.p12.base64

echo "---"
echo "Generated: $OUT_DIR/cert.p12"
echo "Signing identity (CN): $CN"
echo "APPLE_CERTIFICATE secret   = contents of $OUT_DIR/cert.p12.base64"
echo "APPLE_CERTIFICATE_PASSWORD = the P12_PASSWORD you chose"
echo "KEYCHAIN_PASSWORD          = choose any random string for the CI keychain"
