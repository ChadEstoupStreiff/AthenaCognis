#!/bin/bash
# Double-click launcher for AthenaCognis (Linux).
# Checks Docker, creates .env interactively if missing, pulls the latest
# version (git), rebuilds and starts the app
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
  echo "Opening the Docker install page in your browser..."
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "https://docs.docker.com/engine/install/" >/dev/null 2>&1 &
  else
    echo "Install it from: https://docs.docker.com/engine/install/"
  fi
  echo "Install Docker, then run this script again."
  pause_exit
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but not running (or you lack permission to use it)."
  echo "Start Docker and try again."
  pause_exit
fi

# --- 2. .env exists? if not, ask for the settings and write it ---------
# ask VAR "Question" "default": read an answer, empty = default.
ask() {
  local answer
  read -rp "$2 [$3]: " answer
  printf -v "$1" '%s' "${answer:-$3}"
}

# ask_port VAR "Question" default: same, but only accepts 1-65535.
ask_port() {
  while true; do
    ask "$1" "$2" "$3"
    case "${!1}" in
      ''|*[!0-9]*) ;;
      *) [ "${!1}" -ge 1 ] && [ "${!1}" -le 65535 ] && return ;;
    esac
    echo "  Please enter a port number between 1 and 65535."
  done
}

# ask_path VAR "Question" default: absolute path without spaces, ~ expanded.
ask_path() {
  while true; do
    ask "$1" "$2" "$3"
    printf -v "$1" '%s' "${!1/#\~/$HOME}"
    case "${!1}" in
      *' '*) echo "  Please pick a path without spaces." ;;
      /*) return ;;
      *) echo "  Please enter an absolute path (starting with /)." ;;
    esac
  done
}

if [ ! -f .env ]; then
  echo "No .env file found - let's create one."
  echo "Press Enter on any question to accept the default shown in [brackets]."
  echo

  ask PROJECT_NAME "Project name (letters, numbers, - or _)" "athenacognis"
  PROJECT_NAME="$(printf '%s' "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-')"
  [ -n "$PROJECT_NAME" ] || PROJECT_NAME="athenacognis"

  ask_path DATA_PATH "Folder to store your data - documents, database, AI models" "$HOME/AthenaCognisData"
  ask_path LOCAL_PATH "Folder the app may read (Activity page watches folders inside it)" "$HOME"

  ask_port FRONT_PORT "Web interface port" 8401
  ask_port BACK_PORT "Backend API port" 8400
  ask_port PMA_PORT "phpMyAdmin (database UI) port" 8402

  if command -v openssl >/dev/null 2>&1; then
    DEFAULT_DB_PASSWORD="$(openssl rand -hex 12)"
  else
    DEFAULT_DB_PASSWORD="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 24)"
  fi
  ask DATABASE_PASSWORD "Database password" "$DEFAULT_DB_PASSWORD"

  mkdir -p "$DATA_PATH"

  cat > .env <<EOF
# Created by the AthenaCognis launcher. Edit and re-run the launcher to apply.
# Docker Compose project name.
PROJECT_NAME=$PROJECT_NAME
# Docker Hub image tag (Docker Hub install only).
ATHENACOGNIS_VERSION=latest

# Host folder for all persistent data (database, models, caches, uploads). Back it up.
DATA_PATH=$DATA_PATH
# Host folder mounted read-only at /local; the Activity page watches folders inside it.
LOCAL_PATH=$LOCAL_PATH

# Host ports: web interface, backend API, phpMyAdmin.
FRONT_PORT=$FRONT_PORT
BACK_PORT=$BACK_PORT
PMA_PORT=$PMA_PORT

# MariaDB root password. Fixed when the database is first created:
# changing it later does not update an existing database.
DATABASE_PASSWORD=$DATABASE_PASSWORD
EOF

  echo
  echo ".env created. Database password: $DATABASE_PASSWORD (also saved in .env)"
  echo
fi

set -o allexport
source .env
set +o allexport

# --- 3. Update to the latest version ------------------------------------
# Fast-forward only: never merges or touches local edits. Offline = keep current version.
if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  echo "Checking for a new version..."
  if git pull --ff-only; then
    echo
  else
    echo "Could not download the new version (offline, or local changes)."
    echo "Starting the installed version."
    echo
  fi
fi

# --- 4. Launch detached --------------------------------------------------
echo "Starting AthenaCognis (first run can take a while while images download)..."
if ! docker compose -p "athenacognis_${PROJECT_NAME:-athenacognis}" up -d --build; then
  echo
  echo "docker compose failed to start the app. Check the errors above, and"
  echo "double-check your .env file (DATA_PATH, DATABASE_PASSWORD, ports)."
  pause_exit
fi

# --- 5. Confirm it actually came up --------------------------------------
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
  docker compose -p "athenacognis_${PROJECT_NAME:-athenacognis}" ps
  echo
  echo "Something is likely wrong - check your .env file (DATA_PATH, DATABASE_PASSWORD,"
  echo "or a port already in use), and see the logs with:"
  echo "  docker compose logs -f"
  pause_exit
fi

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
else
  echo "Open $URL in your browser."
fi

echo
echo "AthenaCognis is running at $URL"
echo "Closing this window will NOT stop the app - it keeps running in the background."
echo "To stop it later, double-click stop.sh (or run ./stop.sh)."
read -rp "Press Enter to close this window..." _
