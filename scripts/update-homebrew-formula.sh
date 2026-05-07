#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <version> <asset_dir>"
  exit 1
fi

VERSION="$1"
ASSET_DIR="$2"
FORMULA_PATH="Formula/setra.rb"

DARWIN_ARM64="$(shasum -a 256 "$ASSET_DIR/setra-${VERSION}-darwin-arm64.tar.gz" | awk '{print $1}')"
DARWIN_X64="$(shasum -a 256 "$ASSET_DIR/setra-${VERSION}-darwin-x64.tar.gz" | awk '{print $1}')"
LINUX_ARM64="$(shasum -a 256 "$ASSET_DIR/setra-${VERSION}-linux-arm64.tar.gz" | awk '{print $1}')"
LINUX_X64="$(shasum -a 256 "$ASSET_DIR/setra-${VERSION}-linux-x64.tar.gz" | awk '{print $1}')"

node - <<'NODE' "$FORMULA_PATH" "$VERSION" "$DARWIN_ARM64" "$DARWIN_X64" "$LINUX_ARM64" "$LINUX_X64"
const fs = require("fs");
const [formulaPath, version, darwinArm64, darwinX64, linuxArm64, linuxX64] = process.argv.slice(2);
let s = fs.readFileSync(formulaPath, "utf8");
s = s.replace(/version\s+"[^"]+"/, `version "${version}"`);
s = s.replace(/sha256\s+"REPLACE_WITH_REAL_SHA256_DARWIN_ARM64"/, `sha256 "${darwinArm64}"`);
s = s.replace(/sha256\s+"REPLACE_WITH_REAL_SHA256_DARWIN_X64"/, `sha256 "${darwinX64}"`);
s = s.replace(/sha256\s+"REPLACE_WITH_REAL_SHA256_LINUX_ARM64"/, `sha256 "${linuxArm64}"`);
s = s.replace(/sha256\s+"REPLACE_WITH_REAL_SHA256_LINUX_X64"/, `sha256 "${linuxX64}"`);
fs.writeFileSync(formulaPath, s);
NODE

echo "Updated $FORMULA_PATH for version $VERSION"

