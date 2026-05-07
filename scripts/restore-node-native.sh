#!/usr/bin/env bash
# scripts/restore-node-native.sh — Restore Node.js native builds before running tests.
# Use after electron:rebuild to put the Node.js-compiled .node files back.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PNPM_STORE="$ROOT/node_modules/.pnpm"

restore_module() {
  local name="$1"
  local dir
  dir="$(find "$PNPM_STORE" -maxdepth 1 -type d -name "${name}*" 2>/dev/null | head -1)"
  if [[ -z "$dir" ]]; then return 0; fi
  local build_dir="$dir/node_modules/$name/build/Release"
  local node_copy="$build_dir/${name//-/_}.node.nodejs"
  if [[ -f "$node_copy" ]]; then
    cp "$node_copy" "$build_dir/${name//-/_}.node"
    echo "[restore-native] ✔ $name restored to Node.js build"
  else
    echo "[restore-native] ⚠ No saved Node.js copy for $name — rebuilding"
    local pkg_dir="$dir/node_modules/$name"
    (cd "$pkg_dir" && npx node-gyp rebuild --silent 2>/dev/null) && \
      echo "[restore-native] ✔ $name rebuilt for Node.js" || \
      echo "[restore-native] ⚠ $name rebuild failed"
  fi
}

restore_module "better-sqlite3"
restore_module "node-pty"
