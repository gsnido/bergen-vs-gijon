#!/usr/bin/env bash
# Cron wrapper for update_climate.py: locking, logging, failure reporting.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bergen-vs-gijon}"
WEBROOT="${WEBROOT:-/var/www/html/bergen-vs-gijon}"
LOGDIR="${LOGDIR:-/var/log/bergen-vs-gijon}"

SCRIPT="$APP_DIR/update_climate.py"
LOGFILE="$LOGDIR/update.log"
LOCKFILE="$LOGDIR/update.lock"
export CLIMATE_DASH_OUTPUT="$WEBROOT/climate.json"

mkdir -p "$LOGDIR"

# Prevent overlapping runs
exec {lock_fd}>"$LOCKFILE"
if ! flock -n "$lock_fd"; then
  echo "$(date -Is)  SKIP another run already in progress" >> "$LOGFILE"
  exit 0
fi

echo "----" >> "$LOGFILE"
echo "$(date -Is)  START" >> "$LOGFILE"
rc=0
/usr/bin/python3 "$SCRIPT" >> "$LOGFILE" 2>&1 || rc=$?
if [ "$rc" -eq 0 ]; then
  echo "$(date -Is)  DONE" >> "$LOGFILE"
else
  echo "$(date -Is)  FAIL exit=$rc" >> "$LOGFILE"
  # stderr goes to cron, which mails it to MAILTO (if the host can send mail)
  echo "bergen-vs-gijon update failed (exit $rc). Last log lines:" >&2
  tail -n 5 "$LOGFILE" >&2
fi
exit "$rc"
