#!/usr/bin/env bash
# check-native-deps.sh — verify that native addons can be built / loaded.
#
# Run before every release to catch node-abi / rebuild issues early.
# Exit code 0  = all good.
# Exit code 1  = one or more checks failed.
#
# Usage:
#   bash scripts/check-native-deps.sh
#
# Options (env vars):
#   SKIP_REBUILD=1  — skip electron-rebuild, just try require()
#   VERBOSE=1       — print full build output

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
RESET='\033[0m'

PASS=0
FAIL=0
SKIP=0

ok()   { echo -e "  ${GREEN}✔${RESET}  $*"; (( PASS++ )) || true; }
fail() { echo -e "  ${RED}✘${RESET}  $*"; (( FAIL++ )) || true; }
skip() { echo -e "  ${YELLOW}–${RESET}  $*"; (( SKIP++ )) || true; }
sep()  { echo -e "\n${BOLD}$*${RESET}"; }

# ── Detect electron version from desktop package.json ─────────────────────────
DESKTOP_PKG="apps/desktop/package.json"
if [[ -f "$DESKTOP_PKG" ]]; then
  ELECTRON_VERSION=$(node -p "require('./$DESKTOP_PKG').devDependencies?.electron?.replace(/[^0-9.]/g,'')" 2>/dev/null || echo "")
else
  ELECTRON_VERSION=""
fi

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  setra native dependency check${RESET}"
echo -e "  Node   : $(node --version)"
echo -e "  Arch   : $(uname -m)"
echo -e "  OS     : $(uname -s)"
[[ -n "$ELECTRON_VERSION" ]] && echo -e "  Electron: v$ELECTRON_VERSION"
echo -e "${BOLD}══════════════════════════════════════════════════${RESET}"
echo ""

# ── Helper: check if a package exists in node_modules ────────────────────────
pkg_exists() {
  [[ -d "node_modules/$1" ]] || \
  [[ -d "apps/desktop/node_modules/$1" ]] || \
  node -e "require.resolve('$1')" >/dev/null 2>&1
}

# ── Helper: run electron-rebuild for a package ────────────────────────────────
rebuild_for_electron() {
  local pkg="$1"
  if [[ "${SKIP_REBUILD:-0}" == "1" ]]; then
    skip "electron-rebuild skipped (SKIP_REBUILD=1) for $pkg"
    return
  fi

  if ! command -v electron-rebuild >/dev/null 2>&1; then
    # Try local install
    EREBUILD="./node_modules/.bin/electron-rebuild"
    [[ -x "$EREBUILD" ]] || EREBUILD="./apps/desktop/node_modules/.bin/electron-rebuild"
    [[ -x "$EREBUILD" ]] || { skip "electron-rebuild not found — install with pnpm add -D electron-rebuild"; return; }
  else
    EREBUILD="electron-rebuild"
  fi

  local build_flag="--module-dir node_modules/$pkg"
  [[ -d "apps/desktop/node_modules/$pkg" ]] && build_flag="--module-dir apps/desktop/node_modules/$pkg"

  local out
  if [[ "${VERBOSE:-0}" == "1" ]]; then
    $EREBUILD $build_flag && ok "electron-rebuild OK: $pkg" || fail "electron-rebuild FAILED: $pkg"
  else
    out=$($EREBUILD $build_flag 2>&1) && ok "electron-rebuild OK: $pkg" || {
      fail "electron-rebuild FAILED: $pkg"
      echo "    $out" | head -20
    }
  fi
}

# ── Helper: try to require() a package ───────────────────────────────────────
try_require() {
  local pkg="$1"
  local desc="${2:-$1}"
  node -e "require('$pkg'); process.exit(0)" 2>/dev/null \
    && ok "require('$pkg') works" \
    || fail "require('$pkg') failed — $desc"
}

# ─────────────────────────────────────────────────────────────────────────────
sep "1. node-pty"
if pkg_exists "node-pty"; then
  rebuild_for_electron "node-pty"
  try_require "node-pty" "terminal emulation — PTY spawn will fail at runtime"
else
  skip "node-pty not installed (optional for headless CLI)"
fi

# ─────────────────────────────────────────────────────────────────────────────
sep "2. better-sqlite3"
if pkg_exists "better-sqlite3"; then
  rebuild_for_electron "better-sqlite3"
  # Smoke test: open an in-memory DB
  node - <<'JS' && ok "better-sqlite3 in-memory DB works" || fail "better-sqlite3 smoke test failed"
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.prepare('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)').run();
db.prepare('INSERT INTO t VALUES (?, ?)').run(1, 'hello');
const row = db.prepare('SELECT * FROM t WHERE id = 1').get();
if (row.val !== 'hello') throw new Error('unexpected value: ' + row.val);
db.close();
JS
else
  skip "better-sqlite3 not installed"
fi

# ─────────────────────────────────────────────────────────────────────────────
sep "3. @xenova/transformers (WASM)"
if pkg_exists "@xenova/transformers"; then
  # The WASM binary should be bundled — verify the .wasm file exists
  WASM_PATHS=(
    "node_modules/@xenova/transformers/dist"
    "apps/desktop/node_modules/@xenova/transformers/dist"
  )
  WASM_FOUND=0
  for d in "${WASM_PATHS[@]}"; do
    if [[ -d "$d" ]]; then
      wasm_count=$(find "$d" -name "*.wasm" 2>/dev/null | wc -l)
      if (( wasm_count > 0 )); then
        ok "@xenova/transformers WASM files found: $wasm_count file(s) in $d"
        WASM_FOUND=1
        break
      fi
    fi
  done
  (( WASM_FOUND )) || fail "@xenova/transformers installed but no .wasm files found"

  # Try importing the package (no model download, just the module itself)
  node -e "
    const t = require('@xenova/transformers');
    if (!t.pipeline && !t.AutoTokenizer) throw new Error('unexpected exports');
  " 2>/dev/null \
    && ok "@xenova/transformers module loads" \
    || {
      # ES module fallback
      node --input-type=module -e "
        import('@xenova/transformers').then(t => {
          if (!t.pipeline && !t.AutoTokenizer) throw new Error('unexpected exports');
        });
      " 2>/dev/null \
        && ok "@xenova/transformers ESM module loads" \
        || fail "@xenova/transformers failed to load"
    }
else
  skip "@xenova/transformers not installed (optional embedding feature)"
fi

# ─────────────────────────────────────────────────────────────────────────────
sep "4. keytar (system keychain)"
if pkg_exists "keytar"; then
  rebuild_for_electron "keytar"
  try_require "keytar" "credential storage will be unavailable"
else
  skip "keytar not installed"
fi

# ─────────────────────────────────────────────────────────────────────────────
sep "5. fsevents (macOS file watching)"
if [[ "$(uname -s)" == "Darwin" ]]; then
  if pkg_exists "fsevents"; then
    try_require "fsevents" "file watching may fall back to polling"
  else
    skip "fsevents not installed (will use polling)"
  fi
else
  skip "fsevents — macOS only"
fi

# ─────────────────────────────────────────────────────────────────────────────
sep "6. Electron binary"
if [[ -n "$ELECTRON_VERSION" ]]; then
  ELECTRON_BIN=$(node -e "
    try { console.log(require('electron')); } catch(e) { process.exit(1); }
  " 2>/dev/null || true)

  if [[ -n "$ELECTRON_BIN" ]] && [[ -f "$ELECTRON_BIN" ]]; then
    ok "Electron binary found: $ELECTRON_BIN"
    # Verify it can at least print its version
    "$ELECTRON_BIN" --version 2>/dev/null | grep -q "^v" \
      && ok "Electron --version: $("$ELECTRON_BIN" --version 2>/dev/null)" \
      || fail "Electron binary present but --version failed"
  else
    fail "Electron binary not found — run: pnpm install"
  fi
else
  skip "Electron version not detected (apps/desktop/package.json not found)"
fi

# ─────────────────────────────────────────────────────────────────────────────
sep "7. asar unpack sanity"
for pkg in node-pty better-sqlite3 "@xenova/transformers"; do
  safe_pkg="${pkg//\//__}"
  for base in node_modules apps/desktop/node_modules; do
    if [[ -d "$base/$pkg" ]]; then
      # These must be in asarUnpack — check electron-builder config
      if grep -r "asarUnpack" apps/desktop/electron-builder.config.ts >/dev/null 2>&1; then
        grep "asarUnpack" apps/desktop/electron-builder.config.ts | grep -q "${pkg%%/*}" \
          && ok "asarUnpack configured for $pkg" \
          || fail "asarUnpack missing for $pkg — native module will fail inside asar"
      else
        skip "electron-builder.config.ts not found — cannot verify asarUnpack"
      fi
      break
    fi
  done
done

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════${RESET}"
echo -e "  Results:  ${GREEN}${PASS} passed${RESET}  ${YELLOW}${SKIP} skipped${RESET}  ${RED}${FAIL} failed${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════${RESET}"
echo ""

if (( FAIL > 0 )); then
  echo -e "${RED}One or more native dependency checks failed.${RESET}"
  echo "Fix the issues above before cutting a release."
  exit 1
fi

exit 0
