#!/bin/bash
# HealthQ launcher. Double-click this file, or run: ./start.command
#
# Use THIS instead of `python3 -m http.server`.
# The stdlib server prints a BrokenPipeError traceback every time the browser
# cancels a download (a refresh, a tab close, a DevTools probe). That is
# cosmetic, not a fault, but it is alarming. tools/serve.py handles it.
cd "$(dirname "$0")" || exit 1

PORT="${1:-8000}"

# Refuse rather than silently fall back, so a stale server is never mistaken
# for a working one.
if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Close that window, or run: ./start.command $((PORT+1))"
  read -r -p "Press Enter to close."
  exit 1
fi

echo "HealthQ  ->  http://localhost:$PORT"
echo "Ctrl+C to stop."
echo
exec python3 tools/serve.py "$PORT"
