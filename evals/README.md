# Setra Evals

A lightweight behavioral test harness for the Setra agent platform. Unlike unit
tests (which assert on code), evals assert on **agent and system behavior** —
the kinds of regressions that are easy to miss when the code compiles and
passes unit tests but the agent now does the wrong thing.

## Running

The harness is plain Node — no extra dependencies needed.

```bash
pnpm evals             # run all cases
pnpm evals -- --case assignment-pickup   # one case
pnpm evals -- --json   # machine-readable output
```

`pnpm evals` requires a running Setra server on `http://localhost:3141` (or
`SETRA_EVAL_BASE_URL`). Start it with `pnpm dev` in another shell first.

## Case format

Each case lives in `evals/cases/<name>.yaml` and has the same shape:

```yaml
name: assignment-pickup
description: When an issue is assigned to an agent, dispatcher picks it up.
setup:
  - method: POST
    path: /api/issues
    body: { title: "Pick me up", assigneeAgentSlug: "test-engineer" }
expect:
  - within: 30s
    method: GET
    path: /api/issues/$.setup[0].id/runs
    where: $.runs.length >= 1
```

The cases included here cover the high-signal regressions called out in the
roadmap:

| Case                        | What it checks                                        |
| --------------------------- | ----------------------------------------------------- |
| assignment-pickup           | Assigned issues are picked up within the dispatch loop|
| approval-requested          | hire_agent without approval returns 202, not 200      |
| company-boundary            | Cross-tenant /api/runs/X returns 404 (not 403)        |
| conflict-409                | Stale-write to /api/issues/:id returns 409            |
| hire-agent-gate             | Hire request is gated by board-approval policy        |
| skill-promotion-happy-path  | A successful skill promotion creates a wiki entry     |
| profile-distillation        | After a green run, ~/.setra/profile.json is updated   |
| loop-detector-fires         | Repeated identical tool calls trigger the loop signal |

## Why not promptfoo?

We considered promptfoo and may adopt it for prompt-level evals later. For
*system* evals (HTTP behavior, dispatcher loop, governance gates) a thin
Node harness is sufficient and has zero install surface.
