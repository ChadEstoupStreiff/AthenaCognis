#!/bin/bash

# Load .env variables
set -o allexport
source .env
set +o allexport

# Check if PROJECT_NAME is set
if [ -z "$PROJECT_NAME" ]; then
  echo "PROJECT_NAME is not set in .env"
  exit 1
fi

# Run docker compose with APP_NAME as project name
docker compose -p "superdiary_$PROJECT_NAME" down