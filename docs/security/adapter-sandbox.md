# Adapter process sandbox

Setra wraps adapter CLI spawns (Codex, Claude, Gemini, Cursor, OpenCode) with
the host platform's process sandbox so that an adapter's tool calls can only
read/write inside the active project worktree.

## Platform support

| Platform | Sandbox        | Available     |
| -------- | -------------- | ------------- |
| Linux    | `bwrap`        | If installed  |
| macOS    | `sandbox-exec` | Built in      |
| Windows  | none           | No-op + warn  |

## Governance flag

The behaviour is controlled by `SETRA_SANDBOX_ENFORCE`:

| Value     | Meaning                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `off`     | Default. No wrapping. Adapters run with the full Setra-process privileges.   |
| `warn`    | Wrap whenever a host sandbox is available. Log a warning if it's not.        |
| `strict`  | Refuse to spawn an adapter if the host cannot sandbox.                       |

Example:

```bash
export SETRA_SANDBOX_ENFORCE=warn
pnpm dev
```

## What the sandbox allows

- **Read-only**: `/usr`, `/lib`, adapter config dirs (`~/.claude`, `~/.codex`,
  `~/.gemini`, `~/.cursor`, `~/.config/opencode`), `~/.setra/settings.json`.
- **Read-write**: the active project worktree only.
- **Network**: enabled by default (adapters need to reach model APIs). Pass
  `allowNetwork: false` to deny.

## Hardening on Linux

Install bubblewrap:

```bash
sudo apt-get install bubblewrap   # Debian/Ubuntu
sudo dnf install bubblewrap       # Fedora
```

Then export the enforce flag:

```bash
export SETRA_SANDBOX_ENFORCE=strict
```

A `strict`-mode start on a host without `bwrap` (or `sandbox-exec` on macOS)
will refuse to spawn the adapter rather than running it without isolation.

## Verifying the wrap

Add `SETRA_LOG_LEVEL=debug` and run a task. The log line `wrapWithSandbox`
shows the resolved command + args. The `wrapped` field will be `true` when
the sandbox is in effect.
