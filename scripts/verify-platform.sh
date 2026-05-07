#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== setra verification =="
MODE="${1:-stable}"

echo "Mode: $MODE"
echo "1) build stable packages"
pnpm --filter @setra/skills build
pnpm --filter @setra/company build

echo "2) test skills/company"
pnpm --filter @setra/skills test
pnpm --filter @setra/company test

echo "3) verify release + ops files"
test -f .github/workflows/ci.yml
test -f .github/workflows/release-cli.yml
test -f .github/workflows/desktop-release.yml
test -f .github/workflows/soak.yml
test -f Formula/setra.rb
test -f scripts/slo/migration-rollback-smoke.ts
test -f scripts/slo/restart-recovery-smoke.ts
test -f scripts/slo/soak.ts

if [[ "$MODE" == "full" ]]; then
  echo "4) run production SLO smoke checks"
  pnpm exec tsx scripts/slo/migration-rollback-smoke.ts
  pnpm exec tsx scripts/slo/restart-recovery-smoke.ts
fi

echo "Verification complete."
