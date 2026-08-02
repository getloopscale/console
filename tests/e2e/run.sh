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
#   THEMORY_DIR    path to the sibling theo-memory repo (default: ../theo-memory)
#   THEORAG_DIR    path to the sibling theo-rag repo    (default: ../theo-rag)
#   THELENS_DIR    path to the sibling theo-lens repo   (default: ../theo-lens)
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

THEMORY_DIR="${THEMORY_DIR:-${ROOT}/../theo-memory}"
THEMORY_MASTER_KEY="${THEMORY_MASTER_KEY:-e2e-master-key}"
export THEMORY_MASTER_KEY

# M18 (KEYSTONE) — the sibling theo-rag checkout (pinned source with M11/M12/M13).
THEORAG_DIR="${THEORAG_DIR:-${ROOT}/../theo-rag}"
THEORAG_ADMIN_BOOTSTRAP_TOKEN="${THEORAG_ADMIN_BOOTSTRAP_TOKEN:-e2e-bootstrap-token-change-me-min-32-chars}"
export THEORAG_ADMIN_BOOTSTRAP_TOKEN

# O COMPOSE NAO LIA `THEORAG_DIR` — ele hardcodava
# `../../../../theo-data/theo-rag/packages/.../migrations`, um caminho que NAO EXISTE nem no
# dev-box nem no runner. Bind de origem ausente vira DIRETORIO VAZIO, o loop de `psql`
# itera zero vezes, e o container sai 0: schema nunca aplicado, migracao "verde".
#
# O theo-rag entao subia healthy (o healthcheck so bate `/v1/healthz`, que nao toca tabela)
# e `POST /v1/admin/keys` devolvia 503 sobre tabela inexistente. O harness lia esse 503 como
# "bootstrap consumido" — palpite errado que mandou o leitor investigar o token por semanas
# (#271). Diferente do theo-lens, que MIGRA NO BOOT e por isso nunca teve esse modo.
#
# Exportado para o compose consumir; o guard abaixo torna o no-op silencioso impossivel.
THEORAG_MIGRATIONS_DIR="${THEORAG_MIGRATIONS_DIR:-${THEORAG_DIR}/packages/core/src/infrastructure/db/migrations}"
export THEORAG_MIGRATIONS_DIR

# M40 (KEYSTONE) — the sibling theo-lens checkout (pinned source with M22/M37/M38).
THELENS_DIR="${THELENS_DIR:-${ROOT}/../theo-lens}"
THELENS_ADMIN_BOOTSTRAP="${THELENS_ADMIN_BOOTSTRAP:-e2e-bootstrap-token-change-me-min-32-chars}"
export THELENS_ADMIN_BOOTSTRAP

# --- BEGIN e2e-stack-identity (extraido e EXECUTADO por internal/ci/e2e_isolation_test.go) ---
# --- Isolamento de pilha (issue #333) ----------------------------------------
#
# MEDIDO no run 30723256775: `e2e` e `e2e-edge` sao dois jobs do MESMO run, comecam no mesmo
# segundo e a Blacksmith os colocou no MESMO host (`ip-172-31-64-123`) — runners distintos,
# daemon Docker compartilhado. Ambos usavam o literal `theo-cloud-memory-e2e` e as mesmas
# portas fixas. O `e2e` morreu ao ligar 55432, ANTES de qualquer teste rodar.
#
# Duas propriedades fecham a classe, e sao independentes:
#   (a) IDENTIDADE — o nome do projeto compose e containers/rede/volumes e o alvo de
#       `compose down -v`. Constante = os dois jobs sao a MESMA pilha para o Docker, e o
#       teardown de um apaga a do outro no meio do teste.
#   (b) PORTA — o recurso de fato disputado.
#
# O isolamento e por CI, nao por execucao. Localmente o projeto continua FIXO porque o
# `make e2e-down` do Makefile aponta para o literal: variar aqui faria `make e2e-up` deixar uma
# pilha que o `e2e-down` nao encontra — teardown que reporta sucesso sem fazer nada, com volumes
# de Postgres orfaos crescendo em silencio. Foi o defeito que a primeira versao desta correcao
# introduziu, e `TestE2ELocalProjectMatchesTheMakefileTeardown` existe por causa dele.
E2E_PROJECT_BASE="theo-cloud-memory-e2e"
if [[ -n "${GITHUB_ACTIONS:-}" || "${E2E_DYNAMIC_PORTS:-0}" == "1" ]]; then
  E2E_STACK_ID="${E2E_STACK_ID:-${GITHUB_JOB:-job}-${GITHUB_RUN_ATTEMPT:-0}-$$}"
  # Docker exige [a-z0-9][a-z0-9_-]* no nome do projeto.
  E2E_STACK_ID="$(printf '%s' "${E2E_STACK_ID}" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-')"
  E2E_PROJECT="${E2E_PROJECT:-${E2E_PROJECT_BASE}-${E2E_STACK_ID}}"
else
  E2E_PROJECT="${E2E_PROJECT:-theo-cloud-memory-e2e}"
fi
export E2E_PROJECT
# O passo de dump do ci.yml roda noutro shell; sem isto ele olharia um projeto que nao existe
# e devolveria log VAZIO exatamente quando ele e mais necessario.
if [[ -n "${GITHUB_ENV:-}" ]]; then echo "E2E_PROJECT=${E2E_PROJECT}" >> "${GITHUB_ENV}"; fi

# Codigos de saida distintos (pedido explicito da #333). Falha de HARNESS ("nao consegui
# subir") e falha de TESTE ("tal comportamento quebrou") sao diagnosticos diferentes e exigem
# acoes diferentes. Sairem iguais foi o que fez um PR ser mergeado com este check vermelho:
# o leitor concluiu "flaky, re-roda" sem abrir o log.
E2E_EXIT_HARNESS=86
E2E_EXIT_TEST=1

# free_port — pede ao kernel uma porta livre em vez de apostar num literal. Existe porque o
# Kratos assa a porta no `SERVE_PUBLIC_BASE_URL` ANTES de o container subir, entao publicar
# `0` e descobrir depois nao serve: a porta tem de ser conhecida de antemao.
free_port() {
  python3 -c 'import socket
s = socket.socket()
s.bind(("", 0))
print(s.getsockname()[1])
s.close()'
}

# Em CI as portas sao dinamicas; localmente seguem fixas de proposito — um dev faz
# `psql localhost:55432` na pilha de pe, e sortear a porta a cada run quebraria isso sem
# fechar defeito algum (o host do dev nao roda dois jobs irmaos ao mesmo tempo).
# Um `E2E_*_PORT` explicito sempre vence, nos dois modos.
if [[ -n "${GITHUB_ACTIONS:-}" || "${E2E_DYNAMIC_PORTS:-0}" == "1" ]]; then
  dyn_port() { free_port; }
else
  dyn_port() { printf '%s' "$1"; }
fi

# Host-mapped ports (kept in sync with docker-compose.e2e.yaml defaults).
# A port already taken on the host (e.g. another stack on 55432) is resolved by
# exporting the matching E2E_*_PORT before running — the compose honors them.
E2E_CLOUD_PORT="${E2E_CLOUD_PORT:-$(dyn_port 13002)}"
E2E_THEMORY_PORT="${E2E_THEMORY_PORT:-$(dyn_port 18080)}"
E2E_RAG_PORT="${E2E_RAG_PORT:-$(dyn_port 18082)}"
E2E_LENS_PORT="${E2E_LENS_PORT:-$(dyn_port 18084)}"
E2E_PG_CLOUD_PORT="${E2E_PG_CLOUD_PORT:-$(dyn_port 55432)}"
E2E_PG_THEMORY_PORT="${E2E_PG_THEMORY_PORT:-$(dyn_port 55434)}"
E2E_PG_RAG_PORT="${E2E_PG_RAG_PORT:-$(dyn_port 55435)}"
E2E_PG_LENS_PORT="${E2E_PG_LENS_PORT:-$(dyn_port 55436)}"
E2E_KRATOS_PUBLIC_PORT="${E2E_KRATOS_PUBLIC_PORT:-$(dyn_port 14433)}"
E2E_KRATOS_ADMIN_PORT="${E2E_KRATOS_ADMIN_PORT:-$(dyn_port 14434)}"
E2E_EDGE_PORT="${E2E_EDGE_PORT:-$(dyn_port 8090)}"
export E2E_CLOUD_PORT E2E_THEMORY_PORT E2E_RAG_PORT E2E_LENS_PORT E2E_PG_CLOUD_PORT E2E_PG_THEMORY_PORT E2E_PG_RAG_PORT E2E_PG_LENS_PORT E2E_KRATOS_PUBLIC_PORT E2E_KRATOS_ADMIN_PORT E2E_EDGE_PORT
# --- END e2e-stack-identity ---

log()  { printf '\033[1;36m[e2e]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[e2e] FAIL:\033[0m %s\n' "$*" >&2; }
# A distincao que a #333 pede, dita em PROSA alem do codigo — quem le o log so ve o texto.
harness_fail() {
  printf '\033[1;31m[e2e] HARNESS FAIL (exit %s):\033[0m %s\n' "${E2E_EXIT_HARNESS}" "$*" >&2
  printf '\033[1;31m[e2e]\033[0m a pilha nao subiu — NENHUM teste chegou a rodar. Isto nao e um\n' >&2
  printf '\033[1;31m[e2e]\033[0m comportamento quebrado do produto, e o ambiente. Nao releia como flaky:\n' >&2
  printf '\033[1;31m[e2e]\033[0m projeto=%s  (identidade da pilha, por job — issue #333)\n' "${E2E_PROJECT}" >&2
}

# In EDGE mode, layer the Traefik overlay on top of the base compose file.
COMPOSE_ARGS=(-f "${COMPOSE_FILE}")
if [[ "${EDGE}" == "1" ]]; then COMPOSE_ARGS+=(-f "${EDGE_COMPOSE_FILE}"); fi
compose() { docker compose -p "${E2E_PROJECT}" "${COMPOSE_ARGS[@]}" "$@"; }

teardown() {
  if [[ "${KEEP_UP:-0}" == "1" ]]; then
    log "KEEP_UP=1 — leaving the stack running. Tear down with: make e2e-down"
    return
  fi
  log "tearing down…"
  compose down -v --remove-orphans >/dev/null 2>&1 || true
}

dump_logs() {
  harness_fail "harness failed — recent service logs:"
  compose ps -a || true
  # The schema-bearing one-shots (cloud-migrate / kratos-migrate) are the #1 silent
  # failure on a fresh/slow runner — a missing accounts table means migrate didn't apply.
  # Dump them FIRST + verbatim so the root cause isn't invisible.
  echo "── cloud-migrate ──"; compose logs --no-color cloud-migrate || true
  echo "── pg-cloud ──";      compose logs --no-color --tail=40 pg-cloud || true
  compose logs --tail=80 themory theo-cloud mock-openai || true
  if [[ "${EDGE}" == "1" ]]; then compose logs --tail=80 traefik rag lens pg-lens || true; fi
}

# --- mint_admin_key: cunha uma chave de platform-admin e DIZ O QUE ACONTECEU -------
#
# POR QUE ISTO EXISTE. Os tres blocos de provisionamento descartavam a resposta HTTP
# (`2>/dev/null` + grep) e, quando o grep nao casava, reportavam um palpite:
# "bootstrap may be consumed". Em #271 a causa real era **503** — schema ausente, token
# perfeitamente valido — e a mensagem mandou o leitor investigar o token. Um diagnostico
# que aponta para o lugar errado custa mais que a ausencia de diagnostico.
#
# Agora o status e o corpo aparecem. `$1` = rotulo, `$2` = url, `$3` = token,
# `$4` = payload, `$5` = expressao sed que extrai a chave (o shape difere por servico:
# themory/lens usam `secret` plano, rag usa `raw_key` aninhado).
MINT_STATUS=""
MINT_BODY=""
MINT_KEY=""
mint_admin_key() {
  local label="$1" url="$2" token="$3" payload="$4" extract="$5" raw
  raw="$(curl -s -m 10 -w $'\n%{http_code}' -X POST "${url}" \
    -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \
    -d "${payload}" 2>&1 || true)"
  MINT_STATUS="$(printf '%s' "${raw}" | tail -n1)"
  MINT_BODY="$(printf '%s' "${raw}" | sed '$d')"
  MINT_KEY="$(printf '%s' "${MINT_BODY}" | sed -n "${extract}")"
  [[ -n "${MINT_KEY}" ]] && return 0

  fail "${label}: nao consegui cunhar a chave de platform-admin."
  # O corpo e truncado porque uma resposta de erro pode ser uma pagina inteira; 400 chars
  # bastam para distinguir 401 (token) de 503 (dependencia) de 404 (rota ausente).
  printf '  HTTP %s\n  corpo: %s\n' "${MINT_STATUS:-<sem resposta>}" "$(printf '%s' "${MINT_BODY}" | head -c 400)" >&2
  case "${MINT_STATUS}" in
    401|403) printf '  → credencial recusada: o bootstrap pode estar consumido ou o token difere.\n' >&2 ;;
    404)     printf '  → rota ausente nesta imagem: o pin do vizinho pode ser velho demais.\n' >&2 ;;
    503)     printf '  → dependencia indisponivel no servico (schema ausente e a causa comum — ver #271).\n' >&2 ;;
    "")      printf '  → sem resposta: o servico nao esta escutando na porta esperada.\n' >&2 ;;
  esac
  return 1
}

# --- preflight ---------------------------------------------------------------
command -v docker >/dev/null || { fail "docker not found"; exit 1; }
command -v go >/dev/null || { fail "go not found"; exit 1; }
# O checkout do vizinho so e exigido quando NAO ha imagem pre-construida. Com
# `THEMORY_IMAGE` setada (o caminho do CI, que puxa do GHCR por digest) nao ha o que
# buildar, e exigir o diretorio faria o e2e depender de um repo que ele nao usa.
if [[ -z "${THEMORY_IMAGE:-}" ]]; then
  [[ -f "${THEMORY_DIR}/Dockerfile" ]] || {
    fail "TheMemory repo not found at THEMORY_DIR=${THEMORY_DIR} (set THEMORY_DIR=/path/to/theo-memory, ou passe THEMORY_IMAGE=<ref>)"
    exit "${E2E_EXIT_HARNESS}"
  }
fi

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
  if [[ -z "${THEORAG_IMAGE:-}" ]]; then
    [[ -f "${THEORAG_DIR}/packages/api/Dockerfile" ]] || {
      fail "theo-rag repo not found at THEORAG_DIR=${THEORAG_DIR} (set THEORAG_DIR=/path/to/theo-rag, ou passe THEORAG_IMAGE=<ref>)"
      exit "${E2E_EXIT_HARNESS}"
    }
  fi
  if [[ -n "${THEORAG_IMAGE:-}" ]]; then
    log "using pre-built theo-rag image: ${THEORAG_IMAGE}"
    export THEORAG_IMAGE
  else
    log "building theo-rag image from ${THEORAG_DIR} (first run is slow; cached after)…"
    docker build -t theo-rag-e2e:latest -f "${THEORAG_DIR}/packages/api/Dockerfile" "${THEORAG_DIR}"
    export THEORAG_IMAGE="theo-rag-e2e:latest"
  fi
fi

# --- 2c. (EDGE=1, M40) build the theo-lens image from the sibling checkout -----
# Pinned local source (M22/M37/M38), NOT a floating GHCR :develop. theo-lens's
# Dockerfile is at the repo ROOT (a multi-stage pnpm-workspace build serving API + UI).
if [[ "${EDGE}" == "1" ]]; then
  if [[ -z "${THELENS_IMAGE:-}" ]]; then
    [[ -f "${THELENS_DIR}/Dockerfile" ]] || {
      fail "theo-lens repo not found at THELENS_DIR=${THELENS_DIR} (set THELENS_DIR=/path/to/theo-lens, ou passe THELENS_IMAGE=<ref>)"
      exit "${E2E_EXIT_HARNESS}"
    }
  fi
  if [[ -n "${THELENS_IMAGE:-}" ]]; then
    log "using pre-built theo-lens image: ${THELENS_IMAGE}"
    export THELENS_IMAGE
  else
    log "building theo-lens image from ${THELENS_DIR} (first run is slow; cached after)…"
    docker build -t theo-lens-e2e:latest -f "${THELENS_DIR}/Dockerfile" "${THELENS_DIR}"
    export THELENS_IMAGE="theo-lens-e2e:latest"
  fi
fi

# --- 3. boot the stack -------------------------------------------------------
log "booting stack (this waits for every service to report healthy)…"
if ! compose up -d --build --wait --wait-timeout 240; then
  dump_logs
  exit "${E2E_EXIT_HARNESS}"
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
  if ! mint_admin_key "memory" "http://localhost:${E2E_THEMORY_PORT}/v1/admin/keys" \
    "${BOOTSTRAP}" \
    '{"name":"theo-cloud-platform-admin","scopes":["memory:platform-admin"]}' \
    's/.*"secret":"\(theo_live_[^"]*\)".*/\1/p'; then
    dump_logs
    exit "${E2E_EXIT_HARNESS}"
  fi
  PA_KEY="${MINT_KEY}"
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
  if ! mint_admin_key "rag" "http://localhost:${E2E_RAG_PORT}/v1/admin/keys" \
    "${THEORAG_ADMIN_BOOTSTRAP_TOKEN}" \
    '{"name":"theo-cloud-rag-admin","workspace_id":"default","scopes":["rag:platform-admin","rag:admin","rag:read","rag:write","rag:delete"]}' \
    's/.*"raw_key":"\([^"]*\)".*/\1/p'; then
    dump_logs
    exit "${E2E_EXIT_HARNESS}"
  fi
  RA_KEY="${MINT_KEY}"
  export RAG_PLATFORM_ADMIN_KEY="${RA_KEY}"
  log "minted rag platform-admin key; recreating the gateway with it…"
  compose up -d --no-deps --wait --wait-timeout 90 theo-cloud
fi

# --- 3.7 (EDGE=1, M40) lens Model-B platform-admin provisioning ---------------
# The lens broker (M38) needs a observability:platform-admin theo_live_* to mint per-tenant
# keys. Mint it from theo-lens's stateless bootstrap token (M22: /v1/admin/keys,
# workspace_id required, response is FLAT `secret` — NOT rag's nested `raw_key`).
if [[ "${EDGE}" == "1" && -z "${LENS_PLATFORM_ADMIN_KEY:-}" ]]; then
  log "provisioning lens Model B platform-admin key via the theo-lens bootstrap token…"
  if ! mint_admin_key "lens" "http://localhost:${E2E_LENS_PORT}/v1/admin/keys" \
    "${THELENS_ADMIN_BOOTSTRAP}" \
    '{"name":"theo-cloud-lens-admin","workspace_id":"default","scopes":["observability:platform-admin","observability:admin","observability:read","observability:write","observability:delete"]}' \
    's/.*"secret":"\([^"]*\)".*/\1/p'; then
    dump_logs
    exit "${E2E_EXIT_HARNESS}"
  fi
  LA_KEY="${MINT_KEY}"
  export LENS_PLATFORM_ADMIN_KEY="${LA_KEY}"
  log "minted lens platform-admin key; recreating the gateway with it…"
  compose up -d --no-deps --wait --wait-timeout 90 theo-cloud
fi

# --- 4. test environment (URLs + DSNs the Go tests read) ---------------------
export E2E_CLOUD_URL="http://localhost:${E2E_CLOUD_PORT}"
export E2E_THEMORY_URL="http://localhost:${E2E_THEMORY_PORT}"
# M18: the host-mapped rag service + its DB (the rag e2e reads these).
export E2E_RAG_URL="http://localhost:${E2E_RAG_PORT}"
export E2E_PG_RAG_DSN="postgres://therag:therag@localhost:${E2E_PG_RAG_PORT}/therag?sslmode=disable"
# M40: the host-mapped lens service + its DB (the lens e2e reads E2E_LENS_URL).
export E2E_LENS_URL="http://localhost:${E2E_LENS_PORT}"
export E2E_PG_LENS_DSN="postgres://theolens:theolens@localhost:${E2E_PG_LENS_PORT}/theolens?sslmode=disable"
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
    exit "${E2E_EXIT_HARNESS}"
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
    exit "${E2E_EXIT_HARNESS}"
  fi
  log "rag edge ready (forward-auth-rag denies unauthenticated requests)."

  # M40: the lens edge must also deny an unauthenticated /v1/lens (proves lens-edge +
  # forward-auth-lens are wired before the lens test runs).
  log "waiting for the Traefik edge to deny an unauthenticated /v1/lens/datasets…"
  lens_edge_ready=0
  for _ in $(seq 1 30); do
    lcode="$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST "${E2E_EDGE_URL}/v1/lens/datasets" 2>/dev/null || echo 000)"
    if [[ "${lcode}" == "401" || "${lcode}" == "403" ]]; then lens_edge_ready=1; break; fi
    sleep 2
  done
  if [[ "${lens_edge_ready}" != "1" ]]; then
    dump_logs
    fail "Traefik edge never reached the fail-closed deny on /v1/lens (last code: ${lcode:-none})."
    exit "${E2E_EXIT_HARNESS}"
  fi
  log "lens edge ready (forward-auth-lens denies unauthenticated requests)."
fi

# --- 5. run the e2e test against the real endpoints --------------------------
# EDGE mode runs ONLY the ForwardAuth confused-deputy tests through the edge; the
# full suite (non-edge) runs in the default mode (its edge tests SKIP — no Traefik).
if [[ "${EDGE}" == "1" ]]; then
  log "running edge ForwardAuth e2e tests through the Traefik edge…"
  if ! ( cd "${ROOT}" && go test -tags e2e -count=1 -v -run TestEdgeForwardAuth ./tests/e2e/... ); then
    dump_logs
    exit "${E2E_EXIT_TEST}"
  fi
  log "edge e2e PASSED ✔"
else
  log "running Go e2e test against real endpoints…"
  if ! ( cd "${ROOT}" && go test -tags e2e -count=1 -v ./tests/e2e/... ); then
    dump_logs
    exit "${E2E_EXIT_TEST}"
  fi
  log "e2e PASSED ✔"
fi
