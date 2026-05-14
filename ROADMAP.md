# setra.sh Roadmap

## Why this roadmap exists

setra is being built in stages to stay stable while moving from internal usage to public and enterprise adoption.

---

## Phase 0 — Internal Alpha (Current)

Goal: make internal workflows reliable end-to-end.

Shipped:

- [x] CLI, TUI, and Desktop baseline
- [x] Multi-agent broker + role routing
- [x] Token/cost monitoring
- [x] Offline mode foundations
- [x] Security workflows (Sentinel)
- [x] Wiki and kanban workflows
- [x] Company templates and skill system
- [x] Adaptive skill promotion with quality monitoring
- [x] Continuous mode for long-running tasks
- [x] Approval gates for sensitive actions (hire, destructive tools, SSH/DB writes)
- [x] Resend-powered email alerts
- [x] Electron desktop releases (macOS DMG, Windows EXE, Linux AppImage)
- [x] CLI-only adapters (Claude, Codex, Gemini, Cursor, OpenCode)
- [x] Soft-deprecation of legacy API keys
- [x] Two-screen Connect-a-CLI onboarding
- [x] Recharts analytics dashboard
- [x] Cream-light Beacons-style theme

Exit criteria:

- [x] Stable build across core packages (361 tests, both server + board builds green)
- [x] Critical tests passing
- [x] Clear operator docs

---

## Phase 1 — Public Open Source Release

Goal: make setra easy to install and use for external developers.

Scope:

- polished install path (`npx setra@latest`)
- release automation and versioning
- simplified docs and quickstart UX
- improved defaults for templates and skills
- production-quality examples

Exit criteria:

- smooth first-run setup
- public release process operational
- core workflows validated by early users

---

## Phase 2 — SaaS Collaboration Layer

Goal: enable hosted collaboration and team operations.

Scope:

- hosted auth and organization support
- usage analytics and billing
- hosted team coordination APIs
- cloud sync and collaboration features
- richer integrations and governance controls

Exit criteria:

- stable hosted core
- measurable team usage
- controlled cost and performance

---

## Phase 3 — Enterprise & Government Scale

Goal: deliver enterprise-grade trust, policy, and deployment controls.

Scope:

- SSO and advanced access policies
- stronger audit and compliance packs
- hardened deployment recipes for secure environments
- data residency and governance extensions
- curated agent/template marketplace

Exit criteria:

- enterprise security review readiness
- policy-compliant deployment patterns
- repeatable production rollouts

---

## Cross-phase priorities

- reliability over hype
- human-in-the-loop governance
- token efficiency and cost transparency
- offline-first design where possible
- practical, testable agent behavior
