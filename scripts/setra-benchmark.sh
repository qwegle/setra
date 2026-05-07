#!/usr/bin/env bash
# setra-benchmark.sh — measures token cost and cache efficiency across three modes.
#
# Outputs:
#   benchmark-results/results.json     — machine-readable
#   benchmark-results/summary.txt      — human-readable (the one that goes on HN)
#
# Usage:
#   ANTHROPIC_API_KEY=sk-... BENCH_RUNS=3 bash scripts/setra-benchmark.sh
#
# Required env:
#   ANTHROPIC_API_KEY  — used by setra CLI for Claude models
#   OPENAI_API_KEY     — optional, skip OpenAI variants if absent
#
# Optional env:
#   BENCH_RUNS         — number of repetitions per variant (default: 3)
#   SETRA_BIN          — path to setra CLI binary (default: ./apps/cli/dist/index.js)
#   BENCH_TASK         — task prompt to run (default: built-in refactor task)
#   BENCH_REPO_URL     — git repo to clone as test subject (default: built-in tiny app)
#   KEEP_WORK_DIR      — set to 1 to preserve the work directory after the run

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
RUNS="${BENCH_RUNS:-3}"
SETRA_BIN="${SETRA_BIN:-node $(pwd)/apps/cli/dist/index.js}"
RESULTS_DIR="$(pwd)/benchmark-results"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
WORK_BASE="$(pwd)/bench-work-$$"

BENCH_TASK="${BENCH_TASK:-Add input validation to every public function in src/. Use zod. Write tests for each validator. Do not change existing logic.}"

BENCH_REPO_URL="${BENCH_REPO_URL:-}"  # leave empty to generate a synthetic repo

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

log()  { echo -e "${BLUE}[bench]${RESET} $*"; }
ok()   { echo -e "${GREEN}[ok]${RESET}    $*"; }
warn() { echo -e "${YELLOW}[warn]${RESET}  $*"; }
die()  { echo -e "${RED}[fatal]${RESET} $*" >&2; exit 1; }

# ── Deps check ────────────────────────────────────────────────────────────────
command -v node  >/dev/null 2>&1 || die "node not found"
command -v git   >/dev/null 2>&1 || die "git not found"
command -v jq    >/dev/null 2>&1 || { warn "jq not found — JSON output may be unformatted"; JQ_MISSING=1; }

[[ -n "${ANTHROPIC_API_KEY:-}" ]] || die "ANTHROPIC_API_KEY not set"

mkdir -p "$RESULTS_DIR"

# ── Create synthetic test repo ────────────────────────────────────────────────
create_test_repo() {
  local dest="$1"
  mkdir -p "$dest/src" "$dest/src/__tests__"

  # package.json
  cat > "$dest/package.json" <<'JSON'
{
  "name": "setra-bench-subject",
  "version": "1.0.0",
  "type": "module",
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "^1.0.0", "zod": "^3.22.0" }
}
JSON

  # Simple functions to refactor — enough surface area to stress the model
  cat > "$dest/src/users.ts" <<'TS'
export function createUser(name: any, email: any, age: any) {
  return { id: Math.random().toString(36).slice(2), name, email, age, createdAt: new Date() };
}

export function updateUser(user: any, patch: any) {
  if (!user || !user.id) throw new Error("Invalid user");
  return { ...user, ...patch, updatedAt: new Date() };
}

export function deleteUser(users: any[], id: any) {
  return users.filter(u => u.id !== id);
}
TS

  cat > "$dest/src/posts.ts" <<'TS'
export function createPost(title: any, body: any, authorId: any, tags: any) {
  if (!title) throw new Error("title required");
  return { id: Math.random().toString(36).slice(2), title, body, authorId, tags, createdAt: new Date() };
}

export function publishPost(post: any) {
  return { ...post, publishedAt: new Date(), status: "published" };
}

export function searchPosts(posts: any[], query: any) {
  return posts.filter(p => p.title?.includes(query) || p.body?.includes(query));
}
TS

  cat > "$dest/src/billing.ts" <<'TS'
export function createInvoice(userId: any, items: any[], currency: any) {
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  return { id: Math.random().toString(36).slice(2), userId, items, currency, total };
}

export function applyDiscount(invoice: any, pct: any) {
  if (pct < 0 || pct > 100) throw new Error("bad discount");
  return { ...invoice, total: invoice.total * (1 - pct / 100), discountPct: pct };
}

export function refundInvoice(invoice: any, reason: any) {
  return { ...invoice, status: "refunded", refundedAt: new Date(), refundReason: reason };
}
TS

  (cd "$dest" && git init -q && git add . && git commit -qm "initial")
  ok "Synthetic test repo created at $dest"
}

# ── Run a single setra task and capture metrics ────────────────────────────────
# Args: $1=label $2=work_dir $3=extra_flags
run_variant() {
  local label="$1"
  local work_dir="$2"
  local extra_flags="${3:-}"
  local out_file="$RESULTS_DIR/${label}.json"
  local start end elapsed

  log "Running variant: ${BOLD}${label}${RESET}"

  start=$(date +%s%3N)

  # setra CLI expected to emit a JSON metrics line to stderr:
  # {"tokens_in":N,"tokens_out":N,"tokens_cached":N,"cost_usd":N,"model":"..."}
  METRICS_RAW=$(
    ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
    $SETRA_BIN run \
      --task "$BENCH_TASK" \
      --cwd "$work_dir" \
      --json-metrics \
      $extra_flags \
      2>&1 | tee /dev/stderr | grep '^{"tokens' | tail -1
  ) || true

  end=$(date +%s%3N)
  elapsed=$(( (end - start) / 1000 ))

  if [[ -z "$METRICS_RAW" ]]; then
    warn "No metrics line captured for $label — using zeros"
    METRICS_RAW='{"tokens_in":0,"tokens_out":0,"tokens_cached":0,"cost_usd":0,"model":"unknown"}'
  fi

  local tokens_in tokens_out tokens_cached cost_usd model cache_hit_rate
  tokens_in=$(echo "$METRICS_RAW"    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tokens_in',0))")
  tokens_out=$(echo "$METRICS_RAW"   | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tokens_out',0))")
  tokens_cached=$(echo "$METRICS_RAW"| python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tokens_cached',0))")
  cost_usd=$(echo "$METRICS_RAW"     | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cost_usd',0))")
  model=$(echo "$METRICS_RAW"        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('model','unknown'))")

  total_tokens=$(( tokens_in + tokens_out ))
  if (( total_tokens > 0 )); then
    cache_hit_rate=$(python3 -c "print(round($tokens_cached / ($tokens_in + $tokens_out) * 100, 2))")
  else
    cache_hit_rate=0
  fi

  cat > "$out_file" <<JSON
{
  "label": "$label",
  "model": "$model",
  "tokens_in": $tokens_in,
  "tokens_out": $tokens_out,
  "tokens_cached": $tokens_cached,
  "total_tokens": $total_tokens,
  "cost_usd": $cost_usd,
  "cache_hit_rate_pct": $cache_hit_rate,
  "time_seconds": $elapsed
}
JSON

  ok "  ${label}: ${total_tokens} tokens | \$${cost_usd} | ${cache_hit_rate}% cached | ${elapsed}s"
}

# ── Aggregate results across runs ─────────────────────────────────────────────
aggregate() {
  local label="$1"
  shift
  local files=("$@")

  python3 - "${files[@]}" <<'PY'
import sys, json, statistics

files = sys.argv[1:]
data = [json.load(open(f)) for f in files if open(f)]

def avg(key):
    vals = [d[key] for d in data]
    return round(statistics.mean(vals), 4)

print(json.dumps({
    "label":              data[0]["label"],
    "model":              data[0]["model"],
    "runs":               len(data),
    "avg_tokens_in":      avg("tokens_in"),
    "avg_tokens_out":     avg("tokens_out"),
    "avg_tokens_cached":  avg("tokens_cached"),
    "avg_total_tokens":   avg("total_tokens"),
    "avg_cost_usd":       avg("cost_usd"),
    "avg_cache_hit_rate_pct": avg("cache_hit_rate_pct"),
    "avg_time_seconds":   avg("time_seconds"),
    "raw": data,
}, indent=2))
PY
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}════════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}  setra benchmark  •  $(date -u '+%Y-%m-%d %H:%M UTC')${RESET}"
  echo -e "${BOLD}════════════════════════════════════════════════════${RESET}"
  echo ""

  mkdir -p "$WORK_BASE"
  trap '[[ "${KEEP_WORK_DIR:-0}" == "1" ]] || rm -rf "$WORK_BASE"' EXIT

  # ── Prepare base test repo ───────────────────────────────────────────────
  BASE_REPO="$WORK_BASE/base-repo"
  if [[ -n "$BENCH_REPO_URL" ]]; then
    git clone --depth 1 "$BENCH_REPO_URL" "$BASE_REPO"
  else
    create_test_repo "$BASE_REPO"
  fi

  declare -A variant_runs

  # ── Three variants ────────────────────────────────────────────────────────
  #   1. nocache  — fresh every time (no prompt cache, no memory)
  #   2. cache    — prompt caching enabled (re-uses system prompt tokens)
  #   3. memory   — cache + setra memory (summarised context from prior runs)
  VARIANTS=(
    "nocache:--no-cache --no-memory"
    "cache:--cache"
    "cache-memory:--cache --memory"
  )

  for variant_def in "${VARIANTS[@]}"; do
    IFS=':' read -r variant_label variant_flags <<< "$variant_def"
    run_files=()

    for (( i=1; i<=RUNS; i++ )); do
      run_label="${variant_label}-run${i}"
      run_dir="$WORK_BASE/${run_label}"

      # Fresh copy of the repo for each run so we measure clean state
      cp -r "$BASE_REPO" "$run_dir"

      run_variant "$run_label" "$run_dir" "$variant_flags"
      run_files+=("$RESULTS_DIR/${run_label}.json")
    done

    # Store filenames for aggregation (newline-separated)
    variant_runs["$variant_label"]="${run_files[*]}"
  done

  # ── Aggregate ─────────────────────────────────────────────────────────────
  log "Aggregating results …"
  NOCACHE_AGG=$(aggregate "nocache"       ${variant_runs["nocache"]})
  CACHE_AGG=$(aggregate   "cache"         ${variant_runs["cache"]})
  MEMORY_AGG=$(aggregate  "cache-memory"  ${variant_runs["cache-memory"]})

  # ── Top-level summary ──────────────────────────────────────────────────────
  python3 - <<PY
import json, datetime

nocache = $NOCACHE_AGG
cache   = $CACHE_AGG
memory  = $MEMORY_AGG

def pct_change(new, old):
    if old == 0: return None
    return round((new - old) / old * 100, 2)

summary = {
    "timestamp": "$TIMESTAMP",
    "runs_per_variant": $RUNS,
    "variants": {
        "nocache":      nocache,
        "cache":        cache,
        "cache_memory": memory,
    },
    "comparisons": {
        "cache_vs_nocache": {
            "cost_change_pct":  pct_change(cache["avg_cost_usd"], nocache["avg_cost_usd"]),
            "time_change_pct":  pct_change(cache["avg_time_seconds"], nocache["avg_time_seconds"]),
            "token_change_pct": pct_change(cache["avg_total_tokens"], nocache["avg_total_tokens"]),
        },
        "memory_vs_nocache": {
            "cost_change_pct":  pct_change(memory["avg_cost_usd"], nocache["avg_cost_usd"]),
            "time_change_pct":  pct_change(memory["avg_time_seconds"], nocache["avg_time_seconds"]),
            "token_change_pct": pct_change(memory["avg_total_tokens"], nocache["avg_total_tokens"]),
        },
    },
    "avg_cost_usd": round((nocache["avg_cost_usd"] + cache["avg_cost_usd"] + memory["avg_cost_usd"]) / 3, 4),
}

with open("$RESULTS_DIR/results.json", "w") as f:
    json.dump(summary, f, indent=2)

print(json.dumps(summary, indent=2))
PY

  # ── Human-readable summary ────────────────────────────────────────────────
  python3 - <<'PY' | tee "$RESULTS_DIR/summary.txt"
import json

with open("benchmark-results/results.json") as f:
    d = json.load(f)

nc = d["variants"]["nocache"]
ca = d["variants"]["cache"]
me = d["variants"]["cache_memory"]
cc = d["comparisons"]["cache_vs_nocache"]
mc = d["comparisons"]["memory_vs_nocache"]

def sign(v):
    if v is None: return "n/a"
    return f"+{v}%" if v > 0 else f"{v}%"

print(f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  setra benchmark  |  {d['timestamp']}
  {d['runs_per_variant']} runs per variant  |  model: {nc['model']}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Variant           Tokens     Cost (USD)   Cache %   Time (s)
  ──────────────────────────────────────────────────────────────
  no cache          {nc['avg_total_tokens']:<10,.0f} ${nc['avg_cost_usd']:<11.4f}  {nc['avg_cache_hit_rate_pct']:<8.1f}  {nc['avg_time_seconds']:.1f}
  cache             {ca['avg_total_tokens']:<10,.0f} ${ca['avg_cost_usd']:<11.4f}  {ca['avg_cache_hit_rate_pct']:<8.1f}  {ca['avg_time_seconds']:.1f}
  cache + memory    {me['avg_total_tokens']:<10,.0f} ${me['avg_cost_usd']:<11.4f}  {me['avg_cache_hit_rate_pct']:<8.1f}  {me['avg_time_seconds']:.1f}

  Cache vs no-cache:        cost {sign(cc['cost_change_pct'])}  |  time {sign(cc['time_change_pct'])}
  Memory vs no-cache:       cost {sign(mc['cost_change_pct'])}  |  time {sign(mc['time_change_pct'])}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
""")
PY

  echo ""
  ok "Results written to $RESULTS_DIR/"
}

main "$@"
