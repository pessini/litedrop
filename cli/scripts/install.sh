#!/usr/bin/env sh
# litedrop CLI installer — downloads a prebuilt standalone binary (no Node
# required) from GitHub Releases and drops it on your PATH.
#
#   curl -fsSL https://raw.githubusercontent.com/OWNER/litedrop/main/core/cli/scripts/install.sh | sh
#
# Env overrides:
#   LITEDROP_REPO     GitHub owner/repo            (default: OWNER/litedrop)
#   LITEDROP_VERSION  release tag, e.g. cli-v0.1.0 (default: latest)
#   LITEDROP_BIN_DIR  install directory            (default: ~/.local/bin)
set -eu

REPO="${LITEDROP_REPO:-OWNER/litedrop}"
VERSION="${LITEDROP_VERSION:-latest}"
BIN_DIR="${LITEDROP_BIN_DIR:-$HOME/.local/bin}"

err() { echo "litedrop-install: $*" >&2; exit 1; }

# SHA-256 of a file, whichever tool this system has (sha256sum is absent on
# stock macOS, which ships shasum).
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 -r "$1" | awk '{print $1}'
  else
    return 1
  fi
}

# Pick a downloader.
if command -v curl >/dev/null 2>&1; then
  dl() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  dl() { wget -qO "$2" "$1"; }
else
  err "need curl or wget"
fi

# Detect platform -> release asset name (must match scripts/build-binaries.sh).
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux)  os_tag="linux" ;;
  Darwin) os_tag="darwin" ;;
  MINGW*|MSYS*|CYGWIN*) err "on Windows download litedrop-windows-x64.exe from the Releases page" ;;
  *) err "unsupported OS: $os" ;;
esac
case "$arch" in
  x86_64|amd64) arch_tag="x64" ;;
  arm64|aarch64) arch_tag="arm64" ;;
  *) err "unsupported architecture: $arch" ;;
esac
asset="litedrop-${os_tag}-${arch_tag}"

# Resolve the download URL.
if [ "$VERSION" = "latest" ]; then
  base="https://github.com/${REPO}/releases/latest/download"
else
  base="https://github.com/${REPO}/releases/download/${VERSION}"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "litedrop-install: downloading ${asset} (${VERSION}) from ${REPO}..."
dl "${base}/${asset}" "${tmp}/litedrop" || err "download failed: ${base}/${asset}"

# Verify the checksum against the release's SHA256SUMS. A mismatch aborts;
# when verification can't run at all, say so loudly instead of staying silent.
verified=0
if dl "${base}/SHA256SUMS" "${tmp}/SHA256SUMS" 2>/dev/null; then
  if actual="$(sha256_of "${tmp}/litedrop")"; then
    expected="$(grep " ${asset}\$" "${tmp}/SHA256SUMS" | awk '{print $1}')"
    [ -n "$expected" ] || err "no entry for ${asset} in SHA256SUMS"
    [ "$expected" = "$actual" ] || err "checksum mismatch for ${asset}"
    echo "litedrop-install: checksum OK"
    verified=1
  fi
fi
if [ "$verified" -ne 1 ]; then
  echo "litedrop-install: WARNING: checksum NOT verified (SHA256SUMS unavailable or no sha256 tool found)" >&2
fi

mkdir -p "$BIN_DIR"
chmod +x "${tmp}/litedrop"
mv "${tmp}/litedrop" "${BIN_DIR}/litedrop"
echo "litedrop-install: installed to ${BIN_DIR}/litedrop"

# Nudge if the install dir isn't on PATH.
case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *) echo "litedrop-install: add ${BIN_DIR} to your PATH:"
     echo "  export PATH=\"${BIN_DIR}:\$PATH\"" ;;
esac

"${BIN_DIR}/litedrop" --version >/dev/null 2>&1 \
  && echo "litedrop-install: done — run 'litedrop --help'" \
  || echo "litedrop-install: installed, but the binary failed to run"
