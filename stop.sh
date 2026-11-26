#!/bin/bash
# Double-click stopper for AthenaCognis (Linux).
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
PROJECT="superdiary_${PROJECT_NAME:-$DEFAULT_PROJECT_NAME}"

echo "Stopping AthenaCognis ($PROJECT)..."
if ! docker compose -p "$PROJECT" down; then
  echo
  echo "docker compose failed to stop the app. Check the errors above."
  pause_exit 1
fi

echo
echo "AthenaCognis is stopped. Your data is kept; start it again with the launcher."
pause_exit 0
