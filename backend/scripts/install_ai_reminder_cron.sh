#!/usr/bin/env bash
# Install the YourComate Saya reminder worker as a per-user cron job.
#
# NEW FILE
# Project path:
#   backend/scripts/install_ai_reminder_cron.sh
#
# Normal install (run from the backend folder or anywhere inside the project):
#   bash scripts/install_ai_reminder_cron.sh
#
# Useful commands:
#   bash scripts/install_ai_reminder_cron.sh --show
#   bash scripts/install_ai_reminder_cron.sh --remove
#   bash scripts/install_ai_reminder_cron.sh --no-test
#
# The installer:
# - resolves the backend directory from this script's own location;
# - finds venv/.venv Python when present, otherwise python3/python;
# - runs File 11 once with --dry-run before installation;
# - installs exactly one marked cron entry for the current Linux user;
# - runs every minute;
# - uses flock when available to avoid overlapping processes;
# - writes logs to backend/logs/saya_reminders.log;
# - never stores MongoDB/API credentials in cron.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
RUNNER="${BACKEND_DIR}/scripts/send_ai_reminders.py"
LOG_DIR="${BACKEND_DIR}/logs"
LOG_FILE="${LOG_DIR}/saya_reminders.log"
LOCK_FILE="${BACKEND_DIR}/.saya_ai_reminders.lock"

CRON_MARKER_BEGIN="# BEGIN YOURCOMATE_SAYA_AI_REMINDERS"
CRON_MARKER_END="# END YOURCOMATE_SAYA_AI_REMINDERS"
CRON_SCHEDULE="${SAYA_REMINDER_CRON_SCHEDULE:-* * * * *}"

ACTION="install"
RUN_TEST=1

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/install_ai_reminder_cron.sh [option]

Options:
  --show       Show the currently installed Saya reminder cron block.
  --remove     Remove the Saya reminder cron block for the current user.
  --no-test    Install without running File 11 with --dry-run first.
  -h, --help   Show this help.

Environment override:
  SAYA_REMINDER_CRON_SCHEDULE="* * * * *"

Default schedule: every minute.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --show)
      ACTION="show"
      ;;
    --remove)
      ACTION="remove"
      ;;
    --no-test)
      RUN_TEST=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v crontab >/dev/null 2>&1; then
  echo "Error: crontab is not installed on this server." >&2
  echo "Install cron first (Ubuntu/Debian: sudo apt-get install cron)." >&2
  exit 1
fi

current_crontab() {
  crontab -l 2>/dev/null || true
}

strip_existing_block() {
  awk -v begin="$CRON_MARKER_BEGIN" -v end="$CRON_MARKER_END" '
    $0 == begin { inside=1; next }
    $0 == end   { inside=0; next }
    !inside     { print }
  '
}

show_block() {
  local existing
  existing="$(current_crontab)"

  if ! printf '%s\n' "$existing" | grep -Fq "$CRON_MARKER_BEGIN"; then
    echo "Saya reminder cron is not installed for user: $(id -un)"
    return 0
  fi

  printf '%s\n' "$existing" | awk -v begin="$CRON_MARKER_BEGIN" -v end="$CRON_MARKER_END" '
    $0 == begin { inside=1 }
    inside      { print }
    $0 == end   { inside=0 }
  '
}

if [[ "$ACTION" == "show" ]]; then
  show_block
  exit 0
fi

if [[ "$ACTION" == "remove" ]]; then
  existing="$(current_crontab)"

  if ! printf '%s\n' "$existing" | grep -Fq "$CRON_MARKER_BEGIN"; then
    echo "Saya reminder cron is already absent for user: $(id -un)"
    exit 0
  fi

  cleaned="$(printf '%s\n' "$existing" | strip_existing_block)"
  printf '%s\n' "$cleaned" | crontab -
  echo "Removed Saya reminder cron for user: $(id -un)"
  exit 0
fi

if [[ ! -f "$RUNNER" ]]; then
  echo "Error: File 11 was not found:" >&2
  echo "  $RUNNER" >&2
  echo "Add backend/scripts/send_ai_reminders.py before installing cron." >&2
  exit 1
fi

find_python() {
  local candidate

  for candidate in \
    "${BACKEND_DIR}/venv/bin/python" \
    "${BACKEND_DIR}/.venv/bin/python" \
    "${BACKEND_DIR}/env/bin/python"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return 0
  fi

  if command -v python >/dev/null 2>&1; then
    command -v python
    return 0
  fi

  return 1
}

PYTHON_BIN="$(find_python || true)"

if [[ -z "$PYTHON_BIN" ]]; then
  echo "Error: no Python executable was found for the backend." >&2
  exit 1
fi

mkdir -p "$LOG_DIR"

echo "Saya reminder cron installer"
echo "-----------------------------"
echo "Linux user      : $(id -un)"
echo "Backend         : $BACKEND_DIR"
echo "Python          : $PYTHON_BIN"
echo "Runner          : $RUNNER"
echo "Schedule        : $CRON_SCHEDULE"
echo "Log             : $LOG_FILE"

if [[ "$RUN_TEST" -eq 1 ]]; then
  echo ""
  echo "Running reminder worker dry-run before installation..."
  (
    cd "$BACKEND_DIR"
    "$PYTHON_BIN" "$RUNNER" --dry-run --limit 10
  )
  echo "Dry-run completed successfully."
fi

# Quote each shell path for cron. Project paths normally contain no single
# quotes in production; fail explicitly rather than constructing unsafe shell.
for value in "$BACKEND_DIR" "$PYTHON_BIN" "$RUNNER" "$LOG_FILE" "$LOCK_FILE"; do
  if [[ "$value" == *"'"* ]]; then
    echo "Error: project paths containing a single quote are not supported by this installer." >&2
    exit 1
  fi
done

if command -v flock >/dev/null 2>&1; then
  CRON_COMMAND="cd '$BACKEND_DIR' && flock -n '$LOCK_FILE' '$PYTHON_BIN' '$RUNNER' >> '$LOG_FILE' 2>&1"
else
  # File 10 still uses atomic MongoDB claims, so duplicate delivery remains
  # protected even on systems where the optional flock utility is unavailable.
  CRON_COMMAND="cd '$BACKEND_DIR' && '$PYTHON_BIN' '$RUNNER' >> '$LOG_FILE' 2>&1"
fi

CRON_LINE="$CRON_SCHEDULE $CRON_COMMAND"
existing="$(current_crontab)"
cleaned="$(printf '%s\n' "$existing" | strip_existing_block)"

{
  printf '%s\n' "$cleaned"
  printf '%s\n' "$CRON_MARKER_BEGIN"
  printf '%s\n' "$CRON_LINE"
  printf '%s\n' "$CRON_MARKER_END"
} | awk 'NF || previous_nonblank { print } { previous_nonblank = NF }' | crontab -

echo ""
echo "Installed successfully."
echo ""
show_block

echo ""
echo "Verification commands:"
echo "  crontab -l"
echo "  tail -f '$LOG_FILE'"
echo ""
echo "Saya timed reminders are now scheduled to be checked every minute."
