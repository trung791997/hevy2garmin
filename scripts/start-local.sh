#!/bin/bash
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/.local"
PG_BIN="$(brew --prefix postgresql@17)/bin"

if [[ ! -f "$ROOT/web/.env.local" || ! -f "$STATE/postgres/PG_VERSION" ]]; then
  echo "Local configuration is missing. See LOCAL_SETUP.md."
  exit 1
fi
if lsof -nP -iTCP:8096 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 8096 is already in use. Open http://localhost:8096 or stop that server first."
  exit 1
fi
if ! "$PG_BIN/pg_ctl" -D "$STATE/postgres" status >/dev/null 2>&1; then
  "$PG_BIN/pg_ctl" -D "$STATE/postgres" -l "$STATE/postgres.log" -w start
fi
cd "$ROOT/web"
export NEXT_TELEMETRY_DISABLED=1
npm run build
cp -R .next/static .next/standalone/.next/
if [[ -d public ]]; then cp -R public .next/standalone/; fi
echo "Open http://localhost:8096/setup"
echo "Your dashboard password is in $STATE/dashboard-login.txt"
export HOSTNAME=127.0.0.1 PORT=8096
# A separate session keeps the dashboard alive when this terminal closes.
python3 - "$ROOT" <<'PY'
from pathlib import Path
import os
import subprocess
import sys

root = Path(sys.argv[1])
with (root / '.local/web.log').open('a') as log:
    process = subprocess.Popen(
        ['node', '--env-file=.env.local', '.next/standalone/server.js'],
        cwd=root / 'web', env=os.environ.copy(),
        stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
        start_new_session=True,
    )
(root / '.local/web.pid').write_text(str(process.pid) + '\n')
PY
for _ in {1..30}; do
  if ! kill -0 "$(cat "$STATE/web.pid")" 2>/dev/null; then
    echo "Dashboard exited. Check $STATE/web.log"
    exit 1
  fi
  if curl --silent --fail --max-time 1 http://127.0.0.1:8096/login >/dev/null; then
    echo "Dashboard is running in the background. Logs: $STATE/web.log"
    echo "Stop it with ./scripts/stop-local.sh"
    exit 0
  fi
  sleep 0.2
done
echo "Dashboard did not become ready. Check $STATE/web.log"
exit 1
