#!/bin/sh
# Write /config.json for the SPA from the container environment (values come from the shared .env).
set -eu

escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

cat > /usr/share/nginx/html/config.json <<JSON
{
  "userName": "$(escape "${USER_NAME:-}")",
  "telemetryServerUrl": "$(escape "${TELEMETRY_SERVER_URL:-}")",
  "telemetryDashboardUrl": "$(escape "${TELEMETRY_DASHBOARD_URL:-}")"
}
JSON
