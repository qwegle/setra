# FAQ

### Do I need an API key?

No. Setra uses your installed coding CLI (Claude / Codex / Gemini / OpenCode /
Cursor). API keys are explicitly not collected.

### Can I run multiple CLIs side-by-side?

Yes. `probeCLIs()` discovers all installed CLIs and the AdapterStatusPill in
the top bar lets you switch between them per-run.

### Where is my data?

Locally at `~/.setra/`:

- `settings.json` — CLI preference, onboarded flag.
- `profile.json` — distilled operator profile (secret-scrubbed).
- `setra.db` — SQLite database with companies, agents, issues, runs, chunks.
- `memory/` — vector + keyword memory store.
- `wiki/<companySlug>/` — per-company markdown wiki.

### Why does the hire button sometimes go amber?

The CEO agent tried to hire someone but your board-approval policy is on.
Open the Approvals tab to accept or reject the request.

### Why am I seeing 404 on a run I know exists?

You're in the wrong company context. Cross-tenant `/api/runs/:id` always
returns 404 — never 403 — to avoid leaking IDs.

### How do I run evals?

```bash
pnpm dev          # in one shell
pnpm evals        # in another
```

### Can I disable the sandbox?

It's off by default. Set `SETRA_SANDBOX_ENFORCE=off` or unset the variable.
For multi-user hosts we recommend `warn` or `strict`.

### Is Setra ready for production?

The roadmap calls this Phase 1.5. Single-tenant local use is solid; multi-
tenant cloud needs additional hardening (LAN discovery audit, queue
isolation, billing).
