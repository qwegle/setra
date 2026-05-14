# Quickstart

## 1. Install a coding CLI

Setra runs against an existing CLI. Install one if you don't already have one:

```bash
npm i -g @anthropic-ai/claude-code      # Claude Code
npm i -g @openai/codex                  # Codex CLI
npm i -g @google/gemini-cli             # Gemini CLI
curl -fsSL https://opencode.ai/install | bash   # OpenCode
# Cursor Agent ships with the Cursor desktop app: https://cursor.com
```

## 2. Install Setra

```bash
npm i -g @setra/cli
```

## 3. Onboard

```bash
setra onboard
```

The interactive flow detects which CLIs you have installed, asks you to pick
one, and writes `~/.setra/settings.json`. No API keys are collected.

## 4. Start the daemon

```bash
setra serve --port 3141
```

Open `http://localhost:3141` to see the board.

## 5. First run

```bash
setra new "Refactor the user model"
setra run
```

Or from the board: create a Goal, click "Decompose", and watch the issue tree
fill in.
