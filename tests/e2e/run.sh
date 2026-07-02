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
# EDGE=1 (issue #113): also bring up the Traefik single edge (:8090) and run ONLY
# the edge ForwardAuth confused-deputy tests through it (TestEdgeForwardAuth*).
EDGE="${EDGE:-0}"
EDGE_COMPOSE_FILE="${E2E_DIR}/docker-compose.edge.e2e.yaml"
BIN_DIR="${E2E_DIR}/bin"

THEMORY_DIR="${THEMORY_DIR:-${ROOT}/../../theo-data/theo-memory}"
THEMORY_MASTER_KEY="${THEMORY_MASTER_KEY:-e2e-master-key}"
export THEMORY_MASTER_KEY

# M18 (KEYSTONE) — the sibling theo-rag checkout (pinned source with M11/M12/M13).
THEORAG_DIR="${THEORAG_DIR:-${ROOT}/../../theo-data/theo-rag}"
THEORAG_ADMIN_BOOTSTRAP_TOKEN="${THEORAG_ADMIN_BOOTSTRAP_TOKEN:-e2e-bootstrap-token-change-me-min-32-chars}"
export THEORAG_ADMIN_BOOTSTRAP_TOKEN

# Host-mapped ports (kept in sync with docker-compose.e2e.yaml defaults).
# A port already taken on the host (e.g. another stack on 55432) is resolved by
# exporting the matching E2E_*_PORT before running — the compose honors them.
E2E_CLOUD_PORT="${E2E_CLOUD_PORT:-13002}"
E2E_THEMORY_PORT="${E2E_THEMORY_PORT:-18080}"
E2E_RAG_PORT="${E2E_RAG_PORT:-18082}"
E2E_PG_CLOUD_PORT="${E2E_PG_CLOUD_PORT:-55432}"
E2E_PG_THEMORY_PORT="${E2E_PG_THEMORY_PORT:-55434}"
E2E_PG_RAG_PORT="${E2E_PG_RAG_PORT:-55435}"
E2E_KRATOS_PUBLIC_PORT="${E2E_KRATOS_PUBLIC_PORT:-14433}"
E2E_KRATOS_ADMIN_PORT="${E2E_KRATOS_ADMIN_PORT:-14434}"
E2E_EDGE_PORT="${E2E_EDGE_PORT:-8090}"
export E2E_CLOUD_PORT E2E_THEMORY_PORT E2E_RAG_PORT E2E_PG_CLOUD_PORT E2E_PG_THEMORY_PORT E2E_PG_RAG_PORT E2E_KRATOS_PUBLIC_PORT E2E_KRATOS_ADMIN_PORT E2E_EDGE_PORT

log()  { printf '\033[1;36m[e2e]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[e2e] FAIL:\033[0m %s\n' "$*" >&2; }

# In EDGE mode, layer the Traefik overlay on top of the base compose file.
COMPOSE_ARGS=(-f "${COMPOSE_FILE}")
if [[ "${EDGE}" == "1" ]]; then COMPOSE_ARGS+=(-f "${EDGE_COMPOSE_FILE}"); fi
compose() { docker compose -p theo-cloud-memory-e2e "${COMPOSE_ARGS[@]}" "$@"; }

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
  compose ps -a || true
  # The schema-bearing one-shots (cloud-migrate / kratos-migrate) are the #1 silent
  # failure on a fresh/slow runner — a missing accounts table means migrate didn't apply.
  # Dump them FIRST + verbatim so the root cause isn't invisible.
  echo "── cloud-migrate ──"; compose logs --no-color cloud-migrate || true
  echo "── pg-cloud ──";      compose logs --no-color --tail=40 pg-cloud || true
  compose logs --tail=80 themory theo-cloud mock-openai || true
  if [[ "${EDGE}" == "1" ]]; then compose logs --tail=80 traefik || true; fi
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

# --- 2b. (EDGE=1, M18) build the theo-rag image from the sibling checkout ------
# D1: pinned local source (M11/M12/M13), NOT a floating GHCR :develop.
if [[ "${EDGE}" == "1" ]]; then
  [[ -f "${THEORAG_DIR}/packages/api/Dockerfile" ]] || {
    fail "theo-rag repo not found at THEORAG_DIR=${THEORAG_DIR} (set THEORAG_DIR=/path/to/theo-rag)"
    exit 1
  }
  if [[ -n "${THEORAG_IMAGE:-}" ]]; then
    log "using pre-built theo-rag image: ${THEORAG_IMAGE}"
    export THEORAG_IMAGE
  else
    log "building theo-rag image from ${THEORAG_DIR} (first run is slow; cached after)…"
    docker build -t theo-rag-e2e:latest -f "${THEORAG_DIR}/packages/api/Dockerfile" "${THEORAG_DIR}"
    export THEORAG_IMAGE="theo-rag-e2e:latest"
  fi
fi

# --- 3. boot the stack -------------------------------------------------------
log "booting stack (this waits for every service to report healthy)…"
if ! compose up -d --build --wait --wait-timeout 240; then
  dump_logs
  exit 1
fi
log "stack healthy."

# --- 3.5 Model-B platform-admin provisioning (M6 full-chain) -----------------
# The credential broker (per-tenant data keys for the dashboard memory surface)
# needs a real memory:platform-admin theo_live_* key to mint with. Auto-provision
# it from themory's bootstrap token (mirrors dev/run.sh § Model B) and recreate
# the gateway with it — otherwise the full-chain memory write fails CLOSED with
# "resolve per-tenant key: not found".
if [[ -z "${THEMORY_PLATFORM_ADMIN_KEY:-}" ]]; then
  BOOTSTRAP="${THEMORY_ADMIN_BOOTSTRAP_TOKEN:-e2e-bootstrap-token-change-me-min-32-chars}"
  log "provisioning Model B platform-admin key via the themory bootstrap token…"
  # `|| true` on the pipe so a no-match grep (e.g. bootstrap already consumed on a
  # KEEP_UP re-run) does NOT trip `set -e`/`pipefail` before the explicit guard +
  # dump_logs below — otherwise a mint failure is an opaque, log-less red.
  PA_KEY="$( (curl -s -m 10 -X POST "http://localhost:${E2E_THEMORY_PORT}/v1/admin/keys" \
    -H "Authorization: Bearer ${BOOTSTRAP}" -H "Content-Type: application/json" \
    -d '{"name":"theo-cloud-platform-admin","scopes":["memory:platform-admin"]}' \
    2>/dev/null | grep -oE '"secret":"theo_live_[^"]+"' | sed 's/^"secret":"//; s/"$//') || true)"
  if [[ -z "${PA_KEY}" ]]; then
    dump_logs
    fail "could not mint the platform-admin key (bootstrap may be consumed) — the broker mint will fail CLOSED."
    exit 1
  fi
  export THEMORY_PLATFORM_ADMIN_KEY="${PA_KEY}"
  log "minted platform-admin key; recreating the gateway with it…"
  compose up -d --no-deps --wait --wait-timeout 90 theo-cloud
fi

# --- 3.6 (EDGE=1, M18) rag Model-B platform-admin provisioning ----------------
# The rag broker needs a rag:platform-admin theo_live_* to mint per-tenant keys.
# Mint it from theo-rag's bootstrap token (M12: /v1/admin/keys, workspace_id
# required, response nested under `raw_key` — NOT themory's flat `secret`).
if [[ "${EDGE}" == "1" && -z "${RAG_PLATFORM_ADMIN_KEY:-}" ]]; then
  log "provisioning rag Model B platform-admin key via the theo-rag bootstrap token…"
  RA_KEY="$( (curl -s -m 10 -X POST "http://localhost:${E2E_RAG_PORT}/v1/admin/keys" \
    -H "Authorization: Bearer ${THEORAG_ADMIN_BOOTSTRAP_TOKEN}" -H "Content-Type: application/json" \
    -d '{"name":"theo-cloud-rag-admin","workspace_id":"default","scopes":["rag:platform-admin","rag:admin","rag:read","rag:write","rag:delete"]}' \
    2>/dev/null | sed -n 's/.*"raw_key":"\([^"]*\)".*/\1/p') || true)"
  if [[ -z "${RA_KEY}" ]]; then
    dump_logs
    fail "could not mint the rag platform-admin key (bootstrap may be consumed) — the rag broker mint will fail CLOSED."
    exit 1
  fi
  export RAG_PLATFORM_ADMIN_KEY="${RA_KEY}"
  log "minted rag platform-admin key; recreating the gateway with it…"
  compose up -d --no-deps --wait --wait-timeout 90 theo-cloud
fi

# --- 4. test environment (URLs + DSNs the Go tests read) ---------------------
export E2E_CLOUD_URL="http://localhost:${E2E_CLOUD_PORT}"
export E2E_THEMORY_URL="http://localhost:${E2E_THEMORY_PORT}"
# M18: the host-mapped rag service + its DB (the rag e2e reads these).
export E2E_RAG_URL="http://localhost:${E2E_RAG_PORT}"
export E2E_PG_RAG_DSN="postgres://therag:therag@localhost:${E2E_PG_RAG_PORT}/therag?sslmode=disable"
# pg-cloud is the engine-migrated `theo` DB (M6 — full account-tenancy schema).
export E2E_PG_CLOUD_DSN="postgres://theo:theo@localhost:${E2E_PG_CLOUD_PORT}/theo?sslmode=disable"
export E2E_PG_THEMORY_DSN="postgres://themem:themem@localhost:${E2E_PG_THEMORY_PORT}/themem?sslmode=disable"
# M6: real Kratos endpoints for the full-chain login flow.
export E2E_KRATOS_PUBLIC_URL="http://localhost:${E2E_KRATOS_PUBLIC_PORT}"
export E2E_KRATOS_ADMIN_URL="http://localhost:${E2E_KRATOS_ADMIN_PORT}"

# --- 4.5 EDGE readiness (issue #113) -----------------------------------------
# In EDGE mode, wait until Traefik routes /v1/memory -> ForwardAuth and the
# fail-closed deny (401/403, no key) is observable before running the tests —
# proves the edge + authz hop are wired (the recreate above briefly cycles the
# forward-auth target). Then export E2E_EDGE_URL so requireE2EEdge does not SKIP.
if [[ "${EDGE}" == "1" ]]; then
  export E2E_EDGE_URL="http://localhost:${E2E_EDGE_PORT}"
  log "waiting for the Traefik edge (${E2E_EDGE_URL}) to deny an unauthenticated /v1/memory…"
  edge_ready=0
  for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST "${E2E_EDGE_URL}/v1/memory/recall" 2>/dev/null || echo 000)"
    if [[ "${code}" == "401" || "${code}" == "403" ]]; then edge_ready=1; break; fi
    sleep 2
  done
  if [[ "${edge_ready}" != "1" ]]; then
    dump_logs
    fail "Traefik edge never reached the fail-closed deny on /v1/memory (last code: ${code:-none})."
    exit 1
  fi
  log "edge ready (ForwardAuth denies unauthenticated requests)."

  # M18: the rag edge must also deny an unauthenticated /v1/rag (proves rag-edge +
  # forward-auth-rag are wired before the rag test runs).
  log "waiting for the Traefik edge to deny an unauthenticated /v1/rag/collections…"
  rag_edge_ready=0
  for _ in $(seq 1 30); do
    rcode="$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST "${E2E_EDGE_URL}/v1/rag/collections" 2>/dev/null || echo 000)"
    if [[ "${rcode}" == "401" || "${rcode}" == "403" ]]; then rag_edge_ready=1; break; fi
    sleep 2
  done
  if [[ "${rag_edge_ready}" != "1" ]]; then
    dump_logs
    fail "Traefik edge never reached the fail-closed deny on /v1/rag (last code: ${rcode:-none})."
    exit 1
  fi
  log "rag edge ready (forward-auth-rag denies unauthenticated requests)."
fi

# --- 5. run the e2e test against the real endpoints --------------------------
# EDGE mode runs ONLY the ForwardAuth confused-deputy tests through the edge; the
# full suite (non-edge) runs in the default mode (its edge tests SKIP — no Traefik).
if [[ "${EDGE}" == "1" ]]; then
  log "running edge ForwardAuth e2e tests through the Traefik edge…"
  if ! ( cd "${ROOT}" && go test -tags e2e -count=1 -v -run TestEdgeForwardAuth ./tests/e2e/... ); then
    dump_logs
    exit 1
  fi
  log "edge e2e PASSED ✔"
else
  log "running Go e2e test against real endpoints…"
  if ! ( cd "${ROOT}" && go test -tags e2e -count=1 -v ./tests/e2e/... ); then
    dump_logs
    exit 1
  fi
  log "e2e PASSED ✔"
fi
