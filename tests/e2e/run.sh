#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 The Theo Authors
#
# One-command end-to-end harness for the theo-cloud <-> TheMemory integration.
# Builds the host binaries + the themory image, boots the full stack (pgvector +
# postgres + hermetic mock-openai + themory + theo-cloud), runs the Go e2e test
# against the REAL endpoints, then tears everything down.
#
# Usage (from the theo-cloud repo root):
#   make e2e                 # build + up + test + down
#   KEEP_UP=1 make e2e       # leave the stack running for debugging
#   make e2e-down            # tear a left-up stack down
#
# Overridable env:
#   THEMORY_DIR    path to the sibling theo-memory repo (default: ../../theo-data/theo-memory)
#   THEMORY_IMAGE  pre-built themory image to use instead of building one
#   KEEP_UP=1      do not tear the stack down after the test (debug)
set -euo pipefail

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${E2E_DIR}/../.." && pwd)"
COMPOSE_FILE="${E2E_DIR}/docker-compose.e2e.yaml"
BIN_DIR="${E2E_DIR}/bin"

THEMORY_DIR="${THEMORY_DIR:-${ROOT}/../../theo-data/theo-memory}"
THEMORY_MASTER_KEY="${THEMORY_MASTER_KEY:-e2e-master-key}"
export THEMORY_MASTER_KEY

# Host-mapped ports (kept in sync with docker-compose.e2e.yaml defaults).
E2E_CLOUD_PORT="${E2E_CLOUD_PORT:-13002}"
E2E_THEMORY_PORT="${E2E_THEMORY_PORT:-18080}"
E2E_PG_CLOUD_PORT="${E2E_PG_CLOUD_PORT:-55432}"
E2E_PG_THEMORY_PORT="${E2E_PG_THEMORY_PORT:-55434}"
export E2E_THEMORY_PORT E2E_PG_CLOUD_PORT E2E_PG_THEMORY_PORT

log()  { printf '\033[1;36m[e2e]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[e2e] FAIL:\033[0m %s\n' "$*" >&2; }

compose() { docker compose -p theo-cloud-memory-e2e -f "${COMPOSE_FILE}" "$@"; }

teardown() {
  if [[ "${KEEP_UP:-0}" == "1" ]]; then
    log "KEEP_UP=1 — leaving the stack running. Tear down with: make e2e-down"
    return
  fi
  log "tearing down…"
  compose down -v --remove-orphans >/dev/null 2>&1 || true
}

dump_logs() {
  fail "harness failed — recent service logs:"
  compose ps || true
  compose logs --tail=80 themory theo-cloud mock-openai || true
}

# --- preflight ---------------------------------------------------------------
command -v docker >/dev/null || { fail "docker not found"; exit 1; }
command -v go >/dev/null || { fail "go not found"; exit 1; }
[[ -f "${THEMORY_DIR}/Dockerfile" ]] || {
  fail "TheMemory repo not found at THEMORY_DIR=${THEMORY_DIR} (set THEMORY_DIR=/path/to/theo-memory)"
  exit 1
}

trap teardown EXIT

# --- 1. build host binaries (static, copied into the runtime image) ----------
log "building host binaries (theo-cloud + mock-openai)…"
mkdir -p "${BIN_DIR}"
( cd "${ROOT}" && CGO_ENABLED=0 GOOS=linux go build -o "${BIN_DIR}/theo-cloud" ./cmd )
( cd "${ROOT}" && CGO_ENABLED=0 GOOS=linux go build -o "${BIN_DIR}/mock-openai" ./tests/e2e/mock-openai )

# --- 2. build the themory image from the sibling repo ------------------------
if [[ -n "${THEMORY_IMAGE:-}" ]]; then
  log "using pre-built themory image: ${THEMORY_IMAGE}"
  export THEMORY_IMAGE
else
  log "building themory image from ${THEMORY_DIR} (first run is slow; cached after)…"
  docker build -t themory-e2e:latest -f "${THEMORY_DIR}/Dockerfile" "${THEMORY_DIR}"
  export THEMORY_IMAGE="themory-e2e:latest"
fi

# --- 3. boot the stack -------------------------------------------------------
log "booting stack (this waits for every service to report healthy)…"
if ! compose up -d --build --wait --wait-timeout 240; then
  dump_logs
  exit 1
fi
log "stack healthy."

# --- 4. run the e2e test against the real endpoints --------------------------
export E2E_CLOUD_URL="http://localhost:${E2E_CLOUD_PORT}"
export E2E_THEMORY_URL="http://localhost:${E2E_THEMORY_PORT}"
export E2E_PG_CLOUD_DSN="postgres://theocloud:theocloud@localhost:${E2E_PG_CLOUD_PORT}/theocloud?sslmode=disable"
export E2E_PG_THEMORY_DSN="postgres://themem:themem@localhost:${E2E_PG_THEMORY_PORT}/themem?sslmode=disable"

log "running Go e2e test against real endpoints…"
if ! ( cd "${ROOT}" && go test -tags e2e -count=1 -v ./tests/e2e/... ); then
  dump_logs
  exit 1
fi

log "e2e PASSED ✔"
