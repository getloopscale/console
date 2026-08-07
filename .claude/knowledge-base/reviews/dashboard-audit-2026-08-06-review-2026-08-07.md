# Review: dashboard-audit-2026-08-06 (rodada 2)

**Data:** 2026-08-07
**Alvo:** `origin/develop..HEAD` — 610 arquivos
**Revisores:** 4 agentes independentes (arquitetura, testes, cross-validation, control-plane Go)
**Método:** cada revisor **executou** as verificações — injetou o defeito, mediu vermelho, restaurou. Nenhum achado foi aceito por leitura.
**Veredito:** `READY_TO_MERGE_WITH_FOLLOWUPS`

## O que a rodada 1 bloqueou, e como foi resolvido

`8cbc8e7` apagaria de `develop` os 27 planos, 2 ADRs, 15 descobertas e o `ROADMAP.md` — todos listados em `audit-trail-rotation.md § What NEVER rotates`. Restaurados de `8cbc8e7^`. `reviews/`, `audits/` e `releases/` ficaram de fora: a política permite arquivá-los. Dois *splits* de knowledge-base apareceram no caminho (roadmap-runs 9+4, grills 3+7, sem sobreposição) e foram reunidos no local canônico.

## BLOCKERs — 4 encontrados, 4 fechados

| Id | O quê | Como foi provado | Fechado em |
|---|---|---|---|
| F-01 | Os blocos de camada de B-070 **desligaram** o ban do `Alert` (M87/#175) em `components`, `hooks` e `lib`. No flat config um objeto posterior *substitui* o valor da regra | `eslint --print-config` devolvia só `patterns`; sonda com import proibido passava em 3 das 4 camadas | `1766fbf` |
| F-02 | O gate de tree-shake imprimia **PASS com os mocks dentro do bundle**. Procurava `lib/mocks`, um caminho de módulo, que a minificação nunca preserva | Dois revisores injetaram o import, rebuildaram, gate verde | `1766fbf` |
| F1 (Go) | `golangci-lint` falhava em `secret_test.go:36` (S1025) — o passo `Lint` do CI reprovaria | `golangci-lint run ./internal/config/` exit 1 | `1766fbf` |
| BLOCKER-1 | `size-limit` somava um chunk **lazy** (`app-modal-*.js`) no orçamento **eager** — `entryFileNames` virou `app-*` sem `chunkFileNames` acompanhar | Glob resolvia para 2–3 arquivos; app entry media 24,52 kB para um entry de 23,46 | `1766fbf` |

**O padrão é um só, e vale mais que os quatro achados:** cada gate desta promoção foi escrito para impedir uma classe de defeito e, ao ser medido, cometia essa mesma classe. O caso mais literal é F-02, cujo docblock condena *"um gate que passa por apontar para arquivo inexistente"* uma linha antes de reintroduzir o equivalente.

### Retratações registradas

- **F-02 (size-limit vermelho)** e **F-13 (suíte vermelha)** foram levantados como BLOCKER e depois **retratados pelos próprios revisores**: builds concorrentes deixaram dois `app-*.js` no `dist`, e a suíte foi medida com edições não-commitadas de outra sessão. Medi as duas com árvore própria: `size-limit` exit 0, suíte **298 arquivos / 2603 testes verdes** (duas execuções).
- **F9:** meu docblock afirmava que globs obsoletos de `size-limit` produziam *"um verde que não significa nada"*. Um revisor testou: `size-limit` **falha alto** num glob sem correspondência. O defeito real era que o passo é novo e nunca rodou. Corrigido em `22e3852`.

## HIGH fechados nesta rodada

| Achado | Fechado em |
|---|---|
| `silent-null-guard` cego para `useInfiniteQuery` — e um **#274 vivo** em `episodes.tsx:65`: `EmptyState "No episodes yet"` com o branch `isError` inalcançável. O operador lia "você não tem nenhum" quando a verdade era "não consegui perguntar" | `9d76760` |
| `go test \| tee` mascarava o exit code — shell default do Actions é `bash -e` sem `pipefail`. Um revisor reproduziu `--- FAIL` com o step verde | `9d76760` |
| Rename BREAKING `usetheodev → usetheoai` sem entrada de CHANGELOG (Regra 6) | `c3b554e` |
| `architecture.md` descrevia errado o próprio `eslint.config.js`, e "arestas ascendentes: 0" foi refutado pela própria promoção | `22e3852` |
| Assertion frouxa em `secret_test.go` deixava passar `***sk_live_` | `1766fbf` |
| `hooks/` fora do bloco cujo comentário afirmava cobri-lo; grupos cobrindo só 2 níveis de caminho relativo | `1766fbf` |

## Marcações corrigidas

A cross-validation auditou os 47 `[x]` contra o disco: **37 satisfeitos, 5 não, 5 dependentes de julgamento**. Os 26 SHAs de `resolved_in` existem e são ancestrais de HEAD.

- **B-001 reaberto** — o comando do próprio `dod` (`madge --circular`) ainda lista o ciclo, e a regra de lint do outro bullet não existe. O argumento do `resolved_in` procede (a aresta que fecha o laço é `React.lazy`), mas isso é razão para reescrever o `dod`, não para marcar `[x]` contra o que está escrito.
- **B-013 reaberto** — `use-promote.ts`/`use-rollback.ts` não existem e o commit tocou zero testes.
- **B-058 anotado** — fechado pelo oposto do próprio `dod` (pedia apagar; B-017 prevaleceu e ligou). Aplicado o padrão `conflito_com:` que o repo já usa.

## Followups registrados (o que sustenta o `WITH_FOLLOWUPS`)

Cada HIGH acima do teto de 2 é um item registrado, não uma menção em prosa:

| Item | O quê |
|---|---|
| `B-092` | CI não baixa `theo-contracts`: `GOPRIVATE`/`insteadOf` ficaram em `usetheodev/`. Nenhum run exercitou o rename |
| `B-093` | `upstream-debt.test.ts` casa substring do config em vez de resolver a regra — apagar o ban inteiro mantém o teste verde |
| `B-094` | O escape hatch `silent-null-ok` virou carimbo: 10 de 13 usos repetem uma justificativa que nenhum consumidor sustenta (`use-onboarding-state.ts:104` reporta falha de backend como "não logado") |
| `B-095` | `test-only-module-guard` não distingue `import type`; `use-status-stream.ts` (250 LoC, abre `EventSource`) tem só importadores de tipo |
| `B-096` | 8 `it.skip` de corpo vazio em `login.test.tsx` — reativá-los produz 8 verdes vacuosos |
| `B-097` | `LAZY_ONLY_RE` sem teste e com prefixos não ancorados (9 de 10 sósias ejetados do vendor) |
| `B-098` | 233 citações `ADR D1..D9` não resolvem (os arquivos são `ADR-0001..0008`) |
| `B-099` | `npm test` flaky: uma execução falhou em resolver `@/components/ui/alert-guard`, outra passou, sem edição entre elas |

## Gates de qualidade — medidos por mim

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npx eslint src` | 0 erros, 0 avisos |
| `npx vitest run` | **298 arquivos / 2603 testes**, 9 skipped |
| `npx size-limit` | exit 0 — app entry 23,46/25 kB · TOTAL EAGER 306,37/320 kB |
| tree-shake | PASS no build normal, **FAIL com mocks injetados** (distingue os dois estados) |
| `go build ./...` · `go vet ./...` | 0 |
| `golangci-lint run ./internal/config/` | 0 |
| `madge --circular` | 1 ciclo (era 8) — o de B-001, reaberto |
| Co-Authored-By nos commits | 0 |
| CHANGELOG | atualizado |

## Por que `WITH_FOLLOWUPS` e não `READY_TO_MERGE`

Zero BLOCKER em aberto e a dívida está nomeada e registrada — que é o que `cycle-review.md` exige deste veredito. Esticar para `READY_TO_MERGE` chamaria de verde limpo uma dívida reconhecida; usar `NEEDS_FIXES` afirmaria que o trabalho bloqueante está aberto, e ele está demonstravelmente fechado.

## O que NÃO foi verificado

- **Nenhum run de CI rodou neste HEAD.** Todos os gates foram medidos localmente. `B-092` é precisamente a hipótese de que o CI falha — e ela só se resolve com um run.
- A suíte foi medida com edições não-commitadas de outra sessão presentes na árvore. Verde apesar disso, mas não é uma árvore limpa.
- Cobertura de caso negativo em `domains.test.tsx`, `team.test.tsx` e `memory/skills.test.tsx` segue só no happy path (MEDIUM, não registrado como item).
