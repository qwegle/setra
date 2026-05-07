#!/usr/bin/env bash
# scripts/rebuild-native.sh — Rebuild native Node.js modules after pnpm install.
# Called by the root postinstall hook.
# Rebuilds for Node.js (for tests). A separate electron:rebuild handles Electron ABI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PNPM_STORE="$ROOT/node_modules/.pnpm"

rebuild_module() {
  local name="$1"
  local dir
  dir="$(find "$PNPM_STORE" -maxdepth 1 -type d -name "${name}*" 2>/dev/null | head -1)"
  if [[ -z "$dir" ]]; then
    echo "[rebuild-native] $name not found in .pnpm — skipping"
    return 0
  fi
  local pkg_dir="$dir/node_modules/$name"
  if [[ -f "$pkg_dir/binding.gyp" ]]; then
    echo "[rebuild-native] Rebuilding $name for Node.js (ABI $(node -e 'process.stdout.write(process.versions.modules)'))"
    (cd "$pkg_dir" && npx node-gyp rebuild --silent 2>/dev/null) && \
      echo "[rebuild-native] ✔ $name rebuilt for Node.js" || \
      echo "[rebuild-native] ⚠ $name rebuild failed (non-fatal)"
    # Save a Node.js copy so electron:rebuild doesn't permanently overwrite it
    local build_dir="$pkg_dir/build/Release"
    if [[ -f "$build_dir/${name//-/_}.node" ]]; then
      cp "$build_dir/${name//-/_}.node" "$build_dir/${name//-/_}.node.nodejs"
      echo "[rebuild-native] ✔ saved Node.js copy as ${name//-/_}.node.nodejs"
    fi
  fi
}

rebuild_module "better-sqlite3"
rebuild_module "node-pty"
