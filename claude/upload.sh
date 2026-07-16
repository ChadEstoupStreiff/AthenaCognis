#!/usr/bin/env bash
set -euo pipefail

# Base URL of the calendar API. Override with API_BASE=... if needed.
API_BASE="${API_BASE:-http://localhost:400}"
PROJECT="✴️ Claude"
DEFAULT_TIME_SPENT="7.5" # 7h30

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for file in "$SCRIPT_DIR"/*.md; do
    [ -e "$file" ] || continue

    date="$(basename "$file" .md)"

    if ! [[ "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        echo "Skipping $file: filename is not a YYYY-MM-DD date" >&2
        continue
    fi

    title="$(head -n 1 "$file")"
    description="$(cat "$file")"

    existing_count=$(curl -sG "$API_BASE/calendar/search" \
        --data-urlencode "query=" \
        --data-urlencode "start_date=$date" \
        --data-urlencode "end_date=$date" \
        --data-urlencode "project=$PROJECT" \
        | jq 'if type == "array" then length else ((.records // .results // .data // []) | length) end')

    if [ "$existing_count" -gt 0 ]; then
        echo "[$date] record already exists for project \"$PROJECT\", skipping."
        continue
    fi

    echo "[$date] uploading record..."
    http_code=$(curl -sG -X POST "$API_BASE/calendar/record" \
        --data-urlencode "project=$PROJECT" \
        --data-urlencode "date=$date" \
        --data-urlencode "time_spent=$DEFAULT_TIME_SPENT" \
        --data-urlencode "title=$title" \
        --data-urlencode "description=$description" \
        --data-urlencode "start_time=" \
        --data-urlencode "location=" \
        --data-urlencode "attendees=" \
        --data-urlencode "contacts=" \
        -o /dev/null -w "%{http_code}")

    echo "[$date] -> HTTP $http_code"
done
