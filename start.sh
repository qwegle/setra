#!/bin/bash
# setra dev — start all services with auto-restart supervisor
SETRA_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 Starting setra..."

# Kill any existing instances
SERVER_PID=$(lsof -ti:3141 2>/dev/null); [ -n "$SERVER_PID" ] && kill $SERVER_PID 2>/dev/null
BOARD_PID=$(lsof -ti:5173 2>/dev/null);  [ -n "$BOARD_PID"  ] && kill $BOARD_PID  2>/dev/null
sleep 1

# ── Fix better-sqlite3 ABI conflict ──────────────────────────────────────────
# better-sqlite3 must be compiled for the runtime that uses it:
#   Server (Node.js): ABI 115 (Node.js v20)
#   Electron desktop: ABI 130 (Electron 33)
#
# Strategy: keep ABI 130 (Electron) in build/Release/ as the main binary,
# and ABI 115 (Node.js) in build/Release/*.nodejs as backup.
# The server uses server-preload.cjs to redirect dlopen to the .nodejs backup.
echo "  🔧 Rebuilding better-sqlite3 for Electron..."
(cd "$SETRA_DIR" && node apps/desktop/scripts/electron-rebuild.js >> /tmp/setra-rebuild.log 2>&1) && \
  echo "  ✅ Electron native rebuild done" || \
  echo "  ⚠️  Electron native rebuild failed (check /tmp/setra-rebuild.log)"

# ── Server supervisor (auto-restarts on crash) ────────────────────────────────
# Server uses server-preload.cjs to load ABI 115 backup via dlopen redirect
(while true; do
  cd "$SETRA_DIR"
  pnpm --filter @setra/server dev >> /tmp/setra-server.log 2>&1
  echo "[supervisor] server crashed, restarting in 2s..." >> /tmp/setra-server.log
  sleep 2
done) &
disown $!
echo "  ✅ Server supervisor started (port 3141)"
sleep 5

# ── Board (Vite dev server) ───────────────────────────────────────────────────
(while true; do
  cd "$SETRA_DIR/apps/board"
  npx vite --port 5173 >> /tmp/setra-board.log 2>&1
  echo "[supervisor] board crashed, restarting in 2s..." >> /tmp/setra-board.log
  sleep 2
done) &
disown $!
echo "  ✅ Board supervisor started (port 5173)"
sleep 7

# ── Electron ─────────────────────────────────────────────────────────────────
cd "$SETRA_DIR/apps/desktop"
nohup npx electron-vite dev >> /tmp/electron.log 2>&1 &
disown $!
echo "  ✅ Electron launched"

echo ""
echo "✨ setra is running! Logs:"
echo "   tail -f /tmp/setra-server.log"
echo "   tail -f /tmp/setra-board.log"
echo "   tail -f /tmp/electron.log"
