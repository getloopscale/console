# BACKLOG — theo-cloud

Registro unico de trabalho de manutencao pendente **deste repositorio**.

**Regra que governa o registro:** os ids sao monotonicos e NUNCA renumerados. Um item
morto (`status: killed`) mantem seu numero para sempre — o numero e a trilha de auditoria.

> **Escopo declarado.** O contrato do ecossistema (`.claude/rules/cycle-backlog.md § Output`)
> especifica um registro **unico no umbrella root**, cobrindo os 17 repos, precisamente para
> evitar findings orfaos espalhados por repositorio. Este arquivo diverge disso por decisao
> explicita do dono do projeto em 2026-08-06: o registro e **per-repo**, restrito a
> `theo-cloud`. A consequencia a manter em vista: um achado que atravesse a fronteira deste
> repo nao tem onde morar aqui, e itens de outros repos continuam sem registro. Se o
> ecossistema adotar o registro unico depois, estes itens migram preservando id, evidencia
> e data de origem.

## Como um item chega aqui

Dois produtores, um schema. O contrato completo (schema do item, transicoes de status,
verdicts e gates) vive em `.claude/rules/cycle-backlog.md` — este arquivo e **dado**, nao
contrato.

| Produtor | Comando | Chega como |
|---|---|---|
| Humano (hipotese, sem evidencia) | `/backlog-item {slug}` | `status: raw` · `evidence: none-yet` |
| Medicao (varredura com evidencia) | `/discover --sweep {domain}` | `status: triaged` · `evidence: <ponteiro>` |

`raw → planned` e proibido. Nada chega a um plano sem passar pela medicao do `/discover`.

## Roteamento de dominio

Este repositorio contem **dois** dominios registrados, separados por caminho — nao por
julgamento (`scripts/route_domain.py` impoe a invariante um-repo-um-dominio):

| Dominio | Caminho | Especialista |
|---|---|---|
| `control-plane` | `theo-cloud/` (control plane em Go, contas, projetos, billing, broker de credenciais) | `.claude/agents/control-plane.md` |
| `frontend-dashboard` | `theo-cloud/dashboard/` (SPA React/Vite — unico dominio com alvo vivo declarado) | `.claude/agents/frontend-dashboard.md` |

Os outros 6 dominios do ecossistema (`engine-go`, `data-plane-ts`, `theo-db`,
`infra-terraform`, `contracts-auth`, `platform-cli`) existem em repos irmaos e **nao
recebem itens aqui**, por consequencia do escopo per-repo declarado acima.

### Fora de roteamento

| Repo | Motivo |
|---|---|
| `theo-capsim` (3 commits) | Nao pertence a nenhum dos 8 dominios registrados em `cycle-backlog.md`. Decisao de 2026-08-06: fora de escopo por ora, repo embrionario. Roteavel quando amadurecer — exige editar a tabela de dominios, nao este arquivo. |
| `theo-workspace` | Clone aninhado do proprio umbrella (`cycle-backlog.md § Domain routing`). Nao recebe itens. |

## Proveniencia dos itens B-001..B-087

Todos vieram de **uma unica fonte medida**: a auditoria `/loop-system-design` executada em
2026-08-06 sobre `theo-cloud/dashboard`, cujo relatorio esta em
`dashboard/system-design-output/final_report.md` e cuja base de evidencia esta em
`dashboard/system-design-output/system-design.db`.

Por que entram como `triaged` e nao `raw`: eles ja carregam a medicao que o `/discover`
produziria. A auditoria rodou 6 fases com gate de qualidade adversarial (score global 0.90,
4 fases `keep`), verificou **106 pares file:line contra o disco** (104 resolvem exatamente)
e reproduziu os numeros de bundle de forma independente. Dois achados foram **corrigidos ou
retirados** durante o proprio gate por afirmarem o que nao mediram — a trilha ficou
preservada no banco.

Limite honesto desta importacao: a auditoria mediu **estado**, nao **causa em runtime**. Nao
houve profiling (React DevTools, Lighthouse, long tasks); `npx size-limit` aborta no
ambiente e os numeros de bundle vieram do `zlib` do Node com o metodo declarado;
`dependency-cruiser` estava inutilizavel e as metricas de acoplamento vieram de um parser
proprio cross-validado com `madge`. Itens cuja correcao dependa de medicao em runtime
precisam dela antes do `/to-plan`.

**Sobreposicoes.** O gate G2 (dedup) exige que uma colisao seja declarada, nunca escondida.
Os achados que descrevem o mesmo defeito por lentes diferentes foram mantidos como itens
distintos — a pedido do dono do projeto, por fidelidade ao banco — mas carregam
`overlaps: B-NNN` apontando os irmaos. Quem pegar um deles deve ler os irmaos antes de
abrir PR: sao cross-validacoes que se confirmam, nao trabalho independente.

## Itens

Proximo id livre: **B-088**.

**O que `[x]` e `status: shipped` significam aqui.** O contrato canonico reserva
`shipped` para o que passou por `/release` — tag semver em `main`. Este registro usa o
par `[x]` + `status: shipped` + `resolved_in: <sha>` para dizer algo mais fraco e
verificavel: **a mudanca esta implementada, validada e commitada em `workspace`**. A
promocao para `main` acontece em release agregado, nao por item. Um item marcado aqui
carrega sempre o sha que o fecha — sem ele, a marca nao vale nada.

Ordenados por severidade (high → medium → low → info) e, dentro dela, pela dimensao da
auditoria. `severity` traz o `severity_source` entre parenteses: `consensus` (concordancia
ampla da industria), `default` (limiar publicado adotado) ou `heuristic` (regra de bolso
declarada como tal).

## B-001 — 5 ciclos de import em pages/lens causados por shims de re-export homonimos (arquivo.tsx + pasta/)   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: circular_dependency
evidence: src/pages/lens/playground.tsx:6 — madge --circular src -> 8 ciclos, 5 em pages/lens. src/pages/lens/playground.tsx:6 import { asChat } from './trace-detail'; // shim pai src/pages/lens/playground/baseline-column.tsx:5 import { durationMs } from '../trace-detail'; src/pages/lens/traces/peek-sheet.tsx:14 import('../trace-detail').then((m) => ({ default: m.LensTraceDetail })) src/pages/lens/trace-detail/span-detail.tsx:10 import...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#1
overlaps: B-044, B-079
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
partial_progress: 9ef2466 — 5 dos 6 ciclos da familia lens fechados (filhos passaram a importar trace-detail/helpers em vez do shim pai). RESIDUO: span-detail renderiza a pagina irma LensPlayground; fechar exige inverter via render-prop, mudanca de comportamento sem teste que cubra a interacao playground/peek-sheet
dod:
  - Regra de lint (import/no-internal-modules ou dependency-cruiser rule): nenhum arquivo dentro de X/ pode importar de X (o shim pai). Filhos importam leafs: playground.tsx:6 vira import { asChat } from './trace-detail/helpers'; baseline-column.tsx:5 vira from '../trace-detail/helpers';...
  - `npx madge --extensions ts,tsx --ts-config tsconfig.json --circular src` nao lista mais o ciclo que passa por `src/pages/lens/playground.tsx`

## B-002 — Organizacao package-by-layer dispersa cada feature por 3-4 diretorios de topo, sem nenhuma fronteira de modulo declarada   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: missing_interface
evidence: src/pages/deployments.tsx:23 — Dispersao medida (arquivos de producao por camada): auth 4 camadas 17 arq {pages:3 components:6 hooks:1 lib:7} deploy 4 camadas 14 arq {pages:2 components:6 hooks:5 lib:1} logs 4 camadas 8 arq {pages:2 components:4 hooks:1 lib:1} lens 3 camadas 57 arq {pages:46 components:9 lib:2} promptly 3 camadas 23 arq {pages:12 components:10 lib:1} skills 3 camadas 19 arq {pages:8 components:10 lib:1}...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#5
overlaps: B-004, B-008, B-032, B-070
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Migrar para package-by-feature de forma incremental, um dominio por PR, comecando pelos mais dispersos (deploy, auth, logs): criar src/features/<dominio>/ com pages/, components/, hooks/, api.ts e um index.ts que exporta APENAS o que outras features podem consumir
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/pages/deployments.tsx` e passa depois da mudanca

## B-003 — src/app.tsx e um manifesto de rotas monolitico: 729 LOC, 85 lazy() e 118 Route cobrindo ~15 dominios   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: god_module
evidence: src/app.tsx:45 — wc -l src/app.tsx = 729 | grep -c lazy( = 85 | grep -c Route = 118 | src/app.tsx:45 const OverviewPage = lazy(...import @/pages/overview) | src/app.tsx:313 function PreviewsRedirect() | src/app.tsx:326 function RepositoryAlias() | src/app.tsx:351 function RouteScope()
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#6
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Fatiar por dominio: cada feature exporta seu proprio subtree de rotas (ex
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/app.tsx` e passa depois da mudanca

## B-004 — src/hooks e um shared kernel falso: 33 de 44 hooks (75%) sao usados por uma unica feature   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: god_module
evidence: src/hooks/use-scale-cost.ts:1 — Hooks com exatamente 1 feature consumidora (33): use-scale.ts, use-scale-cost.ts, use-secrets.ts, use-invoices.ts, use-overview-kpis.ts, use-kpi-metric.ts, use-build-envs.ts, use-deploy-timeline.ts, use-deploy-timeline-with-steps.ts, use-deployment-stream.ts, use-deployments-list-stream.ts, use-log-stream.ts, use-doc-theme.ts, use-pending-oidc.ts, use-provisioning-status.ts, use-project.ts,...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#7
overlaps: B-002, B-008, B-032, B-070
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Mover os 33 hooks feature-private para dentro da respectiva feature (src/features/scale/hooks/use-scale-cost.ts etc.) na mesma migracao do achado de package-by-layer
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/hooks/use-scale-cost.ts` e passa depois da mudanca

## B-005 — Dois componentes AddSecretSheet com o mesmo nome em pastas concorrentes; o legado tem contrato de backend comprovadamente errado e continua...   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: leaky_abstraction
evidence: src/components/sheets/add-secret-sheet.tsx:22 — src/components/sheets/add-secret-sheet.tsx:22 export function AddSecretSheet({ open, onOpenChange, onCreated }) // 0 importadores src/components/secrets/add-secret-sheet.tsx:36 export function AddSecretSheet(...) // usado em src/pages/secrets.tsx:10 src/components/secrets/add-secret-sheet.tsx:22-25 docblock: Replaces legacy components/sheets/add-secret-sheet.tsx which had a frontend/backend...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#9
overlaps: B-026
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 106c10e
dod:
  - Deletar src/components/sheets/add-secret-sheet.tsx agora — nao ha importador e a versao canonica ja esta em producao
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/components/sheets/add-secret-sheet.tsx` e passa depois da mudanca

## B-006 — src/components mistura tres taxonomias concorrentes (por feature, por tipo de widget, por concern) em 30 pastas irmas   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: missing_interface
evidence: src/components/sheets/add-domain-sheet.tsx:1 — Componentes com 1 unico importador (feature-private guardados por tipo): src/components/sheets/add-domain-sheet.tsx <- src/pages/domains.tsx:3 src/components/sheets/create-environment-sheet.tsx <- src/pages/environments.tsx:8 src/components/sheets/create-project-sheet.tsx <- src/pages/projects.tsx:9 src/components/sheets/invite-member-sheet.tsx <- src/pages/team.tsx:17...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#10
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Adotar UM eixo e escreve-lo no README/architecture: src/components/ passa a conter SOMENTE o que e cross-feature (ui/, layout/, error/, loading/, common/, e o confirm-dialog), e todo o resto muda para a pasta da feature dona
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/components/sheets/add-domain-sheet.tsx` e passa depois da mudanca

## B-007 — Fronteira do design system tem tres donos em tres versoes: componentes de @usetheo/ui@0.35.1, provider de tema de @theokit/ui@1.3.2, tokens...   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: leaky_abstraction
evidence: src/main.tsx:4 — package.json:78 "@theokit/ui": "^1.3.2" e package.json:87 "@usetheo/ui": "^0.35.1" src/main.tsx:4 import { TheoUIProvider, violetForge } from '@theokit/ui'; src/main.tsx:93 dark: { ...violetForge.dark, primary: 'oklch(0.57 0.13 302)' } src/main.tsx:91 comentario: O --primary vem do tema via TheoUIProvider (o index.css NAO tem efeito no primary) src/index.css:140 --primary: oklch(0.50 0.16...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#11
overlaps: B-034, B-071
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Resolver a contradicao com um teste, nao com leitura: um teste de integracao que monta a arvore com o provider real e assere getComputedStyle(document.documentElement).getPropertyValue(--primary) igual ao valor canonico. Isso transforma a duvida em gate e vale para os proximos bumps
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/main.tsx` e passa depois da mudanca

## B-008 — Raiz de src/pages: 41 arquivos de ~15 dominios sem agrupamento, 6 dos quais nao sao paginas (inclui uma pagina declarada deletada que ainda...   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: god_module
evidence: src/pages/new-folder-dialog.tsx:1 — find src/pages -maxdepth 1 -type f (sem testes) = 41 arquivos, 11.987 LOC. Nao referenciados como rota lazy em app.tsx: new-folder-dialog, previews, sub-page-placeholder, use-workspace-selection, workspace-presign, workspace-preview-sheet. src/pages/rag/wiki.tsx:16 import { NewFolderDialog } from '../new-folder-dialog'; // rag importa dialogo dono do workspace, via raiz de pages/...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#13
overlaps: B-002, B-004, B-032, B-070
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Escrever e aplicar a regra que hoje e implicita: TODO dominio vira pasta, sem excecao — a raiz de src/pages/ deve conter no maximo o not-found e o sub-page-placeholder. Promover os agrupamentos obvios ja visiveis nos nomes: project/ (project-connect, project-detail, project-readiness,...
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/pages/new-folder-dialog.tsx` e passa depois da mudanca

## B-009 — Sub-decomposicao de paginas: 32 arquivos .tsx acima de 400 LOC somando 17.735 LOC, e a maioria e UM unico componente gigante, nao varios...   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: god_module
evidence: src/pages/promptly/detail.tsx:131 — Distribuicao .tsx de producao (n=216): mediana 153 LOC; 32 arquivos acima de 400 LOC somando 17.735 LOC; apenas 4 arquivos com 5+ componentes. Maiores com UM unico componente: src/pages/promptly/detail.tsx 916 LOC (PromptDetailPage na linha 131, 15 useState, 9 useQuery), src/pages/deployments.tsx 705, src/pages/lens/evaluators.tsx 586, src/pages/skills/bundle-detail.tsx 555,...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#15
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Generalizar o gate que ja existe: trocar login-loc-budget.test.ts por uma regra de eslint (max-lines com max 500 para src/**/*.tsx) com uma allowlist explicita dos 32 arquivos atuais, e proibir que a allowlist cresca. Isso trava a divida e nao exige refactor de tudo de uma vez
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/pages/promptly/detail.tsx` e passa depois da mudanca

## B-010 — Nao existe contrato escrito de fronteira de modulo para o dashboard, e o codigo cita um que nao esta no repositorio   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: missing_interface
evidence: src/pages/lens/trace-detail.tsx:5 — src/pages/lens/trace-detail.tsx:4-5 ... was a 680-LoC view that already breached the 500-LoC architecture.md budget src/pages/lens/trace-detail/helpers.ts:5 ... dir stays under the 500-LoC budget src/pages/use-workspace-selection.ts:12 Extracted from workspace.tsx to keep that file under the LoC budget Busca por architecture.md: ausente em dashboard/ (nao ha diretorio docs/);...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#16
overlaps: B-033, B-078
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 9314954
dod:
  - Escrever dashboard/docs/architecture.md curto (uma pagina) fixando cinco decisoes que hoje sao ambiguas, e so entao migrar codigo: (1) o eixo de organizacao (feature-first sob src/features/, com src/components e src/hooks reservados ao que e cross-feature); (2) o criterio objetivo de quando um...
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/pages/lens/trace-detail.tsx` e passa depois da mudanca

## B-011 — Query keys inline em 71 dos 87 arquivos que definem queryKey — factory central so cobre 8 dominios   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: cache_invalidation_risk
evidence: src/lib/api/query-keys.ts:11 — 87 arquivos non-test contem queryKey:; apenas 17 importam @/lib/api/query-keys (16 em src/hooks + src/pages/deployment-detail-layout.tsx). 60 dos 87 sao paginas, e nenhuma delas usa a factory exceto deployment-detail-layout.
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#1
overlaps: B-019, B-036
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Mover query-keys.ts para um factory por feature (src/features/<feature>/api/query-keys.ts) e proibir tupla literal via lint rule (@tanstack/eslint-plugin-query exige-query-key-factory nao existe, mas um no-restricted-syntax sobre ObjectProperty[key.name=queryKey] > ArrayExpression resolve)
  - existe teste que falha hoje e passa depois, provando que `invalidateQueries` alcanca a chave afetada a partir de `src/lib/api/query-keys.ts`

## B-012 — Acesso a dados vive nas paginas: 58 arquivos de src/pages e 13 de src/components chamam cloudFetch/engineFetch direto   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: state_synchronization_issue
evidence: src/pages/lens/traces.tsx:1 — grep -rln cloudFetch|engineFetch|apiFetch: 58 arquivos em src/pages, 13 em src/components. 102 chamadas de useQuery() em 56 arquivos de src/pages de um total de 126 no repo (81% do fetching mora em paginas). 75 useMutation() em 36 paginas. Em src/hooks/ ha 46 hooks mas eles cobrem quase so o dominio Deploy.
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#2
overlaps: B-052, B-053
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Extrair um modulo de data-access por feature no padrao ja emergente em src/components/promptly/promptly-api.ts, src/components/trust/trust-api.ts e src/components/skills/skills-api.ts, movido para src/features/<feature>/api/ + src/features/<feature>/hooks/
  - `src/pages/lens/traces.tsx` deixa de conter a logica apontada e ha teste cobrindo o novo dono

## B-013 — Promote-to-production e rollback fazem fetch cru, pulando o pipeline de auth/erro do cloudFetch   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: state_synchronization_issue
evidence: src/components/dialogs/promote-to-production-dialog.tsx:113 — promote-to-production-dialog.tsx:113 usa `await fetch(`${API_URL}/engine/api/v1/projects/.../promote`, {headers:{Authorization: `Bearer ${token}`}})` com token vindo de ensureSSEToken(); mesmo padrao em src/components/dialogs/rollback-dialog.tsx:93. cloudFetch (src/lib/api.ts:226) faz refresh-e-retry no 401 (linha 314) e maybeEmitPaymentRequired no 402 (linha 381) — nada disso roda nestes dois...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#3
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 702fc1d
dod:
  - Trocar por cloudFetch(path,{method:POST,body},{throwOnError:true}) de src/lib/api.ts:226 e mover a chamada para src/hooks/mutations/use-promote.ts e use-rollback.ts (src/hooks/mutations/ ja existe com 7 mutations)
  - `src/components/dialogs/promote-to-production-dialog.tsx` deixa de conter a logica apontada e ha teste cobrindo o novo dono

## B-014 — Recuperacao de token no SSE exige 3 erros consecutivos, mas um 401 fecha o EventSource no primeiro   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: state_synchronization_issue
evidence: src/hooks/use-sse-stream.ts:184 — use-sse-stream.ts:66 `const TOKEN_REFRESH_THRESHOLD = 3`; :179-196 `es.onerror = () => { failureCount += 1; if (failureCount >= TOKEN_REFRESH_THRESHOLD) { clearToken(); es?.close(); void open(); } }`. O teste nao pega porque o MockEventSource de use-sse-stream.test.tsx:65 expoe triggerError() sem nunca setar readyState=2, entao o teste consegue emitir 3 erros seguidos que o browser real nunca...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#4
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: d395601 (o MockEventSource nunca setava readyState=2 — era por isso que a suite nao pegava; ganhou triggerFatalError e as constantes da spec)
dod:
  - Em src/hooks/use-sse-stream.ts:179, tratar `es.readyState === EventSource.CLOSED` como sinal terminal e refazer o token+reconexao imediatamente (threshold 1 nesse caso), mantendo o contador de 3 apenas para o caminho de reconexao nativa
  - `src/hooks/use-sse-stream.ts` deixa de conter a logica apontada e ha teste cobrindo o novo dono

## B-015 — use-status-stream abre EventSource cru com estrategia de auth divergente da primitiva useSSEStream   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: state_synchronization_issue
evidence: src/hooks/use-status-stream.ts:194 — use-status-stream.ts:193-194 `const url = `/engine/api/v1/projects/.../signals/stream?env=...`; const es = new EventSource(url, { withCredentials: true });` — sem token. Compare com src/hooks/use-sse-stream.ts:146-156 que monta `${API_URL}${path}?token=${encodeURIComponent(token)}` apos ensureSSEToken(). Os outros 3 consumidores (use-log-stream, use-deployment-stream,...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#5
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 4c52dc1
risco_aberto: a primitiva autentica por ?token= na URL; a versao anterior usava cookie (withCredentials). Confirmar com o BACKEND que /signals/stream aceita token na query antes de a UI voltar a consumir o hook. Seguro hoje porque B-051 removeu o unico consumidor.
dod:
  - Reescrever src/hooks/use-status-stream.ts:180-226 como wrapper de useSSEStream({eventTypes:["signal.changed"], maxEvents:...}) preservando o reducer puro applySignalEvent (que ja e testavel isoladamente e deve ficar em src/hooks/use-status-stream.reducer.ts)
  - `src/hooks/use-status-stream.ts` deixa de conter a logica apontada e ha teste cobrindo o novo dono

## B-016 — Snapshot historico de logs (Loki REST) entra sem cap e anula o FIFO de 5000 linhas do stream   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: unbounded_collection
evidence: src/pages/deployment-tabs/logs-tab.tsx:163 — logs-tab.tsx:163 setHistorical((data.entries ?? []).map(toLogLine)) sem slice/cap; logs-tab.tsx:191 [...historical, ...stream.lines] reconstroi o array inteiro a cada evento SSE; src/components/logs/log-viewer.tsx:58 comenta acceptable up to ~5000 lines / for larger streams we would need react-virtual - deferred, e log-viewer.tsx:236 faz filtered.map(...) direto. @tanstack/react-virtual JA e...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#6
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: ed05370 (residuo: a virtualizacao do LogViewer — B-025 — segue aberta; o cap reduz o pior caso mas nao dispensa virtualizar 5000 linhas)
dod:
  - Cortar o snapshot no mesmo cap do stream (entries.slice(-5000)) em src/pages/deployment-tabs/logs-tab.tsx:163
  - existe teste que prova o teto/dedup em `src/pages/deployment-tabs/logs-tab.tsx` sob carga sintetica

## B-017 — O caminho de CREATE de 3 recursos vive no componente de sheet e nao invalida cache; o hook de mutation correspondente esta orfao   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: cache_invalidation_risk
evidence: src/components/sheets/add-domain-sheet.tsx:54 — Consumidores non-test: useAddDomain=0, useCreateEnvironment=0, useInviteMember=0; useDeleteDomain=1, useVerifyDomain=2, useDeleteEnvironment=1, usePromoteEnvironment=1, useRemoveMember=1, useUpdateMemberRole=1. add-domain-sheet.tsx:54 `await engineFetch<Domain>("/api/v1/domains", {method:POST, body: JSON.stringify({domain, project, app, environment})})` seguido de `onAdded?.(res)` — sem...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#10
overlaps: B-058, B-059, B-060
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 78b0f6e
dod:
  - Deletar o engineFetch dos sheets e consumir useAddDomain / useCreateEnvironment / useInviteMember (src/hooks/mutations/), alinhando o payload com o do sheet (que e o que o backend aceita hoje)
  - existe teste que falha hoje e passa depois, provando que `invalidateQueries` alcanca a chave afetada a partir de `src/components/sheets/add-domain-sheet.tsx`

## B-018 — Recurso domains tem dois namespaces de query key independentes — invalidar um nunca alcanca o outro   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: cache_invalidation_risk
evidence: src/hooks/use-domain-status-polling.ts:55 — use-domain-status-polling.ts:55 `queryKey: ["engine", `/api/v1/domains/${domainName}`] as const`; src/hooks/mutations/use-domains.ts:4 `const DOMAINS_KEY = ["domains"] as const` usado nos onSuccess das linhas 15, 27 e 40. src/lib/api/query-keys.ts nao tem entrada domains.
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#11
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: af6532c
dod:
  - Adicionar `domains: { all, list(filters), detail(name) }` em src/lib/api/query-keys.ts e trocar as duas chaves literais por ela, para que invalidate(["domains"]) alcance lista e detalhe
  - existe teste que falha hoje e passa depois, provando que `invalidateQueries` alcanca a chave afetada a partir de `src/hooks/use-domain-status-polling.ts`

## B-019 — Ha TRES convencoes de query key competindo; a que src/lib/api/query-keys.ts define e minoria (12% dos 208 sites)   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: cache_invalidation_risk
evidence: src/hooks/use-api.ts:40 — Contagem por primeiro elemento da tupla em 208 sites: cloud=130, queryKeys.*=25, engine=5, variaveis locais nomeadas=~30, outros literais (storage-object, build-envs, build-stats, provisioning-status, dashboard, billing)=6. Exemplo do custo em src/pages/promptly/detail.tsx: 9 useQuery com ["cloud","/v1/dashboard/promptly/prompts", promptName, ...] repetido nas linhas 153, 181, 218, 229, 242 e...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#13
overlaps: B-011, B-036
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Nao migrar as 130 para query-keys.ts — formalizar a convencao que ja venceu
  - existe teste que falha hoje e passa depois, provando que `invalidateQueries` alcanca a chave afetada a partir de `src/hooks/use-api.ts`

## B-020 — A aba Timeline do deploy abre TRES EventSource, duas delas para a MESMA URL — SSE nao tem dedup por conexao   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: missing_backpressure
evidence: src/hooks/use-deploy-timeline-with-steps.ts:31 — deployment-detail-layout.tsx:142 `<DeployTimelineHero deployId={build.build_id} .../>` -> deploy-timeline-hero.tsx:79 useDeployTimelineWithSteps(deployId) -> use-deploy-timeline-with-steps.ts:30-32 chama useDeployTimeline(deployID) [path /engine/api/v1/deploys/{id}/timeline, use-deploy-timeline.ts:126] E useDeploymentStream(deployID) [path /engine/api/v1/builds/{id}/stream,...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#18
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
analise_2026-08-06: as TRES conexoes foram localizadas com precisao. Na rota index de deployment-detail-layout.tsx, coexistem DeployTimelineHero (linha 142) e o <Outlet/> (linha 184) que renderiza TimelineTab. O hero chama useDeployTimelineWithSteps -> useDeployTimeline (1 SSE) + useDeploymentStream(deployId) (1 SSE); a TimelineTab renderiza BuildTimelineLive -> useDeploymentStream(build.build_id) (1 SSE). As duas ultimas apontam para a MESMA URL quando deployId == build_id. POR QUE NAO FECHEI: as duas opcoes do achado custam mais do que parecem. (a) "passar os steps por prop" nao se aplica direto — hero e aba sao IRMAOS via Outlet, nao pai e filho, entao exigiria um contexto no layout e uma decisao sobre quem e dono do stream (decisao de composicao de UI). (b) o registry por URL dentro de useSSEStream fecha a classe, mas precisa unir eventTypes divergentes entre consumidores, conciliar `paused` por assinante e compartilhar lastEventID — muito para uma primitiva que acabou de mudar em B-014, e sem teste que cubra a interacao. Recomendacao: (a) com um contexto no layout, decidindo que o HERO e o dono e a aba consome. O custo real e de composicao, nao de SSE.
dod:
  - Ou (a) BuildTimelineLive passa a receber os steps por prop do hero em vez de reabrir o stream, ou (b) introduzir um registry de EventSource por URL em src/hooks/use-sse-stream.ts (Map<url, {es, refCount, buffer}>) para que N assinantes da mesma URL compartilhem uma conexao — o equivalente do que...
  - existe teste que prova o teto/dedup em `src/hooks/use-deploy-timeline-with-steps.ts` sob carga sintetica

## B-021 — Chunk vendor eager de 1.59 MB (397 KB brotli) — manualChunks joga TODO node_modules nao-React num unico chunk modulepreload   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: memory_inefficiency
evidence: src/build/manual-chunks.ts:45 — MEDIDO em build limpo (npm run build, 2026-08-06): dist/assets/vendor-B11nP9-F.js raw=1593511 B, brotli=397109 B (node zlib.brotliCompressSync). dist/index.html emite modulepreload para react-vendor (52374 B br), router (12592 B br) e vendor (397109 B br) => 462 KB brotli de JS eager antes de qualquer rota. Total dos 128 chunks .js = 858495 B brotli. Limite declarado no package.json size-limit...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · scaling#1
overlaps: B-073
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Em src/build/manual-chunks.ts, parar de mapear todo node_modules para vendor
  - o tamanho brotli do conjunto eager e re-medido com `ANALYZE=true npm run bundle:analyze` e registrado antes/depois

## B-022 — O orcamento de bundle (size-limit) esta desatualizado: 3 das 9 entradas apontam para chunks que nao existem mais e o HARD GATE total esta...   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (heuristic)
category: memory_inefficiency
evidence: package.json:43 — MEDIDO: ls dist/assets | grep para cada glob declarado — react-vendor-*.js=1, vendor-*.js=1, router-*.js=1, index-*.js=1, register-*.js=1, mas theo-ui-*.js=0, radix-*.js=0, lucide-*.js=0. Soma brotli de dist/assets/*.js (glob da entrada TOTAL) = 858495 B contra limite declarado de 225 KB = 230400 B. NAO MEDIDO pela ferramenta: npx size-limit aborta neste ambiente com TimeoutError do puppeteer...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · scaling#2
overlaps: B-035
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Alinhar as entradas do package.json aos chunks que src/build/manual-chunks.ts realmente emite: remover 02/03/06 (theo-ui, radix, lucide) ou reintroduzir esses chunks
  - o tamanho brotli do conjunto eager e re-medido com `ANALYZE=true npm run bundle:analyze` e registrado antes/depois

## B-023 — A virtualizacao da arvore de spans nunca foi implementada: @tanstack/react-virtual tem 0 import sites e VIRTUALIZE_THRESHOLD nao e lido por...   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: missing_pagination
evidence: src/pages/lens/trace-detail/helpers.ts:48 — MEDIDO: grep -rn "from '@tanstack/react-virtual'" src e2e => 0 resultados (a dep direta do package.json nao tem um unico import de codigo de app). grep -rn VIRTUALIZE_THRESHOLD src (sem testes) => 4 hits, todos declaracao/re-export/comentario: helpers.ts:48 (declaracao), helpers.ts:8 (comentario), trace-detail.tsx:13 e :24 (re-export do shim). Zero leituras em condicional de render. CORRECAO...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · scaling#3
overlaps: B-062
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Trocar src/pages/lens/trace-detail/index.tsx:157 de <SpanTree> para o SpanTreeVirtual que @usetheo/ui ja exporta, acionando-o quando flattenVisible (linha 79) passar de VIRTUALIZE_THRESHOLD — a virtualizacao ja esta implementada e testada no design system, nao precisa ser escrita aqui
  - o request emitido por `src/pages/lens/trace-detail/helpers.ts` carrega teto explicito (limit/offset) — verificavel no painel Network ou por teste sobre o handler MSW

## B-024 — A pagina de Audit busca GET /api/v1/audit sem limit nem offset e renderiza toda a resposta — audit log e a tabela append-only por definicao   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: unbounded_query
evidence: src/pages/audit.tsx:87 — MEDIDO por varredura AST-lite de todos os literais de URL passados a cloudFetch/engineFetch em src (excluindo testes e mocks): 185 literais distintos, dos quais apenas 6 carregam limit/offset/page — /engine/api/v1/projects?limit=, /v1/dashboard/lens/labeling-queue?page=, /v1/dashboard/lens/sessions?limit=&offset=, /v1/dashboard/lens/traces (via buildTraceQuery com limit/offset),...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · scaling#4
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Adicionar limit/offset ao request em src/pages/audit.tsx:87 e expor paginacao na UI, seguindo o padrao ja existente em src/pages/lens/sessions.tsx:54-60 (SESSIONS_PAGE_SIZE + calculo de pageCount)
  - o request emitido por `src/pages/audit.tsx` carrega teto explicito (limit/offset) — verificavel no painel Network ou por teste sobre o handler MSW

## B-025 — LogViewer materializa uma linha de DOM por linha de log, sem virtualizacao, e o teto de 5000 que ele assume nao existe no caminho real   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: missing_pagination
evidence: src/components/logs/log-viewer.tsx:237 — MEDIDO por leitura do caminho completo: log-viewer.tsx:109 filtra sem cortar; :237 mapeia o resultado inteiro para DOM; nao ha useVirtualizer nem windowing em nenhum ponto do arquivo. use-log-stream.ts:40 define maxLines=5000 e :43 o repassa como maxEvents ao FIFO de use-sse-stream.ts:123. logs-tab.tsx:156 faz engineFetch(/api/v1/builds/{id}/logs) sem parametro de limite e :191 concatena esse...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · scaling#6
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Virtualizar a lista em src/components/logs/log-viewer.tsx:237
  - o request emitido por `src/components/logs/log-viewer.tsx` carrega teto explicito (limit/offset) — verificavel no painel Network ou por teste sobre o handler MSW

## B-026 — Duplicate AddSecretSheet: legacy orphan with known backend schema mismatch still in tree   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: dead_feature_path
evidence: src/components/sheets/add-secret-sheet.tsx:22 — src/components/sheets/add-secret-sheet.tsx:22 exports AddSecretSheet with ZERO importers (grep across src/, e2e/, .storybook/ finds only self-references). The live component is src/components/secrets/add-secret-sheet.tsx:36, imported by src/pages/secrets.tsx:10 and covered by src/components/secrets/add-secret-sheet.test.tsx. The canonical docblock (secrets/add-secret-sheet.tsx:24-28) states...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#1
overlaps: B-005
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 106c10e
dod:
  - git rm src/components/sheets/add-secret-sheet.tsx; verify with npx tsc --noEmit && npm test
  - `npx tsc --noEmit` e `npm test` passam apos a remocao/wiring, e `npx knip` nao reporta mais o simbolo de `src/components/sheets/add-secret-sheet.tsx`

## B-027 — Orphan directory src/components/scaling/ shadows the live src/components/scale/   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: dead_feature_path
evidence: src/components/scaling/scale-dialog.tsx:36 — src/components/scaling/ contains exactly one file, scale-dialog.tsx (178 LOC), exporting ScaleDialog at line 36 with ZERO importers anywhere in src/, e2e/ or .storybook/ - grep for ScaleDialog returns only self-references. The live scaling UI lives in the sibling src/components/scale/ (hpa-toggle, keda-toggle, scale-confirm-dialog, scale-slider) where every component has a colocated .test.tsx;...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#2
overlaps: B-040
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 106c10e
dod:
  - Delete the whole src/components/scaling/ directory (git rm on its single file, then the empty dir)
  - `npx tsc --noEmit` e `npm test` passam apos a remocao/wiring, e `npx knip` nao reporta mais o simbolo de `src/components/scaling/scale-dialog.tsx`

## B-028 — PreviewsPage declared deleted in three files but still in the tree, with its private hook   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: dead_feature_path
evidence: src/pages/previews.tsx:51 — Three separate source files assert this page was removed: src/app.tsx:308 (PreviewsPage deleted per plan 2026-06-08-dashboard-screens-review-fixes), src/pages/pages.smoke.test.ts:128 (PreviewsPage smoke test deleted per plan), src/test/e2e-journeys.test.tsx:64 (use-previews mock removed per plan). The route was replaced by a PreviewsRedirect stub at src/app.tsx:313. Yet src/pages/previews.tsx...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#3
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 106c10e
dod:
  - git rm src/pages/previews.tsx src/hooks/use-previews.ts
  - `npx tsc --noEmit` e `npm test` passam apos a remocao/wiring, e `npx knip` nao reporta mais o simbolo de `src/pages/previews.tsx`

## B-029 — src/lib/api.ts is unexcisable: 151 importers across 51 feature dirs pulling 12+ distinct symbols   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (heuristic)
category: tangled_module
evidence: src/lib/api.ts:1 — Measured with a static import graph over all 673 .ts/.tsx files under src/ (resolving @/ and relative specifiers to real files). src/lib/api.ts has 151 direct importers, 103 of them non-test, spread over 51 distinct feature directories - the largest single fan-in in the codebase and 30x the >5 tangled heuristic. Crucially the interface is NOT narrow: importers pull 12+ distinct symbols...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#11
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Split by reason-to-change before the fan-in grows further: move the token lifecycle (lines 110-224) into src/lib/api/session.ts, keep transport (cloudFetch/engineFetch/cloudFetchRaw) and ApiError in the entry module, and fold the file into the existing src/lib/api/ directory as...
  - a contagem de importadores diretos de `src/lib/api.ts` cai de forma medida (registrar o antes/depois com o mesmo parser de imports usado na auditoria)

## B-030 — Two user-facing hooks are wired to nothing but their own tests: useDomainStatusPolling and useFirstDeployTrigger   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: dead_feature_path
evidence: src/hooks/use-domain-status-polling.ts:50 — An import graph over all 673 src files (resolving @/ and relative specifiers) finds exactly two of the 39 hooks in src/hooks/ with zero non-test importers, and grep confirms both. (1) useDomainStatusPolling, src/hooks/use-domain-status-polling.ts:50 (101 LOC, added 2026-06-15, 52 days) - its only importer is src/hooks/use-domain-status-polling.test.tsx:12. It even exports two test-only escape...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#20
overlaps: B-031, B-069, B-076
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Per hook, decide and act - do not leave them
  - `npx tsc --noEmit` e `npm test` passam apos a remocao/wiring, e `npx knip` nao reporta mais o simbolo de `src/hooks/use-domain-status-polling.ts`

## B-031 — Twelve modules (935 LOC + 844 LOC of tests) have no importer except their own test file   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: high (consensus)
category: dead_feature_path
evidence: src/pages/lens/compare-core.ts:1 — Built a static import graph over all 673 src files, then re-verified every candidate with a per-module quoted-specifier grep across src/, e2e/, .storybook/, vite.config.ts and vitest.config.ts. Twelve modules have PROD=0 importers and TEST>=1: src/pages/lens/compare-core.ts (188 LOC, added 2026-07-04) - src/pages/lens/compare.tsx imports react-router, @usetheo/ui, ./trace-detail and...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#23
overlaps: B-030, B-069, B-076
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Triage in two buckets rather than deleting blindly
  - `npx tsc --noEmit` e `npm test` passam apos a remocao/wiring, e `npx knip` nao reporta mais o simbolo de `src/pages/lens/compare-core.ts`

## B-032 — Estrategia de organizacao de codigo: package-by-layer no topo (pages/ components/ hooks/ lib/) com feature-folders aninhados dentro de cada...   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: coupling_vs_cohesion
evidence: src:1 — src/ tem 4 camadas de producao: pages/ 246 arquivos, components/ 243, hooks/ 79, lib/ 89. Feature 'deploy' espalhada por 4 camadas/25 arquivos; 'lens' por 3 camadas/57 arquivos. 33 dos 44 hooks tem UMA unica feature consumidora (nao sao compartilhados — estao em hooks/ so por conta da camada). So 7 dos 39 modulos de lib/ sao realmente compartilhados. Acoplamento medido e BAIXO: 1.084 arestas...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#1
overlaps: B-002, B-004, B-008, B-070
adr_draft: dashboard/system-design-output/adrs/
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
partial_progress: 9314954 — ADR-0001 (eixo + regra de residencia) escrito e versionado em dashboard/docs/adr/. NAO fechado: o ADR esta em status proposed. Declara-lo accepted e decisao do time, nao de quem escreveu o rascunho.
dod:
  - Escrever um ADR curto que declare o eixo de organizacao e a regra de residencia ('um hook com um unico consumidor mora com a feature; lib/ so aceita modulo com >=2 features consumidoras'), e entao migrar incrementalmente para package-by-feature comecando por lens e deploy — as duas com maior...
  - mudanca verificavel em `src` com `npx tsc --noEmit` + `npm test` verdes

## B-033 — Adotar um orcamento de 500 LoC por modulo como regra de arquitetura, citando um documento 'architecture.md' que nao existe neste repositorio   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: complexity_vs_simplicity
evidence: src/pages/lens/trace-detail.tsx:5 — src/pages/lens/trace-detail.tsx:4-5 'was a 680-LoC view that already breached the 500-LoC `architecture.md` budget'. src/pages/lens/trace-detail/helpers.ts:5 'stays under the 500-LoC budget'. src/pages/use-workspace-selection.ts:12 'Extracted from workspace.tsx to keep that file under the LoC budget'. grep -rn 'architecture.md' em docs/ e dashboard/ nao retorna nenhum arquivo alvo; grep -n...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#2
overlaps: B-010, B-078
adr_draft: dashboard/system-design-output/adrs/
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
partial_progress: 9314954 — ADR-0002 (orcamento de LoC) escrito e versionado; as citacoes no codigo agora resolvem. NAO fechado: o ADR esta em status proposed. Declara-lo accepted e decisao do time, nao de quem escreveu o rascunho.
dod:
  - Escolher um dos dois: (a) promover o orcamento a regra executavel — ESLint 'max-lines' com o valor 500 e um override list para os arquivos legados — e apagar as citacoes ao documento fantasma; ou (b) declarar o orcamento morto e remover as citacoes
  - mudanca verificavel em `src/pages/lens/trace-detail.tsx` com `npx tsc --noEmit` + `npm test` verdes

## B-034 — Valor do token --primary definido em DOIS lugares, cada um com docblock afirmando ser o que vale em runtime, com valores diferentes   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: other
evidence: src/index.css:140 — src/main.tsx:88-96 comentario 'o index.css NAO tem efeito no primary' + light/dark primary = 'oklch(0.57 0.13 302)'. src/index.css:140 '--primary: oklch(0.50 0.16 296.97);' sob :root, e src/index.css:150 o mesmo valor sob '.dark', precedido do comentario 'This is the block the app actually uses at runtime'. As duas afirmacoes sao mutuamente exclusivas. Nenhum teste fixa o valor computado de...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#5
overlaps: B-007, B-071
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Medir uma vez com getComputedStyle no app buildado, apagar o perdedor, e fixar o vencedor num teste de regressao (jsdom nao resolve cascade de @import; use um teste Playwright que le getComputedStyle(document.body).getPropertyValue('--primary'))
  - mudanca verificavel em `src/index.css` com `npx tsc --noEmit` + `npm test` verdes

## B-035 — Orcamento de bundle enforced por size-limit com HARD GATE de 225KB brotli — configurado contra chunks que nao existem mais   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: performance_vs_readability
evidence: package.json:22 — package.json:26-40 entradas 02/03/06 apontam para 'dist/assets/theo-ui-*.js', 'radix-*.js', 'lucide-*.js'. ls dist/assets/ retorna apenas index-*, react-vendor-*, router-*, vendor-* entre os chunks nomeados — nenhum theo-ui/radix/lucide. package.json:67-71 'TOTAL initial JS — HARD GATE' limit '225 KB' vs 485KB brotli medidos na Fase 5a. src/build/manual-chunks.ts:30-36 documenta a fusao que...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#11
overlaps: B-022
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Reescrever as entradas para os chunks que existem hoje (react-vendor, router, vendor, index) e reancorar o TOTAL no valor medido com um plano de reducao — ou apagar o size-limit
  - mudanca verificavel em `package.json` com `npx tsc --noEmit` + `npm test` verdes

## B-036 — Acesso a dados sem camada dedicada: TanStack Query chamado direto das paginas, com tres convencoes concorrentes de query key   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: high (consensus)
category: coupling_vs_cohesion
evidence: src/lib/api/query-keys.ts:1 — src/lib/api/query-keys.ts:1-9 docblock T1.2 declarando a factory centralizada, o fold do EC-05 e a convencao hierarquica para invalidate. Medido: 74 arquivos de src/ chamam useQuery(, 56 deles em src/pages/; apenas 18 arquivos importam query-keys. Fase 2 mediu 102/126 useQuery e 75/75 useMutation fora de hooks residindo em paginas, e 3 convencoes de key coexistindo (130 tuplas ad-hoc, 25 via...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#16
overlaps: B-011, B-019
adr_draft: dashboard/system-design-output/adrs/
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Nao criar uma camada nova — tornar obrigatoria a que ja existe
  - mudanca verificavel em `src/lib/api/query-keys.ts` com `npx tsc --noEmit` + `npm test` verdes

## B-037 — Ciclo runtime pages/lens/traces/columns.tsx <-> pages/lens/traces.tsx   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (heuristic)
category: circular_dependency
evidence: src/pages/lens/traces/columns.tsx:6 — src/pages/lens/traces/columns.tsx:6 import { nsToIso } from '../traces'; src/pages/lens/traces.tsx:20 import { tracesColumns, type Trace } from './traces/columns';
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#2
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 9ef2466
dod:
  - Extrair nsToIso (e demais helpers puros de traces.tsx) para src/pages/lens/traces/helpers.ts — mesmo padrao ja usado com sucesso em trace-detail/helpers.ts
  - `npx madge --extensions ts,tsx --ts-config tsconfig.json --circular src` nao lista mais o ciclo que passa por `src/pages/lens/traces/columns.tsx`

## B-038 — Ciclo runtime pages/workspace.tsx <-> pages/workspace-preview-sheet.tsx (pagina exporta dominio)   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (heuristic)
category: circular_dependency
evidence: src/pages/workspace-preview-sheet.tsx:4 — src/pages/workspace.tsx:22 import { useWorkspaceSelection } from './use-workspace-selection'; src/pages/workspace.tsx:23 import { WorkspacePreviewSheet } from './workspace-preview-sheet'; src/pages/workspace-preview-sheet.tsx:4 import { formatBytes, previewKind, type StorageFile } from './workspace'; // VALOR -> ciclo runtime src/pages/use-workspace-selection.ts:6 import type { StorageFile }...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#3
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 9ef2466
dod:
  - Criar src/features/workspace/ (ou src/pages/workspace/) com: types.ts (StorageFile), helpers.ts (formatBytes, previewKind), use-workspace-selection.ts, preview-sheet.tsx e index.tsx (a rota)
  - `npx madge --extensions ts,tsx --ts-config tsconfig.json --circular src` nao lista mais o ciclo que passa por `src/pages/workspace-preview-sheet.tsx`

## B-039 — lib/auth.ts e lib/api.ts (producao) dependem de lib/dev-mocks.ts (camada de mock), formando ciclo auth<->dev-mocks   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (heuristic)
category: cross_boundary_import
evidence: src/lib/auth.ts:18 — src/lib/auth.ts:18 import { mocksEnabled, getMockSession } from './dev-mocks'; src/lib/auth.ts:92 if (mocksEnabled()) return getMockSession(); src/lib/api.ts:14 import { mocksEnabled } from './dev-mocks'; src/lib/dev-mocks.ts:19 import type { Session } from './auth'; madge: ciclos 1) lib/api.ts > lib/dev-mocks.ts > lib/auth.ts 2) lib/dev-mocks.ts > lib/auth.ts
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#4
overlaps: B-049, B-067
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 9ef2466
dod:
  - Mover o tipo Session para src/lib/api/types.ts (que ja existe e ja e a ACL de tipos do backend) e importa-lo de la tanto em auth.ts quanto em dev-mocks.ts — quebra o ciclo sem tocar em runtime
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/lib/auth.ts` e passa depois da mudanca

## B-040 — Dois diretorios para o mesmo conceito: src/components/scale/ e src/components/scaling/ (o segundo esta morto)   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (heuristic)
category: cross_boundary_import
evidence: src/components/scaling/scale-dialog.tsx:36 — src/components/scale/ -> hpa-toggle.tsx, keda-toggle.tsx, scale-confirm-dialog.tsx, scale-slider.tsx (4 importados por src/pages/project-scale.tsx:11-14) src/components/scaling/ -> scale-dialog.tsx (178 LOC, export function ScaleDialog na linha 36) grep -rn ScaleDialog src e2e => apenas as 4 ocorrencias dentro do proprio arquivo. Zero importadores.
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#8
overlaps: B-027
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 106c10e
dod:
  - Deletar src/components/scaling/ inteiro (o componente e orfao e ScaleConfirmDialog em components/scale/ ja cobre o caso de dialogo de escala)
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/components/scaling/scale-dialog.tsx` e passa depois da mudanca

## B-041 — src/lib e um saco plano de 31 modulos onde apenas 7 sao realmente compartilhados; lens e auth tem submodulos de dominio escondidos la   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (heuristic)
category: god_module
evidence: src/lib/trace-layout.ts:1 — Compartilhados de fato (2+ features): src/lib/api.ts(20), api/types.ts(7), format.ts(8), api/query-keys.ts(6), rum.ts(4), readiness/signals.ts(2), domain.ts(2). Privados de lens: trace-layout.ts(370 LOC), span-status.ts, lens-error.ts, traces-export.ts, otel-attributes.ts, usage-series.ts, usage-summary.ts, download.ts. Auth em duas formas: src/lib/auth.ts, src/lib/auth-policy.ts,...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#12
overlaps: B-068
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Mover os 8 modulos de lens para features/lens/lib/ (ou pages/lens/lib/ se a migracao por feature ainda nao comecou) — sao domain logic, nao utilidade
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/lib/trace-layout.ts` e passa depois da mudanca

## B-042 — src/lib/api.ts guarda o estado de sessao em 6 variaveis mutaveis de modulo e abre um BroadcastChannel como efeito colateral de import, para...   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (heuristic)
category: shared_mutable_state
evidence: src/lib/api.ts:61 — src/lib/api.ts:61 let accessToken: string | null = null; src/lib/api.ts:62 let tokenExpiresAt = 0; src/lib/api.ts:63 let refreshPromise: Promise<boolean> | null = null; src/lib/api.ts:73 let authChannel: BroadcastChannel | null = null; src/lib/api.ts:74-86 try { authChannel = new BroadcastChannel('theo-auth'); authChannel.onmessage = ... redirectToLogin('expired'); } <- efeito colateral no...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#14
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 2e9cd47 (o singleton em memoria foi MANTIDO de proposito — o token precisa ser legivel fora da arvore React; faltava ciclo de vida, nao inversao de dependencia)
dod:
  - Mover a criacao do BroadcastChannel para uma funcao installAuthChannel() chamada explicitamente em main.tsx, junto do resto do bootstrap — o import passa a ser puro e o teardown fica possivel (a funcao retorna um dispose)
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/lib/api.ts` e passa depois da mudanca

## B-043 — promptly importa 3 niveis fundo no interior do lens e replica a DSL de URL do lens sem contrato compartilhado   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (heuristic)
category: cross_boundary_import
evidence: src/pages/promptly/traces-link.ts:1 — src/pages/promptly/traces-link.ts:1 import { type ColumnState, encodeColumns } from '../lens/traces/view-encoding'; src/pages/promptly/traces-link.ts const ROTA_DO_EXPLORADOR = '/observability/traces'; // rota do lens duplicada src/pages/promptly/traces-link.ts span_query: `attr:${ATRIBUTO_DO_PROMPT}=${promptName}` // DSL do lens reimplementada por interpolacao...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#18
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 86c4b47
dod:
  - O lens deve exportar o construtor do link, nao os tijolos
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/pages/promptly/traces-link.ts` e passa depois da mudanca

## B-044 — O padrao arquivo+pasta homonimos aparece 16 vezes com DUAS semanticas opostas e apenas 1 index.ts em todo o conjunto   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (consensus)
category: missing_interface
evidence: src/pages/lens/traces.tsx:20 — 16 pares X.(ts|tsx) + X/ em src/: pages/lens/traces.tsx 480 LOC / traces 9 arq / index=nao pages/lens/dashboards.tsx 439 / 3 / nao pages/lens/labeling-queue.tsx 279 / 3 / nao pages/lens/session-detail.tsx 221 / 3 / nao pages/lens/playground.tsx 102 / 3 / nao pages/lens/trace-detail.tsx 30 / 7 / SIM <- unico shim, unico index pages/memory.tsx 280 / 13 / nao ; pages/skills.tsx 263 / 7 / nao ;...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · boundary#19
overlaps: B-001, B-079
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Padronizar na semantica A, que e a de 15 dos 16 casos e a mais legivel: X.tsx e o root, X/ sao as partes, e ninguem dentro de X/ importa X
  - existe regra executavel (ESLint/dependency-cruiser) que FALHA no estado atual de `src/pages/lens/traces.tsx` e passa depois da mudanca

## B-045 — Padrao snapshot-REST + delta-SSE reimplementado a mao em logs-tab com useState, em vez do hook que ja resolve   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (heuristic)
category: state_synchronization_issue
evidence: src/pages/deployment-tabs/logs-tab.tsx:128 — logs-tab.tsx:128-136 declara paused/historical/historicalLoading/historicalError/refreshing; :152-177 fetch manual; :211-227 handleRefresh duplica o mesmo fetch; :190 merge. Compare com src/hooks/use-deployments-list-stream.ts:82-193 que encapsula snapshot+delta+refetch atras de uma interface.
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#7
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 98a292f (fechou tambem um escape do proprio B-016 — o Refresh manual escrevia o snapshot sem cap — e corrigiu um guard de click-storm que lia state em vez de ref)
dod:
  - Extrair src/hooks/use-build-logs.ts (snapshot REST + useLogStream + merge + refetch), espelhando a assinatura de src/hooks/use-deployments-list-stream.ts:54
  - `src/pages/deployment-tabs/logs-tab.tsx` deixa de conter a logica apontada e ha teste cobrindo o novo dono

## B-046 — Estado de URL tem duas implementacoes: nuqs em 7 arquivos, useSearchParams cru em 28 — e traces.tsx usa as duas ao mesmo tempo   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (consensus)
category: state_synchronization_issue
evidence: src/pages/lens/traces.tsx:204 — traces.tsx:128-148 declara 11 useQueryState; traces.tsx:204 `const [searchParams, setSearchParams] = useSearchParams();` e traces.tsx:224 `setSearchParams(new URLSearchParams(queryString.replace(/^\?/, "")))` substitui a query inteira. Contagem: 7 arquivos importam nuqs, 28 importam useSearchParams (src/pages/lens/*, src/pages/memory/*, secrets, team, projects, domains...).
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#8
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Definir nuqs como a unica API de estado de URL para filtros/paginacao e reservar useSearchParams do react-router para o que o roteador realmente possui (callbacks OAuth, ?flow= do Kratos)
  - `src/pages/lens/traces.tsx` deixa de conter a logica apontada e ha teste cobrindo o novo dono

## B-047 — Estado de servidor guardado em useState com polling manual por setInterval, ao lado de hooks que ja fazem isso declarativamente   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (heuristic)
category: state_synchronization_issue
evidence: src/pages/project-connect.tsx:170 — project-connect.tsx:68 `const [conn, setConn] = useState<ProjectConnection|null>(null)` (13 useState no total, 696 LOC) e :170 `const id = window.setInterval(async () => {...}, POLL_INTERVAL_MS)`; src/pages/billing.tsx:91 `const poll = setInterval(async () => { ... await cloudFetch<BillingResponse>("/v1/billing") ... }, 2000)` com maxAttempts=15. Compare com...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#9
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Migrar para useQuery com refetchInterval derivado do dado, seguindo src/hooks/use-provisioning-status.ts:52; extrair src/hooks/use-project-connection.ts e src/hooks/use-billing-activation.ts
  - `src/pages/project-connect.tsx` deixa de conter a logica apontada e ha teste cobrindo o novo dono

## B-048 — 20 endpoints sao buscados de mais de um arquivo; /v1/dashboard/rag/collections aparece em 7 paginas diferentes   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (heuristic)
category: state_synchronization_issue
evidence: src/pages/rag/collections.tsx:49 — /v1/dashboard/rag/collections: rag/ask.tsx:60, rag/connectors.tsx:168, rag/documents.tsx:74, rag/wiki.tsx:97, rag/graphrag.tsx:134, rag/analytics.tsx:60, rag/collections.tsx:49 e :57. /v1/dashboard/lens/datasets: lens/datasets.tsx:90 e :107, lens/experiments.tsx:134, lens/traces.tsx:305, lens/playground/variant-column.tsx:119. /v1/dashboard/lens/traces/{id}: lens/ask.tsx:32,...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#12
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Um hook por recurso compartilhado — src/features/rag/hooks/use-collections.ts, src/features/lens/hooks/use-datasets.ts, use-trace.ts — com o queryKey vindo da factory da feature
  - `src/pages/rag/collections.tsx` deixa de conter a logica apontada e ha teste cobrindo o novo dono

## B-049 — O client HTTP de producao importa estaticamente o modulo de fixtures de dev (src/lib/api.ts -> dev-mocks.ts)   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (heuristic)
category: state_synchronization_issue
evidence: src/lib/api.ts:14 — src/lib/api.ts:14 `import { mocksEnabled } from "./dev-mocks";` usado em exchangeSessionToken (:119); src/lib/auth.ts:18 `import { mocksEnabled, getMockSession } from "./dev-mocks";`. Contraste com src/main.tsx:33-38 que usa `Promise.all([import("./lib/dev-mocks"), import("./lib/mocks")])` sob guarda de env. src/lib/mocks/server.ts:82-87 ja resolveu isso corretamente com um isMockingEnabled()...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#14
overlaps: B-039, B-067
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: ed98fa5 (residuo: getMockSession segue como import em auth.ts; vira-lo injecao no boot muda o ciclo de vida da sessao e pede teste proprio)
dod:
  - Mover mocksEnabled() para src/lib/config.ts (onde API_URL ja mora) e fazer dev-mocks.ts e mocks/server.ts importarem de la
  - `src/lib/api.ts` deixa de conter a logica apontada e ha teste cobrindo o novo dono

## B-050 — Busca-enquanto-digita sem debounce em /memory/skills: um GET por tecla, e o debounce das outras telas e copiado a mao com constantes divergentes   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (consensus)
category: missing_backpressure
evidence: src/pages/memory/skills.tsx:193 — skills.tsx:193 `onChange={(e) => updateParam("q", e.target.value)}` -> :68-78 setSearchParams imediato -> :81 `queryKey: ["cloud", "/v1/dashboard/memory/skills/all", { q, offset }]`. Debounces ad-hoc: src/pages/lens/traces.tsx:157-163 (useState espelho + setTimeout 300ms) e src/pages/memory/episodes.tsx:55-61 (setTimeout 350ms). Nenhum queryFn do repo repassa o signal do TanStack Query para o...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#15
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 173f268 (residuo: traces.tsx nao migrado — debounce via setter do nuqs, migrar mudaria o contrato de URL)
dod:
  - Criar src/hooks/use-debounced-value.ts (a implementacao ja existe duplicada em traces.tsx:157 e episodes.tsx:55) e usa-la em memory/skills.tsx; ou trocar por useQueryState do nuqs com limitUrlUpdates/throttle, que ja e dependencia
  - existe teste que prova o teto/dedup em `src/pages/memory/skills.tsx` sob carga sintetica

## B-051 — /project-status mantem um EventSource aberto cujo resultado e descartado — assinatura SSE sem consumidor   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (consensus)
category: state_synchronization_issue
evidence: src/pages/project-status.tsx:77 — project-status.tsx:77 `useStatusStream(name, status?.environment ?? "production");` — sem destructuring, retorno ignorado; :206 `const signals = {...}` montado do REST; :29-30 comentario diz "T1.3 backend SSE handler not yet shipped — hook returns connected=false". src/hooks/use-status-stream.ts:144 documenta "T1.3.b: backend wire-up complete" e :194 `const es = new EventSource(url, {...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#16
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 4b81a36
dod:
  - Decidir uma das duas: (a) consumir de verdade — `const { signals: live, connected } = useStatusStream(...)` e mesclar sobre o snapshot REST em project-status.tsx:206, ou (b) remover a chamada ate a UI existir
  - `src/pages/project-status.tsx` deixa de conter a logica apontada e ha teste cobrindo o novo dono

## B-052 — A camada de data-access por feature ja existe pela metade e mora em src/components/ — exporta transporte, mas nao query key nem hook   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (consensus)
category: state_synchronization_issue
evidence: src/components/skills/skills-api.ts:27 — src/components/trust/trust-api.ts 91 LOC / 8 exports / 0 queryKey; src/components/skills/skills-api.ts 350 LOC / 23 exports / 0 queryKey; src/components/promptly/promptly-api.ts 352 LOC / 20 exports / 1 queryKey (CATALOG_QUERY_KEY:23). Consumidores: trust=5 paginas, skills=8, promptly=6 — todas em src/pages/. Exemplo do wrapper repetido: src/pages/trust/guardrails.tsx:53-54 declara useQuery...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#17
overlaps: B-012, B-053
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Promover os tres para src/features/<feature>/api/ (client.ts + keys.ts) e adicionar src/features/<feature>/hooks/ com os useQuery/useMutation que hoje estao inline nas 19 paginas
  - `src/components/skills/skills-api.ts` deixa de conter a logica apontada e ha teste cobrindo o novo dono

## B-053 — src/pages concentra 34k LOC contra 4k em src/hooks — a inversao de massa e o sintoma quantitativo de que o estado de servidor nao tem camada...   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (heuristic)
category: state_synchronization_issue
evidence: src/pages/api-keys.tsx:1 — Maiores paginas que tambem fazem fetch: api-keys.tsx 954 LOC, promptly/detail.tsx 915 (9 useQuery + 4 useMutation + 15 useState), project-connect.tsx 696 (16 useState + setInterval manual), memory/graph.tsx 664, lens/evaluators.tsx 585, memory/webhooks.tsx 560, skills/bundle-detail.tsx 554, billing.tsx 539, settings/webhooks.tsx 533, lens/alerts.tsx 522, workspace.tsx 511, rag/wiki.tsx 498.
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · state#19
overlaps: B-012, B-052
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Meta de reorganizacao: nenhuma pagina declara queryKey nem chama cloudFetch
  - `src/pages/api-keys.tsx` deixa de conter a logica apontada e ha teste cobrindo o novo dono

## B-054 — memory/entities baixa o conjunto inteiro e pagina no cliente — a paginacao visivel esconde que o request nao tem teto   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (heuristic)
category: unbounded_query
evidence: src/pages/memory/entities.tsx:95 — MEDIDO por leitura: entities.tsx:95-101 monta a URL so com scope e session_id opcional; linha 120 const all = query.data?.entities ?? []; linha 124 const entities = filtered.slice(offset, offset + PAGE_SIZE) com PAGE_SIZE=25 (linha 56). Comparacao no mesmo diretorio: memories.tsx:95 faz params.set(limit, String(PAGE_SIZE)) e episodes.tsx:77 idem — ambos com paginacao server-side. CONTEXTO A...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · scaling#5
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Alinhar src/pages/memory/entities.tsx ao padrao de src/pages/memory/memories.tsx:95: mandar limit=PAGE_SIZE e offset no querystring, incluir offset na queryKey (linha 91) para o cache do TanStack Query paginar corretamente, e mover o filtro de substring da linha 121 para um parametro de busca no...
  - o request emitido por `src/pages/memory/entities.tsx` carrega teto explicito (limit/offset) — verificavel no painel Network ou por teste sobre o handler MSW

## B-055 — O Service Worker adiciona uma segunda camada de cache sobre a API que contradiz o staleTime do app em 60x, e o proprio codigo documenta tres...   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (heuristic)
category: premature_distribution
evidence: vite.config.ts:162 — MEDIDO por leitura: vite.config.ts:162-169 { urlPattern: /\/api\/v1\//, handler: NetworkFirst, networkTimeoutSeconds: 3, expiration: { maxEntries: 100, maxAgeSeconds: 60*60 } }. src/lib/query-client.ts:38-42 new QueryClient com staleTime 60_000 e gcTime 5*60_000 (coberto por src/lib/query-client.test.ts:11 test_default_staleTime_60s). src/lib/api.ts:253 engineFetch chama cloudFetch(/engine +...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · scaling#7
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Remover a regra NetworkFirst de /api/v1/ do runtimeCaching em vite.config.ts:162 e deixar o TanStack Query como unica camada de cache de dados de servidor — ele ja tem invalidacao por queryKey, que o SW nao tem
  - a decisao fica escrita e a configuracao em `vite.config.ts` reflete o que foi decidido

## B-056 — A conversa da sessao dispara ate 50 GETs paralelos de arvore de spans — um por turno — por falta de endpoint em lote   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (consensus)
category: n_plus_one_query
evidence: src/pages/lens/session-detail/session-conversation.tsx:87 — MEDIDO por leitura: linha 26 CONVERSATION_TURN_CAP = 50; linha 84 const capped = ordered.slice(0, CONVERSATION_TURN_CAP); linha 87-92 useQueries({ queries: capped.map((t) => ({ queryKey: [cloud, /v1/dashboard/lens/traces, t.traceId, tree], queryFn: () => cloudFetch(/v1/dashboard/lens/traces/${t.traceId}) })) }). Uma query por elemento de capped, sem endpoint agregador. O mesmo endpoint...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · scaling#8
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Introduzir um read em lote no BFF (por exemplo GET /v1/dashboard/lens/traces?ids=a,b,c ou um /v1/dashboard/lens/sessions/{id}/conversation que ja devolva os turnos com suas arvores) e trocar o useQueries de session-conversation.tsx:87 por um unico useQuery
  - o numero de requests disparados por `src/pages/lens/session-detail/session-conversation.tsx` deixa de crescer com o tamanho da colecao — medido no Network antes e depois

## B-057 — O grafo de memoria e baixado inteiro sem limit — as mitigacoes do incidente #254 sao todas de leitura, nenhuma de transporte   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (consensus)
category: unbounded_query
evidence: src/pages/memory/graph.tsx:548 — MEDIDO por leitura, com o numero de producao citado pelo proprio codigo: graph.tsx:549-551 monta a URL sem parametro de limite; graph.tsx:233 registra 4423 nodes como o caso reportado e :245 registra 1266 of 4423 nodes (29%) were unconnected; :237 HAIRBALL_NODE_THRESHOLD = 500. Contraste medido na varredura de literais de URL desta auditoria:...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · scaling#9
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Mandar um teto no request de src/pages/memory/graph.tsx:548, no mesmo formato que src/pages/rag/graphrag.tsx ja usa (limit, e level quando o backend suportar), preferindo os nos de maior grau — que e exatamente o criterio que topLabelIds (linha 270-281) ja implementa no cliente e que ficaria...
  - o request emitido por `src/pages/memory/graph.tsx` carrega teto explicito (limit/offset) — verificavel no painel Network ou por teste sobre o handler MSW

## B-058 — useAddDomain has zero references anywhere - not even a test   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (consensus)
category: dead_feature_path
evidence: src/hooks/mutations/use-domains.ts:6 — grep for useAddDomain across src/, e2e/ and .storybook/ returns exactly one hit: its own definition at src/hooks/mutations/use-domains.ts:6. No caller, no test, no story. The live domain-creation path is src/components/sheets/add-domain-sheet.tsx:54, which does its own engineFetch POST to /api/v1/domains and is wired from src/pages/domains.tsx:366. The two implementations target the same...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#4
overlaps: B-017, B-059, B-060
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 78b0f6e
dod:
  - Delete the useAddDomain function (lines 6-18) from src/hooks/mutations/use-domains.ts, keeping useDeleteDomain and useVerifyDomain
  - `npx tsc --noEmit` e `npm test` passam apos a remocao/wiring, e `npx knip` nao reporta mais o simbolo de `src/hooks/mutations/use-domains.ts`

## B-059 — useCreateEnvironment is test-only: production sheet bypasses it with a raw fetch   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (heuristic)
category: dead_feature_path
evidence: src/hooks/mutations/use-environments.ts:62 — useCreateEnvironment (src/hooks/mutations/use-environments.ts:62) is referenced only by its own test file (use-environments.test.tsx lines 11, 44, 50, 174). Zero production consumers. The live create-environment flow is src/components/sheets/create-environment-sheet.tsx:87-88, which issues its own engineFetch POST to /api/v1/environments, wired from src/pages/environments.tsx:335. The comment...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#5
overlaps: B-017, B-058, B-060
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: bab4883
dod:
  - Either wire create-environment-sheet.tsx to useCreateEnvironment (preferred - the hook already handles cache invalidation the raw fetch does not), or delete the hook and its test
  - `npx tsc --noEmit` e `npm test` passam apos a remocao/wiring, e `npx knip` nao reporta mais o simbolo de `src/hooks/mutations/use-environments.ts`

## B-060 — useInviteMember is test-only: production sheet bypasses it with a raw fetch   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (heuristic)
category: dead_feature_path
evidence: src/hooks/mutations/use-team.ts:6 — useInviteMember (src/hooks/mutations/use-team.ts:6) is referenced only by use-team.test.tsx (lines 25, 47, 50, 121). Zero production consumers. The live invite flow is src/components/sheets/invite-member-sheet.tsx:35-36, a raw engineFetch POST to /api/v1/teams/members, wired from src/pages/team.tsx:207. use-team.test.tsx:47 is named test_useInviteMember_posts_to_teams_members_plural_path - it...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#6
overlaps: B-017, B-058, B-059
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 80b0f38
blocked_by: descoberta em bab4883 — team.tsx:43 le a lista com useEngineApi('/api/v1/teams/members'), chave ['engine', ...], enquanto useInviteMember invalida ['team']. Sao arvores disjuntas: ligar o sheet ao hook produziria um convite que CONTINUA nao atualizando a tabela, com aparencia de corrigido. Requer primeiro dar ao recurso team a hierarquia unica que domains recebeu em B-017 (queryKeys.team.{all,list}) — mesmo padrao, outro recurso.
dod:
  - Either wire invite-member-sheet.tsx to useInviteMember (which would make the plural-path regression test meaningful) or delete the hook plus its three test cases
  - `npx tsc --noEmit` e `npm test` passam apos a remocao/wiring, e `npx knip` nao reporta mais o simbolo de `src/hooks/mutations/use-team.ts`

## B-061 — CodeMirror editor stack (4 production packages) shipped but never imported   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (consensus)
category: zombie_dependency
evidence: package.json:71 — @codemirror/lang-json (line 71), @codemirror/state (72), @codemirror/view (73) and @uiw/react-codemirror (86) are declared in dependencies (production, not devDependencies). Two independent methods agree they are dead: (a) npx knip reports all four under unused dependencies; (b) grep -rl across src/, e2e/, .storybook/ and every root config file returns 0 files for each of the four package...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#8
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 106c10e
dod:
  - npm uninstall @codemirror/lang-json @codemirror/state @codemirror/view @uiw/react-codemirror, then npm run build && npm run test:e2e
  - a entrada correspondente saiu de `package.json` e `npm run build` + `npm run lint` passam

## B-062 — @tanstack/react-virtual unused while three code comments claim the app virtualizes with it   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (consensus)
category: zombie_dependency
evidence: package.json:77 — @tanstack/react-virtual is a production dependency (package.json:77, added 2026-06-10, 57 days). grep for both useVirtualizer and @tanstack/react-virtual across src/ and e2e/ returns 0 hits; npx knip independently lists it as an unused dependency. It is worse than inert because three comments describe it as live: src/pages/lens/trace-detail/helpers.ts:45 (Above this many visible rows, switch...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#9
overlaps: B-023
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Decide explicitly, do not just uninstall: either (a) the large-trace virtualization is still required - implement it and keep the dep; or (b) it is not - npm uninstall @tanstack/react-virtual, delete VIRTUALIZE_THRESHOLD from helpers.ts:48, and correct the three comments
  - a entrada correspondente saiu de `package.json` e `npm run build` + `npm run lint` passam

## B-063 — Zero @deprecated annotations in 673 files while 44 files carry 97 prose legacy references and live backward-compat fallbacks   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (heuristic)
category: missing_deprecation_marker
evidence: src/pages/projects.tsx:174 — grep for @deprecated, DEPRECATED and LEGACY across all 673 .ts/.tsx files under src/ returns exactly 0 hits, yet grep -i legacy returns 97 occurrences in 44 files. The prose is doing the job the annotation should do, so nothing is machine-visible: no IDE strikethrough, no lint rule, no report of what is safe to remove. Several of these are real backward-compat fallback chains still executing...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#14
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Adopt @deprecated JSDoc on every compat shim with a sunset condition in the tag body, e.g
  - o marcador/mecanismo existe em `src/pages/projects.tsx` e ha regra de lint ou gate de CI que falha na ausencia dele

## B-064 — package.json declares packageManager pnpm while the repo tracks package-lock.json and gitignores pnpm-lock.yaml   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (consensus)
category: zombie_dependency
evidence: package.json:141 — package.json:141 sets packageManager to pnpm@11.1.0+sha512..., which Corepack treats as authoritative and will enforce. Everything else in the repo says npm: dashboard/.gitignore lines 1-3 block pnpm-lock.yaml with the comment this project uses npm (matches monorepo convention); git ls-files confirms package-lock.json is the only tracked lockfile (1 file) and pnpm-lock.yaml is tracked in 0...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#15
overlaps: B-072
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 106c10e
dod:
  - Pick one and make everything agree
  - a entrada correspondente saiu de `package.json` e `npm run build` + `npm run lint` passam

## B-065 — Permanently-false branch in register.tsx renders a Check your email card that no user can reach   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (consensus)
category: dead_feature_path
evidence: src/pages/register.tsx:266 — src/pages/register.tsx:98 declares const [registered, _setRegistered] = useState(false) with an eslint-disable for the unused setter, and the comment above it (lines 92-96) states plainly: the registered intermediate UI block is unreachable ... setter no longer fires. grep confirms _setRegistered is never called anywhere in the file - the state is initialised false and can never change. Yet...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#17
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 106c10e
dod:
  - Delete the registered state at line 98 and its eslint-disable at line 97, plus the entire if (registered) block at lines 266-300, then drop the now-unused Mail import if nothing else uses it
  - `npx tsc --noEmit` e `npm test` passam apos a remocao/wiring, e `npx knip` nao reporta mais o simbolo de `src/pages/register.tsx`

## B-066 — ActionBar component (79 LOC) is kept alive only by its own test and a barrel re-export   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: medium (consensus)
category: dead_feature_path
evidence: src/components/layout/action-bar.tsx:1 — npx knip flags src/components/layout/index.ts:2 ActionBar as an unused export. Verified by hand: the only import of ActionBar anywhere is src/components/layout/action-bar.test.tsx:5, which imports it from ./action-bar directly. No page, no component and no story consumes it, and the four files that import the layout barrel pull only DashboardLayout (src/app.tsx:12) or ContentGrid...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#18
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 106c10e
dod:
  - Delete src/components/layout/action-bar.tsx and src/components/layout/action-bar.test.tsx, and drop line 2 of src/components/layout/index.ts
  - `npx tsc --noEmit` e `npm test` passam apos a remocao/wiring, e `npx knip` nao reporta mais o simbolo de `src/components/layout/action-bar.tsx`

## B-067 — Two parallel mock frameworks (3,944 LOC, 6.2% of src) behind one flag; only one is excisable   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (heuristic)
category: tangled_module
evidence: src/lib/dev-mocks.ts:23 — Two independent window.fetch-wrapping mock layers coexist, both gated on the same import.meta.env.VITE_USE_MOCKS === true check: src/lib/dev-mocks.ts:23 (466 LOC, added 2026-05-25) and src/lib/mocks/ (3,478 LOC across 13 files, added 2026-05-27, gate at src/lib/mocks/server.ts:86). src/lib/mocks/server.ts:3 admits the duplication - Extends the dev-mocks.ts pattern (window.fetch wrap) - and...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#21
overlaps: B-039, B-049
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Extend the tree-shake-check script to also fail on dev-mocks / mocksEnabled / mock-jwt-for-visual-validation, so the layer coupled into auth is guarded like the other
  - a contagem de importadores diretos de `src/lib/dev-mocks.ts` cai de forma medida (registrar o antes/depois com o mesmo parser de imports usado na auditoria)

## B-068 — Auth logic is split across three homonymous modules with two divergent copies of the Kratos Flow type   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (heuristic)
category: tangled_module
evidence: src/lib/auth/kratos-flow.ts:9 — Three modules own auth concerns and their names actively hide it: src/lib/auth.ts (161 LOC, 15 importers), the sibling directory src/lib/auth/ (8 modules: error-mapper, kratos-error-detail, kratos-flow, return-to, safe-redirect), and src/lib/kratos.ts (157 LOC, 3 importers). @/lib/auth and @/lib/auth/error-mapper are unrelated modules distinguished only by a slash. Unlike the other 14...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#22
overlaps: B-041
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Pick one Flow/FlowNode definition (kratos.ts is the stricter and more widely used one - 3 importers vs 1) and delete the other, updating src/pages/login.tsx:17
  - a contagem de importadores diretos de `src/lib/auth/kratos-flow.ts` cai de forma medida (registrar o antes/depois com o mesmo parser de imports usado na auditoria)

## B-069 — No feature-flag mechanism exists at all: 118 routes ship all-or-nothing, which is why half-built features are abandoned in the tree   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (heuristic)
category: missing_feature_toggle
evidence: src/app.tsx:1 — Searched for every common flag mechanism - feature_flag, FEATURE_, useFlag, isEnabled(, flags., featureFlags, LaunchDarkly, unleash, flipper, GrowthBook, killSwitch, KILL_SWITCH - across all .ts/.tsx under src/. Zero hits. The only environment-driven switches are import.meta.env.VITE_USE_MOCKS (src/main.tsx:32, src/lib/dev-mocks.ts:23, src/lib/mocks/server.ts:86, src/lib/mocks/sse.ts:160) and...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#24
overlaps: B-030, B-031, B-076
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Introduce one minimal build-time flag module (a typed record read from import.meta.env, no SaaS dependency needed at this scale) with a mandatory sunset date per flag, and route new partially-built features through it instead of merging them unwired
  - o marcador/mecanismo existe em `src/app.tsx` e ha regra de lint ou gate de CI que falha na ausencia dele

## B-070 — Fronteiras arquiteturais entre camadas/features nao sao enforced por ferramenta — a unica regra executavel de import bane um simbolo   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (heuristic)
category: coupling_vs_cohesion
evidence: eslint.config.js:89 — eslint.config.js:89-101 — unica entrada de no-restricted-imports, escopada ao importName 'Alert' de '@usetheo/ui', com override em eslint.config.js:106 para o proprio guard. Nenhum eslint-plugin-boundaries, import/no-restricted-paths ou dependency-cruiser no package.json. Medido na Fase 2: 1.084 arestas internas sem nenhuma verificacao de direcao.
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#3
overlaps: B-002, B-004, B-008, B-032
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Depois de escrever o ADR do achado #1, codificar a regra de residencia em import/no-restricted-paths (ja disponivel via eslint-plugin-import) — mesmo que comece permissiva (ex.: 'lib/ nao pode importar de pages/ nem de components/')
  - mudanca verificavel em `eslint.config.js` com `npx tsc --noEmit` + `npm test` verdes

## B-071 — Duas bibliotecas de UI npm coexistindo: @usetheo/ui@0.35.1 para componentes e @theokit/ui@1.3.2 apenas para o theme provider   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (consensus)
category: coupling_vs_cohesion
evidence: src/main.tsx:4 — src/main.tsx:4 'import { TheoUIProvider, violetForge } from "@theokit/ui"'. package.json: '@usetheo/ui':'^0.35.1' e '@theokit/ui':'^1.3.2'. 225 arquivos de src/ importam @usetheo/ui; apenas src/main.tsx, src/pages/billing.tsx, src/pages/overview.tsx e src/test/render.tsx importam @theokit/ui. node_modules/@theokit/ui/package.json description declara o split. DESIGN.md:88 e DESIGN.md:798 ainda...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#4
overlaps: B-007, B-034
adr_draft: dashboard/system-design-output/adrs/
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Escrever um ADR de 10 linhas que registre o split (qual pacote e dono do tema, qual e dono dos componentes, e o que fazer quando um bump de um quebra o outro) e atualizar DESIGN.md secao 3 — hoje ela nomeia uma versao e um pacote que nao correspondem ao que o app carrega
  - mudanca verificavel em `src/main.tsx` com `npx tsc --noEmit` + `npm test` verdes

## B-072 — Gerenciador de pacotes: npm na pratica, pnpm declarado no campo packageManager   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (consensus)
category: other
evidence: package.json:141 — package.json:141 '"packageManager": "pnpm@11.1.0+sha512.0c44e84..."'. .gitignore:1-3 '# Block pnpm/yarn lockfiles — this project uses npm (matches monorepo convention).' + 'pnpm-lock.yaml'. Dockerfile:3-5 'COPY package.json package-lock.json ./' + 'npm ci'. .github/workflows/quality.yml:139 'cache: npm', :143 'run: npm ci'. git ls-files: package-lock.json rastreado; pnpm-lock.yaml nao...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#8
overlaps: B-064
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 106c10e
dod:
  - Trocar package.json:141 para 'npm@<versao>' ou remover o campo
  - mudanca verificavel em `package.json` com `npx tsc --noEmit` + `npm test` verdes

## B-073 — Chunking manual do bundle: as familias @usetheo/ui, Radix, lucide e todo o resto de node_modules colapsadas num unico chunk 'vendor' eager   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (consensus)
category: performance_vs_readability
evidence: src/build/manual-chunks.ts:8 — src/build/manual-chunks.ts:8-13 ADR D1 (react/react-dom/scheduler co-locados; prior art vitejs/vite #12209/#7376/#12448). :15-26 F-fe-1 (force-graph/d3 devolvem undefined). :30-36 NOTE explicando por que @usetheo/ui/Radix/lucide NAO tem chunk dedicado. Medido: dist/assets/vendor-*.js = 1.593.511 bytes raw (397KB brotli), react-vendor 194.982, index 96.251. Fase 5a mediu TipTap 29,6% / markdown...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#10
overlaps: B-021
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - O ciclo de init impede chunk dedicado para as familias de UI, mas NAO impede tratar TipTap, markdown e syntax-highlight como a familia force-graph ja e tratada: devolver undefined para elas em manual-chunks.ts e deixar o Rollup coloca-las no chunk dinamico do consumidor
  - mudanca verificavel em `src/build/manual-chunks.ts` com `npx tsc --noEmit` + `npm test` verdes

## B-074 — Service worker / PWA (vite-plugin-pwa + Workbox) num dashboard operacional autenticado   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (heuristic)
category: complexity_vs_simplicity
evidence: vite.config.ts:86 — vite.config.ts:86-91 comentario T4.2 documentando as opcoes e seus modos de falha. vite.config.ts:11-15 importa BFF_NAVIGATION_DENYLIST/REGEXP de um modulo puro criado para 'the recurring #112/#203 bug class'. src/main.tsx:50-56 registro do SW gated em import.meta.env.PROD. DESIGN.md (803 linhas) nao contem nenhum requisito offline, de instalabilidade ou de PWA — as secoes 14 (perceived...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#12
adr_draft: dashboard/system-design-output/adrs/
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Escrever 5 linhas de ADR respondendo 'o SW existe para que?'
  - mudanca verificavel em `vite.config.ts` com `npx tsc --noEmit` + `npm test` verdes

## B-075 — React Compiler (auto-memoizacao via babel-plugin-react-compiler) ativo em todo o build   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (heuristic)
category: performance_vs_readability
evidence: vite.config.ts:66 — vite.config.ts:66-74 — plugin react() com babel plugins ['babel-plugin-react-compiler', {}], sem opcoes de compilationMode ou sources. Comentario T0.2 nas linhas 66-69. Nenhuma mencao a React Compiler, memoizacao ou Rules of React em DESIGN.md (803 linhas), TESTING.md (184) ou docs/governance/dashboard.md (243). eslint.config.js nao inclui eslint-plugin-react-compiler.
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#13
adr_draft: dashboard/system-design-output/adrs/
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
conflito_com: B-080 (fechado em 106c10e) — CONTRADICAO REAL entre dois achados da mesma auditoria. deletion#10 mediu que eslint-plugin-react-compiler nao e referenciado em eslint.config.js e mandou REMOVER a dependencia; tradeoff#13 mandou ADICIONA-LA ao eslint.config.js justamente por ser o mecanismo que torna visivel quando o React Compiler desiste de um componente. Ambos os achados estao corretos sobre o estado — a dep estava instalada e nao usada. O que eles discordam e sobre o DESTINO. A onda 1 executou a remocao (o caminho reversivel: reinstalar e uma linha). Quem pegar B-075 decide primeiro a politica de memoizacao e, SE decidir pelo plugin, reinstala a dep na mesma PR que o wira no eslint.config.js — nao antes.
dod:
  - Adicionar eslint-plugin-react-compiler ao eslint.config.js — ele e o mecanismo que transforma 'o compiler desistiu deste componente' em sinal visivel, e sem ele a adocao e cega
  - mudanca verificavel em `vite.config.ts` com `npx tsc --noEmit` + `npm test` verdes

## B-076 — Nao adotar feature flags: trabalho incompleto e escondido apagando rotas, nao desligando flags   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (consensus)
category: complexity_vs_simplicity
evidence: src/app.tsx:308 — src/app.tsx:308 '// PreviewsPage deleted per plan 2026-06-08-dashboard-screens-review-fixes'. src/pages/previews.tsx existe, 7.828 bytes, mtime 2026-07-18, com imports vivos (@usetheo/ui, usePreviews, engineFetch) e nenhum importador — grep por 'PreviewsPage|pages/previews' em src/ retorna apenas o comentario de delecao e um comentario equivalente em src/pages/pages.smoke.test.ts:128....
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#14
overlaps: B-030, B-031, B-069
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Nao introduzir feature flags — a escolha esta correta para o tamanho do time
  - mudanca verificavel em `src/app.tsx` com `npx tsc --noEmit` + `npm test` verdes

## B-077 — Nenhum modelo de consistencia declarado para o estado servidor cacheado do TanStack Query num dashboard operacional   [ ]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (heuristic)
category: consistency_model
evidence: src/lib/query-client.ts:1 — DESIGN.md:534-540 tabela 'Strategy by operation type' (comportamento desejado, sem parametros). DESIGN.md:775 'Confiavel — Status truthful'. Nenhum documento define staleTime, refetchInterval ou politica de invalidacao por classe de dado. Polling implementado por feature de forma isolada — docs/governance/dashboard.md:159 registra 'useDomainStatusPolling terminal-set {active, failed, removing}...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#18
adr_draft: dashboard/system-design-output/adrs/
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: triaged
dod:
  - Escrever meia pagina classificando os dados em duas ou tres classes (operacional volatil: builds, deploys, status de dominio; configuracao estavel: settings, team, billing) e fixar staleTime/refetch por classe no queryClient, com override explicito por excecao
  - mudanca verificavel em `src/lib/query-client.ts` com `npx tsc --noEmit` + `npm test` verdes

## B-078 — Registro de decisoes arquiteturais feito em docblocks de codigo citando planos/ADRs que foram removidos do versionamento, com o diretorio de...   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: medium (consensus)
category: other
evidence: .claude/knowledge-base/adrs:1 — grep 'ADR D[0-9]|ADR:' em dashboard/src/ retorna 236 ocorrencias. Slugs de plano citados em src/ e nao resolviveis: 2026-05-27-backend-frontend-integration, 2026-06-07-preview-as-category-single-slot-plan, 2026-06-08-dashboard-screens-review-fixes, 2026-06-11-code-review-remediation, entre 12+. ls .claude/knowledge-base/adrs/ .claude/knowledge-base/plans/ .claude/knowledge-base/reviews/...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#19
overlaps: B-010, B-033
adr_draft: dashboard/system-design-output/adrs/
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 9314954
dod:
  - Escrever no repositorio, como arquivos, apenas os ADRs que continuam vinculantes — os candidatos ja estao identificados nesta fase: eixo de organizacao de codigo, orcamento de LoC, split @usetheo/ui vs @theokit/ui, justificativa do service worker, politica do React Compiler, obrigatoriedade da...
  - mudanca verificavel em `.claude/knowledge-base/adrs` com `npx tsc --noEmit` + `npm test` verdes

## B-079 — trace-detail re-export shim is a migration artifact with no @deprecated marker, no sunset, and 3 provably unused re-exports   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: low (heuristic)
category: missing_deprecation_marker
evidence: src/pages/lens/trace-detail.tsx:15 — src/pages/lens/trace-detail.tsx (30 LOC) exists solely to re-export the trace-detail/ module dir - its own docblock (line 10) says it re-exports the moved public surface so every existing import keeps resolving with zero churn. That is a transitional compatibility layer, but it carries no @deprecated JSDoc tag, no sunset date and no linked cleanup issue, so nothing will ever prompt its...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#7
overlaps: B-001, B-044
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: af6532c
dod:
  - Drop VIRTUALIZE_THRESHOLD, ChatMessage and FlatNode from the re-export list (lines 24, 26, 27) and correct the docblock claim at line 13
  - o marcador/mecanismo existe em `src/pages/lens/trace-detail.tsx` e ha regra de lint ou gate de CI que falha na ausencia dele

## B-080 — Three unused devDependencies: autoprefixer, eslint-plugin-react-compiler, @storybook/blocks   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: low (consensus)
category: zombie_dependency
evidence: package.json:123 — All three are flagged by npx knip and confirmed by grep. (1) autoprefixer (package.json:123, added 2026-04-01, 127 days): postcss.config.js declares only the @tailwindcss/postcss plugin, and Tailwind v4 (tailwindcss ^4.3.0) performs prefixing internally - autoprefixer is never loaded. (2) eslint-plugin-react-compiler (package.json:125): grep for react-compiler in eslint.config.js returns...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#10
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 106c10e
conflito_com: B-075 (aberto) — a remocao de eslint-plugin-react-compiler executada aqui e o OPOSTO do que B-075 pede. Registrado nos dois lados de proposito: um item fechado que contradiz um item aberto, sem nota, e como uma decisao vira folclore. Reverter custa uma linha.
dod:
  - npm uninstall autoprefixer eslint-plugin-react-compiler @storybook/blocks; then npm run lint && npm run storybook:build to confirm
  - a entrada correspondente saiu de `package.json` e `npm run build` + `npm run lint` passam

## B-081 — Dead compatibility alias: export { cloudFetch as apiFetch } has zero consumers   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: low (consensus)
category: dead_feature_path
evidence: src/lib/api.ts:249 — src/lib/api.ts:249 declares export { cloudFetch as apiFetch }. grep -rn for the word apiFetch across src/ and e2e/, excluding that declaration line itself, returns zero hits - no import, no dynamic import, no test, no story. The alias is an unmarked backward-compatibility shim whose last caller is gone; it widens the public surface of the most-imported module in the codebase (151 importers)...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#12
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 106c10e
dod:
  - Delete line 249 of src/lib/api.ts and run npx tsc --noEmit
  - `npx tsc --noEmit` e `npm test` passam apos a remocao/wiring, e `npx knip` nao reporta mais o simbolo de `src/lib/api.ts`

## B-082 — Six nav-reachable routes render a placeholder with no tracking issue or sunset date   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: low (heuristic)
category: dead_feature_path
evidence: src/app.tsx:604 — Six of the 118 <Route> declarations in src/app.tsx resolve to SubPagePlaceholder: /settings/members (line 604), /settings/notifications (651), /settings/danger (664), /profile/security (678), /profile/sessions (691), /profile/danger (704). All six are advertised in the sidebar - src/components/layout/app-sidebar-menus.ts lines 172, 181, 186, 200, 201, 206 - so a user can click into each and...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#13
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: b645e01 (eram SETE rotas, nao seis — /profile/danger faltava no achado)
dod:
  - Attach a tracking issue id and a review date to each of the six placeholder call sites (a one-line comment above each <Route> is enough)
  - `npx tsc --noEmit` e `npm test` passam apos a remocao/wiring, e `npx knip` nao reporta mais o simbolo de `src/app.tsx`

## B-083 — .dockerignore misses playwright-report/, test-results/ and tsconfig.tsbuildinfo, which COPY . . pulls into the build context   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: low (heuristic)
category: zombie_dependency
evidence: .dockerignore:1 — Dockerfile:6 is a blanket COPY . . into the builder stage. .dockerignore excludes node_modules, dist, coverage, .env*, *.md, *.log and .DS_Store, but not playwright-report/ (524 KB), test-results/ (8 KB) or tsconfig.tsbuildinfo (28 KB) - all three are present on disk right now and all three are build outputs. VERIFIED NOT a git problem: git ls-files reports 0 tracked files for dist,...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#16
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 106c10e
dod:
  - Add playwright-report, test-results, *.tsbuildinfo and pnpm-lock.yaml to .dockerignore
  - a entrada correspondente saiu de `.dockerignore` e `npm run build` + `npm run lint` passam

## B-084 — Four dead exported symbols confirmed by knip and by grep (the definition is the only reference)   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: review
source: discover-review
severity: low (consensus)
category: dead_feature_path
evidence: src/lib/auth.ts:129 — For each symbol below, grep -rn across src/ and e2e/ returns exactly one hit - the export statement itself - and npx knip independently lists all four under unused exports. (1) startRegistration, src/lib/auth.ts:129 - src/pages/register.tsx does not use it; that page submits through its own form.submit() path. (2) getInputNodes, src/lib/kratos.ts:76 - the other nine exports of kratos.ts...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · deletion#19
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 106c10e
dod:
  - Delete the four symbols and run npx tsc --noEmit
  - `npx tsc --noEmit` e `npm test` passam apos a remocao/wiring, e `npx knip` nao reporta mais o simbolo de `src/lib/auth.ts`

## B-085 — Vendorizar as camadas de tokens CSS do @usetheo/ui dentro de src/vendor/ em vez de fazer downgrade do pacote   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: low (heuristic)
category: complexity_vs_simplicity
evidence: src/vendor/usetheo-ui/README.md:1 — src/vendor/usetheo-ui/README.md — secoes 'Why they are here' (com a alternativa rejeitada e o motivo), tabela de proveniencia por arquivo, e 'Maintenance' com criterio de saida. src/index.css:31-37 replica o motivo inline e importa os tres arquivos. Deriva medida: README fala de @usetheo/ui@0.22; package.json fixa ^0.35.1; node_modules/@usetheo/ui@0.35.1 exporta './preset' (JS), nao...
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#6
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 671c175
dod:
  - Manter a decisao — esta correta e bem fundamentada
  - mudanca verificavel em `src/vendor/usetheo-ui/README.md` com `npx tsc --noEmit` + `npm test` verdes

## B-086 — Camada local src/components/ui/ com 3 wrappers sobre a biblioteca de design   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: info (heuristic)
category: complexity_vs_simplicity
evidence: src/components/ui/alert-guard.tsx:3 — src/components/ui/ contem exatamente 5 arquivos (3 fontes + 2 testes): alert-guard.tsx, app-modal.tsx, dialog.tsx. alert-guard.tsx:3-8 docblock com o numero do issue upstream e o sintoma. eslint.config.js:85-101 ban de no-restricted-imports sobre o simbolo Alert com mensagem acionavel; eslint.config.js:104-107 override para o guard. 97 arquivos importam de @/components/ui/.
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#7
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 671c175
dod:
  - Nenhuma acao
  - mudanca verificavel em `src/components/ui/alert-guard.tsx` com `npx tsc --noEmit` + `npm test` verdes

## B-087 — Manter a camada de mocks (MSW-like, 2847 LOC) dentro de src/ em vez de num pacote separado, contida por import dinamico + gate de CI   [x]

domain: frontend-dashboard
repo: theo-cloud/dashboard
suggested_mode: evolve
source: discover-review
severity: info (consensus)
category: complexity_vs_simplicity
evidence: src/main.tsx:26 — src/main.tsx:26-40 docblock do gate + import() dinamico duplo. src/lib/mocks/index.ts:1-9 barrel com o contrato ('All gated by VITE_USE_MOCKS=true. Production builds tree-shake everything.'). package.json:19 script tree-shake-check com grep no dist e mensagem de falha citando T7.1/EC-10. Fase 2 mediu 0 bytes de mocks no bundle de producao.
provenance: dashboard/system-design-output/final_report.md · loop-system-design 2026-08-06 · tradeoff#9
why_now: a auditoria de system design de 2026-08-06 mediu este estado no nosso proprio codigo (quality gate 0.90, evidencia file:line verificada contra o disco)
status: shipped
resolved_in: 4723b6a
dod:
  - Nenhuma mudanca estrutural
  - mudanca verificavel em `src/main.tsx` com `npx tsc --noEmit` + `npm test` verdes

---

## Registros do relatorio que NAO viraram item

A auditoria produziu 91 registros; 87 viraram item. Estes 4 nao tem o que corrigir —
registra-los como trabalho seria fabricar tarefa:

| Registro | Assunto | Motivo da exclusao |
|---|---|---|
| `boundary#17` | CALIBRAGEM: o acoplamento entre features e MEDIDAMENTE BAIXO e a direcao das camadas esta 100% corre | registro de CALIBRAGEM — afirma a AUSENCIA de violacao (acoplamento medidamente baixo). Nao ha o que corrigir; serve de contrapeso na priorizacao. |
| `scaling#10` | RETIRADO — Load more de deployments: a premissa do achado estava errada (o backend limita em 50 e o  | RETIRADO pelo proprio auditor apos re-verificacao — a premissa estava errada (backend limita em 50 e o tradeoff esta documentado). Status withdrawn no banco. |
| `tradeoff#17` | Testes co-localizados com o codigo de producao, na proporcao de ~1:1 em arquivos (43.3k LOC de teste | decisao AVALIADA COMO CORRETA — testes co-localizados. A recomendacao medida e explicitamente NAO mexer. |
| `tradeoff#15` | Roteamento centralizado num unico app.tsx de 729 LoC com 85 React.lazy e 118 elementos <Route> | decisao AVALIADA COMO CORRETA — roteamento centralizado deve ser mantido. A unica acao derivada (incoerencia do orcamento de LoC) ja e o item do tradeoff #2. |

---

## Triagem por esforco (2026-08-06, apos a primeira rodada de execucao)

Os 87 itens nao sao homogeneos, e tratar a contagem como se fossem produz um
plano falso. Esta triagem separa o que a execucao mostrou:

| Faixa | N | O que sao |
|---|---|---|
| **Fechados** | 23 | Implementados, validados e commitados. Cada um com `resolved_in`. |
| **[A] Projetos grandes** | 20 | Migracao ou refactor amplo — semanas, nao sessoes. Precisam de plano proprio via `/to-plan`, nao de execucao direta. |
| **[B] Dependem de decisao ou de terceiro** | 15 | Exigem uma decisao que e do time (qual pacote de UI e canonico, o SW fica ou sai, a politica de memoizacao) ou um contrato de backend que este repo nao controla. |
| **[C] Fechaveis com esforco moderado** | 29 | Mesma natureza dos 23 ja fechados: escopo delimitado, criterio verificavel, cabem numa sessao cada. |

**[A] — projetos grandes:** B-002 B-003 B-004 B-006 B-008 B-009 B-011 B-012
B-019 B-029 B-031 B-036 B-041 B-046 B-048 B-052 B-053 B-063 B-067 B-068

Sao as migracoes estruturais: mover 82 arquivos para package-by-feature (B-002),
fatiar 118 rotas de `app.tsx` (B-003), extrair a camada de data-access de 130
call sites (B-012), reancorar 208 definicoes de query key (B-011/B-019),
decompor 32 arquivos acima de 400 LOC (B-009). O relatorio da auditoria e
explicito sobre a ordem: **o ADR do eixo de organizacao (B-032/B-010) vem
primeiro** — mover arquivos antes de escrever a regra de residencia e como a
arvore atual foi produzida.

**[B] — dependem de decisao ou de terceiro:** B-007 B-023 B-024 B-034 B-054
B-055 B-056 B-057 B-062 B-069 B-071 B-074 B-075 B-076 B-077

Exemplos do porque nao sao executaveis por conta propria: B-024 (paginacao do
Audit) depende de o endpoint da engine aceitar limit/offset — o handler nao vive
neste repositorio, e mandar um parametro que o backend ignora produz a aparencia
de paginacao sem o efeito; B-034 (o token `--primary` definido em dois lugares
com valores diferentes) precisa de UMA medicao no app buildado para decidir qual
vence, e a escolha muda o contraste da marca; B-074 (o service worker) e B-071
(as duas libs de UI) sao decisoes de produto.

**[C] — fechaveis com esforco moderado:** B-001 B-010 B-013 B-014 B-015 B-016
B-020 B-021 B-022 B-025 B-030 B-032 B-033 B-035 B-042 B-043 B-044 B-045 B-047
B-049 B-050 B-059 B-060 B-070 B-073 B-078 B-082 B-085 B-086

Proximos por valor: **B-032 + B-010 + B-078** (o ADR do eixo e a regra de
residencia — destravam toda a faixa [A]), **B-013/B-014/B-015** (fetch cru
pulando o pipeline de auth; recuperacao de token no SSE), **B-021/B-073** (~200
KB brotli fora do caminho eager, com o mecanismo ja provado no proprio arquivo).

## Rollback

Um item registrado por engano e marcado `status: killed` com `kill_reason` — nunca
deletado, nunca renumerado. Se ja estava `triaged`, a evidencia permanece no bloco: saber
que algo foi medido e depois descartado vale mais que um arquivo limpo.
