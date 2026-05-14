# Contributing to Setra

Thanks for contributing to Setra. This document covers the workflow, the
local dev loop, and our review expectations.

## Workflow

1. Fork the repository.
2. Create a feature branch from `dev` (never from `main` or `stage`):
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feat/short-descriptive-name
   ```
3. Make focused changes with tests where relevant.
4. Open a pull request **against `dev`**. Never push directly to
   `main`, `dev`, or `stage`.
5. Fill in the PR template — including **Model Used**, **Thinking
   Path**, and **Test Plan**. These are first-class review artifacts.

Branches in flight:

| Branch | Purpose |
| ------ | ------- |
| `dev` | Active development, canary releases |
| `stage` | Pre-release soak |
| `main` | Stable releases |

Promotion: `dev` -> `stage` -> `main` via merge PR.

## Development setup

```bash
git clone https://github.com/qwegle/setra
cd setra
cp .env.example .env
pnpm install
pnpm dev          # server :3141, board :5173
```

Requirements:

- Node.js 20+
- pnpm 9+
- At least one CLI adapter installed (Claude Code, Codex CLI, Gemini
  CLI, Cursor CLI, or OpenCode). See the [README adapters
  table](README.md#cli-adapters).

## Commit convention

Setra uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): add X
fix(scope): handle Y when Z
docs(scope): clarify W
chore(scope): bump deps
test(scope): cover Q
```

Scope matches the workspace package or app (e.g. `server`, `board`,
`agent-runner`, `cli`, `desktop`, `db`). Breaking changes use `!` and a
`BREAKING CHANGE:` footer.

Update `CHANGELOG.md` under `[Unreleased]` for any user-visible change.

## Validation

Before opening a PR, run the same checks CI runs:

```bash
pnpm test:ci                          # 361+ tests
pnpm --filter @setra/server build     # server build
pnpm --filter @setra/board build      # board build
pnpm lint                             # Biome
```

Watch mode while developing a single package is fine:

```bash
pnpm --filter @setra/agent-runner test --watch
```

## Code style

- Biome for formatting and linting (`pnpm lint`).
- TypeScript strict. Prefer typed interfaces over `any`.
- Tone: enterprise-professional, no emojis in code, commits, PRs, or UI.
- Keep changes scoped — avoid unrelated refactors in the same PR.
- Comment only where the code needs clarification beyond what it reads
  as.

## Tests

- Unit and integration tests live alongside source under `__tests__/`.
- Use Vitest. Run a single file with `pnpm test path/to/file.test.ts`.
- For server route tests, prefer integration-level (real DB, real
  router) over deeply mocked unit tests.

## Schema and migrations

When you add a column:

1. Update the Drizzle table definition in `apps/server/src/db/schema.ts`.
2. Add it to the `CREATE TABLE` block (~line 450).
3. Add an `ALTER TABLE ... ADD COLUMN` in the ALTER list (~line 600-700).
4. Add a migration in `packages/db/migrations/` if it must run on
   existing installs.

The runtime is idempotent: `ensureTables` -> `runMigrations` ->
`seedBuiltins`.

## Documentation

User-facing docs live in `docs/`. They are published to the docs site
via the docs build (`pnpm --filter @setra/docs build`). If your change
adds a feature or alters behaviour, update the relevant page in the same
PR.

## Filing issues

- **Bugs:** open a GitHub issue with reproduction steps, expected vs.
  observed behaviour, and the version (`setra --version`).
- **Features / design:** open a Discussion (or an issue if Discussions
  are disabled) before doing significant implementation work.
- **Security:** see [SECURITY.md](SECURITY.md). Do not open a public
  issue.

## License

By contributing you agree your code is released under the Apache 2.0
license that covers the project. No CLA is required.
