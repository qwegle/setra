<div align="center">

# Setra

**Run AI coding agents anywhere. Remember everything. Promote what works.**

Setra is an open-source operating layer for AI coding agents — a CEO
agent that hires specialists, governs their work, learns which skills
worked, and keeps you in the loop without slowing you down.

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-2563eb.svg)](LICENSE)
[![Offline ready](https://img.shields.io/badge/offline-ready-10b981)](#governance--offline)
[![Desktop](https://img.shields.io/badge/desktop-electron-7c3aed)](#install)
[![CI](https://img.shields.io/badge/tests-361%20passing-10b981)](#contributing)

[Quickstart](#quickstart) · [Why Setra](#why-setra) · [Adapters](#cli-adapters) · [Docs](docs/) · [Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md)

</div>

---

## Quickstart

```bash
# Easiest — one command, zero config
npx @setra/cli onboard

# Or clone the repo and run the full workspace
git clone https://github.com/qwegle/setra
cd setra
pnpm install
pnpm dev          # server :3141, board :5173
```

Open <http://localhost:5173>. The two-screen onboarding asks for a
company name and one connected CLI — that's it.

## CLI adapters

Setra runs your agents through the coding CLIs you already trust. No
provider API keys to manage; the CLI picks the best model for the task.

| Adapter | Status | Install |
| ------- | ------ | ------- |
| [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code) | Supported | `npm i -g @anthropic-ai/claude-code` |
| [Codex CLI](https://github.com/openai/codex) | Supported | `npm i -g @openai/codex` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Supported | `npm i -g @google/gemini-cli` |
| [Cursor CLI](https://docs.cursor.com/cli) | Supported | `curl https://cursor.com/install \| bash` |
| [OpenCode](https://github.com/sst/opencode) | Supported | `npm i -g opencode-ai` |

The top-bar **adapter pill** turns green when at least one CLI is
detected and the popover lists each adapter's connection state.

## Why Setra

Most AI agent platforms hand you raw model access and a chat box. Setra
gives you an operating model.

- **CEO + specialists.** A CEO agent hires the right specialist for each
  goal. Hires above sensitivity thresholds route to a human approver.
- **Adaptive skill promotion.** Successful task patterns are distilled
  into versioned reusable skills — the only agent platform that learns
  this way today.
- **Governance you can show your CISO.** Approval gates, per-tool
  policies, budget caps, full audit trail, SSE event stream.
- **Tenant-isolated by construction.** Every read and write is scoped to
  a company; cross-tenant access returns 404, not 403.
- **Offline-first.** Run fully air-gapped with local CLIs and SQLite.

## How it compares

| Capability | Paperclip | OpenSpace | DeepCode | **Setra** |
| ---------- | --------- | --------- | -------- | --------- |
| CEO + specialist hiring | Yes | No | No | **Yes** |
| Adaptive skill promotion | No | Yes | No | **Yes** |
| Governance / approval gates | Partial | No | No | **Yes** |
| Offline / air-gapped | No | No | No | **Yes** |
| CLI-only adapters (no API keys) | Yes | No | Partial | **Yes** |
| Multi-agent broker | No | No | No | **Yes** |
| Tenant isolation | Hosted only | No | No | **Yes** |
| Audit + SSE event stream | Partial | No | No | **Yes** |
| Open source | Hosted | Yes | Yes | **Yes** |

## Feature grid

<table>
<tr>
<td width="33%">

### Agents
- CEO agent + on-demand hiring
- Specialist roles: engineer, QA, security, GTM, research, more
- Multi-agent broker with role channels
- Continuous mode for long tasks
- Persistent tmux sessions

</td>
<td width="33%">

### Work
- Issues, kanban, wiki, PRs
- Goal -> issue tree decomposition
- Skill library with quality monitoring
- Built-in NewIssueDialog with markdown
- Recharts analytics dashboard

</td>
<td width="33%">

### Trust
- Approval gates for sensitive actions
- Budget caps and token tracking
- Per-tool policy controls
- Process sandbox per adapter run
- Full audit trail + SSE stream

</td>
</tr>
</table>

## Governance & offline

Setra is built for regulated and high-trust environments:

- **Approval gates.** Hires above sensitivity thresholds, destructive
  tools, and SSH/DB writes all gate on a human approver.
- **Budget caps.** Per-company spend ceilings with auto-stop and Resend
  alerting.
- **Air-gapped install.** No cloud dependency — drop in local CLIs and
  the SQLite-backed server runs anywhere Node 20 runs.
- **Audit-ready.** Every tool call, model response, and approval is
  recorded with the agent, run, and tenant scope.

See [`docs/security/`](docs/security) for hardening guidance and the
private-portal cloud setup in [`docs/enterprise-cloud-setup.md`](docs/enterprise-cloud-setup.md).

## Install

| Surface | Install | Notes |
| ------- | ------- | ----- |
| CLI / TUI | `npx @setra/cli onboard` | Single command, embeds server + opens UI |
| Web + server | `pnpm install && pnpm dev` | Full workspace from source |
| Desktop | Download from [Releases](https://github.com/qwegle/setra/releases) | macOS DMG, Windows EXE, Linux AppImage |

Requirements:

- Node.js 20+
- pnpm 9+
- At least one CLI adapter installed (see table above)

## Roadmap

- **Phase 0 (current)** Internal alpha — stable core workflows, skill promotion, continuous mode, approval gates.
- **Phase 1** Public OSS release — `npx @setra/cli onboard`, docs site, release automation.
- **Phase 2** SaaS collaboration — hosted auth, usage analytics, billing.
- **Phase 3** Enterprise scale — SSO, policy packs, marketplace.

Full plan in [ROADMAP.md](ROADMAP.md).

## Contributing

Setra is Apache 2.0. PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
pnpm install
pnpm test:ci
pnpm --filter @setra/server build
pnpm --filter @setra/board build
```

All PRs go through `dev` first. Use the PR template — it asks for
**Model Used**, **Thinking Path**, and **Test Plan**, which we treat as
first-class review artifacts.

## Security

Please do not file public issues for security problems. See
[SECURITY.md](SECURITY.md) — disclosure to `security@setra.sh` or a
private GitHub security advisory.

## License

[Apache 2.0](LICENSE). Built by Qwegle Technologies, Odisha, India.
