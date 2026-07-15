#!/bin/bash
# Double-click launcher for AthenaCognis (macOS).
# Checks Docker, creates .env interactively if missing, starts the app
# detached, and opens it in your browser once it's confirmed running.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

pause_exit() {
  read -rp "Press Enter to close..." _
  exit 1
}

echo "=== AthenaCognis launcher ==="
echo

# --- 1. Docker installed? ---------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker was not found on this system."
  echo "Opening the Docker Desktop download page in your browser..."
  open "https://www.docker.com/products/docker-desktop/" >/dev/null 2>&1 || \
    echo "Install it from: https://www.docker.com/products/docker-desktop/"
  echo "Install Docker Desktop, then run this script again."
  pause_exit
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but not running. Start Docker Desktop and try again."
  pause_exit
fi

# --- 2. .env exists? if not, ask for the important settings -----------
if [ ! -f .env ]; then
  echo "No .env file found - let's create one."
  echo "Press Enter on any question to accept the default shown in [brackets]."
  echo

  read -rp "Project name (letters, numbers, - or _) [athenacognis]: " PROJECT_NAME
  PROJECT_NAME="${PROJECT_NAME:-athenacognis}"
  PROJECT_NAME="$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-')"
  [ -n "$PROJECT_NAME" ] || PROJECT_NAME="athenacognis"

  read -rp "Your name (shown in the app) [${USER:-User}]: " USER_NAME
  USER_NAME="${USER_NAME:-${USER:-User}}"

  DEFAULT_DATA_PATH="$HOME/AthenaCognisData"
  read -rp "Folder to store your data - documents, database, AI models (avoid spaces) [$DEFAULT_DATA_PATH]: " DATA_PATH
  DATA_PATH="${DATA_PATH:-$DEFAULT_DATA_PATH}"

  read -rp "Backend port [8400]: " BACK_PORT
  BACK_PORT="${BACK_PORT:-8400}"

  read -rp "Frontend (web UI) port [8401]: " FRONT_PORT
  FRONT_PORT="${FRONT_PORT:-8401}"

  read -rp "phpMyAdmin port [8402]: " PMA_PORT
  PMA_PORT="${PMA_PORT:-8402}"

  if command -v openssl >/dev/null 2>&1; then
    DEFAULT_DB_PASSWORD="$(openssl rand -hex 12)"
  else
    DEFAULT_DB_PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 24)"
  fi
  read -rp "Database password [random: $DEFAULT_DB_PASSWORD]: " DATABASE_PASSWORD
  DATABASE_PASSWORD="${DATABASE_PASSWORD:-$DEFAULT_DB_PASSWORD}"

  read -rp "Password to protect the web UI (leave blank for none): " APP_PWD

  mkdir -p "$DATA_PATH"

  cat > .env <<EOF
PROJECT_NAME=$PROJECT_NAME
USER_NAME=$USER_NAME
ATHENACOGNIS_VERSION=latest

DATA_PATH=$DATA_PATH
BACK_PORT=$BACK_PORT
FRONT_PORT=$FRONT_PORT
PMA_PORT=$PMA_PORT

DATABASE_PASSWORD=$DATABASE_PASSWORD

# Optional: protect the web UI with a password (leave empty to disable)
APP_PWD=$APP_PWD
LOGIN_TIMEOUT=86400

# Telemetry (optional) - URL of the separately deployed telemetry service
TELEMETRY_SERVER_URL=https://telemetryathenacognis.chades.fr
TELEMETRY_DASHBOARD_URL=https://athenacognis.chades.fr
EOF

  echo
  echo ".env created. Database password: $DATABASE_PASSWORD (also saved in .env)"
  echo
fi

set -o allexport
source .env
set +o allexport

# --- 3. Launch detached --------------------------------------------------
echo "Starting AthenaCognis (first run can take a while while images download)..."
if ! docker compose -p "superdiary_${PROJECT_NAME:-athenacognis}" up -d --build; then
  echo
  echo "docker compose failed to start the app. Check the errors above, and"
  echo "double-check your .env file (DATA_PATH, DATABASE_PASSWORD, ports)."
  pause_exit
fi

# --- 4. Confirm it actually came up --------------------------------------
PORT="${FRONT_PORT:-8401}"
URL="http://localhost:$PORT"

echo "Waiting for AthenaCognis to come up at $URL ..."
READY=0
for _ in $(seq 1 60); do
  if command -v curl >/dev/null 2>&1 && curl -sf "$URL" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" != "1" ]; then
  echo
  echo "AthenaCognis did not come up at $URL in time. Current container status:"
  docker compose -p "superdiary_${PROJECT_NAME:-athenacognis}" ps
  echo
  echo "Something is likely wrong - check your .env file (DATA_PATH, DATABASE_PASSWORD,"
  echo "or a port already in use), and see the logs with:"
  echo "  docker compose logs -f"
  pause_exit
fi

open "$URL"

echo
echo "AthenaCognis is running at $URL"
echo "Closing this window will NOT stop the app - it keeps running in the background."
echo "To stop it later, run: docker compose down"
read -rp "Press Enter to close this window..." _
