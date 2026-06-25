#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 The Theo Authors
#
# Bring up the DEV stack for end-user validation (real apps, real LLM).
# See dev/README.md. Invoked by `make dev-up`.
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${DEV_DIR}/.." && pwd)"
COMPOSE_FILE="${ROOT}/docker-compose.dev.yaml"
BIN_DIR="${DEV_DIR}/bin"

THEMORY_DIR="${THEMORY_DIR:-${ROOT}/../../theo-data/theo-memory}"
export THEMORY_MASTER_KEY="${THEMORY_MASTER_KEY:-dev-master-key}"
export DEV_ORIGIN_PORT="${DEV_ORIGIN_PORT:-8088}"

log()  { printf '\033[1;36m[dev]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[dev] FAIL:\033[0m %s\n' "$*" >&2; }

compose() { docker compose -p theo-cloud-dev -f "${COMPOSE_FILE}" "$@"; }

command -v docker >/dev/null || { fail "docker not found"; exit 1; }
command -v go >/dev/null || { fail "go not found"; exit 1; }

# --- LLM backend: hermetic mock by default; real provider when exported -------
# NOTE: theo-memory/.env's OPENAI_API_KEY returns 401 (expired), so we do NOT
# auto-load it. For REAL semantic recall, export a valid key before running:
#   export OPENAI_API_KEY=sk-...                 # OpenAI
#   # or OpenRouter:
#   export OPENAI_API_KEY=sk-or-... OPENAI_BASE_URL=https://openrouter.ai/api/v1
if [[ -n "${OPENAI_API_KEY:-}" && -z "${OPENAI_BASE_URL:-}" ]]; then
  export OPENAI_BASE_URL="https://api.openai.com/v1"
  log "using REAL LLM provider at ${OPENAI_BASE_URL}"
else
  log "using hermetic mock LLM (deterministic; export OPENAI_API_KEY for real recall)."
fi

# --- themory image -----------------------------------------------------------
# Default: REBUILD from the sibling theo-memory repo each run so the dev stack
# always reflects theo-memory's current code (e.g. the entity /graph surface).
# Docker layer cache makes a no-change rebuild fast. Escapes:
#   THEMORY_IMAGE=<tag>    use a specific prebuilt image (skip build entirely)
#   THEMORY_SKIP_BUILD=1   reuse an existing themory-e2e:latest (no rebuild)
if [[ -z "${THEMORY_IMAGE:-}" ]]; then
  if [[ "${THEMORY_SKIP_BUILD:-}" == "1" ]] && docker image inspect themory-e2e:latest >/dev/null 2>&1; then
    log "themory: reusing existing themory-e2e:latest (THEMORY_SKIP_BUILD=1)"
  elif [[ -d "${THEMORY_DIR}" ]]; then
    log "themory: rebuilding from ${THEMORY_DIR} (cached layers — fast when unchanged)…"
    docker build -t themory-e2e:latest -f "${THEMORY_DIR}/Dockerfile" "${THEMORY_DIR}"
  elif docker image inspect themory-e2e:latest >/dev/null 2>&1; then
    log "themory: ${THEMORY_DIR} not found — reusing existing themory-e2e:latest"
  else
    fail "themory image missing AND ${THEMORY_DIR} not found — set THEMORY_DIR or THEMORY_IMAGE"
  fi
  export THEMORY_IMAGE="themory-e2e:latest"
fi
log "themory image: ${THEMORY_IMAGE}"

# --- build the gateway binary (static; copied into the runtime image) --------
log "building host binaries (theo-cloud gateway + mock-openai)…"
mkdir -p "${BIN_DIR}"
( cd "${ROOT}" && CGO_ENABLED=0 GOOS=linux go build -o "${BIN_DIR}/theo-cloud" ./cmd )
( cd "${ROOT}" && CGO_ENABLED=0 GOOS=linux go build -o "${BIN_DIR}/mock-openai" ./tests/e2e/mock-openai )

# --- boot backend --------------------------------------------------------------------
log "booting dev stack (waiting for health)…"
if ! compose up -d --build --wait --wait-timeout 240; then
  fail "stack failed to become healthy — recent logs:"
  compose ps || true
  compose logs --tail=60 themory theo-cloud kratos themory-mcp 2>/dev/null || true
  exit 1
fi

log "backend stack healthy."

# --- Model B platform-admin provisioning (platform-api-gateway M6) ------------
# The credential broker (per-tenant data keys + the ForwardAuth edge) needs a
# real `memory:platform-admin` theo_live_* key to mint with. Auto-provision it
# from themory's bootstrap token so `make dev-up` (and the edge e2e) work out of
# the box — closing the gap the dev/README § Model B documented. Skipped if the
# operator already exported THEMORY_PLATFORM_ADMIN_KEY.
if [ -z "${THEMORY_PLATFORM_ADMIN_KEY:-}" ]; then
  BOOTSTRAP="${THEMORY_ADMIN_BOOTSTRAP_TOKEN:-dev-bootstrap-token-change-me-min-32-chars}"
  THEMORY_HOST_PORT="${DEV_THEMORY_PORT:-18081}"
  log "provisioning Model B platform-admin key via the themory bootstrap token…"
  PA_KEY="$(curl -s -m 10 -X POST "http://localhost:${THEMORY_HOST_PORT}/v1/admin/keys" \
    -H "Authorization: Bearer ${BOOTSTRAP}" -H "Content-Type: application/json" \
    -d '{"name":"theo-cloud-platform-admin","scopes":["memory:platform-admin"]}' \
    2>/dev/null | grep -oE '"secret":"theo_live_[^"]+"' | sed 's/^"secret":"//; s/"$//')"
  if [ -n "${PA_KEY}" ]; then
    export THEMORY_PLATFORM_ADMIN_KEY="${PA_KEY}"
    log "minted platform-admin key; recreating the gateway with it…"
    compose up -d --no-deps theo-cloud
    for _ in $(seq 1 20); do
      curl -fsS -o /dev/null "http://localhost:${DEV_GATEWAY_PORT:-13002}/health" 2>/dev/null && break
      sleep 2
    done
  else
    fail "could not mint the platform-admin key (bootstrap may be consumed). Model B per-tenant mint + the edge will fail CLOSED until provisioned — see dev/README § Model B."
  fi
fi

# --- dashboard: host-side vite dev server (native workflow) ------------------
# vite's built-in proxy forwards /v1, /self-service, /sessions to the
# docker-exposed gateway + kratos. Runs detached; make dev-down stops it.
VITE_PID_FILE="${DEV_DIR}/.vite.pid"
VITE_LOG="${DEV_DIR}/.vite.log"
if [[ -f "${VITE_PID_FILE}" ]] && kill -0 "$(cat "${VITE_PID_FILE}" 2>/dev/null)" 2>/dev/null; then
  log "vite dev already running (pid $(cat "${VITE_PID_FILE}"))."
else
  if [[ ! -d "${ROOT}/dashboard/node_modules" ]]; then
    log "installing dashboard deps (npm ci)…"
    ( cd "${ROOT}/dashboard" && npm ci )
  fi
  log "starting dashboard (vite dev) on :5173…"
  ( cd "${ROOT}/dashboard" && nohup npm run dev -- --host --port 5173 >"${VITE_LOG}" 2>&1 & echo $! >"${VITE_PID_FILE}" )
  # wait for vite to answer
  for _ in $(seq 1 30); do
    curl -fsS -o /dev/null "http://localhost:5173/" 2>/dev/null && break
    sleep 1
  done
fi

ORIGIN="http://localhost:5173"
log "dev stack is UP."
cat <<EOF

  ┌─ theo-cloud dev stack ──────────────────────────────────────────────┐
  App (open this)         ${ORIGIN}        ← register a user on first run
  Login                   ${ORIGIN}/login
  Gateway API (direct)    http://localhost:${DEV_GATEWAY_PORT:-13002}
  TheMemory REST (direct) http://localhost:${DEV_THEMORY_PORT:-18081}/v1/health
  Kratos (direct)         http://localhost:${DEV_KRATOS_PUBLIC_PORT:-14433}
  MCP (OpenMemory SSE)    http://localhost:${DEV_MCP_PORT:-8765}/{client}/sse/{user}
  Stop:  make dev-down     Logs: make dev-logs  (vite log: dev/.vite.log)
  See dev/README.md for the MCP client config + details.
  └─────────────────────────────────────────────────────────────────────┘
EOF
