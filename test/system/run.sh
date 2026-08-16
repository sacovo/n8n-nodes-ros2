#!/usr/bin/env bash
# Brings up the ROS 2 fixture + rosbridge container, runs the system tests
# against it, then tears it down again.
#
#   ./test/system/run.sh              build if needed, run everything
#   ./test/system/run.sh -t 'Action'  pass extra args through to jest
#   KEEP_UP=1 ./test/system/run.sh    leave the container running afterwards
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE=(docker compose -f "${SCRIPT_DIR}/docker-compose.yml")

cleanup() {
  if [[ "${KEEP_UP:-0}" == "1" ]]; then
    echo "KEEP_UP=1, leaving the fixture container running" >&2
    return
  fi
  echo "Tearing down the ROS fixture..." >&2
  "${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Starting the ROS fixture (first run builds the image, this takes a while)..." >&2
"${COMPOSE[@]}" up --build --detach --wait

echo "Fixture is up; waiting for the ROS graph to settle..." >&2
# rosbridge accepts connections before rosapi has finished discovering the
# fixture's topics/services/actions, so give discovery a moment.
sleep 5

cd "${REPO_ROOT}"
# roslib 2.x is ESM-only and the services reach it through a dynamic import;
# jest needs VM modules for that callback to work inside its CJS sandbox.
NODE_OPTIONS="${NODE_OPTIONS:-} --experimental-vm-modules" \
  npx jest --config jest.system.config.js "$@"
