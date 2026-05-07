#!/usr/bin/env bash
# setra.sh — One-line installer for setra CLI
# Usage:
#   curl -fsSL https://setra.sh/install.sh | bash
#   or:
#   bash setra.sh [--version 0.1.0] [--prefix /usr/local]
#
set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
SETRA_VERSION="${SETRA_VERSION:-0.1.0}"
SETRA_REPO="https://github.com/nitikeshq/setra"
SETRA_NPM_PKG="@setra/cli"
INSTALL_PREFIX="${INSTALL_PREFIX:-$HOME/.setra}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"

# ─── Helpers ─────────────────────────────────────────────────────────────────
info()    { echo "  \033[34m•\033[0m $*"; }
success() { echo "  \033[32m✔\033[0m $*"; }
warn()    { echo "  \033[33m⚠\033[0m $*"; }
error()   { echo "  \033[31m✖\033[0m $*" >&2; exit 1; }

banner() {
  printf '\n'
  printf '  \033[1msetra\033[0m — Run AI coding agents anywhere, remember everything.\n'
  printf '  version %s\n\n' "$SETRA_VERSION"
}

# ─── Parse args ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --version) SETRA_VERSION="$2"; shift 2 ;;
    --prefix)  INSTALL_PREFIX="$2"; BIN_DIR="$2/bin"; shift 2 ;;
    --bin-dir) BIN_DIR="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: bash setra.sh [--version X.Y.Z] [--prefix DIR] [--bin-dir DIR]"
      exit 0 ;;
    *) warn "Unknown flag: $1"; shift ;;
  esac
done

# ─── Detect OS / Arch ────────────────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)  PLATFORM="darwin" ;;
  Linux)   PLATFORM="linux"  ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="win32" ;;
  *) error "Unsupported OS: $OS. Use the Windows installer (setra-setup.ps1) instead." ;;
esac

case "$ARCH" in
  x86_64|amd64)   ARCH_SLUG="x64"   ;;
  arm64|aarch64)  ARCH_SLUG="arm64" ;;
  *) warn "Unknown arch $ARCH — defaulting to x64"; ARCH_SLUG="x64" ;;
esac

banner

# ─── Check prerequisites ─────────────────────────────────────────────────────
INSTALL_METHOD="npm"

if command -v brew &>/dev/null && [[ "$PLATFORM" == "darwin" ]]; then
  INSTALL_METHOD="brew"
elif command -v npm &>/dev/null; then
  INSTALL_METHOD="npm"
elif command -v node &>/dev/null; then
  INSTALL_METHOD="npm"
else
  # Fall back to downloading a pre-built binary from GitHub Releases
  INSTALL_METHOD="binary"
fi

info "Platform: $PLATFORM/$ARCH_SLUG"
info "Install method: $INSTALL_METHOD"

# ─── Install ─────────────────────────────────────────────────────────────────
install_via_brew() {
  info "Installing setra via Homebrew..."
  if brew tap nitikeshq/setra &>/dev/null 2>&1; then
    brew install setra
  else
    # Tap not yet published — install formula directly
    brew install --formula "$SETRA_REPO/raw/main/Formula/setra.rb"
  fi
  success "Installed via Homebrew"
}

install_via_npm() {
  info "Installing setra via npm..."
  if command -v npm &>/dev/null; then
    npm install -g "$SETRA_NPM_PKG@$SETRA_VERSION" --silent
    success "Installed via npm"
  else
    error "npm not found. Please install Node.js (https://nodejs.org) first, then re-run this script."
  fi
}

install_binary() {
  TARBALL="setra-${SETRA_VERSION}-${PLATFORM}-${ARCH_SLUG}.tar.gz"
  DOWNLOAD_URL="${SETRA_REPO}/releases/download/v${SETRA_VERSION}/${TARBALL}"

  info "Downloading binary from GitHub Releases..."
  info "URL: $DOWNLOAD_URL"

  mkdir -p "$INSTALL_PREFIX/bin"
  TMP=$(mktemp -d)

  if command -v curl &>/dev/null; then
    curl -fsSL "$DOWNLOAD_URL" -o "$TMP/setra.tar.gz" || error "Download failed. Check https://github.com/nitikeshq/setra/releases for available versions."
  elif command -v wget &>/dev/null; then
    wget -q "$DOWNLOAD_URL" -O "$TMP/setra.tar.gz" || error "Download failed."
  else
    error "Neither curl nor wget found. Please install one and retry."
  fi

  tar -xzf "$TMP/setra.tar.gz" -C "$TMP"
  mkdir -p "$BIN_DIR"
  mv "$TMP/setra" "$BIN_DIR/setra"
  chmod +x "$BIN_DIR/setra"
  rm -rf "$TMP"

  success "Binary installed to $BIN_DIR/setra"
}

case "$INSTALL_METHOD" in
  brew)   install_via_brew  ;;
  npm)    install_via_npm   ;;
  binary) install_binary    ;;
esac

# ─── PATH setup ──────────────────────────────────────────────────────────────
add_to_path() {
  local shell_rc
  if [[ -n "${ZSH_VERSION:-}" ]] || [[ "$SHELL" == */zsh ]]; then
    shell_rc="$HOME/.zshrc"
  elif [[ -n "${BASH_VERSION:-}" ]] || [[ "$SHELL" == */bash ]]; then
    shell_rc="$HOME/.bashrc"
    [[ -f "$HOME/.bash_profile" ]] && shell_rc="$HOME/.bash_profile"
  else
    shell_rc="$HOME/.profile"
  fi

  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo "" >> "$shell_rc"
    echo "# setra CLI" >> "$shell_rc"
    echo "export PATH=\"\$PATH:$BIN_DIR\"" >> "$shell_rc"
    warn "Added $BIN_DIR to PATH in $shell_rc"
    warn "Restart your shell or run: source $shell_rc"
  fi
}

if [[ "$INSTALL_METHOD" == "binary" ]]; then
  add_to_path
fi

# ─── Verify ──────────────────────────────────────────────────────────────────
printf '\n'
if command -v setra &>/dev/null; then
  INSTALLED_VERSION="$(setra --version 2>/dev/null || echo 'unknown')"
  success "setra $INSTALLED_VERSION is ready!"
else
  warn "setra not found in PATH yet. Restart your terminal and run: setra --help"
fi

printf '\n'
echo "  Quick start:"
echo "    setra tui           — launch interactive TUI"
echo "    setra run           — run an AI agent on current repo"
echo "    setra --help        — show all commands"
printf '\n'
echo "  Docs: https://setra.sh/docs"
echo "  GitHub: https://github.com/nitikeshq/setra"
printf '\n'
