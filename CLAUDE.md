# setra — AI Agent Platform

## What this is
setra is a monorepo for an enterprise AI agent orchestration platform. Think "Linear + Slack + AI agents that actually write code". Companies hire AI agents (CEO, CTO, engineers), assign issues from a Kanban board, and agents autonomously work on them.

## Monorepo structure
```
apps/
  server/          # Hono/Node.js API server (port 3141) — dispatcher, agent runner, collaboration
  board/           # React/Vite board UI (port 5173) — Kanban, agents, collaboration chat
  desktop/         # Electron app — wraps board UI, runs PTY-based coding agents
  cli/             # Ink TUI CLI — setra run, setra status, setra tui

packages/
  db/              # Drizzle ORM + better-sqlite3, DB at ~/.setra/setra.db
  types/           # Zod schemas shared across apps
  agent-runner/    # Adapters for claude/codex/openai-api/etc.
  memory/          # SQLite vector store for agent memory
  monitor/         # Process metrics
```

## Key architecture decisions
- **Dispatcher** (`apps/server/src/lib/dispatcher.ts`): polls every 30s, picks up `backlog`/`todo` board issues, creates `runs` rows, hands to server-runner OR leaves `pending` for desktop PTY bridge
- **PTY bridge** (`apps/desktop/src/main/ipc/pty-dispatch.ts`): Electron polls DB every 10s, picks up `pending` runs for PTY adapters (claude/codex/amp/opencode), spawns via node-pty
- **server-runner**: handles API adapters (openai-api, anthropic-api, openrouter, groq, ollama) — text-only, no file writes
- **PTY agents** (claude, codex, amp): full coding tools — file writes, bash, git, open PRs

## Database
- Location: `~/.setra/setra.db`
- Schema defined with Drizzle in `packages/db/src/schema.ts`
- Migrations in `packages/db/migrations/`
- Key tables: `runs`, `plots`, `agent_roster`, `board_issues`, `board_projects`, `chunks`, `team_messages`

## Running locally
```bash
./start.sh          # starts server + board + electron
pnpm --filter @setra/server dev    # server only
npx vite --port 5173               # board only (from apps/board/)
```

## Tech stack
- TypeScript everywhere, pnpm workspaces + Turborepo
- Server: Hono, Drizzle, better-sqlite3, Zod
- Board: React 18, TanStack Query, Radix UI, Tailwind
- Desktop: Electron 33, electron-vite, node-pty
- CLI: Commander + Ink (React for terminal)

## Operating standards (mandatory)

This codebase ships an enterprise multi-agent orchestration product. Every
artifact you produce must be production-ready and suitable for delivery to
a paying enterprise customer.

The full operating standards live in `AGENTS.md` at the repository root and
are also injected into every Setra agent system prompt via
`apps/server/src/lib/enterprise-standards.ts`. Read `AGENTS.md` before
making any change. Highlights:

- No emojis in code, comments, commits, PRs, issue comments, broker posts,
  or wiki articles. Professional, neutral English only.
- TypeScript strict, Biome for lint and format, no `any` without a tracked
  follow-up.
- All DB access through repositories or `packages/db` schema. No raw SQL in
  routes.
- Never push to `main`, `dev`, or `stage`. Feature branch, then PR to `dev`.
- Conventional Commits. No `Co-authored-by` trailer naming an assistant.
- Validate every change with `pnpm lint`, `pnpm test:ci`,
  `pnpm --filter @setra/server build`, `pnpm --filter @setra/board build`.

## Code style
- Biome for linting/formatting (`pnpm biome check`)
- No unused imports, no `any` unless necessary
- Server routes use Hono + Zod validators
- All DB writes go through `packages/db` schema (never raw SQL in routes)

## Common issues & fixes
- `better-sqlite3` ABI conflict: server needs Node.js ABI, Electron needs Electron ABI. `start.sh` handles this with `electron:rebuild`
- `TERM_PROGRAM=kitty` must be set in PTY env for Claude Code to work correctly
- `ANTHROPIC_PROMPT_CACHING=1` reduces cost by ~9x — always set in PTY runs

## What needs fixing (CTO priority list)
1. **TypeScript errors** — run `pnpm tsc --noEmit` to find all type errors across the monorepo
2. **Build failures** — run `pnpm build` and fix any compilation errors
3. **Missing implementations**: 
   - `traces` table is never written to (no activity storage)
   - Routines cron scheduler exists in DB but never fires
   - `PluginManagerPage` has no server API (`/api/plugins` doesn't exist)
   - Integrations (GitHub/Slack/Linear) store config but never use it
4. **Test failures** — run `pnpm test` and fix any failures
5. **Lint errors** — run `pnpm lint` and fix

## Agent collaboration
- **CEO** (`claude` adapter): owns delivery, creates/assigns issues, drives projects
- **CTO** (`claude` adapter): owns architecture, fixes bugs, makes technical decisions  
- **assistant** (`openai-api`): answers general questions in collaboration channels
- Agents talk via `#general` and project channels in collaboration (/api/collaboration)
