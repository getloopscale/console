# SPDX-License-Identifier: Apache-2.0
# Copyright 2025-2026 The LoopScale Authors
#
# Developer convenience entrypoints for loop-console. The cross-repo contract
# matrix + acyclic gate still live in the engine repo (see CLAUDE.md
# § Durable enforcement); this Makefile covers the day-to-day local loop.

COMPOSE_E2E := docker compose -p loop-console-memory-e2e -f tests/e2e/docker-compose.e2e.yaml
COMPOSE_E2E_EDGE := docker compose -p loop-console-memory-e2e -f tests/e2e/docker-compose.e2e.yaml -f tests/e2e/docker-compose.edge.e2e.yaml
COMPOSE_DEV := docker compose -p loop-console-dev -f docker-compose.dev.yaml

.DEFAULT_GOAL := help

.PHONY: help build test vet e2e e2e-edge e2e-up e2e-down e2e-logs e2e-clean dev-up dev-down dev-logs dev-restart mcp-broker-help

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

build: ## Build the cloud-API
	go build ./...

test: ## Run unit tests (race)
	go test ./... -race

vet: ## Static analysis
	go vet ./...

e2e: ## Run the full loop-console <-> TheMemory e2e against real endpoints (build + up + test + down)
	bash tests/e2e/run.sh

e2e-edge: ## Run the edge ForwardAuth e2e through the Traefik edge (#113; build + up + test + down)
	EDGE=1 bash tests/e2e/run.sh

e2e-up: ## Boot the e2e stack and LEAVE IT RUNNING (KEEP_UP=1) for debugging
	KEEP_UP=1 bash tests/e2e/run.sh

e2e-down: ## Tear down a left-up e2e stack
	$(COMPOSE_E2E) down -v --remove-orphans

e2e-logs: ## Tail logs from the e2e stack
	$(COMPOSE_E2E) logs -f --tail=120

e2e-clean: e2e-down ## Tear down + remove built e2e binaries
	rm -rf tests/e2e/bin

dev-up: ## Bring up the real dev stack (apps + real LLM) for end-user validation
	bash dev/run.sh

mcp-broker-help: ## loop-console's role as the MCP Model B broker (mcp-resolve) in the integrated path
	@echo "loop-console is the MCP Model B broker: POST /internal/authz/mcp-resolve mints a"
	@echo "per-tenant downstream key for the LoopScale MCP Gateway. In the loopscale-workspace stack it"
	@echo "runs as the 'loop-console' compose service (LOOPSCALE_MCP_BROKER_URL=http://loop-console:13002)."
	@echo "Integrated bring-up: loopscale-workspace 'make up' + 'make memory-up MODE=--mcp'."
	@echo "See docs/mcp-model-b-broker.md."

dev-down: ## Stop the dev stack (backend containers + host vite dev server)
	-@[ -f dev/.vite.pid ] && kill "$$(cat dev/.vite.pid)" 2>/dev/null && rm -f dev/.vite.pid && echo "stopped vite dev" || true
	$(COMPOSE_DEV) down --remove-orphans

dev-logs: ## Tail dev stack logs
	$(COMPOSE_DEV) logs -f --tail=120

dev-restart: ## Rebuild the gateway + restart the dev stack
	bash dev/run.sh
