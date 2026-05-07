# setra.sh

> Multi-agent AI workbench for teams that need speed, control, and offline capability.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Offline Ready](https://img.shields.io/badge/offline-ready-green)](#government-of-india--enterprise-fit)
[![Desktop](https://img.shields.io/badge/desktop-electron-purple)](#platform-support)

## 1. Quick start

### Prerequisites

- Node.js 20+
- pnpm 9+
- git
- Bun is optional for local workflows, but not required

### Quick Start

```bash
git clone https://github.com/qwegle/setra
cd setra
cp .env.example .env
pnpm install
pnpm dev          # → server on :3141, board on :5173
```

Use [.env.example](./.env.example) as the source of truth for available
configuration. Set at least one provider key in `.env` or add it later in
**Settings** after startup.

Open http://localhost:5173 — the **onboarding wizard** opens
automatically the first time. Create a company, add an API key in
**Settings**, hire an agent, and start a run.

Other modes:

| Command               | What runs                                  |
| --------------------- | ------------------------------------------ |
| `pnpm dev`            | Server + web board (recommended for daily) |
| `pnpm dev:desktop`    | Electron desktop app + dev tooling         |
| `pnpm dev:everything` | Everything in parallel (Turbo)             |
| `pnpm verify`         | typecheck + tests + lint (used by CI)      |
| `pnpm test:ci`        | All tests, no watcher                      |
| `pnpm build`          | Production build of every package + app    |

### API keys & smart routing

Setra resolves the cheapest *connected* model automatically. Set any
**one** key to get started:

```bash
# In the UI: Settings → API keys
#   OR via env at startup:
export OPENROUTER_API_KEY=...   # cheapest path (free models available)
export GROQ_API_KEY=...
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
export GEMINI_API_KEY=...
```

When you save a key, agents that were waiting for one **auto-activate**
(no restart needed). Saving a key while at budget cap also lifts the
hard-stop.

### The Assistant

A built-in agent named **Assistant** (chat panel, top-right) can take
real actions for you via tool calls: set keys, hire agents, run agents,
query the budget. Just type what you want.

## Platform support

- **Desktop app (Electron):** macOS, Windows, Linux
- **CLI/TUI:** macOS, Linux, Windows (WSL recommended for tmux-based workflows)

Current repo already uses Electron + electron-builder, so this is **not Mac-only**.

---

## 2. What is setra?

setra is an open-source operating layer for AI agents:

- Run single or multi-agent workflows
- Keep long tasks alive in persistent tmux sessions
- Track token/cost usage in real time
- Work online (cloud models) or fully offline (local models)
- Use company-style teams (architect, engineer, QA, GTM, security, etc.)

Brand direction: **setra.sh** is built to feel practical, reliable, and human-led.

---

## 3. Vision

Build the default execution platform for AI-native teams in India and globally:

1. Internal automation first (high trust, high control)
2. Public open-source adoption
3. SaaS collaboration layer
4. Enterprise/government-grade deployments at scale

---

## 4. Problem we are solving

Most AI agent setups fail in production because they are:

- stateless (lose context on disconnect)
- expensive (waste tokens on repeated context)
- hard to govern (weak audit, weak budget controls)
- cloud-locked (not usable in offline/on-prem environments)

setra solves this with persistent runs, context discipline, budget controls, and offline-first architecture.

---

## 5. Roadmap and future plan

See full phased roadmap in **[ROADMAP.md](./ROADMAP.md)**.

At a high level:

- **Phase 0 (current):** Internal alpha, local-first, core workflow stabilization
- **Phase 1:** Public OSS release (`npx setra@latest`, docs, release pipeline)
- **Phase 2:** SaaS layer (team auth, usage analytics, billing, hosted APIs)
- **Phase 3:** Enterprise scale (SSO, policy packs, marketplace, advanced governance)

---

## 6. How it works

Core execution flow:

1. User creates a task (CLI, TUI, or Desktop)
2. setra launches agent session in tmux (persistent)
3. Agents coordinate through broker channels
4. Tool output and messages are stored in SQLite
5. Cost/token usage is parsed and monitored continuously
6. Human can interrupt, approve, redirect, or resume anytime

Key architecture choices:

- **Persistent sessions:** survives app close/network drop
- **Prompt caching strategy:** reuses stable context
- **Context graph approach:** agents receive scoped context, not raw transcript dump
- **Role-aware model routing:** expensive models only where needed
- **Offline mode:** local Ollama/SLM workflows with governance controls

---

## 7. Differentiation (USPs)

- Multi-agent orchestration with real roles and channels
- Offline-first + air-gapped deployment capability
- Human approval model for sensitive actions
- SSH and database grounds with safety constraints
- Security scanning agent stack with extensible tooling
- Cost governance (budget caps, usage visibility, daily controls)
- Wiki + Kanban + PR workflows integrated into agent operations

---

## 8. Agent system

setra supports both built-in and company-defined agents.

Common roles:

- Architect / Tech Lead
- Full-stack / Frontend / Backend Engineer
- QA / Reviewer / Documentation
- GTM / Sales / CRM Ops
- Research lead and analysts
- Governance/compliance roles

New specialist capability tracks added:

- **Game Engineer**
- **AI Model Creator**
- **Web3 / Blockchain Developer**
- **Smart Contract Auditor**
- **Mobile App Developer (Expo / React Native first)**

### Mobile note

setra agents are strongest today on **Expo + React Native hybrid development**.
Native Kotlin/Swift support exists, but output quality and iteration speed can be lower until native-specialized training layers are expanded.

---

## 9. Security agent (Sentinel)

Sentinel is setra’s cybersecurity agent layer for:

- attack surface discovery
- web and network scanning workflows
- vulnerability triage and reporting
- tool-assisted checks (e.g., nmap-style and web security workflows)

Design principles:

- typed output before LLM reasoning
- explicit confirmation for install/destructive actions
- strong guardrails around remote and privileged operations
- auditable findings and workflow traces

---

## 10. Government of India & Enterprise fit

setra is designed for high-governance environments:

- **Air-gapped deployments** (no cloud dependency required)
- **Data residency and control** (local infra first)
- **Role and approval workflows** for operational safety
- **Audit trail ready** for compliance and review
- **Cost visibility** for budgeting and policy enforcement

This makes setra suitable for:

- Indian government departments and public-sector programs
- regulated enterprises (BFSI, healthcare, infrastructure, defense-adjacent)
- internal secure AI execution environments

---

## 11. Enterprise cloud-only web version (private SaaS)

Use this when you want **web + cloud providers only** (no local LLM dependency).

Deploy:

```bash
bash scripts/deploy-enterprise-cloud.sh infra/.env.enterprise
```

Full setup guide:

- `docs/enterprise-cloud-setup.md`

Private enterprise controls:

- `SETRA_PRIVATE_PORTAL=true`
- `SETRA_PORTAL_ACCESS_KEY=<secret>`
- web portal at `/app` requires `x-setra-access-key` header when private mode is enabled

Access control:

- optional instance-wide API protection via `SETRA_INSTANCE_TOKEN`
- provider keys can be supplied through environment variables or per-company settings
- `/` shows the GitHub link, install/download paths, and portal entry points

---

## 12. Active agent tracks in this repo

Current active built-in specialization tracks include:

- Core engineering and QA
- Security audit and Sentinel security workflows
- Game engineering
- Model creator + model evaluation
- Web3 developer + smart contract audit
- Mobile app development (Expo/React Native first)

Current active company templates include:

- starter, founding-team, gtm-sales, code-review, governance-onprem, support-team, research
- game-studio, model-lab, web3-protocol, mobile-expo

---

## 13. Quick commands

```bash
setra init
setra run --task "Implement feature X"
setra company templates
setra company run --name my-team --task "Review current PR"
setra pr review 42
setra connect db --driver postgres --host localhost --database appdb --user app
```

---

## 14. Contributing

Apache 2.0. PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the fork / branch / PR workflow, local setup, and code style expectations.

```bash
pnpm install
pnpm build
pnpm test
```

Built by Qwegle Technologies, Odisha, India.
