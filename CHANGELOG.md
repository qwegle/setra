# Changelog

All notable changes to Setra are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Setra uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-package changelogs live alongside each `package.json` once a package
ships its own npm release. Until then, this root file is the source of
truth.

## [Unreleased]

### Added

- Cream-light default theme with Beacons-style warm palette.
- `NewIssueDialog` with title, description, status, priority, assignee, and labels.
- Recharts analytics dashboard with 4 KPIs and 4 charts (tenant-scoped).
- `AdapterStatusPill` in the top bar: live CLI connection state with a 5-CLI popover.
- Two-screen Connect-a-CLI onboarding flow replacing the legacy wizard for new users.
- Cursor CLI adapter, `cli-probe` service, `GET /api/cli-status` endpoint.
- Soft-deprecation of legacy provider API keys (governed by `legacyApiKeysEnabled`).
- `SECURITY.md`, `CHANGELOG.md`, expanded PR template with Model Used / Thinking Path / Test Plan fields.

### Fixed

- Silent 202 in `HireAgentModal`: the CEO hire path now distinguishes "created" from "gated" responses inline.
- Tenant scoping on `/api/runs/*` (404, not 403, on cross-tenant access).

## [0.1.0] — Internal alpha

Initial internal alpha. CLI, TUI, desktop, multi-agent broker, skill
promotion, kanban, wiki, and governance scaffolding all in place.

---

## Release channels

- **canary** — pushed from `dev`. Fast-moving, may break.
- **stable** — tagged from `main` after canary soak.

## Commit convention

Setra uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): add X
fix(scope): handle Y when Z
docs(scope): clarify W
chore(scope): bump deps
```

The `scope` matches the workspace package or app (e.g. `server`, `board`,
`agent-runner`, `cli`). Breaking changes carry a `!` and a `BREAKING
CHANGE:` footer.
