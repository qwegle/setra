# API reference

The full machine-readable API is at [`/docs/openapi.yaml`](../../docs/openapi.yaml).
Highlights:

## Authentication

The local daemon runs on `127.0.0.1` and uses Unix-socket trust by default
— any process running as the same user can reach it. Multi-tenant cloud
deployments use bearer tokens and per-request company scoping.

## Endpoints

### Runs

- `GET /api/runs` — list runs in your company.
- `GET /api/runs/:id` — run details. Cross-tenant returns `404` (never 403).
- `GET /api/runs/:id/chunks` — paginated streamed chunks.
- `GET /api/runs/:id/stream` — SSE of live chunks for active runs.

### Issues

- `POST /api/issues` — create.
- `PATCH /api/issues/:id` — partial update; sends `409` on stale version.
- `GET /api/issues` — list with tenant scope.

### Goals

- `POST /api/goals/:id/decompose` — break a goal into a root issue + sub-issues.

### Agents

- `POST /api/agents/hire` — hire a specialist; returns `200` or `202`.
- `GET /api/agents/hire-requests` — list pending hire approvals.

### Profile

- `GET /api/profile` — read the operator profile.
- `PUT /api/profile` — replace it (secrets are scrubbed before persistence).

### CLI status

- `GET /api/cli-status` — install/version state for the five first-class CLIs.
- `GET /api/cli-status?force=1` — bust the 60s probe cache.

### Wiki

- `GET /api/wiki` — list wiki entries.
- `GET /api/wiki/:slug` — read a wiki entry (markdown).
- `POST /api/wiki/:slug` — write/update.

## SSE

`/api/sse` streams every run event for the requesting company:
`run.started`, `run.chunk`, `run.completed`, `issue.created`,
`hire-request.created`, etc.
