# setra.sh — Testing Strategy

**Version:** 0.1  
**Date:** 2026-05  
**Status:** Pre-build reference. Set up testing infrastructure before writing the first service.

---

## Tooling

| Layer | Tool | Why |
|---|---|---|
| Unit / Integration | **Vitest** | Native ESM, fast, built-in coverage, compatible with the monorepo |
| E2E (Electron) | **Playwright** + **electron-playwright-helpers** | Official Electron testing story |
| SSH mock server | **ssh2** (server mode) | Same library as the production code — zero extra deps |
| DB in tests | **better-sqlite3** `:memory:` | Real SQLite, no disk I/O, auto-cleaned |
| Coverage | `@vitest/coverage-v8` | V8 native, no instrumentation overhead |
| CI fixture validation | `setra-benchmark.sh` | Proves the "9× savings" claim with real numbers |

---

## A. UNIT TESTS

### What MUST have unit tests from day 1

| Module | File | Critical because |
|---|---|---|
| PTY cost parser | `packages/agent-runner/src/cost-tracker.ts` | Fragile — every agent update can break it silently |
| Memory search | `packages/memory/src/sqlite-vec.ts` | Core product differentiator — must be correct |
| Git worktree ops | `packages/git/src/worktree.ts` | Destructive ops (force remove) — failures corrupt repos |
| Session resume logic | `packages/agent-runner/src/local-pty.ts` | Stale threshold misconfig = context injection with stale data |
| MCP config generation | `packages/mcp/src/config-gen.ts` | Security-critical — wrong output = scope escape |
| Company manifest parsing | `packages/company/src/types.ts` | Cloud billing — validation failures = silent data corruption |

---

### A1. PTY Cost Parser Tests

```typescript
// packages/agent-runner/tests/cost-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseCostFromPtyOutput } from '../src/cost-tracker.js';
import { readFileSync } from 'fs';
import { join } from 'path';

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf-8');
}

// ─── Claude Code ──────────────────────────────────────────────────────────────
describe('Claude Code cost parser', () => {
  it('parses a complete run with cache hits', () => {
    const result = parseCostFromPtyOutput('claude', fixture('claude-pty-output.txt'));
    expect(result).toEqual({
      costUsd: 0.0523,
      inputTokens: 12345,
      outputTokens: 1234,
      cacheReadTokens: 10891,
      cacheWriteTokens: 2345,
      confidence: 'high',
    });
  });

  it('parses a cold run with no cache', () => {
    const result = parseCostFromPtyOutput('claude', fixture('claude-pty-cold.txt'));
    expect(result).toEqual({
      costUsd: 0.1847,
      inputTokens: 45000,
      outputTokens: 3200,
      cacheReadTokens: 0,
      cacheWriteTokens: 45000,
      confidence: 'high',
    });
  });

  it('returns the LAST cost block when multiple runs in same PTY output', () => {
    const output = fixture('claude-pty-output.txt') + '\n' + fixture('claude-pty-second-run.txt');
    const result = parseCostFromPtyOutput('claude', output);
    // Should return the second run's cost, not the first
    expect(result?.costUsd).toBe(0.0089);
  });

  it('returns null gracefully when no cost info in output', () => {
    const result = parseCostFromPtyOutput('claude', 'Hello from Claude\nNo cost here');
    expect(result).toBeNull();
  });

  it('sets confidence=low when only cost line found (no token breakdown)', () => {
    const result = parseCostFromPtyOutput('claude', fixture('claude-pty-cost-only.txt'));
    expect(result?.confidence).toBe('low');
    expect(result?.costUsd).toBeGreaterThan(0);
    expect(result?.inputTokens).toBe(0);
  });

  it('handles ANSI escape codes in PTY output', () => {
    const withAnsi = '\x1b[32mTotal cost:\x1b[0m  $0.0523\n';
    const result = parseCostFromPtyOutput('claude', withAnsi);
    expect(result?.costUsd).toBe(0.0523);
  });

  it('does not parse numbers from non-cost lines', () => {
    const misleading = 'The function returned 0.0523 which is a valid ratio\n';
    const result = parseCostFromPtyOutput('claude', misleading);
    expect(result).toBeNull();
  });
});

// ─── OpenAI Codex CLI ─────────────────────────────────────────────────────────
describe('Codex CLI cost parser', () => {
  it('parses standard Codex usage block', () => {
    const result = parseCostFromPtyOutput('codex', fixture('codex-pty-output.txt'));
    expect(result).toEqual({
      costUsd: 0.0156,
      inputTokens: 1234,
      outputTokens: 456,
      cacheReadTokens: 891,
      cacheWriteTokens: 0,
      confidence: 'high',
    });
  });

  it('parses Codex output with reasoning tokens', () => {
    const result = parseCostFromPtyOutput('codex', fixture('codex-pty-reasoning.txt'));
    expect(result?.inputTokens).toBeGreaterThan(0);
    // reasoning tokens are included in inputTokens total
    expect(result?.confidence).toBe('high');
  });

  it('returns null when Codex exits with no usage block', () => {
    const result = parseCostFromPtyOutput('codex', 'Error: rate limit exceeded\n');
    expect(result).toBeNull();
  });
});

// ─── Gemini CLI ───────────────────────────────────────────────────────────────
describe('Gemini CLI cost parser', () => {
  it('parses standard Gemini usage footer', () => {
    const result = parseCostFromPtyOutput('gemini', fixture('gemini-pty-output.txt'));
    expect(result).toEqual({
      costUsd: 0.0023,
      inputTokens: 4500,
      outputTokens: 1178,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      confidence: 'high',
    });
  });

  it('parses Gemini output with thinking tokens (2.5 flash)', () => {
    const result = parseCostFromPtyOutput('gemini', fixture('gemini-pty-thinking.txt'));
    expect(result?.inputTokens).toBeGreaterThan(0);
    expect(result?.confidence).toBe('high');
  });

  it('falls back to confidence=low when only cost estimate available', () => {
    const result = parseCostFromPtyOutput('gemini', 'Estimated cost: $0.0023\n');
    expect(result?.confidence).toBe('low');
    expect(result?.costUsd).toBe(0.0023);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────
describe('cost parser edge cases', () => {
  it('handles very large token counts with commas', () => {
    const output = 'Total cost:  $1.2345\nInput: 1,234,567 tokens\n';
    const result = parseCostFromPtyOutput('claude', output);
    expect(result?.inputTokens).toBe(1234567);
  });

  it('handles zero-cost runs (e.g., from cache-only local models)', () => {
    const output = 'Total cost:  $0.0000\nInput: 500 tokens\nOutput: 100 tokens\n';
    const result = parseCostFromPtyOutput('claude', output);
    expect(result?.costUsd).toBe(0);
    expect(result?.confidence).toBe('high');
  });

  it('throws for unknown agent type', () => {
    expect(() => parseCostFromPtyOutput('unknown-agent' as never, 'output'))
      .toThrowError(/unknown agent type/i);
  });
});
```

---

### A2. Memory Search Tests

```typescript
// packages/memory/tests/memory-search.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteVecStore } from '../src/sqlite-vec.js';
import { Embedder } from '../src/embedder.js';

// Use pre-computed embeddings so tests don't require WASM/network
const KNOWN_EMBEDDINGS: Record<string, Float32Array> = {
  'implement user authentication with JWT': new Float32Array(384).fill(0.1),
  'fix the login bug with session tokens': new Float32Array(384).fill(0.105),
  'add CSS animations to the header': new Float32Array(384).fill(0.9),
};

// Mock embedder that returns deterministic vectors
const mockEmbedder: Embedder = {
  embed: async (text: string) => {
    // Return a pre-computed embedding or a deterministic fake
    return KNOWN_EMBEDDINGS[text] ?? new Float32Array(384).fill(Math.random());
  },
  isReady: () => true,
};

let store: SqliteVecStore;
let db: Database.Database;

beforeAll(async () => {
  db = new Database(':memory:');
  store = new SqliteVecStore(db, mockEmbedder);
  await store.initialize();
});

afterAll(() => {
  db.close();
});

describe('SqliteVecStore', () => {
  it('inserts a trace and retrieves it by exact ID', async () => {
    const id = await store.insert({
      content: 'implement user authentication with JWT',
      projectId: 'proj-1',
      sourceType: 'run_output',
    });
    const result = await store.getById(id);
    expect(result?.content).toBe('implement user authentication with JWT');
  });

  it('finds semantically similar traces via vector search', async () => {
    await store.insert({ content: 'implement user authentication with JWT', projectId: 'proj-1', sourceType: 'run_output' });
    await store.insert({ content: 'fix the login bug with session tokens', projectId: 'proj-1', sourceType: 'run_output' });
    await store.insert({ content: 'add CSS animations to the header', projectId: 'proj-1', sourceType: 'run_output' });

    const results = await store.search({
      query: 'implement user authentication with JWT',
      projectId: 'proj-1',
      limit: 2,
    });

    expect(results).toHaveLength(2);
    // The auth-related trace should rank higher than the CSS one
    expect(results[0].content).toContain('authentication');
    expect(results.every(r => r.score >= 0 && r.score <= 1)).toBe(true);
  });

  it('scopes search to projectId — no cross-project leakage', async () => {
    await store.insert({ content: 'implement user authentication with JWT', projectId: 'proj-A', sourceType: 'run_output' });
    await store.insert({ content: 'implement user authentication with JWT', projectId: 'proj-B', sourceType: 'run_output' });

    const results = await store.search({
      query: 'authentication JWT',
      projectId: 'proj-A',
      limit: 10,
    });

    expect(results.every(r => r.projectId === 'proj-A')).toBe(true);
  });

  it('returns empty array when no traces exist for project', async () => {
    const results = await store.search({
      query: 'anything',
      projectId: 'nonexistent-project',
      limit: 5,
    });
    expect(results).toHaveLength(0);
  });

  it('deduplicates traces with same content_hash', async () => {
    const content = 'unique content for dedup test';
    await store.insert({ content, projectId: 'proj-dedup', sourceType: 'run_output' });
    await store.insert({ content, projectId: 'proj-dedup', sourceType: 'run_output' }); // duplicate

    const results = await store.search({ query: content, projectId: 'proj-dedup', limit: 10 });
    expect(results).toHaveLength(1);
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await store.insert({ content: `trace number ${i}`, projectId: 'proj-limit', sourceType: 'run_output' });
    }
    const results = await store.search({ query: 'trace', projectId: 'proj-limit', limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('deletes traces by runId when run is deleted', async () => {
    const runId = 'run-to-delete';
    await store.insert({ content: 'deletable trace', projectId: 'proj-1', sourceType: 'run_output', runId });
    await store.deleteByRunId(runId);
    const results = await store.search({ query: 'deletable trace', projectId: 'proj-1', limit: 5 });
    expect(results).toHaveLength(0);
  });
});
```

---

### A3. Git Worktree Tests

```typescript
// packages/git/tests/worktree.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import {
  createWorktree,
  deleteWorktree,
  listWorktrees,
  worktreeExists,
  detectConflicts,
} from '../src/worktree.js';

let repoDir: string;
let worktreeBaseDir: string;

beforeEach(() => {
  // Create a real git repo in a temp directory
  repoDir = mkdtempSync(join(process.cwd(), '.test-repo-'));
  worktreeBaseDir = mkdtempSync(join(process.cwd(), '.test-worktrees-'));

  execSync('git init', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "test@setra.sh"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "setra test"', { cwd: repoDir, stdio: 'pipe' });
  execSync('echo "# test" > README.md', { cwd: repoDir, stdio: 'pipe', shell: true });
  execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: repoDir, stdio: 'pipe' });
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
  rmSync(worktreeBaseDir, { recursive: true, force: true });
});

describe('createWorktree', () => {
  it('creates a worktree at the expected path', async () => {
    const plotId = 'plot-abc123';
    const result = await createWorktree({
      repoPath: repoDir,
      plotId,
      baseBranch: 'main',
      worktreeBaseDir,
    });

    expect(result.worktreePath).toBe(join(worktreeBaseDir, plotId));
    expect(result.branch).toBe(`setra/plot-${plotId}`);
  });

  it('the new branch is a fork of baseBranch, not ahead/behind', async () => {
    const plotId = 'plot-fork-test';
    await createWorktree({ repoPath: repoDir, plotId, baseBranch: 'main', worktreeBaseDir });

    const log = execSync(
      `git log --oneline setra/plot-${plotId}..main`,
      { cwd: repoDir, stdio: 'pipe' }
    ).toString().trim();
    expect(log).toBe(''); // branch is even with main
  });

  it('throws if baseBranch does not exist', async () => {
    await expect(
      createWorktree({ repoPath: repoDir, plotId: 'x', baseBranch: 'nonexistent', worktreeBaseDir })
    ).rejects.toThrow(/branch.*not found/i);
  });

  it('throws if plotId worktree already exists', async () => {
    const plotId = 'plot-duplicate';
    await createWorktree({ repoPath: repoDir, plotId, baseBranch: 'main', worktreeBaseDir });
    await expect(
      createWorktree({ repoPath: repoDir, plotId, baseBranch: 'main', worktreeBaseDir })
    ).rejects.toThrow(/already exists/i);
  });
});

describe('deleteWorktree', () => {
  it('removes the worktree directory', async () => {
    const plotId = 'plot-to-delete';
    const { worktreePath } = await createWorktree({ repoPath: repoDir, plotId, baseBranch: 'main', worktreeBaseDir });

    await deleteWorktree({ repoPath: repoDir, worktreePath });

    const exists = await worktreeExists(worktreePath);
    expect(exists).toBe(false);
  });

  it('does not delete the branch on remote (branch preserved for PR)', async () => {
    const plotId = 'plot-branch-preserve';
    await createWorktree({ repoPath: repoDir, plotId, baseBranch: 'main', worktreeBaseDir });
    const worktreePath = join(worktreeBaseDir, plotId);

    await deleteWorktree({ repoPath: repoDir, worktreePath });

    // Branch should still exist in the repo
    const branches = execSync('git branch', { cwd: repoDir, stdio: 'pipe' }).toString();
    expect(branches).toContain(`setra/plot-${plotId}`);
  });

  it('succeeds even if worktree has uncommitted changes (force mode)', async () => {
    const plotId = 'plot-dirty';
    const { worktreePath } = await createWorktree({ repoPath: repoDir, plotId, baseBranch: 'main', worktreeBaseDir });

    execSync(`echo "dirty" >> README.md`, { cwd: worktreePath, stdio: 'pipe', shell: true });

    await expect(deleteWorktree({ repoPath: repoDir, worktreePath, force: true })).resolves.not.toThrow();
  });
});

describe('listWorktrees', () => {
  it('lists all setra worktrees for a repo', async () => {
    await createWorktree({ repoPath: repoDir, plotId: 'plot-1', baseBranch: 'main', worktreeBaseDir });
    await createWorktree({ repoPath: repoDir, plotId: 'plot-2', baseBranch: 'main', worktreeBaseDir });

    const worktrees = await listWorktrees(repoDir);

    // Main worktree + 2 plot worktrees
    expect(worktrees.filter(w => w.branch?.startsWith('setra/'))).toHaveLength(2);
  });
});

describe('detectConflicts', () => {
  it('reports no conflicts on a clean worktree vs main', async () => {
    const plotId = 'plot-no-conflict';
    const { worktreePath } = await createWorktree({ repoPath: repoDir, plotId, baseBranch: 'main', worktreeBaseDir });

    const conflicts = await detectConflicts({ repoPath: repoDir, worktreePath, targetBranch: 'main' });
    expect(conflicts).toHaveLength(0);
  });

  it('reports conflict when both branches modify the same file', async () => {
    const plotId = 'plot-conflict';
    const { worktreePath } = await createWorktree({ repoPath: repoDir, plotId, baseBranch: 'main', worktreeBaseDir });

    // Modify in main
    execSync('echo "main change" > README.md && git add . && git commit -m "main"', { cwd: repoDir, stdio: 'pipe', shell: true });

    // Modify same file in worktree
    execSync('echo "plot change" > README.md && git add . && git commit -m "plot"', { cwd: worktreePath, stdio: 'pipe', shell: true });

    const conflicts = await detectConflicts({ repoPath: repoDir, worktreePath, targetBranch: 'main' });
    expect(conflicts).toContain('README.md');
  });
});
```

---

### A4. Session Resume Logic Tests

```typescript
// packages/agent-runner/tests/session-resume.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SessionResumeService } from '../src/session-resume.js';
import { applyMigrations } from '../../db/src/migrations.js';

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour (matches blueprint spec)

let db: Database.Database;
let service: SessionResumeService;

beforeEach(() => {
  db = new Database(':memory:');
  applyMigrations(db);
  service = new SessionResumeService(db, { staleThresholdMs: STALE_THRESHOLD_MS });
});

describe('SessionResumeService', () => {
  it('resumes a recent session (under stale threshold)', async () => {
    const recentTime = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
    db.prepare(`INSERT INTO runs (id, plot_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('run-recent', 'plot-1', 'running', recentTime, recentTime);

    const result = service.shouldResume('plot-1');
    expect(result.resume).toBe(true);
    expect(result.runId).toBe('run-recent');
  });

  it('does NOT resume a stale session (over stale threshold)', async () => {
    const staleTime = new Date(Date.now() - 90 * 60 * 1000).toISOString(); // 90 min ago
    db.prepare(`INSERT INTO runs (id, plot_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('run-stale', 'plot-1', 'running', staleTime, staleTime);

    const result = service.shouldResume('plot-1');
    expect(result.resume).toBe(false);
    expect(result.reason).toMatch(/stale/i);
  });

  it('does NOT resume a completed run', async () => {
    const recentTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    db.prepare(`INSERT INTO runs (id, plot_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('run-done', 'plot-1', 'completed', recentTime, recentTime);

    const result = service.shouldResume('plot-1');
    expect(result.resume).toBe(false);
  });

  it('returns the correct cursor for chunk replay', async () => {
    const runId = 'run-with-chunks';
    db.prepare(`INSERT INTO runs (id, plot_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(runId, 'plot-1', 'running', new Date().toISOString(), new Date().toISOString());

    // Insert some chunks
    for (let i = 1; i <= 5; i++) {
      db.prepare(`INSERT INTO session_chunks (id, run_id, seq, data, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(`chunk-${i}`, runId, i, `output-${i}`, new Date().toISOString());
    }

    const result = service.shouldResume('plot-1');
    expect(result.resume).toBe(true);
    expect(result.lastSeenCursor).toBe(5); // last seq number
  });

  it('handles no existing runs for a plot', () => {
    const result = service.shouldResume('plot-with-no-runs');
    expect(result.resume).toBe(false);
    expect(result.reason).toMatch(/no.*run/i);
  });

  it('marks stale chunks as replay-only (not context-injected)', async () => {
    const staleTime = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const runId = 'run-stale-chunks';
    db.prepare(`INSERT INTO runs (id, plot_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(runId, 'plot-1', 'running', staleTime, staleTime);
    db.prepare(`INSERT INTO session_chunks (id, run_id, seq, data, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('chunk-old', runId, 1, 'stale-output', staleTime);

    const chunks = service.getChunksForReplay(runId, { maxAgeMs: STALE_THRESHOLD_MS });
    // Chunks exist for scrollback replay
    expect(chunks).toHaveLength(1);
    // But they should NOT be injected as context
    expect(chunks[0].useForContextInjection).toBe(false);
  });
});
```

---

### A5. MCP Config Generation Tests

```typescript
// packages/mcp/tests/mcp-config.test.ts
import { describe, it, expect } from 'vitest';
import { generatePlotMcpConfig } from '../src/config-gen.js';
import type { Plot, Tool } from '@setra/types';

const basePlot: Plot = {
  id: 'plot-test-123',
  project_id: 'proj-1',
  name: 'Test Plot',
  worktree_path: '/workspaces/my-project/.setra-plots/plot-test-123',
  branch: 'setra/plot-test-123',
  agent_type: 'claude',
  status: 'active',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const filesystemTool: Tool = {
  id: 'tool-fs',
  name: 'filesystem',
  transport: 'stdio',
  command: 'npx',
  args: JSON.stringify(['@modelcontextprotocol/server-filesystem']),
  env_vars: null,
  is_builtin: 0,
  is_global: 0,
  health_status: 'healthy',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('generatePlotMcpConfig', () => {
  it('always includes setra-core in the config', () => {
    const config = generatePlotMcpConfig(basePlot, [], basePlot.worktree_path);
    expect(config.mcpServers['setra-core']).toBeDefined();
  });

  it('scopes setra-core to this plot only (SETRA_PLOT_ID injected)', () => {
    const config = generatePlotMcpConfig(basePlot, [], basePlot.worktree_path);
    expect(config.mcpServers['setra-core'].env?.SETRA_PLOT_ID).toBe('plot-test-123');
  });

  it('scopes setra-core path to this worktree (no parent directories)', () => {
    const config = generatePlotMcpConfig(basePlot, [], basePlot.worktree_path);
    const allowedPaths = JSON.parse(config.mcpServers['setra-core'].env?.SETRA_ALLOWED_PATHS ?? '[]');
    expect(allowedPaths).toHaveLength(1);
    expect(allowedPaths[0]).toBe(basePlot.worktree_path);
    // Must not grant access to the parent or repo root
    expect(allowedPaths[0]).not.toBe('/workspaces/my-project');
    expect(allowedPaths[0]).not.toBe('/');
  });

  it('adds user-enabled tools to the config', () => {
    const config = generatePlotMcpConfig(basePlot, [filesystemTool], basePlot.worktree_path);
    expect(config.mcpServers['filesystem']).toBeDefined();
  });

  it('injects ALLOWED_PATHS into user tools', () => {
    const config = generatePlotMcpConfig(basePlot, [filesystemTool], basePlot.worktree_path);
    const env = config.mcpServers['filesystem'].env ?? {};
    const paths = JSON.parse(env['ALLOWED_PATHS'] ?? '[]');
    expect(paths).toContain(basePlot.worktree_path);
  });

  it('does not add builtin tools twice', () => {
    const builtinTool: Tool = { ...filesystemTool, is_builtin: 1, name: 'setra-core' };
    const config = generatePlotMcpConfig(basePlot, [builtinTool], basePlot.worktree_path);
    // setra-core should appear exactly once
    const keys = Object.keys(config.mcpServers).filter(k => k === 'setra-core');
    expect(keys).toHaveLength(1);
  });

  it('produces valid JSON (config is serializable)', () => {
    const config = generatePlotMcpConfig(basePlot, [filesystemTool], basePlot.worktree_path);
    expect(() => JSON.stringify(config)).not.toThrow();
  });

  it('uses the correct MCP server path for setra-core', () => {
    const config = generatePlotMcpConfig(basePlot, [], basePlot.worktree_path);
    // Must point to the actual setra-core MCP server binary
    expect(config.mcpServers['setra-core'].args?.[0]).toMatch(/setra-core/);
  });
});
```

---

## B. INTEGRATION TESTS

### B1. Agent Run Lifecycle

```typescript
// packages/agent-runner/tests/integration/run-lifecycle.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { RunService } from '../../../apps/desktop/src/main/services/RunService.js';
import { applyMigrations } from '../../../packages/db/src/migrations.js';

// Mock the actual agent binary — we're testing the lifecycle, not the agent
vi.mock('../src/local-pty.js', () => ({
  spawnAgentPty: vi.fn().mockImplementation(async (config) => {
    // Simulate an agent that runs for 100ms then outputs cost info and exits
    setTimeout(() => {
      config.onData('Working on task...\n');
      config.onData('Total cost:  $0.0050\n');
      config.onData('Total duration (API): 1.2s\n');
      config.onExit(0);
    }, 100);
    return { pid: 12345, kill: vi.fn() };
  }),
}));

let db: Database.Database;
let runService: RunService;

beforeEach(() => {
  db = new Database(':memory:');
  applyMigrations(db);

  // Seed required data
  db.prepare(`INSERT INTO projects (id, name, repo_path) VALUES (?, ?, ?)`)
    .run('proj-1', 'My Project', '/tmp/project');
  db.prepare(`INSERT INTO plots (id, project_id, name, worktree_path, branch, agent_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('plot-1', 'proj-1', 'Test Plot', '/tmp/worktree', 'setra/plot-1', 'claude', 'active');

  runService = new RunService(db);
});

describe('run lifecycle integration', () => {
  it('transitions status: queued → running → completed', async () => {
    const runId = await runService.createRun('plot-1', { task: 'Add tests' });

    let states: string[] = [];
    runService.on('status-change', (id, status) => {
      if (id === runId) states.push(status);
    });

    await runService.startRun(runId);

    // Wait for the mock agent to complete
    await new Promise(r => setTimeout(r, 200));

    expect(states).toEqual(['running', 'completed']);
  });

  it('captures cost from PTY output and stores in ledger', async () => {
    const runId = await runService.createRun('plot-1', { task: 'Add tests' });
    await runService.startRun(runId);
    await new Promise(r => setTimeout(r, 200));

    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as any;
    expect(run.cost_usd).toBe(0.005);
  });

  it('stores PTY output as session_chunks with monotonic sequence', async () => {
    const runId = await runService.createRun('plot-1', { task: 'Add tests' });
    await runService.startRun(runId);
    await new Promise(r => setTimeout(r, 200));

    const chunks = db.prepare('SELECT * FROM session_chunks WHERE run_id = ? ORDER BY seq').all(runId) as any[];
    expect(chunks.length).toBeGreaterThan(0);
    // Verify monotonic sequence
    chunks.forEach((c, i) => {
      if (i > 0) expect(c.seq).toBeGreaterThan(chunks[i - 1].seq);
    });
  });

  it('generates a trace/memory entry after run completes', async () => {
    const runId = await runService.createRun('plot-1', { task: 'Add tests' });
    await runService.startRun(runId);
    await new Promise(r => setTimeout(r, 500));

    const traces = db.prepare('SELECT * FROM traces WHERE run_id = ?').all(runId);
    expect(traces.length).toBeGreaterThan(0);
  });

  it('records run status as failed when agent exits non-zero', async () => {
    vi.mocked(spawnAgentPty).mockImplementationOnce(async (config) => {
      setTimeout(() => config.onExit(1), 50);
      return { pid: 99, kill: vi.fn() };
    });

    const runId = await runService.createRun('plot-1', { task: 'Failing task' });
    await runService.startRun(runId);
    await new Promise(r => setTimeout(r, 200));

    const run = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as any;
    expect(run.status).toBe('failed');
  });
});
```

---

### B2. Team Broker (Message Routing + Rate Limiting)

```typescript
// packages/mcp/tests/integration/broker.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TeamBroker } from '../src/broker.js';

let broker: TeamBroker;

beforeEach(() => {
  broker = new TeamBroker({ rateLimitPerMinute: 10 });
});

afterEach(() => {
  broker.shutdown();
});

describe('TeamBroker routing', () => {
  it('routes a message from agent A to agent B', async () => {
    const received: any[] = [];
    broker.subscribe('agent-B', (msg) => received.push(msg));

    await broker.send({ from: 'agent-A', to: 'agent-B', content: 'hello' });

    expect(received).toHaveLength(1);
    expect(received[0].content).toBe('hello');
    expect(received[0].from).toBe('agent-A');
  });

  it('does NOT deliver a message to the wrong agent', async () => {
    const receivedByC: any[] = [];
    broker.subscribe('agent-C', (msg) => receivedByC.push(msg));

    await broker.send({ from: 'agent-A', to: 'agent-B', content: 'for B only' });

    expect(receivedByC).toHaveLength(0);
  });

  it('enforces rate limit per agent', async () => {
    const sends = Array.from({ length: 15 }, (_, i) =>
      broker.send({ from: 'agent-A', to: 'agent-B', content: `msg ${i}` })
    );

    const results = await Promise.allSettled(sends);
    const rejected = results.filter(r => r.status === 'rejected');
    expect(rejected.length).toBeGreaterThan(0);
  });

  it('tags messages with contentSource based on sender metadata', async () => {
    const received: any[] = [];
    broker.subscribe('coordinator', (msg) => received.push(msg));

    // Worker agent processed a file
    await broker.send({
      from: 'worker-1',
      to: 'coordinator',
      content: 'file summary',
      metadata: { processedExternalContent: true },
    });

    expect(received[0].contentSource).toBe('external-processed');
  });

  it('delivers messages in order (FIFO per recipient)', async () => {
    const received: string[] = [];
    broker.subscribe('agent-B', (msg) => received.push(msg.content));

    for (let i = 0; i < 5; i++) {
      await broker.send({ from: 'agent-A', to: 'agent-B', content: `msg-${i}` });
    }

    expect(received).toEqual(['msg-0', 'msg-1', 'msg-2', 'msg-3', 'msg-4']);
  });
});
```

---

### B3. DB Schema Migration Tests

```typescript
// packages/db/tests/migrations.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { getMigrations, applyMigrations, rollbackMigration } from '../src/migrations.js';

describe('schema migrations', () => {
  it('applies all migrations to a fresh database', () => {
    const db = new Database(':memory:');
    expect(() => applyMigrations(db)).not.toThrow();
    db.close();
  });

  it('migration is idempotent (applying twice is safe)', () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    db.close();
  });

  it('all expected tables exist after migration', () => {
    const db = new Database(':memory:');
    applyMigrations(db);

    const requiredTables = [
      'grounds', 'tools', 'projects', 'plots', 'runs',
      'session_chunks', 'ledger_entries', 'traces', 'app_settings',
    ];

    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table'`
    ).all().map((r: any) => r.name);

    for (const table of requiredTables) {
      expect(tables).toContain(table);
    }
    db.close();
  });

  it('can roll back each migration one at a time without data corruption', () => {
    const db = new Database(':memory:');
    const migrations = getMigrations();

    // Apply all
    applyMigrations(db);

    // Rollback in reverse order
    for (let i = migrations.length - 1; i >= 0; i--) {
      expect(() => rollbackMigration(db, migrations[i])).not.toThrow();
    }
    db.close();
  });

  it('foreign key constraints are enforced after migration', () => {
    const db = new Database(':memory:');
    applyMigrations(db);

    // Attempt to insert a plot referencing a non-existent project
    expect(() =>
      db.prepare(
        `INSERT INTO plots (id, project_id, name, worktree_path, branch, agent_type, status)
         VALUES ('p1', 'nonexistent-proj', 'name', '/path', 'branch', 'claude', 'active')`
      ).run()
    ).toThrow(); // FK violation
    db.close();
  });

  it('Phase 2 SaaS migration: adds organization_id to all tables without data loss', () => {
    const db = new Database(':memory:');
    applyMigrations(db);

    // Insert Phase 1 data
    db.prepare(`INSERT INTO projects (id, name, repo_path) VALUES ('proj-1', 'My Project', '/path')`).run();

    // Apply Phase 2 migration (adds org_id as nullable first)
    const { applyPhase2Migration } = require('../src/migrations-phase2.js');
    expect(() => applyPhase2Migration(db)).not.toThrow();

    // Existing data should still be there
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get('proj-1');
    expect(project).toBeDefined();
    db.close();
  });
});
```

---

## C. E2E TESTS (Electron + Playwright)

```typescript
// apps/desktop/e2e/main-flow.e2e.ts
import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';
import { join } from 'path';

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const latestBuild = findLatestBuild('dist');
  const appInfo = parseElectronApp(latestBuild);

  electronApp = await electron.launch({
    args: [appInfo.main],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SETRA_TEST_MODE: '1',               // disables agent spawning, uses mocks
      SETRA_DB_PATH: ':memory:',           // fresh in-memory DB for each test
    },
  });

  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
});

// ─── Project Creation ─────────────────────────────────────────────────────────
test('add a project from the sidebar', async () => {
  await page.click('[data-testid="btn-add-project"]');
  await page.fill('[data-testid="input-repo-path"]', '/tmp/test-project');
  await page.click('[data-testid="btn-confirm-add-project"]');

  await expect(page.locator('[data-testid="project-item"]').first()).toBeVisible();
});

// ─── Plot Creation ────────────────────────────────────────────────────────────
test('create a plot and see it in the plot list', async () => {
  // Select the first project
  await page.click('[data-testid="project-item"]');

  // Create a new plot
  await page.click('[data-testid="btn-new-plot"]');
  await page.fill('[data-testid="input-plot-name"]', 'Add OAuth login');
  await page.selectOption('[data-testid="select-agent"]', 'claude');
  await page.click('[data-testid="btn-create-plot"]');

  await expect(
    page.locator('[data-testid="plot-item"]', { hasText: 'Add OAuth login' })
  ).toBeVisible();
});

// ─── Run an Agent (Mock) ──────────────────────────────────────────────────────
test('run the agent in a plot and see the run appear in the ledger', async () => {
  await page.click('[data-testid="plot-item"]');
  await page.click('[data-testid="btn-start-run"]');

  // Mock agent emits cost data immediately in test mode
  await expect(
    page.locator('[data-testid="run-status-badge"]', { hasText: 'running' })
  ).toBeVisible({ timeout: 5000 });

  // Wait for mock run to complete
  await expect(
    page.locator('[data-testid="run-status-badge"]', { hasText: 'completed' })
  ).toBeVisible({ timeout: 15000 });

  // Navigate to ledger and verify entry
  await page.click('[data-testid="nav-ledger"]');
  await expect(
    page.locator('[data-testid="ledger-entry"]').first()
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="ledger-cost"]').first()
  ).toContainText('$');
});

// ─── Terminal Output Replay ───────────────────────────────────────────────────
test('terminal replays output after reconnect (cursor-based)', async () => {
  // Simulate a "reconnect" by reloading the renderer
  const runId = await electronApp.evaluate(({ db }) =>
    db.prepare('SELECT id FROM runs ORDER BY created_at DESC LIMIT 1').get()?.id
  );

  await page.reload();
  await page.click('[data-testid="plot-item"]');

  // The terminal should replay the previous output
  await expect(page.locator('[data-testid="terminal-pane"]')).toContainText('Working on task');
});

// ─── SSH Ground ───────────────────────────────────────────────────────────────
// This test requires the mock SSH server to be running (see integration fixtures)
test('SSH ground: connect and verify tmux session created', async () => {
  await page.click('[data-testid="nav-grounds"]');
  await page.click('[data-testid="btn-add-ground"]');
  await page.fill('[data-testid="input-ground-host"]', '127.0.0.1');
  await page.fill('[data-testid="input-ground-port"]', '2222'); // mock SSH port
  await page.fill('[data-testid="input-ground-username"]', 'testuser');
  await page.selectOption('[data-testid="select-auth-type"]', 'password');
  await page.fill('[data-testid="input-ground-password"]', 'testpass');
  await page.click('[data-testid="btn-test-connection"]');

  await expect(
    page.locator('[data-testid="ground-status"]', { hasText: 'connected' })
  ).toBeVisible({ timeout: 10000 });

  // Create a remote plot
  await page.click('[data-testid="btn-new-plot"]');
  await page.fill('[data-testid="input-plot-name"]', 'Remote Task');
  await page.selectOption('[data-testid="select-ground"]', '127.0.0.1:2222');
  await page.click('[data-testid="btn-create-plot"]');

  // Verify tmux session was created on the server (checked via SSH command)
  const tmuxSessions = await electronApp.evaluate(({ groundService, groundId }) =>
    groundService.exec(groundId, 'tmux list-sessions 2>/dev/null')
  );
  expect(tmuxSessions).toContain('setra-');
});
```

---

## D. COST PARSER FIXTURES

### D1. Claude Code PTY Output

```
# packages/agent-runner/tests/fixtures/claude-pty-output.txt
```

(See actual fixture file at `tests/fixtures/claude-pty-output.txt`)

### D2. Codex CLI PTY Output

(See actual fixture file at `tests/fixtures/codex-pty-output.txt`)

### D3. Gemini CLI PTY Output

(See actual fixture file at `tests/fixtures/gemini-pty-output.txt`)

---

## E. BENCHMARK SCRIPT

See `setra-benchmark.sh` at the repo root. Run with:
```bash
TASK="add a hello-world endpoint to this Express app" \
PROJECT_PATH="./test-fixtures/express-app" \
./setra-benchmark.sh
```

The script outputs `setra-benchmark-report.json` and a human-readable summary proving the cache savings.
