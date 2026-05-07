#!/usr/bin/env bash
#
# Setra CLI Installer
# Usage: curl -fsSL https://setra.sh/install.sh | bash
#
set -euo pipefail

REPO="qwegle/setra"
INSTALL_DIR="${SETRA_INSTALL_DIR:-/usr/local/bin}"
VERSION="${SETRA_VERSION:-latest}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info() { echo -e "${CYAN}▸${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1" >&2; exit 1; }

# Detect OS and architecture
detect_platform() {
    local os arch

    case "$(uname -s)" in
        Darwin)  os="darwin" ;;
        Linux)   os="linux" ;;
        MINGW*|MSYS*|CYGWIN*) os="windows" ;;
        *) error "Unsupported OS: $(uname -s)" ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64) arch="amd64" ;;
        arm64|aarch64) arch="arm64" ;;
        *) error "Unsupported architecture: $(uname -m)" ;;
    esac

    echo "${os}-${arch}"
}

# Get latest release version
get_latest_version() {
    local url="https://api.github.com/repos/${REPO}/releases/latest"
    curl -fsSL "$url" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"v?([^"]+)".*/\1/' || echo ""
}

main() {
    echo ""
    echo -e "${BOLD}⚡ Setra CLI Installer${NC}"
    echo ""

    local platform
    platform=$(detect_platform)
    info "Detected platform: ${platform}"

    # Resolve version
    if [ "$VERSION" = "latest" ]; then
        info "Fetching latest release..."
        VERSION=$(get_latest_version)
        if [ -z "$VERSION" ]; then
            error "Could not determine latest version. Set SETRA_VERSION manually."
        fi
    fi
    info "Version: ${VERSION}"

    # Download binary
    local ext=""
    if [[ "$platform" == windows-* ]]; then
        ext=".exe"
    fi

    local binary_name="setra-${platform}${ext}"
    local download_url="https://github.com/${REPO}/releases/download/v${VERSION}/${binary_name}"
    local checksum_url="https://github.com/${REPO}/releases/download/v${VERSION}/checksums.txt"

    info "Downloading ${binary_name}..."
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap 'rm -rf "$tmp_dir"' EXIT

    if ! curl -fsSL -o "${tmp_dir}/setra${ext}" "$download_url"; then
        error "Download failed. Check version ${VERSION} exists at ${download_url}"
    fi

    # Verify checksum
    info "Verifying checksum..."
    if curl -fsSL -o "${tmp_dir}/checksums.txt" "$checksum_url" 2>/dev/null; then
        local expected_hash
        expected_hash=$(grep "${binary_name}" "${tmp_dir}/checksums.txt" | awk '{print $1}')
        if [ -n "$expected_hash" ]; then
            local actual_hash
            if command -v sha256sum &>/dev/null; then
                actual_hash=$(sha256sum "${tmp_dir}/setra${ext}" | awk '{print $1}')
            elif command -v shasum &>/dev/null; then
                actual_hash=$(shasum -a 256 "${tmp_dir}/setra${ext}" | awk '{print $1}')
            fi
            if [ -n "$actual_hash" ] && [ "$expected_hash" != "$actual_hash" ]; then
                error "Checksum mismatch! Expected: ${expected_hash}, Got: ${actual_hash}"
            fi
            success "Checksum verified"
        fi
    fi

    # Install
    info "Installing to ${INSTALL_DIR}/setra..."
    chmod +x "${tmp_dir}/setra${ext}"

    if [ -w "$INSTALL_DIR" ]; then
        mv "${tmp_dir}/setra${ext}" "${INSTALL_DIR}/setra${ext}"
    else
        sudo mv "${tmp_dir}/setra${ext}" "${INSTALL_DIR}/setra${ext}"
    fi

    success "Setra ${VERSION} installed successfully!"
    echo ""
    echo -e "  ${BOLD}Get started:${NC}"
    echo "    setra init        — Initialize in your project"
    echo "    setra start       — Launch the platform"
    echo "    setra status      — Check health"
    echo "    setra --help      — See all commands"
    echo ""
    echo -e "  ${CYAN}Documentation:${NC} https://github.com/${REPO}"
    echo ""
}

main "$@"
