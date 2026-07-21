#!/usr/bin/env bash
# Generate a self-signed development certificate.
#
# These files are for LOCAL DEVELOPMENT ONLY and are intentionally NOT bundled
# into the production build (see requirements F-05-3). For production, supply a
# real certificate via KEY_PATH/CERT_PATH or terminate TLS at a reverse proxy.
set -euo pipefail

OUT_DIR="${1:-./certs}"
mkdir -p "$OUT_DIR"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$OUT_DIR/dev.key" \
  -out "$OUT_DIR/dev.cert" \
  -days 365 \
  -subj "/CN=localhost"

KEY_ABS="$(cd "$OUT_DIR" && pwd)/dev.key"
CERT_ABS="$(cd "$OUT_DIR" && pwd)/dev.cert"

echo "Generated:"
echo "  KEY_PATH=$KEY_ABS"
echo "  CERT_PATH=$CERT_ABS"
echo
echo "Run the server from the dist directory (static assets are resolved relative to the cwd):"
echo "  cd dist && KEY_PATH=$KEY_ABS CERT_PATH=$CERT_ABS node server.bundle.js"
