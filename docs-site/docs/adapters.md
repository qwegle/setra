# Adapters

An *adapter* wraps a third-party coding CLI so Setra can use it as a backend.
Setra ships five first-class adapters:

| ID         | CLI binary       | Notes                                      |
| ---------- | ---------------- | ------------------------------------------ |
| `claude`   | `claude`         | Anthropic Claude Code                      |
| `codex`    | `codex`          | OpenAI Codex CLI                           |
| `gemini`   | `gemini`         | Google Gemini CLI                          |
| `opencode` | `opencode`       | Open-source CLI from opencode.ai           |
| `cursor`   | `cursor-agent`   | Cursor's headless agent (from desktop app) |

## Probing

`@setra/agent-runner`'s `probeCLIs()` checks each adapter for installation
status and version. Results are cached for 60s. The board's
AdapterStatusPill and the `/api/cli-status` endpoint both use this.

## Model selection

Setra does **not** show model selection inside agent settings. Each CLI is
trusted to pick the best model for the task. The top-bar dropdown lets the
operator override the default model for the active CLI when they really need
to.

## Why no API-key adapters

The legacy direct-API adapters (raw Anthropic / OpenAI / Gemini API keys)
are kept behind `legacy_api_keys_enabled` on company settings. New companies
default to `false`. The reasoning: the CLIs are smarter (tool use,
parallel reads, project context) and the operator already authenticated them
when installing.

## Adding a new adapter

1. Implement the adapter under `packages/agent-runner/src/adapters/<id>.ts`
   exporting a function with the `AdapterDispatch` signature.
2. Register it in `packages/agent-runner/src/adapters/registry.ts`.
3. Add a probe entry in `cli-probe.ts` (binary name, version command, doc URL).
4. Add an option row in `apps/cli/src/commands/onboard.ts`.
5. Add tests in `packages/agent-runner/src/__tests__/`.
