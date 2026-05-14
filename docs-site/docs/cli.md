# CLI reference

The `setra` binary exposes both fire-and-forget commands (`setra run`,
`setra status`) and an Ink TUI (`setra tui`).

## Common commands

| Command          | Description                                  |
| ---------------- | -------------------------------------------- |
| `setra onboard`  | Interactive first-run setup (Connect-a-CLI). |
| `setra serve`    | Start the local daemon on a Unix socket.     |
| `setra status`   | Show running plots and active runs.          |
| `setra new`      | Create a new plot in the current repo.       |
| `setra run`      | Start an agent run in the active plot.       |
| `setra log`      | Tail a run's chunks live.                    |
| `setra kanban`   | Show the issue board (TUI).                  |
| `setra activity` | Recent activity feed.                        |
| `setra wiki`     | Browse the project wiki.                     |
| `setra company`  | Inspect company-level settings.              |
| `setra deploy`   | Deployment commands.                         |

## `setra onboard`

```bash
setra onboard            # interactive
setra onboard --yes      # auto-pick first detected CLI
setra onboard --open     # open the board in a browser after setup
setra onboard --port 4000  # custom port for the board
```

Writes `~/.setra/settings.json` with:

```json
{
  "preferredCli": "claude",
  "legacyApiKeysEnabled": false,
  "onboardedAt": "2024-..."
}
```

## Environment variables

| Variable                  | Purpose                                       |
| ------------------------- | --------------------------------------------- |
| `SETRA_HOME`              | Override `~/.setra`.                          |
| `SETRA_SANDBOX_ENFORCE`   | `off` (default) / `warn` / `strict`.          |
| `SETRA_EVAL_BASE_URL`     | Override the eval harness target.             |
| `SETRA_LOG_LEVEL`         | `error` / `warn` / `info` / `debug`.          |
