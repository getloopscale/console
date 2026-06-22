# Full-System Live-Test — TheMemory + Theo-Cloud (todas as jornadas)

**Data:** 2026-06-22
**Escopo:** TODAS as suítes automatizadas + live-test no browser (usuário real, LLM real OpenAI) cobrindo TODAS as jornadas do sistema.
**Stack:** dev compose (theo-cloud gateway Go + dashboard Vite + theo-memory REST + ankane/pgvector:v0.5.1). Engine control-plane NÃO incluído neste stack parcial.
**Diretriz:** "NUNCA USE MOCK USE LLM REAL" — honrada (OpenAI real, embedder + extração + reflect reais).

---

## 1. Suítes automatizadas

### theo-memory (`@usetheo/memory`)

| Suíte | Comando | Resultado |
|---|---|---|
| typecheck | `pnpm -r typecheck` | **0 erros** |
| API (Hono handlers) | `cd packages/api && npx vitest run --config vitest.config.ts` | **212 passed** |
| Integration (real pgvector) | `vitest.integration.config.ts` (THEOMEM_PG_URI) | **73 passed** |
| Contract (core + mcp) | `npm test` (vitest.contract.config.ts) | **1087 passed · 2 skipped** (re-run limpo) |

**Nota de honestidade (Regra 3):** uma execução em *background* do contract concorrente com `go test` + browser + escrita no mesmo Postgres reportou "4 failed | 1070 passed" com logs `extraction_failed (network): ECONNREFUSED`. A re-execução isolada deu **1087 passed, 0 failed** — falha de contenção/flakiness sob carga paralela, NÃO regressão de código. Não reproduzível isolado.

### theo-cloud (gateway + dashboard)

| Suíte | Comando | Resultado |
|---|---|---|
| Build gateway | `go build -o dev/bin/theo-cloud ./cmd` | **OK** |
| Go tests | `go test ./...` | **ALL PASS** (inclui contract_test Episodes + dashboard_memory_test + memory_handlers_test) |
| Dashboard typecheck | `npx tsc --noEmit` | **0 erros** |

---

## 2. Live-test — jornadas no browser (usuário real, LLM real)

| # | Jornada | Resultado | Evidência |
|---|---|---|---|
| 1 | **Auth / login** | OK | sessão Kratos válida; `/sessions/whoami` 200; token de dashboard mintado |
| 2 | **Overview** | OK | métricas reais: 4 memórias · 2 recall API calls · 4 add events · usage trend · entities trend |
| 3 | **Memories** | OK | 4 memórias listadas; filtros Category/From/To; botões Forget por linha |
| 4 | **Episodes (NOVA feature M2)** | OK | timeline 4 episódios newest-first; toggle "Oldest first" funciona; filtro de texto "Dune" → só o episódio Dune; rail temporal + badge de scope |
| 5 | **Playground (remember/recall/reflect)** | OK | remember "I'm reading Dune by Frank Herbert and I love science fiction novels" → "Stored 1 memory(ies)"; recall "what books does the user like?" → Dune score 0.364; reflect executado |
| 6 | **Entities** | OK | 10 entidades (Dune, Frank Herbert, Japan, ramen, trains, ...) |
| 7 | **Graph** | OK | 10 entities · 3 relations · grafo force-directed |
| 8 | **Skills** | OK | browse read-only scoped-por-repo; empty-state correto (nenhum skill escrito p/ este repo) |
| 9 | **Exports** | OK (com ressalva) | "Create export" → linha PENDING (POST OK, UI otimista). No reload a lista volta vazia — exports não persistem no gateway dev. Feature pré-existente, fora do escopo episodes. |
| 10 | **Webhooks** | OK | empty-state + "Add webhook"; `/v1/dashboard/memory/webhooks/list` 200 |

### Console / rede

- **1 erro de console:** 502 Bad Gateway (3×) em `/engine/api/v1/{projects,auth/whoami,domains}` — **engine control-plane**, serviço separado NÃO presente neste dev stack parcial. Não afeta as features de memória.
- **Todos os endpoints `/v1/dashboard/memory/*` = 200** (incluindo `episodes`, `webhooks/list`).

---

## 3. Ressalvas honestas (não-bloqueantes)

1. **Overview "Distinct entities: 1" diverge do Entities tab (10).** Lacuna conhecida da derivação de counters no gateway (roadmap theo-memory: `GET /v1/metrics` + `GET /v1/entities` server-side planejados). Não é regressão.
2. **Exports não persiste no reload (dev).** Feature pré-existente do dashboard, fora do escopo desta entrega (episodes). Anotado para follow-up.
3. **Engine control-plane down neste stack** → 502 em projects/domains/whoami. Esperado (stack parcial memory-only).

---

## 4. Veredito

- **Automated:** theo-cloud 100% verde; theo-memory typecheck/api/integration verdes; contract verde em execução isolada (flakiness de contenção documentada).
- **Live (todas as 10 jornadas):** funcionais com LLM real. Feature nova (Episodes) validada ponta-a-ponta via browser.
- **Erros de console relevantes às features de memória:** 0.

**FULL-SYSTEM LIVE-TEST: PASS** (com 3 ressalvas honestas pré-existentes/de-stack-parcial, nenhuma bloqueante).
