# Architecture

Setra is a monorepo with three runtime processes and a set of shared packages.

## Processes

1. **`@setra/server`** (Hono on Node). Owns the database, runs the dispatcher,
   serves REST + SSE.
2. **`@setra/board`** (React + Vite). The web UI.
3. **`@setra/cli`** (Commander + Ink). Terminal client + onboarding.

## Shared packages

- `@setra/db` — SQLite schema, migrations, drizzle queries.
- `@setra/agent-runner` — adapter dispatch, CLI probes, loop detector,
  sandbox wrapper.
- `@setra/memory` — vector + keyword memory store.
- `@setra/monitor` — CPU/RAM sampling for the dashboard.
- `@setra/company` — org-hierarchy primitives, broker.
- `@setra/shared` — types shared between server, board, CLI.

## Data flow for a single run

1. Issue is created (board, CLI, or programmatic API).
2. **Dispatcher** matches the issue to an agent role; opens a `run` record.
3. **Run orchestrator** loads the agent's profile, builds the system prompt
   (`buildSystemPrompt`), and spawns the configured adapter
   (`wrapWithSandbox` if `SETRA_SANDBOX_ENFORCE` is set).
4. Adapter emits chunks → `recordRunChunk` → SSE → board live timeline.
5. On completion, `onRunCompleted` distills profile updates and writes
   reflections / memory.

## Key invariants

- All `/api/runs/*` calls are tenant-scoped via `authorizeRunAccess`. Cross-
  tenant reads return 404, never 403.
- Migrations run after `ensureTables()`. New schema starts from a known
  baseline; old schema is upgraded incrementally.
- Adapter spawn sites use `wrapWithSandbox`; behavior governed by
  `SETRA_SANDBOX_ENFORCE`.
