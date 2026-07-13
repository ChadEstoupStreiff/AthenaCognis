#!/bin/bash
set -e

# Builds the back/front images and pushes them to Docker Hub, tagged with
# the version from ./VERSION plus :latest. Bump ./VERSION before releasing.
#
# Requires: `docker login` already done for DOCKERHUB_NAMESPACE.

DOCKERHUB_NAMESPACE="chadesdev"
BACK_IMAGE="$DOCKERHUB_NAMESPACE/athenacognis-back"
FRONT_IMAGE="$DOCKERHUB_NAMESPACE/athenacognis-front"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VERSION_FILE="VERSION"
if [ ! -f "$VERSION_FILE" ]; then
  echo "VERSION file not found at $SCRIPT_DIR/$VERSION_FILE"
  exit 1
fi

VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
if [ -z "$VERSION" ]; then
  echo "VERSION file is empty"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running"
  exit 1
fi

echo "==> Building AthenaCognis v$VERSION"

docker build -t "$BACK_IMAGE:$VERSION" -t "$BACK_IMAGE:latest" ./back
docker build -t "$FRONT_IMAGE:$VERSION" -t "$FRONT_IMAGE:latest" ./front

echo "==> Pushing images to Docker Hub"

docker push "$BACK_IMAGE:$VERSION"
docker push "$BACK_IMAGE:latest"
docker push "$FRONT_IMAGE:$VERSION"
docker push "$FRONT_IMAGE:latest"

echo "==> Done. Published:"
echo "    $BACK_IMAGE:$VERSION"
echo "    $BACK_IMAGE:latest"
echo "    $FRONT_IMAGE:$VERSION"
echo "    $FRONT_IMAGE:latest"
