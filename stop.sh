#!/bin/bash
# Re-run under bash if started with sh/dash (e.g. `sh start.sh`).
[ -z "$BASH_VERSION" ] && exec bash "$0" "$@"
# Stopper for AthenaCognis (Linux & macOS).
# Stops and removes the app containers. Your data (DATA_PATH) is kept.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DEFAULT_PROJECT_NAME="athenacognis"

pause_exit() {
  read -rp "Press Enter to close..." _
  exit "$1"
}

echo "=== AthenaCognis stopper ==="
echo

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Docker is not installed or not running - nothing to stop."
  pause_exit 1
fi

if [ -f .env ]; then
  set -o allexport
  source .env
  set +o allexport
fi
PROJECT="athenacognis_${PROJECT_NAME:-$DEFAULT_PROJECT_NAME}"
# Older launchers used this prefix: stop such a stack too.
LEGACY_PROJECT="superdiary_${PROJECT_NAME:-$DEFAULT_PROJECT_NAME}"
if [ -n "$(docker compose -p "$LEGACY_PROJECT" ps -q 2>/dev/null)" ]; then
  echo "Stopping the stack started by an older launcher ($LEGACY_PROJECT)..."
  docker compose -p "$LEGACY_PROJECT" down
fi

echo "Stopping AthenaCognis ($PROJECT)..."
if ! docker compose -p "$PROJECT" down; then
  echo
  echo "docker compose failed to stop the app. Check the errors above."
  pause_exit 1
fi

echo
echo "AthenaCognis is stopped. Your data is kept; start it again with the launcher."
pause_exit 0
