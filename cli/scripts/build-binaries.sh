#!/usr/bin/env bash
# Cross-compile the litedrop CLI into standalone executables that embed the Bun
# runtime, so end users need nothing installed (no Node, no Bun).
#
# Bun cross-compiles every target from one machine, so CI runs this on a single
# Linux runner. Pass target triples as args to build a subset, e.g.
#   ./scripts/build-binaries.sh bun-darwin-arm64
# With no args it builds the full release matrix.
set -euo pipefail

cd "$(dirname "$0")/.."

# Map Bun target triple -> output binary name (Windows gets .exe).
declare -A TARGETS=(
  [bun-linux-x64]=litedrop-linux-x64
  [bun-linux-arm64]=litedrop-linux-arm64
  [bun-darwin-x64]=litedrop-darwin-x64
  [bun-darwin-arm64]=litedrop-darwin-arm64
  [bun-windows-x64]=litedrop-windows-x64.exe
)

# Inline the version constant before compiling (single source of truth).
node scripts/gen-version.mjs

requested=("$@")
if [ ${#requested[@]} -eq 0 ]; then
  requested=("${!TARGETS[@]}")
fi

mkdir -p binaries
for triple in "${requested[@]}"; do
  out="${TARGETS[$triple]:-}"
  if [ -z "$out" ]; then
    echo "unknown target: $triple" >&2
    exit 1
  fi
  echo "==> building $triple -> binaries/$out"
  # undici stays external: it is the Node-only proxy fallback and never loads
  # under Bun, whose fetch honors the proxy env vars natively. No sourcemap —
  # it would be embedded into the binary and only inflate it.
  bun build src/main.ts \
    --compile \
    --minify \
    --external undici \
    --target="$triple" \
    --outfile "binaries/$out"
done

echo "==> done. artifacts in binaries/:"
ls -lh binaries/
