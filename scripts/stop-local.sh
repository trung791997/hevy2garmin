#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/.local"
PG_BIN="$(brew --prefix postgresql@17)/bin"

if [[ -f "$STATE/web.pid" ]]; then
  WEB_PID="$(cat "$STATE/web.pid")"
  # A stale PID must never stop an unrelated application.
  if [[ "$WEB_PID" =~ ^[0-9]+$ ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    WEB_CWD="$(lsof -a -p "$WEB_PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    case "$WEB_CWD" in
      "$ROOT/web"|"$ROOT/web/.next/standalone")
        kill "$WEB_PID"
        for _ in {1..50}; do
          if ! kill -0 "$WEB_PID" 2>/dev/null; then break; fi
          sleep 0.1
        done
        ;;
    esac
  fi
  rm -f "$STATE/web.pid"
fi
if "$PG_BIN/pg_ctl" -D "$STATE/postgres" status >/dev/null 2>&1; then
  "$PG_BIN/pg_ctl" -D "$STATE/postgres" -m fast -w stop
fi
echo "Local hevy2garmin stopped. Your data is preserved in .local/postgres."
