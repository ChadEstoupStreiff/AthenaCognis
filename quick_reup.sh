#!/usr/bin/env bash
# Rebuild and recreate only the given services, without touching the others.
#
# Usage: ./quick_reup.sh [--dev] [service...]
#   service   back, front, ... (default: back front)
#   --dev     use docker-compose.dev.yml: back runs from ./back/src,
#             so back is restarted instead of rebuilt.
#
# Examples:
#   ./quick_reup.sh              rebuild back + front
#   ./quick_reup.sh front        rebuild front only
#   ./quick_reup.sh --dev back   restart back on local source (no build)
set -euo pipefail

cd "$(dirname "$0")"

DEV_MODE=false
SERVICES=()
for arg in "$@"; do
  case "$arg" in
    --dev) DEV_MODE=true ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option: $arg" >&2; exit 1 ;;
    *) SERVICES+=("$arg") ;;
  esac
done
[ ${#SERVICES[@]} -eq 0 ] && SERVICES=(back front)

COMPOSE=(docker compose -f docker-compose.yml)
$DEV_MODE && COMPOSE+=(-f docker-compose.dev.yml)

BUILD_SERVICES=()
for service in "${SERVICES[@]}"; do
  if $DEV_MODE && [ "$service" = back ]; then
    echo "→ back: dev mode, restart on local source"
    "${COMPOSE[@]}" up -d --no-deps back
    "${COMPOSE[@]}" restart back
  else
    BUILD_SERVICES+=("$service")
  fi
done

if [ ${#BUILD_SERVICES[@]} -gt 0 ]; then
  echo "→ rebuild + recreate: ${BUILD_SERVICES[*]}"
  "${COMPOSE[@]}" up -d --build --no-deps "${BUILD_SERVICES[@]}"
fi

"${COMPOSE[@]}" ps "${SERVICES[@]}"
