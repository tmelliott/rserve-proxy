#!/usr/bin/env bash
# Build the rserve-base Docker image.
# Usage: ./build.sh [R_VERSION]
# Default R_VERSION: latest

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
R_VERSION="${1:-latest}"
IMAGE_TAG="rserve-base:${R_VERSION}"

echo "Building ${IMAGE_TAG} from ${SCRIPT_DIR}/Dockerfile ..."
docker build \
  --build-arg "R_VERSION=${R_VERSION}" \
  --tag "${IMAGE_TAG}" \
  "${SCRIPT_DIR}"

echo "✓ Built ${IMAGE_TAG}"
echo "  Verify: docker run --rm -p 6311:6311 ${IMAGE_TAG}"
