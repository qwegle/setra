# Security Policy

Setra is built for teams operating in regulated and enterprise environments.
We take security disclosures seriously.

## Supported versions

We patch the latest minor release on the `main` branch. Older minors are
patched on a best-effort basis for 90 days after release.

| Version | Supported          |
| ------- | ------------------ |
| latest  | Yes                |
| < latest minor | Best effort (90 days) |

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security problems.

Email: `security@setra.sh`

If you do not get an acknowledgement within 72 hours, open a private
security advisory through GitHub:
<https://github.com/qwegle/setra/security/advisories/new>

Include:

- a clear description of the issue
- the affected version(s) and component (server, board, CLI, desktop, agent runner)
- minimal reproduction steps or a proof-of-concept
- the impact you expect (data exposure, code execution, privilege bypass, etc.)

We will acknowledge receipt within 72 hours, share a remediation plan
within 7 days, and aim to ship a fix within 30 days for high-severity
issues.

## Scope

In scope:

- the `@setra/server` API and authentication
- the agent runner (adapter spawn, tool execution, sandboxing)
- governance, approval gates, and tenant isolation
- the desktop app and CLI

Out of scope:

- third-party CLI adapters (Claude, Codex, Gemini, Cursor, OpenCode) — report upstream
- denial of service via unreasonable load on a self-hosted instance
- best-practice recommendations that are not exploitable

## Coordinated disclosure

We follow a 90-day coordinated disclosure window. After a fix ships, the
advisory is published with credit to the reporter (unless they request
anonymity). If active exploitation is observed, we may shorten the window.

## Operational guidance

For hardening guidance see [`docs/security/`](docs/security) and the
governance section of the docs site.
