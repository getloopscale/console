# Auditoria de System Design — dashboard theo-cloud

> Análise de design de sistema em nível Staff/Principal, aplicando princípios de
> sistemas distribuídos na escala do codebase.
>
> **Alvo:** `theo-cloud/dashboard` (SPA React 19 + Vite 6 + TypeScript, TanStack Query,
> react-router-dom v7, SSE) · **Modo:** full (fases 1–6) · **Data:** 2026-08-06
> · **Limiar de severidade:** medium

---

## 1. Sumário executivo

O dashboard é um SPA de operação com **63.756 LOC de produção** e **43.297 LOC de teste**
distribuídos em 375 arquivos de produção, cobrindo ~15 domínios de produto (lens, rag,
memory, promptly, skills, trust, deploy, project, billing, team, secrets, domains,
environments, auth, audit).

O achado central é contraintuitivo e ele muda toda a prescrição: **o acoplamento entre
features é medidamente baixo — o que está errado é a árvore de diretórios.** Das 1.084
arestas de import internas, apenas 90 são cross-feature, e 70 dessas (78%) apontam para
`use-auth`, que é cross-cutting legítimo. Zero arestas sobem de `components`/`hooks`/`lib`
para `pages`. Nenhuma feature passa de 25% de razão cross-boundary contra o limiar
heurístico de 30%. As fronteiras lógicas que o time respeita na prática já estão certas;
o que falta é a estrutura de pastas e as regras escritas **refletirem** essas fronteiras.
O custo hoje é **cognitivo** (navegar uma feature exige abrir 3–4 diretórios de topo), não
técnico — e é exatamente por isso que a correção é barata e pode ser feita um domínio por PR,
sem big bang, sem micro-frontends e sem divisão em pacotes.

A causa-raiz é documental. O código cita um orçamento de "500 LoC do `architecture.md`" em
três módulos de produção; **o documento não existe** em lugar nenhum do repositório. Há
**236 referências a `ADR D<n>`** em `src/` e o diretório `.claude/knowledge-base/adrs/`
está vazio. `DESIGN.md` é um contrato de UX, não de arquitetura de código, e declara na
linha 8 que o artefato `architecture` foi *"removido do versionamento"*. A única regra de
fronteira executável no repositório é um `no-restricted-imports` que bane exatamente um
símbolo de terceiros. **O código sobreviveu à própria documentação** — e é isso que explica
economicamente por que alguns domínios viraram pasta e outros não, por que
`src/components/` tem três taxonomias concorrentes, por que existem dois `AddSecretSheet`,
e por que `scale/` e `scaling/` coexistem.

**A coisa mais importante a fazer primeiro:** escrever um ADR de uma página fixando o eixo
de organização e a **regra de residência** — *"hook de consumidor único mora com a feature;
`lib/` só aceita módulo com ≥2 features consumidoras"* — e codificá-la em
`import/no-restricted-paths` **antes** de mover um único arquivo. Sem a regra, a migração
recria o problema em seis meses.

### Os 3 riscos de topo

1. **Não existe contrato escrito nem executável de fronteira de módulo** (`boundary_findings#16`, high) — nenhum documento define layout de pastas, critério de promoção de domínio a pasta ou taxonomia de `src/components`. Zero `index.ts` nas 30 subpastas de `src/components/`: não há distinção entre API pública e detalhe interno de nenhuma feature. É a raiz da maioria dos outros achados.
2. **Invalidação de cache não é confiável** (`state_findings#1`, `#11`, `#13`; `tradeoff_decisions#16`, high) — três convenções concorrentes de query key entre 208 definições (130 tuplas ad-hoc, 25 pela factory, ~30 constantes locais). O recurso `domains` tem dois namespaces disjuntos; o caminho de CREATE de três recursos vive dentro do sheet com `engineFetch` cru e **não invalida cache**, enquanto o hook correto que invalida está órfão. Num painel de operação isso significa agir sobre estado velho.
3. **O único gate de tamanho de bundle está morto e o orçamento está 3,8x estourado** (`scaling_findings#1`, `#2`, high) — o chunk `vendor` eager tem **397.109 B brotli medidos** contra um limite declarado de 25 KB (15,5x), e 53% dele são famílias consumidas por uma única rota lazy (TipTap 29,6%, markdown 16,6%, syntax-highlight 4,1%). Três das nove entradas do `size-limit` apontam para chunks que não existem mais e passam **verdes por ausência**.

---

## 2. Cartão de pontuação

| Dimensão | Nota | Achado-chave |
|---|---|---|
| Fronteiras & DDD | **2/5** | Acoplamento medido baixo e direção de camadas 100% correta, mas zero fronteiras declaradas: 0 `index.ts` em 30 pastas, 3 taxonomias concorrentes, 8 ciclos de import, `app.tsx` com 729 LOC/118 rotas |
| Fluxo de Dados & Estado | **2/5** | Primitivas de resiliência boas (FIFO com `droppedCount`, Idempotency-Key, retry que não retenta 4xx), mas 81% do fetching mora nas páginas e a invalidação de cache não é confiável em 130 sites |
| Prontidão para Escala | **2/5** | Code splitting de rotas correto e polling disciplinado, porém 397 KB brotli eager, virtualização documentada que nunca foi implementada, e 3 telas sem teto de transporte |
| Segurança de Deleção | **2/5** | Higiene de repositório limpa (0 FIXME/HACK, 1 TODO real, nada versionado indevidamente), mas 1.779 LOC importáveis só pelo próprio teste, 5 hooks sem chamador de produção, 5 deps de produção zumbis, **zero** `@deprecated` em 673 arquivos |
| Trade-offs & Pragmatismo | **3/5** | 8 de 19 decisões documentadas com alternativa rejeitada e até critério de saída (o vendor CSS é exemplar), mas 236 referências a ADR apontam para um diretório vazio e duas decisões se contradizem em runtime |
| **Geral** | **2,2/5** | |

Média simples = 2,2/5. Média ponderada (Fronteiras 30% · Dados 20% · Trade-offs 20% ·
Escala 15% · Deleção 15%) = **2,2/5** — os pesos foram ancorados no pedido literal do
time (organização de pastas e componentização em primeiro lugar) e coincidem com a média
simples.

**Legenda da escala:**

- **5 = Excelente** — um Staff engineer aprovaria sem comentários
- **4 = Bom** — problemas menores, todos documentados
- **3 = Aceitável** — lacunas conhecidas com plano de mitigação
- **2 = Parcial** — lacunas significativas afetando manutenibilidade
- **1 = Rudimentar** — padrões fundamentais ausentes
- **0 = Ausente** — dimensão não endereçada

**Leia 2,2 corretamente.** Isto não é um codebase ruim. É um codebase **bem construído e
mal governado**: as lacunas são majoritariamente *conhecidas* — muitas estão descritas em
comentários no próprio código — mas nenhuma tem plano de mitigação escrito nem
enforcement. É exatamente a diferença entre a nota 3 ("lacunas conhecidas com plano de
mitigação") e a nota 2. A dimensão Trade-offs pontua mais alto justamente porque a cultura
de registrar o *porquê* existe e é visível; o que falha é a durabilidade do registro.

---

## 3. Achados positivos

Um relatório que só lista problemas está incompleto. Os itens abaixo foram verificados e
**não devem ser mexidos** — vários deles evitariam falsos positivos se lidos primeiro.

**Fronteiras e acoplamento**

- **Direção de camadas perfeita.** Das 1.084 arestas internas, **zero** vão de `components/`, `hooks/` ou `lib/` para `pages/`. Não existe import ascendente, não existe `lib` importando componente. (`boundary_findings#17`)
- **Acoplamento cross-feature baixo.** 90 arestas cross-feature no codebase inteiro, 70 delas para `use-auth`. Excluindo auth, todas as features ficam **abaixo de 10%** de razão cross-boundary. Não há justificativa para micro-frontends, divisão de pacotes ou reescrita arquitetural.
- **Testes co-localizados são a convenção correta.** 43.297 LOC de teste para 63.756 de produção (~1:1 em arquivos), `<name>.test.tsx` ao lado do módulo, documentado em `TESTING.md` (184 linhas que se declaram referência autoritativa e justificam o padrão de duas camadas de mock por *o que cada teste prova*). **Recomendação explícita: não mexer.** Se a migração para feature folders acontecer, os testes viajam com os módulos sem nenhuma mudança de convenção — o que é mais um argumento a favor da migração.

**Runtime e performance**

- **React Compiler está ATIVO** (`vite.config.ts:66-74`). Memoização manual ausente **não é um achado válido** neste codebase e nenhum foi levantado. Isso é calibragem, não omissão.
- **Code splitting de rotas está correto.** 85 `React.lazy` e 118 `<Route>` produzem 128 chunks; o entry chunk tem 40 módulos de shell e **nenhuma página vaza** para ele. O problema de bundle é o split das *dependências*, não o do código de aplicação.
- **Polling disciplinado.** 4 hooks usam `refetchInterval` derivado do dado, com `refetchIntervalInBackground: false` e parada em estado terminal.
- **Defaults de cache centralizados e testados.** `staleTime` 60s / `gcTime` 5min em `src/lib/query-client.ts:38-42`, com `retryGuard` que não retenta 4xx e backoff exponencial até 30s; mutations com `retry: 0` — decisão correta: nunca reexecutar ação do usuário automaticamente.

**Fluxo de dados e segurança**

- **Token de sessão em memória, nunca em `localStorage`**, com dedup de refreshes concorrentes via `refreshPromise` (`src/lib/api.ts:63`). Decisão correta contra XSS e documentada.
- **`BroadcastChannel` transmite apenas o sinal de logout — o JWT nunca trafega** entre abas; cada aba troca o próprio token pelo cookie Kratos. (`data_flows#9`)
- **`Idempotency-Key` automático** em todo verbo mutante (`src/lib/api.ts:309`).
- **Backpressure real onde importa:** `useSSEStream` corta em FIFO por `maxEvents` e expõe `droppedCount`. Nenhum achado de circuit breaker ausente foi levantado — para um SPA de browser isso seria crying wolf, e o auditor registrou a decisão de não levantar.
- **Zero achados de estado global mutável** além do singleton de sessão em `api.ts`, cujo *design* é defensável e está bem justificado no código — o que falta lá é ciclo de vida explícito, não inversão de dependência.
- **Modelo de referência interno existe:** `use-deployments-list-stream.ts` implementa snapshot REST + patch SSE por `build_id` com guard de estado terminal contra replay. É o padrão que o resto do app deveria seguir, e ele já está escrito e testado aqui dentro.

**Contenção e higiene**

- **Mocks MSW são tree-shaken de verdade.** Medido no artefato construído: `grep` em `dist/assets/*.js` por `lib/mocks`, `mocksEnabled`, `getMockSession` e `mock-jwt-for-visual-validation` retorna **0 arquivos**. O gate `tree-shake-check` no `package.json` faz build e grep no `dist`, falhando com mensagem que cita o plano de origem. Um invariante com teste, não um acidente feliz.
- **Nenhum artefato indevidamente versionado.** `git ls-files` retorna 0 arquivos rastreados para `dist`, `playwright-report`, `test-results`, `tsconfig.tsbuildinfo`, `pnpm-lock.yaml` e `node_modules`.
- **Marcadores de dívida quase inexistentes:** 0 `FIXME`, 0 `HACK`, 0 `XXX`, e **1** `TODO` real em 673 arquivos.
- **`src/components/ui/` é o exemplo de camada local bem feita** (`tradeoff_decisions#7`): 3 arquivos, cada um com docblock nomeando o problema concreto (`alert-guard.tsx:3-8` cita o issue upstream `usetheodev/theo-cloud#175` e o sintoma exato), e — raro — com **enforcement**: `eslint.config.js:89-101` transforma o import errado em erro de lint, com override cirúrgico para o próprio guard. Não é abstração especulativa; não há YAGNI aqui.
- **`src/vendor/usetheo-ui/README.md` é o melhor registro de decisão do repositório** (`tradeoff_decisions#6`): gatilho, alternativa rejeitada com o motivo, mapeamento arquivo-a-arquivo da origem e — o que quase nenhuma decisão vendorizada tem — **critério de saída explícito**.
- **`src/pages/sub-page-placeholder.tsx` é um stub honesto por design** (`deletion_findings#13`): mostra o comando CLI que atinge o mesmo resultado hoje, citando explicitamente a regra de honestidade. É a escolha certa contra uma página em branco ou uma UI falsa.
- **Rigor de auditoria do próprio time:** `deployments.tsx:144-150` registra a decisão de *não* migrar para `useInfiniteQuery` com gatilho declarado ("PG OFFSET degrada acima de ~10k linhas") e caminho de migração pronto. Isso é um trade-off documentado, não um achado — e foi tratado como tal (ver §9).

---

## 4. A resposta ao pedido: organização de pastas e componentização

Esta seção responde diretamente ao pedido do time. As demais dimensões são suporte.

### 4.1 O diagnóstico, em números medidos

| Métrica | Valor medido |
|---|---|
| Arestas de import internas (produção) | 1.084 |
| Arestas cross-feature | 90 — das quais **70 para `use-auth`** |
| Arestas ascendentes (`components`/`hooks`/`lib` → `pages`) | **0** |
| Maior razão cross-boundary por feature | `project` 25,0% (limiar heurístico: 30%) |
| Dispersão de `deploy` | 4 camadas / 25 arquivos |
| Dispersão de `lens` | 3 camadas / 57 arquivos |
| Dispersão de `promptly` / `rag` | 3/23 e 2/22 |
| Hooks com **uma única** feature consumidora | **33 de 44** (20 com um único arquivo importador) |
| Módulos de `lib/` realmente compartilhados (≥2 features) | **7 de 39** |
| `index.ts` nas 30 subpastas de `src/components/` | **0** |
| Arquivos na raiz de `src/pages/` | 41 (11.987 LOC), 6 dos quais **não são páginas** |
| Pares homônimos `X.tsx` + `X/` | 16, com **duas semânticas opostas** e apenas 1 `index.ts` no conjunto |

O que esses números dizem: as features **já estão desacopladas**. Elas só estão
*espalhadas*. `src/components/` classifica suas 30 pastas em três eixos incompatíveis
simultaneamente — por feature (`billing`, `deploy`, `lens`…), por tipo de widget
(`dialogs`, `sheets`, `ui`) e por concern técnico (`common`, `data`, `error`, `loading`) —
e nada indica ao desenvolvedor qual eixo usar. O resultado é mensurável: das 14 peças em
`dialogs/` e `sheets/`, **11 têm exatamente um importador de exatamente uma feature** —
são componentes privados de feature arquivados por formato visual. Só `confirm-dialog.tsx`
(30 importadores em 15 features) é genuinamente compartilhado.

### 4.2 Estrutura de pastas alvo (nomes reais deste projeto)

```
src/
├── app.tsx                         # ~150 LOC (estimado): shell + ~15 subárvores de rota
├── main.tsx                        # bootstrap: providers, RUM, SW
├── features/
│   ├── lens/                       # hoje: 46 arq. em pages/ + 9 em components/ + 8 módulos em lib/
│   │   ├── routes.tsx              # <Route path="observability/*"> — sai de app.tsx
│   │   ├── pages/                  # traces, trace-detail, playground, evaluators, alerts,
│   │   │                           #   monitors, dashboards, datasets, experiments, sessions,
│   │   │                           #   session-detail, labeling-queue, usage-by-user, ask, compare
│   │   ├── components/             # de src/components/lens/ (ask-thread, ...)
│   │   ├── hooks/
│   │   ├── lib/                    # trace-layout.ts (370 LOC), span-status.ts, lens-error.ts,
│   │   │                           #   traces-export.ts, otel-attributes.ts, usage-series.ts,
│   │   │                           #   usage-summary.ts, download.ts  ← hoje em src/lib/
│   │   ├── api/                    # client.ts · keys.ts · paths.ts
│   │   └── index.ts                # ÚNICA API pública: buildTracesUrl, ColumnState, ...
│   ├── deploy/
│   │   ├── routes.tsx
│   │   ├── pages/                  # deployments, deployment-detail-layout, deployment-tabs/, runtime-logs
│   │   ├── components/             # rollback-dialog, redeploy-dialog, cancel-build-dialog,
│   │   │                           #   promote-to-production-dialog  ← hoje em components/dialogs/
│   │   ├── hooks/                  # use-deploy-timeline, use-deploy-timeline-with-steps,
│   │   │                           #   use-deployment-stream, use-deployments-list-stream, use-build-envs
│   │   ├── api/
│   │   └── index.ts
│   ├── project/                    # project-connect, project-detail, project-readiness,
│   │                               #   project-status, projects + create-project-sheet,
│   │                               #   bulk-delete-projects-dialog, use-project*, PreviewsRedirect
│   ├── scale/                      # project-scale + components/scale/ (hpa-toggle, keda-toggle,
│   │                               #   scale-slider, scale-confirm-dialog) + use-scale, use-scale-cost
│   ├── auth/                       # login, register, recovery, verification, check-email,
│   │                               #   device-verify, device-success, profile + lib/auth/ + kratos.ts
│   ├── workspace/                  # index.tsx, preview-sheet.tsx, presign.ts, use-workspace-selection.ts
│   ├── billing/  team/  domains/  environments/  secrets/  api-keys/  audit/
│   ├── status/  overview/  onboarding/  readiness/  logs/
│   └── memory/  rag/  skills/  trust/  promptly/
├── components/                     # SOMENTE cross-feature
│   ├── ui/                         # alert-guard, app-modal, dialog  (mantido como está)
│   ├── layout/                     # dashboard-layout, app-sidebar, content-grid
│   ├── error/  loading/  common/
│   └── dialogs/confirm-dialog.tsx  # 30 importadores · new-folder-dialog.tsx (workspace + rag)
├── hooks/                          # SOMENTE o kernel real
│   └── use-auth · use-page-meta · use-api · use-sse-stream · use-mutation-in-flight · use-whoami
├── lib/                            # SOMENTE módulos com ≥2 features consumidoras
│   ├── api/                        # index.ts (transporte) · session.ts · types.ts · keys.ts · sse-events.ts
│   └── format.ts · rum.ts · domain.ts · config.ts · readiness/signals.ts
├── build/  test/  vendor/          # inalterados
```

Diferenças em relação a hoje que carregam o valor:

- `src/pages/` deixa de existir como namespace global. Os 6 arquivos que hoje **não são páginas** e moram na raiz de `pages/` (`new-folder-dialog.tsx`, `workspace-preview-sheet.tsx`, `workspace-presign.ts`, `use-workspace-selection.ts`, `sub-page-placeholder.tsx`, `previews.tsx`) vão cada um para o seu lugar — e `previews.tsx` é deletado (o próprio `app.tsx:308` declara a página removida).
- `src/hooks/` cai de 44 para ~6 arquivos. `src/lib/` cai de ~39 para ~10 módulos.
- `src/components/` deixa de ter três taxonomias porque passa a ter **uma**: só entra o que é cross-feature.
- Cada feature ganha um `index.ts`. Hoje esse número é zero.

### 4.3 A regra de residência (sem ela a migração recria o problema)

> **Um hook, componente ou módulo com um único consumidor mora com a feature que o
> consome. `src/components/`, `src/hooks/` e `src/lib/` só aceitam artefato com ≥2
> features consumidoras. Import entre features acontece exclusivamente pelo `index.ts` da
> feature alvo; caminho profundo entre features é proibido.**

A regra é objetiva (contável), mecanizável e responde sozinha às três perguntas que hoje
não têm resposta escrita: quando um domínio vira pasta (sempre), o que é API pública de
uma feature (o `index.ts`) e o que pode morar em `lib/`.

### 4.4 Sequência recomendada

| # | Passo | Por que nesta ordem |
|---|---|---|
| 1 | **ADR do eixo + regra de residência** (ADR-0001) | Mover arquivos antes de decidir a regra é como a árvore atual foi produzida |
| 2 | **Codificar em `import/no-restricted-paths`** | Uma fronteira sem verificação é uma preferência, não uma fronteira. O plugin `eslint-plugin-import` já está disponível; `dependency-cruiser` e `madge` existem **apenas como binários globais** na máquina do dev, não são devDependencies e não rodam em CI |
| 3 | **Migrar `lens` e depois `deploy`** | São as de maior espalhamento medido (57 e 25 arquivos). Um domínio por PR; o baixo acoplamento torna cada PR mecânico |
| 4 | **Resolver a incoerência do orçamento de LoC** (ADR-0002) | `app.tsx` tem **729 linhas** — 49 a mais que o `trace-detail.tsx` que foi refatorado por "estourar 500 LoC". Ou a regra vale para a raiz também, ou não vale para ninguém |

Efeito colateral desejável do passo 3: fatiar `routes.tsx` por feature derruba `app.tsx`
de 729 para menos de 150 LOC (estimado), elimina o ponto único de conflito de merge e
destrava a migração dos demais domínios.

### 4.5 Componentização: o problema é sub-decomposição, não arquivos gordos

Este é o ponto onde a intuição usual erra, e a medição corrige.

| Métrica | Valor medido |
|---|---|
| Arquivos `.tsx` de produção | 216 |
| Mediana de LOC por `.tsx` | 153 |
| Arquivos acima de 400 LOC | 32, somando 17.735 LOC |
| Arquivos com **5 ou mais componentes** | **4** |
| Entre os 30 maiores `.tsx`: declaram **exatamente UM** componente | **18** |

O problema **não** é empacotar muitos componentes num arquivo. É ter **um componente só
fazendo tudo**. O caso extremo é `src/pages/promptly/detail.tsx`: **916 LOC**, um único
`PromptDetailPage` começando na linha 131, com **15 `useState` e 9 `useQuery`** dentro da
mesma função — e cada `useQuery` é uma seção de UI independente (tags, revisions, labels,
policy, uso, resolvido, dependentes, comentários). O mesmo padrão em `deployments.tsx`
(705 LOC, 1 componente), `lens/evaluators.tsx` (586, 1), `skills/bundle-detail.tsx`
(555, 1), `workspace.tsx` (512, 1), `login.tsx` (499, 1).

**O padrão de correção já foi validado pelo próprio time**, em `src/pages/lens/trace-detail/`:
`helpers.ts` puro + subcomponentes + `index.tsx` como composition root. Aplicado a
`promptly/detail.tsx`, cada `useQuery` vira uma seção componentizada (`TagsSection`,
`RevisionsSection`, `CommentsSection`, `DependentsSection`) recebendo o id do prompt — o
que também permite `Suspense` e error boundary **por seção** em vez de a página inteira
falhar junto.

Ordem sugerida pelos 5 piores: `promptly/detail.tsx` (916) → `api-keys.tsx` (954, também
faz fetch) → `deployments.tsx` (705) → `project-connect.tsx` (696, 16 `useState` +
`setInterval` manual) → `memory/graph.tsx` (664).

---

## 5. Achados por dimensão

Ordenados por severidade (critical → high → medium → low → info). Todo achado high carrega
evidência `file:line`. **`severity_source`:** `consensus` = concordância ampla da indústria
com múltiplas fontes autoritativas; `heuristic` = baseado em experiência, sem autoridade
forte (ver §8).

### 5.1 Fronteiras & DDD — 2/5

**19 achados: 10 high · 8 medium · 1 info**

#### HIGH

| # | Achado | Evidência | Remediação |
|---|---|---|---|
| B-16 | **Não existe contrato escrito de fronteira de módulo, e o código cita um que não está no repositório** *(consensus)* | `src/pages/lens/trace-detail.tsx:5` — *"breached the 500-LoC `architecture.md` budget"*. Busca: sem `architecture.md` em `dashboard/`; `theo-cloud/docs/architecture/` só tem `index.md` e `mcp-broker.md`; a única referência a folder layout está no `.llms.txt` do pacote `@usetheo/ui`, não do dashboard | Escrever `dashboard/docs/architecture.md` de uma página fixando cinco decisões hoje ambíguas, e **só então** migrar código. Ver ADR-0001 |
| B-5 | **Organização package-by-layer dispersa cada feature por 3–4 diretórios, sem nenhuma fronteira declarada** *(consensus)* | `src/pages/deployments.tsx:23`. Dispersão: `auth` 4 camadas/17 arq · `deploy` 4/14 · `logs` 4/8 · `lens` 3/57 · `promptly` 3/23. `find src/components/*/index.ts` → **0 resultados** | Migração incremental para `src/features/<domínio>/`, um domínio por PR, com `index.ts` por feature e trava em `dependency-cruiser`/`import/no-restricted-paths` |
| B-6 | **`src/app.tsx` é um manifesto de rotas monolítico: 729 LOC, 85 `lazy()`, 118 `<Route>`, ~15 domínios** *(consensus)* | `src/app.tsx:45` (`OverviewPage`), `:313` `PreviewsRedirect`, `:326` `RepositoryAlias`, `:351` `RouteScope` | Cada feature exporta seu subtree de rotas; `app.tsx` monta ~15 `<Route>` + shell. Derruba para <150 LOC (estimado) |
| B-7 | **`src/hooks` é um shared kernel falso: 33 de 44 hooks (75%) servem uma única feature** *(consensus)* | `src/hooks/use-scale-cost.ts:1`. Genuinamente compartilhados: `use-auth` (19 features), `use-page-meta` (20), `use-api` (7), `use-projects` (5), `use-deployments` (5), `use-sse-stream` (3). Duplicidade de nome: `use-environments.ts` existe em `hooks/` **e** `hooks/mutations/` | Mover os 33 para dentro da feature; manter só o kernel real. Ou aposentar `mutations/` ou aplicá-la a 100% dos hooks de escrita |
| B-10 | **`src/components` mistura três taxonomias concorrentes em 30 pastas irmãs** *(consensus)* | `src/components/sheets/add-domain-sheet.tsx:1`. 11 das 14 peças de `dialogs/`+`sheets/` têm 1 importador de 1 feature. Colisão de eixo: `data/{card,table}-skeleton.tsx` vs `loading/route-loading.tsx`. Dois arquivos soltos na raiz de `components/` | Adotar UM eixo: `components/` só recebe cross-feature; o resto vai para a feature dona |
| B-13 | **Raiz de `src/pages`: 41 arquivos de ~15 domínios, 6 dos quais não são páginas** *(consensus)* | `src/pages/new-folder-dialog.tsx:1` — importado por **duas** features (`workspace.tsx:24` e `rag/wiki.tsx:16`). `src/app.tsx:308` declara `PreviewsPage` deletada; `previews.tsx` (213 LOC) segue na árvore | Todo domínio vira pasta, sem exceção. `new-folder-dialog` sobe para `components/dialogs/`. Deletar `previews.tsx` + `use-previews.ts` |
| B-15 | **Sub-decomposição de páginas: 32 `.tsx` acima de 400 LOC somando 17.735, a maioria com UM componente** *(consensus)* | `src/pages/promptly/detail.tsx:131` — 916 LOC, 1 componente, 15 `useState`, 9 `useQuery`. Gate existente cobre **um** arquivo: `src/pages/login-loc-budget.test.ts:10` | Generalizar o gate (ESLint `max-lines` + allowlist congelada) e aplicar o padrão `trace-detail/` aos 5 piores. Ver §4.5 e ADR-0002 |
| B-9 | **Dois `AddSecretSheet` homônimos; o legado tem contrato de backend comprovadamente errado e continua importável** *(consensus)* | `src/components/sheets/add-secret-sheet.tsx:22` (0 importadores) vs `src/components/secrets/add-secret-sheet.tsx:36` (usado por `pages/secrets.tsx:10`). O docblock canônico (`:24-28`) declara o mismatch: legado envia `environments: []`, backend espera `environment: string` | Deletar o legado agora. Proibir dois arquivos com o mesmo basename em `src/components` via CI |
| B-11 | **Fronteira do design system tem três donos em três versões** *(consensus)* | `src/main.tsx:4` `TheoUIProvider` de `@theokit/ui@1.3.2`; 192 arquivos importam `@usetheo/ui@0.35.1`; tokens vendorizados do `@usetheo/ui@0.22`. `main.tsx:91` e `index.css:145` afirmam coisas **mutuamente exclusivas** sobre `--primary`, com valores diferentes | Resolver com um teste (`getComputedStyle`), não por leitura. Ver ADR-0003 |
| B-1 | **5 ciclos de import em `pages/lens` causados por shims de re-export homônimos** *(consensus)* | `madge --circular src` → 8 ciclos, 5 em `pages/lens`. `playground.tsx:6` importa do shim pai; `playground/baseline-column.tsx:5`; `traces/peek-sheet.tsx:14`; `trace-detail/span-detail.tsx:10` importa a página irmã `LensPlayground` | Regra de lint: nenhum arquivo dentro de `X/` importa de `X`. Filhos importam leafs. Ver §7 (contradição resolvida) |

#### MEDIUM

- **B-19** — O padrão `X.tsx` + `X/` aparece **16 vezes com duas semânticas opostas** e apenas 1 `index.ts` no conjunto todo (`src/pages/lens/traces.tsx:20`). Padronizar na semântica A (o arquivo é o composition root), que cobre 15 dos 16 casos. *(consensus)*
- **B-12** — `src/lib` é um saco plano de ~39 módulos onde só 7 são compartilhados; `lens` mantém **8 módulos de domínio** lá dentro (incluindo `trace-layout.ts`, 370 LOC) e `auth` está fragmentado em duas formas (`auth.ts` + `auth/`) (`src/lib/trace-layout.ts:1`). *(heuristic)*
- **B-14** — `src/lib/api.ts` guarda sessão em 6 variáveis mutáveis de módulo e **abre um `BroadcastChannel` como efeito colateral de import** (`:73-86`), para 103 sites em 20 features. O design do singleton é correto; o que falta é ciclo de vida explícito e um `reset` para os testes. *(heuristic)*
- **B-18** — `promptly` importa 3 níveis fundo no interior do `lens` e **replica a DSL de URL** sem contrato compartilhado (`src/pages/promptly/traces-link.ts:1`). É a **única** aresta profunda entre subpastas de features distintas — o que reforça o diagnóstico geral. O lens deve exportar `buildTracesUrl()`, não os tijolos. *(heuristic)*
- **B-8** — `components/scale/` e `components/scaling/` cobrem o mesmo conceito; o segundo tem 1 arquivo com **zero importadores**. *(heuristic)* → ver D-2 (mesma causa, contado uma vez)
- **B-4** — `lib/auth.ts` e `lib/api.ts` (produção) importam estaticamente `lib/dev-mocks.ts`, fechando ciclo (`src/lib/auth.ts:18`). Inversão de dependência invertida; sem consequência de bundle (ver §7). *(heuristic)*
- **B-2** — Ciclo runtime `pages/lens/traces/columns.tsx` ↔ `traces.tsx` (`columns.tsx:6`): a página exporta helper puro. *(heuristic)*
- **B-3** — Ciclo runtime `pages/workspace.tsx` ↔ `workspace-preview-sheet.tsx` (`:4`, import de **valor**). *(heuristic)*

#### INFO

- **B-17 — CALIBRAGEM (leia antes dos demais).** O acoplamento é medidamente baixo e a direção das camadas está 100% correta. Registrado explicitamente para impedir leitura inflacionada: os achados B-5/7/10/13 são investimento em **navegabilidade**, não correção de acoplamento. *(consensus)*

### 5.2 Fluxo de Dados & Estado — 2/5

**19 achados: 10 high · 9 medium** · 15 fluxos de dados mapeados (8 `http_sync`, 7 `event_bus`; backpressure real em 4)

#### HIGH

| # | Achado | Evidência | Remediação |
|---|---|---|---|
| S-13 | **Três convenções concorrentes de query key; a documentada é minoria (12% dos 208 sites)** *(consensus)* | `src/hooks/use-api.ts:40`. Contagem: `["cloud", path]` = 130, `queryKeys.*` = 25, `["engine", …]` = 5, constantes locais ≈ 30. Em `promptly/detail.tsx`, a mutation de rollback (`:330`) invalida `labelsKey` e `revisionsKey` mas **não** as queries `prompt` (`:180`) e `resolvido` (`:241`) | Formalizar a convenção que venceu: `cloudKey()`/`engineKey()` + catálogo de paths por feature. Ver ADR-0006 |
| S-1 | **Query keys inline em 71 dos 87 arquivos que definem `queryKey`** *(consensus)* | `src/lib/api/query-keys.ts:11` — factory cobre 8 domínios; apenas 17 arquivos a importam; 60 dos 87 são páginas | Factory por feature + regra de lint proibindo array literal em `queryKey` |
| S-10 | **O CREATE de 3 recursos vive no sheet e não invalida cache; o hook correspondente está órfão** *(consensus)* | `src/components/sheets/add-domain-sheet.tsx:54` faz `engineFetch` e notifica por callback `onAdded`. Consumidores de produção: `useAddDomain`=0, `useCreateEnvironment`=0, `useInviteMember`=0 — enquanto `useDeleteDomain`, `useVerifyDomain`, `useRemoveMember` **são usados**. A divisão é só no create: isso é deriva, não decisão | Consumir os hooks de mutation; o sheet fica só com formulário + validação |
| S-11 | **`domains` tem dois namespaces de query key independentes — invalidar um nunca alcança o outro** *(consensus)* | `use-domain-status-polling.ts:55` usa `["engine", "/api/v1/domains/<nome>"]`; `hooks/mutations/use-domains.ts:4` usa `["domains"]`. Nenhuma das duas existe em `query-keys.ts` | Adicionar `domains: {all, list, detail}` à factory |
| S-2 | **Acesso a dados vive nas páginas: 58 arquivos de `pages` e 13 de `components` chamam `cloudFetch`/`engineFetch` direto** *(consensus)* | 102 das 126 `useQuery` e **75 de 75** `useMutation` fora de hooks moram em páginas | Módulo de data-access por feature, no molde já emergente de `promptly-api.ts`/`trust-api.ts`/`skills-api.ts` |
| S-19 | **`src/pages` concentra 34.137 LOC contra 3.961 de `src/hooks`** *(heuristic)* | `src/pages/api-keys.tsx:1` (954 LOC). Doze páginas acima de 490 LOC misturam fetch, estado de UI, estado de URL e render | Meta: nenhuma página declara `queryKey` nem chama `cloudFetch` |
| S-4 | **Recuperação de token no SSE exige 3 erros consecutivos, mas um 401 fecha o `EventSource` no primeiro** *(consensus)* | `use-sse-stream.ts:66` `TOKEN_REFRESH_THRESHOLD = 3`; `:179-196` só limpa o token no 3º erro. Pela spec, uma resposta HTTP não-2xx dispara `error` **uma vez** e move `readyState` para `CLOSED` definitivamente. O teste não pega porque o `MockEventSource` (`use-sse-stream.test.tsx:65`) nunca seta `readyState=2` | Tratar `readyState === CLOSED` como sinal terminal (threshold 1 nesse caminho) + backoff com jitter; corrigir o mock |
| S-5 | **`use-status-stream` abre `EventSource` cru com estratégia de auth divergente da primitiva** *(consensus)* | `:193-194` autentica por `withCredentials: true` (cookie); os outros quatro streams usam `?token=<jwt>` após `ensureSSEToken()` (`use-sse-stream.ts:146-156`). **São dois contratos de auth de SSE no mesmo app** | Reescrever como wrapper de `useSSEStream`, preservando o reducer puro `applySignalEvent` |
| S-18 | **A aba Timeline abre TRÊS `EventSource`, duas para a MESMA URL** *(consensus)* | `use-deploy-timeline-with-steps.ts:30-32` abre `deploys/{id}/timeline` + `builds/{id}/stream`; `timeline-tab.tsx:27` → `build-timeline-live.tsx:98` abre `builds/{id}/stream` de novo. O TanStack Query deduplica por `queryKey`; `useSSEStream` **não tem nada equivalente**. Limite do browser: ~6 conexões por origem em HTTP/1.1 | (a) passar os steps por prop do hero — KISS, resolve o caso; ou (b) registry de `EventSource` por URL com refcount — fecha a classe |
| S-6 | **Snapshot histórico de logs entra sem cap e anula o FIFO de 5000 linhas do stream** *(consensus)* | `logs-tab.tsx:163` `setHistorical(data.entries ?? [])` sem slice; `:191` concatena `[...historical, ...stream.lines]`. `log-viewer.tsx:58` documenta o limite de ~5000 que o caminho real não respeita | Cortar o snapshot no mesmo cap e virtualizar o render com o componente do design system (ver §7) |

#### MEDIUM

- **S-8** — Estado de URL tem duas implementações: `nuqs` em 7 arquivos, `useSearchParams` cru em 28 — e `traces.tsx` usa **as duas no mesmo componente** (11 `useQueryState` + um `setSearchParams` em `:224` que reescreve a query string inteira, podendo derrubar chaves que o `nuqs` acabou de gravar). *(consensus)*
- **S-17** — A camada de data-access por feature **já existe pela metade e mora em `src/components/`**: `trust-api.ts` (8 exports/5 páginas), `skills-api.ts` (23/8), `promptly-api.ts` (20/6). Nenhum exporta `queryKey` (exceto um). É o embrião certo no lugar errado. *(consensus)*
- **S-16** — `/project-status` mantém um `EventSource` aberto **cujo resultado é descartado** (`project-status.tsx:77`, sem destructuring) — e reabre a conexão quando o snapshot resolve a env real. *(consensus)*
- **S-15** — Busca-enquanto-digita sem debounce em `/memory/skills` (`skills.tsx:193`): um GET por tecla, sem `AbortSignal`. Duas outras telas resolveram local e independentemente, com constantes divergentes (300ms e 350ms). Não existe primitiva de debounce no repo. *(consensus)*
- **S-12** — 20 endpoints são buscados de mais de um arquivo; `/v1/dashboard/rag/collections` aparece em **7 páginas**, cada uma com key e opções reescritas. *(heuristic)*
- **S-3** — Promote-to-production e rollback fazem `fetch` cru (`promote-to-production-dialog.tsx:113`, `rollback-dialog.tsx:93`), pulando refresh-e-retry no 401, o interceptor de 402 e o `ApiError` tipado. **As duas mutações de maior risco do produto.** *(consensus — severidade medium pelo alcance, prioridade alta pelo impacto)*
- **S-7** — Padrão snapshot-REST + delta-SSE reimplementado à mão em `logs-tab` com 4 `useState`, enquanto `use-deployments-list-stream.ts` já o encapsula corretamente. *(heuristic)*
- **S-9** — Estado de servidor em `useState` com `setInterval` manual em duas páginas (`project-connect.tsx:170`, `billing.tsx:91`), ao lado de 4 hooks que fazem isso declarativamente. *(heuristic)*
- **S-14** — O client HTTP de produção importa estaticamente `dev-mocks.ts`. **Defeito arquitetural real (ciclo); consequência de bundle refutada por medição** — ver §7. *(heuristic)*

### 5.3 Prontidão para Escala — 2/5

**10 achados: 5 high · 4 medium · 1 low (retirado pelo próprio auditor)**

#### HIGH

| # | Achado | Métrica medida | Remediação |
|---|---|---|---|
| E-1 | **Chunk `vendor` eager de 1,59 MB (397 KB brotli)** *(consensus)* | `dist/assets/vendor-B11nP9-F.js` raw = 1.593.511 B, **brotli = 397.109 B** contra limite declarado de 25.600 B (**15,5x**). `modulepreload` emite 462 KB brotli de JS eager antes de qualquer rota. Atribuição módulo-a-módulo: TipTap+ProseMirror **29,6%**, markdown **16,6%**, syntax-highlight **4,1%**, ansi-to-html 2,7% — somadas, **53,1% do chunk eager pertence a famílias de rota única** | Em `src/build/manual-chunks.ts:45`, devolver `undefined` para essas famílias — exatamente como a linha 37 já faz para `force-graph`/`d3`, que comprovadamente funciona (saiu para chunk próprio de 26.734 B brotli). Ganho **estimado** ~200 KB brotli no eager |
| E-2 | **O orçamento de bundle está desatualizado e o HARD GATE está 3,8x estourado** *(heuristic)* | 3 das 9 entradas (`theo-ui-*`, `radix-*`, `lucide-*`) casam com **globs vazios** e passam por ausência. Total medido = 858.495 B brotli contra limite declarado de 230.400 B | Realinhar as entradas aos chunks reais, reancorar o TOTAL no conjunto realmente eager (os 3 arquivos com `modulepreload`), e **plugar no CI** — hoje `size-limit` não aparece em `.github/workflows/quality.yml` |
| E-3 | **A virtualização da árvore de spans nunca foi implementada** *(consensus)* | `grep "from '@tanstack/react-virtual'"` em `src` + `e2e` → **0 resultados**. `VIRTUALIZE_THRESHOLD = 200` (`helpers.ts:48`) tem 4 hits, todos declaração/re-export/comentário — **zero leituras em condicional de render**. `trace-detail/index.tsx:157` renderiza `<SpanTree>` recursivo sem condicional. 32 arquivos usam `<DataTable`, **0** passam `virtualized` | Trocar por `SpanTreeVirtual` de `@usetheo/ui` (existe: `dist/components/composites/span-tree/span-tree-virtual.d.ts`) e corrigir o docblock que afirma o contrário. Ver §7 |
| E-4 | **A página de Audit busca sem `limit`/`offset` e renderiza toda a resposta** *(consensus)* | `src/pages/audit.tsx:87` monta a URL só com `action` e `actor`. Varredura de 185 literais de URL: apenas 6 carregam `limit`/`offset`/`page`; `/api/v1/audit` não está entre eles. Audit log é append-only por definição: o custo por render escala com a **idade da conta** | Adicionar `limit`/`offset` seguindo `lens/sessions.tsx:54-60`; para o export, reusar `EXPORT_CAP=5000` de `traces-export.ts:15` |
| E-6 | **`LogViewer` materializa uma linha de DOM por linha de log** *(consensus)* | `log-viewer.tsx:237` mapeia `filtered` inteiro; `parseAnsi` roda `convert.toHtml` na main thread a cada render. O teto de ~5000 que o docblock assume vem do FIFO do stream — mas o array que chega inclui o snapshot REST **sem limite** (`logs-tab.tsx:156`). **A premissa de dimensionamento está escrita no código e é falsa no único caminho que o usa** | Virtualizar com o `DataTable` virtualizado do design system + memoizar `parseAnsi` por linha |

#### MEDIUM

- **E-9** — O grafo de memória é baixado inteiro sem `limit` (`memory/graph.tsx:548`). **Tamanho já observado em produção e escrito no próprio arquivo: 4.423 nós, 1.266 desconectados** (incidente `theo-cloud#254`). As três mitigações que saíram do incidente atuam todas **depois** que os 4.423 nós chegaram, foram parseados e entraram na simulação de forças — resolveram legibilidade e deixaram intacto o custo de rede, parse e física. A tela irmã `rag/graphrag.tsx` já chama seu endpoint com `level` e `limit=300`. *(consensus)*
- **E-8** — A conversa da sessão dispara até **50 GETs paralelos** de árvore de spans, um por turno (`session-conversation.tsx:87`, `CONVERSATION_TURN_CAP = 50`). N+1 clássico traduzido para o cliente. Mantém 50 árvores inteiras vivas em memória. *(consensus — o limiar de N+1 é `consensus`: sempre um bug)*
- **E-7** — O service worker adiciona uma segunda camada de cache sobre a API que **contradiz o `staleTime` do app em 60x** (`maxAgeSeconds: 3600` vs `staleTime: 60s`), e o próprio código documenta **três incidentes** causados pelo SW. Como `engineFetch` prefixa `/engine`, a regex alcança reads do control plane — deploys, builds, audit, secrets. *(heuristic)* → ADR-0004
- **E-5** — `memory/entities` baixa o conjunto inteiro e pagina no cliente (`:95`, `:124`); a paginação visível esconde que o request não tem teto. As telas irmãs `memories.tsx:95` e `episodes.tsx:77` já mandam `limit`. *(heuristic)*

#### LOW — retirado

- **E-10 — RETIRADO PELO PRÓPRIO AUDITOR**, registrado em vez de apagado para preservar a trilha. A versão original afirmava que o "Load more" de deployments permitia janela ilimitada e que o repo não usava `useInfiniteQuery`. **As duas afirmações são falsas**: `deployments.tsx:144-145` documenta que o backend limita em `limit=50`, e `memory/episodes.tsx:66` usa `useInfiniteQuery` com paginação por cursor. Além disso `:146-150` registra a decisão de não migrar como escopo deliberado, com gatilho declarado e caminho de migração pronto — **um trade-off documentado não é um achado de scaling**.

### 5.4 Segurança de Deleção — 2/5

**24 achados: 6 high · 12 medium · 6 low**

#### HIGH

| # | Achado | Evidência | Remediação |
|---|---|---|---|
| D-23 | **Doze módulos (935 LOC + 844 LOC de testes) não têm importador exceto o próprio teste** *(consensus)* | Grafo de import sobre 673 arquivos + re-verificação por grep com especificador citado. Inclui `src/pages/lens/compare-core.ts` (188 LOC — a página `compare.tsx` **não importa o próprio core extraído**), `src/lib/auth/safe-redirect.ts` (56 LOC — um guard de **open-redirect que nada chama**), `src/lib/clipboard.ts` (44 — enquanto `live-url-hero.tsx:116` chama `navigator.clipboard` inline), `src/components/data/card-skeleton.tsx` (importado só pelo teste de **outro** componente). **Todos têm teste verde — é exatamente por isso que ninguém notou** | Triagem em dois baldes: (a) **deveria estar wired, e a falta de wiring é o bug** — `safe-redirect` (lacuna de segurança latente), `clipboard`, `compare-core`; (b) deletar com o teste. Depois, gate de CI para módulo sem importador de produção |
| D-20 | **Dois hooks de comportamento visível ao usuário estão wired a nada além dos próprios testes** *(consensus)* | `use-domain-status-polling.ts:50` (101 LOC, único importador = seu teste; exporta `__test_TERMINAL_STATUSES` e `__test_POLL_INTERVAL_MS` só para o teste ler) e `use-first-deploy-trigger.ts:31` (86 LOC, idem). **161 linhas de teste verde afirmam um comportamento que não existe em runtime** | Por hook: wirear ou deletar com o teste. Gate de CI para hook cujo único importador é o próprio teste — **este padrão já produziu 5 instâncias** |
| D-11 | **`src/lib/api.ts` é inexcisável: 151 importadores em 51 diretórios puxando 12+ símbolos distintos** *(heuristic)* | 30x o limiar heurístico de fan-in. A interface **não é estreita**: `cloudFetch` ×60, `engineFetch` ×59, `ApiError` ×28, mais `ensureSSEToken`, `clearToken`, `exchangeSessionToken`, `getApiBase`, `cloudFetchRaw`, `useEngineApi`… O arquivo de 394 LOC mistura 4 responsabilidades que mudam por razões diferentes, e colide com o diretório irmão `src/lib/api/` (80 importadores) — `@/lib/api` e `@/lib/api/types` são módulos diferentes a um caractere de distância | Split por razão-de-mudar, **primeiro como move mecânico preservando re-exports** (zero mudança de comportamento), depois migrando importadores. Um big-bang em 151 arquivos não é revisável |
| D-1 | **`AddSecretSheet` legado órfão com mismatch de schema conhecido continua na árvore** *(consensus)* | `src/components/sheets/add-secret-sheet.tsx:22`, 0 importadores, adicionado 2026-05-27, superado 2026-06-12, **editado em 2026-07-19** — manutenção sendo paga em código morto. `:55` faz POST com `environments` **array**; o backend espera `environment` **string** | `git rm`. Dois exports homônimos em pastas irmãs são risco ativo: um auto-import do editor reintroduz silenciosamente o payload quebrado |
| D-2 | **Diretório órfão `src/components/scaling/` sombreia o vivo `src/components/scale/`** *(consensus)* | `scale-dialog.tsx:36`, 178 LOC, **zero importadores** em `src/`, `e2e/` ou `.storybook/`, sem arquivo de teste (enquanto todo componente do irmão `scale/` tem `.test.tsx` colocalizado). Carrega `engineFetch` cru e uma prop de custo cujo próprio comentário admite ser mock | Deletar o diretório. Elimina também a armadilha de navegação `scale/` vs `scaling/`, indistinguíveis num fuzzy finder |
| D-3 | **`PreviewsPage` é declarada deletada em três arquivos e continua na árvore, com seu hook privado** *(consensus)* | `src/app.tsx:308`, `pages.smoke.test.ts:128` e `test/e2e-journeys.test.tsx:64` todos afirmam a remoção. `src/pages/previews.tsx` (213 LOC) segue no disco com 0 importadores, e é o único consumidor de `use-previews.ts` (39 LOC, transitivamente morto). **Ambos receberam manutenção DEPOIS de serem declarados deletados** | `git rm` nos dois. Manter código que comentários afirmam ter sumido é pior que qualquer um dos dois estados: torna toda afirmação de deleção do repositório não confiável |

#### MEDIUM

- **D-14** — **Zero anotações `@deprecated` em 673 arquivos**, enquanto 44 arquivos carregam **97 referências em prosa** a "legacy". A prosa faz o trabalho que a anotação deveria fazer, então nada é visível à máquina. Vários são fallbacks de compat **ainda executando em produção**: `projects.tsx:174` e `project-detail.tsx:182` leem `active_env_count ?? production_env_count ?? environment_count ?? (environment ? 1 : 0)` — cadeia de quatro níveis cujos dois últimos elos os comentários rotulam como legacy. *(heuristic)*
- **D-24** — **Não existe nenhum mecanismo de feature flag.** Busca negativa exaustiva por 12 mecanismos (`feature_flag`, `FEATURE_`, `useFlag`, `isEnabled(`, `flags.`, LaunchDarkly, Unleash, Flipper, GrowthBook, `killSwitch`…): zero hits. Com 118 rotas e nenhum toggle, uma feature parcialmente construída só tem dois estados — merged-and-live ou não merged. **A consequência observada é o resto desta fase**: 6 rotas com placeholder, 12 módulos importáveis só pelo teste, 5 hooks sem chamador. Trabalho inacabado não tem onde morar exceto na árvore principal. *(heuristic)*
- **D-21** — Dois frameworks de mock paralelos (3.944 LOC, 6,2% de `src`) atrás da mesma flag, com excisabilidade muito diferente: `src/lib/mocks/` tem **um** importador externo e sai limpo; `dev-mocks.ts` é importado **estaticamente** por `api.ts:14` e `auth.ts:18`. **Verificado como não-problema de bundle** (ambos tree-shaken). A lacuna residual é o guard: `tree-shake-check` faz grep só por `lib/mocks`, então uma regressão que deixasse `dev-mocks.ts` no bundle passaria em silêncio. *(heuristic)*
- **D-22** — Lógica de auth espalhada por três módulos homônimos, com **duas cópias divergentes do tipo `Flow` do Kratos** (`kratos.ts:10`/`:25` vs `auth/kratos-flow.ts:9`/`:16`), descrevendo o mesmo payload com shapes diferentes. `login.tsx` importa das duas famílias. Nenhum dos módulos pode ser refatorado antes de decidir qual `Flow` é autoritativo. *(heuristic)*
- **D-8** — **Stack CodeMirror (4 pacotes de produção) shipado e nunca importado**: `@codemirror/lang-json`, `@codemirror/state`, `@codemirror/view`, `@uiw/react-codemirror`. Dois métodos independentes concordam (knip + grep em `src/`, `e2e/`, `.storybook/` e configs). Todos adicionados no mesmo dia (2026-07-04): um editor foi começado e abandonado sem reverter a dependência. *(consensus)*
- **D-9** — `@tanstack/react-virtual` não usado enquanto **três comentários afirmam que o app virtualiza com ele**. Pior que inerte: um safeguard de performance documentado não existe em runtime. *(consensus)* → ver §7
- **D-15** — `package.json:141` declara `packageManager: pnpm@11.1.0`, que o Corepack trata como autoritativo, enquanto `.gitignore:1-3` bane `pnpm-lock.yaml` ("this project uses npm"), o `Dockerfile` copia `package-lock.json` e roda `npm`, e o CI usa `cache: npm`. Existe um `pnpm-lock.yaml` local não rastreado de 404 KB, **14 dias defasado** — a prova de que alguém já resolveu um grafo de dependências diferente do que a imagem instala. *(consensus)*
- **D-17** — Branch permanentemente falsa em `register.tsx`: `const [registered, _setRegistered] = useState(false)` com `eslint-disable` para o setter não usado (`:97-98`), e um bloco de ~35 linhas de UI atrás de `if (registered)` (`:266`) que nenhum usuário pode alcançar. **Sobrevive à review porque o `eslint-disable` silencia o único sinal automático que teria detectado.** *(consensus)*
- **D-18** — `ActionBar` (79 LOC + 62 de teste) é mantido vivo apenas pelo próprio teste e por um re-export de barrel. *(consensus)*
- **D-4/D-5/D-6** — `useAddDomain` (zero referências, nem teste), `useCreateEnvironment` e `useInviteMember` (**test-only**: o sheet de produção faz `fetch` cru e passa ao largo). Em `use-team.test.tsx:47` há um teste chamado `test_useInviteMember_posts_to_teams_members_plural_path` — **guardando uma regressão de path num hook que nada chama, enquanto o sheet que realmente emite a request está desprotegido**. *(consensus / heuristic)* → mesma raiz de S-10, contado uma vez

#### LOW

- **D-7** — O shim `trace-detail.tsx` é artefato de migração sem `@deprecated`, sem sunset e sem issue de limpeza, com 3 dos 12 re-exports provadamente não usados. **Verificado NÃO morto:** 6 consumidores reais. Mas a migração também está incompleta na direção oposta — 5 arquivos já importam subpaths diretamente e passam ao largo do shim, então a justificativa de "zero churn" expirou. *(heuristic)* → ver §7
- **D-13** — Seis rotas alcançáveis pela navegação renderizam `SubPagePlaceholder`, todas anunciadas na sidebar. **Não é defeito de padrão** — o stub honesto é a escolha certa. A lacuna é que nada limita a vida deles: sem issue, sem sunset, sem `@deprecated`. Deletar os seis hoje removeria ~110 linhas de `app.tsx` e 6 entradas de nav com zero perda para o usuário. *(consensus)*
- **D-19** — Quatro símbolos exportados mortos confirmados por knip **e** por grep: `startRegistration` (`auth.ts:129`), `getInputNodes` (`kratos.ts:76`), `TERMINAL_TIMELINE_EVENT_TYPES` (`api/deploy-timeline-events.ts:86`) e um re-export de `Loader2`. As deleções mais baratas disponíveis. *(consensus)*
- **D-12** — Alias de compatibilidade morto: `export { cloudFetch as apiFetch }` (`api.ts:249`) com zero consumidores — alarga a superfície pública do módulo mais importado do codebase por nada. *(consensus)*
- **D-10** — Três devDependencies não usadas: `autoprefixer` (Tailwind v4 já prefixa internamente), `eslint-plugin-react-compiler` (**instalado e desligado** — ver ADR-0005) e `@storybook/blocks`. Severidade baixa mantida pela distinção dev-vs-prod. *(consensus)*
- **D-16** — `.dockerignore` não cobre `playwright-report/` (524 KB), `test-results/` e `tsconfig.tsbuildinfo`, que o `COPY . .` puxa para o contexto de build. **Verificado como não sendo problema de git** (nada rastreado); o vazamento é só do Docker: ~560 KB de saída de teste invalidam o cache de layer sempre que alguém roda a suíte localmente. *(heuristic)*

### 5.5 Trade-offs & Pragmatismo — 3/5

**19 decisões analisadas: 8 documentadas · 11 não documentadas** (5 high · 9 medium · 2 low · 3 info)
**14 sínteses** em `system_design_findings` derivam destas mesmas decisões (não são achados adicionais).

#### HIGH

| # | Decisão | Estado | Ação |
|---|---|---|---|
| T-1 | Eixo de organização package-by-layer | **Não documentada.** Varridos `DESIGN.md`, `.llms.txt`, `TESTING.md`, `DOGFOOD.md`, `docs/governance/dashboard.md`, `docs/architecture/*`. Existe apenas por imitação de commits anteriores | **ADR-0001** + regra de residência |
| T-2 | Orçamento de 500 LoC citando `architecture.md` | **Documento não existe.** A regra sobreviveu ao documento que a definia; engenheiros refatoram para cumprir um número cuja fonte ninguém consegue abrir | **ADR-0002**: promover a `max-lines` executável ou declarar morta |
| T-5 | Valor de `--primary` definido em dois lugares | **Ambos documentados, e as duas documentações se contradizem** — logo pelo menos uma está errada e um dos fixes está morto. `main.tsx:91` afirma que o `index.css` não tem efeito; `index.css:145` afirma o oposto sobre o próprio bloco. Cada um cita uma investigação de contraste WCAG diferente | Medir com `getComputedStyle` no app buildado, apagar o perdedor, fixar o vencedor num teste Playwright. **O contraste real da marca hoje é indeterminado por leitura** |
| T-11 | `size-limit` como gate de bundle | **Documentado e obsoleto.** 3 de 8 entradas apontam para chunks fundidos pela correção de init-order e passam por ausência; o TOTAL está estourado; não roda no CI. **Um gate que passa por apontar para arquivos inexistentes é pior que nenhum gate** | Reancorar nos chunks reais + plugar no CI, ou remover |
| T-16 | Acesso a dados sem camada dedicada | **Deriva, não decisão** — e a evidência é que a decisão certa chegou a ser tomada: `query-keys.ts:1-9` documenta a factory com o porquê técnico exato (EC-05) e nunca virou obrigatória. 18 arquivos a importam contra 74 que chamam `useQuery` | **ADR-0006**: tornar obrigatória a que já existe, via lint |

#### MEDIUM

- **T-4** — Split `@usetheo/ui` (componentes) vs `@theokit/ui` (theme provider). **Intencional upstream**, declarado na `description` do pacote de terceiros — mas nenhum documento do dashboard o menciona, e `DESIGN.md:88` ainda nomeia `@usetheo/ui@0.12.0-next.0` como única biblioteca canônica, 23 minors atrás. **Não recomendo consolidar** — o split é deliberado. → ADR-0003
- **T-12** — Service worker num dashboard operacional autenticado. O **como** está documentado em detalhe; o **porquê** não existe em nenhum documento. O custo está medido: duas classes de bug (#112, #203) já atribuídas a ele. → ADR-0004
- **T-13** — React Compiler ativo sem política de memoização documentada nem lint companheiro. A flag mudou a política de memoização de todo o time e nenhum documento voltado a quem escreve componente a menciona. → ADR-0005
- **T-10** — `manualChunks` colapsando todo `node_modules` num chunk. **Documentada e medida — mas medida contra CRASH, não contra tamanho.** `manual-chunks.ts:8-13` (ADR D1) documenta que separar `scheduler` quebra a ordem de init, citando 3 issues do Vite como prior art. A decisão está certa para o problema que resolve; o custo de bundle nunca foi o critério.
- **T-14** — Não adotar feature flags. **Defensável** para um time pequeno; o que não é defensável é o mecanismo substituto: sem flag, "desligar" virou "apagar a rota e deixar o arquivo". Um Staff engineer não pediria LaunchDarkly aqui; pediria que "deletado" significasse deletado.
- **T-18** — Nenhum modelo de consistência declarado, num produto cujo contrato de UX promete "status truthful" sobre produção. → ADR-0007
- **T-19** — 236 referências a ADR no código, diretório de ADRs vazio, 12+ slugs de plano citados que não resolvem. **A cultura de decidir existe e é forte; o que não existe é a durabilidade.** → ADR-0008
- **T-8** — `packageManager: pnpm` contra npm de facto. A **escolha** está documentada com o porquê; o problema é a contradição residual. → D-15
- **T-3** — Nenhuma fronteira arquitetural enforced por ferramenta: a única regra de import executável bane um símbolo de terceiros por causa de um bug upstream. Coerente com T-1 — sem estratégia escrita não há o que enforçar.

#### LOW / INFO — decisões bem tomadas, registradas para não serem perdidas

- **T-6 (low)** — Vendorizar tokens CSS em `src/vendor/`: **documentada e bem argumentada**, com gatilho, alternativa rejeitada e critério de saída explícito. Único problema: a cláusula de manutenção do próprio README não está sendo cumprida (tokens do 0.22 contra pacote 0.35.1). **Manter a decisão**; adicionar um teste barato que falhe quando a condição de saída for atingida.
- **T-15 (low)** — Roteamento centralizado em `app.tsx`. **Manter a centralização** — a auditabilidade das 118 rotas num lugar e a aplicação uniforme dos guards valem mais que a modularidade aqui. O que precisa ser resolvido antes é a incoerência do orçamento de LoC.
- **T-7 (info)** — `src/components/ui/`: 3 wrappers com causa nomeada e **enforcement por lint**. Nenhuma ação, exceto registrar a dívida de upstream (quando `#175` for corrigido, remover o guard e o ban juntos — senão a regra de lint sobrevive ao bug, o mesmo modo de falha do orçamento de 500 LoC).
- **T-9 (info)** — Camada de mocks contida por import dinâmico + gate de CI: **o padrão mais forte encontrado**. Verificar apenas se `tree-shake-check` roda no CI — um invariante verificável que ninguém executa é documentação, não gate.
- **T-17 (info)** — Testes co-localizados: documentados com o porquê, em `TESTING.md`. **Nenhuma ação. Não mexer.**

---

## 6. Radar de dimensões

```
                         Fronteiras
                            2/5
                             ●
                        .    |    .
                   .         |         .
   Trade-offs 3/5  ●---------+---------●  Dados 2/5
                    `.       |       .'
                      `.     |     .'
                        ●---------●
                   Deleção 2/5   Escala 2/5

   escala:  0 ---- 1 ---- 2 ---- 3 ---- 4 ---- 5
   média ponderada: 2,2 / 5
```

```
Fronteiras     [████░░░░░░] 2/5   (10 high · 8 medium · 1 info)
Dados/Estado   [████░░░░░░] 2/5   (10 high · 9 medium)
Escala         [████░░░░░░] 2/5   ( 5 high · 4 medium · 1 retirado)
Deleção        [████░░░░░░] 2/5   ( 6 high · 12 medium · 6 low)
Trade-offs     [██████░░░░] 3/5   ( 5 high · 9 medium · 2 low · 3 info)
──────────────────────────────────
Geral          [████░░░░░░] 2,2/5  (91 achados · 0 critical · 36 high)
```

Versões vetoriais: `figures/dimension_scores.svg`, `figures/severity_distribution.svg`,
`figures/data_flow_map.svg`.

---

## 7. Contradições entre fases — resolvidas

Fases independentes chegaram a prescrições divergentes em três pontos. Este relatório
emite **uma** prescrição por ponto, com a justificativa da escolha.

### 7.1 `@tanstack/react-virtual`: manter ou remover? → **REMOVER a dep direta; usar o design system**

- Fase 3 (S-6) mandava usar a lib "já instalada". Fase 4 (E-3/E-6) manda usar `SpanTreeVirtual` / `DataTable virtualized` do `@usetheo/ui`. Fase 5 (D-9) exige decisão explícita.
- **Vence a fase 4.** Motivos medidos: (a) a virtualização **já existe e está testada** no design system (`span-tree-virtual.d.ts` e `data-table-virtualized.d.ts` existem no pacote instalado; o docblock do `DataTable` afirma renderizar 10K+ linhas); (b) a dependência direta é **zumbi** — chega ao bundle **apenas transitivamente** via `@usetheo/ui`, e nenhum caminho parte do código do app.
- **Prescrição única:** trocar `trace-detail/index.tsx:157` de `<SpanTree>` para `SpanTreeVirtual` acionado acima de `VIRTUALIZE_THRESHOLD`; virtualizar `log-viewer.tsx:237` com o `DataTable` virtualizado; **remover `@tanstack/react-virtual` do `package.json`**; corrigir os três comentários que afirmam que o app já virtualiza. Introduzir um primeiro uso próprio da lib quando o design system já resolve seria reinventar a roda.

### 7.2 `dev-mocks` incha o bundle? → **NÃO. Já corrigido no banco.**

- Fase 3 (S-14) **afirmava** que o import estático puxa o módulo para o grafo de produção. Fase 5 (D-21) **mediu** o artefato construído.
- **Vence a fase 5.** `grep` em `dist/assets/*.js` por `lib/mocks`, `mocksEnabled`, `getMockSession` e `mock-jwt-for-visual-validation` retorna **0 arquivos**: ambas as camadas são tree-shaken.
- **Prescrição única:** o defeito arquitetural (ciclo `api.ts → dev-mocks.ts → auth.ts`, inversão de dependência) **permanece real e vale a correção** — mover `mocksEnabled()` para `src/lib/config.ts`. A justificativa de bundle é retirada. Ação adicional: estender `tree-shake-check` para também falhar em `dev-mocks`/`mocksEnabled`, já que hoje ele só faz grep por `lib/mocks` — a camada soldada no caminho de auth é justamente a que não está guardada.

### 7.3 Shim `trace-detail.tsx`: colapsar ou depreciar? → **DEPRECIAR agora, colapsar como consequência do ADR-0001**

- Fase 2 (B-19) manda colapsar o shim e padronizar na semântica A. Fase 5 (D-7) manda mantê-lo e marcar `@deprecated` com sunset. Mesmo destino, sequências divergentes.
- **Escolha: o destino da fase 2, a sequência da fase 5.** Justificativa: o shim tem **6 consumidores reais verificados**, então colapsá-lo hoje significa reescrever 6 arquivos numa PR que ainda não decidiu o eixo de pastas — e é essa decisão (ADR-0001) que define se o destino é `trace-detail.tsx` ou `features/lens/pages/trace-detail/`. Colapsar antes do ADR é fazer o movimento duas vezes.
- **Prescrição única, em duas etapas.** **Agora:** remover os 3 re-exports provadamente não usados (`VIRTUALIZE_THRESHOLD`, `ChatMessage`, `FlatNode`), corrigir a afirmação falsa do docblock na linha 13, adicionar `@deprecated` com data de sunset e abrir a issue de limpeza. **Junto do ADR-0001:** reescrever os 6 consumidores para os leaf modules e deletar o shim, padronizando na semântica A (15 dos 16 pares). A regra de lint — *nenhum arquivo dentro de `X/` importa de `X`* — entra junto, senão o próximo split grande cria o próximo ciclo.

### 7.4 Sobreposições deduplicadas

Estas são **cross-validações que se confirmam entre fases independentes** — reportadas uma
única vez, com a redundância registrada como reforço de confiança, não como volume:

| Achado | Confirmado por |
|---|---|
| `src/components/scaling/` morto | Fase 2 (B-8) = Fase 5 (D-2) |
| `sheets/add-secret-sheet.tsx` órfão com schema errado | Fase 2 (B-9) = Fase 3 (`data_flows#14`) = Fase 5 (D-1) |
| Hooks de mutation órfãos (`useAddDomain`, `useCreateEnvironment`, `useInviteMember`) | Fase 3 (S-10) = Fase 5 (D-4/D-5/D-6) |

---

## 8. Legenda de sourcing de limiares

| Fonte | Significado |
|---|---|
| `consensus` | Concordância ampla da indústria, múltiplas fontes autoritativas |
| `default` | Default de ferramenta/fornecedor, uma fonte autoritativa |
| `heuristic` | Baseado em experiência, sem autoridade forte |
| `declarado-no-projeto` | Valor que o próprio repositório fixa (e portanto se obriga a cumprir) |

| Limiar | Valor | Fonte | Uso nesta auditoria |
|---|---|---|---|
| Queries N+1 | sempre um bug | `consensus` (Fowler) | E-8: até 50 GETs por view de sessão |
| Circuit breaker em chamada externa | obrigatório | `consensus` (Nygard, *Release It!*) | **Não aplicado** — 15/15 fluxos sem breaker e **nenhum achado levantado**: para um SPA de browser seria crying wolf |
| Connection pooling multi-tenant | obrigatório | `consensus` (AWS Well-Architected) | **N/A** — não há acesso a banco a partir do cliente |
| Fila para endpoints sujeitos a pico | obrigatório | `consensus` | **N/A** neste alvo |
| Profundidade de cadeia síncrona | ≤ 3 saltos | `heuristic` | Sem violação medida |
| Razão de import cross-boundary | > 30% indica abstração vazando | `heuristic` | **Nenhuma feature excede**; máximo `project` 25,0% |
| LOC por módulo | 2.000 | `heuristic` (folclore, sem fonte forte) | Nenhum módulo excede; a métrica útil aqui foi outra (§4.5) |
| Tamanho da API pública por módulo | 20 exports | `heuristic` | `src/lib/api.ts` puxa 12+ símbolos em 151 importadores → D-11 |
| Arquivos por módulo | 30 | `heuristic` | `src/pages` raiz = 41; `src/hooks` = 44 |
| Idade máxima de feature flag | 30 dias | `default` (LaunchDarkly) | **Deliberadamente NÃO aplicado** a `VITE_USE_MOCKS` (73 dias): é toggle de harness de teste em build-time, não flag de rollout — e os dois layers estão comprovadamente tree-shaken |
| Orçamento de LoC por arquivo | 500 | **fantasma** — citado como `architecture.md`, documento inexistente | T-2 / ADR-0002 |
| Orçamento de JS inicial | 225 KB brotli (TOTAL, "HARD GATE"); 25 KB (`vendor`) | `declarado-no-projeto` (`package.json` size-limit) | E-1: 397 KB medidos no `vendor` (15,5x); E-2: 858 KB no TOTAL (3,8x) |
| Cap de buffer de log SSE | 5.000 linhas FIFO | `declarado-no-projeto` (`use-log-stream.ts:40`) | E-6 / S-6: o cap não governa o snapshot REST |
| Cap de export de traces | 5.000 | `declarado-no-projeto` (`traces-export.ts:15`) | Citado como padrão correto a reusar em E-4 |
| `staleTime` / `gcTime` padrão | 60s / 5min | `declarado-no-projeto` (`query-client.ts:41-42`, com teste) | E-7: SW contradiz em 60x |
| Limiar de virtualização de spans | 200 linhas visíveis | `declarado-no-projeto` (`helpers.ts:48`) | E-3: constante nunca lida por render algum |
| Cap de turnos por conversa | 50 | `declarado-no-projeto` (`session-conversation.tsx:26`) | E-8: é o cap que limita o N+1 |
| Limiar de hairball de grafo | 500 nós | `declarado-no-projeto` (`graph.tsx:237`) | E-9: 4.423 nós observados em produção |
| Fan-in "tangled module" | > 5 importadores | `heuristic` | D-11: `api.ts` com 151 (30x) |

---

## 9. Plano de remediação priorizado

Ranqueado por (impacto × raio de alcance ÷ esforço). Os cinco primeiros são o que
recomendo tratar como o próximo ciclo de trabalho.

| # | Ação | Dimensão | Esforço | Impacto | Por quê primeiro |
|---|---|---|---|---|---|
| **1** | **ADR do eixo de organização + regra de residência, codificada em `import/no-restricted-paths`** — e só então migrar `lens` e `deploy`, um domínio por PR | Fronteiras | Médio (ADR: baixo) | **Alto** | É o pedido literal do time e a raiz de 10 achados high. O acoplamento medido baixo torna a migração barata; sem a regra escrita **primeiro**, ela recria o problema |
| **2** | **Regra ESLint proibindo array literal em `queryKey`/`mutationKey`** + wirear os 3 sheets aos hooks de mutation que já invalidam corretamente | Dados/Estado | **Baixo** | **Alto** | Fecha o buraco de invalidação de cache, que é **correção, não estética**, num painel que promete "status truthful". Os hooks corretos já existem e estão órfãos — o trabalho é ligar, não escrever |
| **3** | **`manual-chunks.ts`: devolver `undefined` para TipTap, markdown e syntax-highlight** + realinhar o `size-limit` aos chunks reais e plugar no CI | Escala | **Baixo** | **Alto** | ~200 KB brotli estimados fora do caminho eager, com o mecanismo **já provado no próprio arquivo** (`force-graph`). E ressuscita o único gate de tamanho do projeto, hoje verde por ausência |
| **4** | **Deletar o código morto confirmado por dois métodos**: `previews.tsx` + `use-previews.ts`, `components/scaling/`, `sheets/add-secret-sheet.tsx`, 4 símbolos mortos, alias `apiFetch`, 4 deps CodeMirror + `@tanstack/react-virtual`; **e adicionar o gate de CI** que falha em módulo sem importador de produção | Deleção | **Baixo** | Médio-Alto | Cada item foi confirmado por knip **e** por grep. O gate é o que impede o 6º caso: este padrão já produziu 5 instâncias, e o `AddSecretSheet` legado é risco **ativo** (auto-import reintroduz payload quebrado) |
| **5** | **Corrigir a recuperação de token no SSE** (`readyState === CLOSED` como terminal) **e a colisão de EventSource** da aba Timeline | Dados/Estado | Baixo-Médio | Médio-Alto | Hoje um 401 mata **todos** os streams até o usuário recarregar a página, e o teste não pega porque o mock nunca reproduz o comportamento real do browser. Três conexões para duas URLs distintas competem com as queries REST da mesma tela |

**Fila seguinte (6–10), por ordem de retorno:** (6) resolver a contradição de `--primary`
com um teste — o contraste da marca está indeterminado; (7) virtualizar `LogViewer` e capar
o snapshot histórico; (8) `limit`/`offset` em `/api/v1/audit`, `memory/entities` e
`memory/graph`; (9) remover o cache de API do service worker; (10) componentizar
`promptly/detail.tsx` pelo padrão já validado em `trace-detail/`.

**Fila de higiene (custo quase zero, faça junto de qualquer PR):** alinhar
`packageManager`; deletar o `if (registered)` morto de `register.tsx`; completar o
`.dockerignore`; ativar `eslint-plugin-react-compiler` (já instalado e desligado);
estender `tree-shake-check` para `dev-mocks`.

---

## 10. Cobertura e metodologia

### 10.1 Escopo inventariado

| Métrica | Valor |
|---|---|
| Arquivos inventariados | **724** |
| Arquivos de produção | 400 (96.465 LOC contando configs) — **375 arquivos / 63.756 LOC** de código-fonte de produção |
| Arquivos de teste | 324 (43.297 LOC) |
| Módulos mapeados | 22 |
| Mediana de LOC por arquivo de produção | **113** (p90 = 408) |
| Fluxos de dados mapeados | 15 |
| Registros de achado | **91** (+14 sínteses de trade-off, não contadas em dobro) |
| Gates de qualidade | 4, todos `keep` |

### 10.2 Ferramentas e método (declarado, não presumido)

| Ferramenta | Status | O que produziu |
|---|---|---|
| `madge --circular src` | **OK** (exit 1, 677 arquivos, 11,6s) | 8 ciclos de import confirmados |
| Parser de imports próprio (python3) | **OK** (3s) | 1.084 arestas sobre 370 arquivos de produção, com resolução de `@/` e relativos. Usado para razão cross-boundary, classificação feature-private vs shared e detecção de órfãos. **Cross-validado contra o `madge` nos 8 ciclos — bate 100%** |
| `knip --reporter json` | **OK** | 119 achados brutos, **triados individualmente**: `public/__config.js` marcado como falso positivo (carregado por `<script>` em `index.html:82`), assim como `HPA_*`, `ENGINE_URL`, `KNOWN_ROUTES`, `MAX_MARKDOWN_CHARS`, `TIME_RANGE_PRESETS` |
| `dependency-cruiser` | **INUTILIZÁVEL** | Existe apenas como binário global na máquina, não é devDependency, sem `.dependency-cruiser.cjs`; retornou `modules=0`. **As métricas de acoplamento NÃO vieram dele** |
| `npx size-limit` | **ABORTA neste ambiente** | `TimeoutError` do puppeteer (o preset exige Chrome headless). Os números de bundle vieram de `node zlib.brotliCompressSync` sobre o `dist/` recém-buildado — **método declarado, e reproduzido dígito a dígito por um segundo avaliador** |
| `ANALYZE=true vite build` | **OK** | `dist/bundle-stats.html`, usado para a atribuição módulo-a-módulo do chunk `vendor` (campo `renderedLength`) |

### 10.3 O que NÃO foi analisado (limitações honestas)

- **Nenhum profiling de runtime.** Não houve React DevTools Profiler, Lighthouse, medição de long tasks, INP/LCP reais ou trace de renderização. Todas as afirmações de custo de render são **derivadas de leitura de código e de contagens estáticas**, não de medição em execução. Um achado como "o `LogViewer` materializa uma linha de DOM por linha de log" é verificável por leitura; **quanto** isso custa em milissegundos não foi medido.
- **`npx size-limit` não roda neste ambiente.** Os números de bundle são confiáveis (medidos e reproduzidos independentemente com `zlib` do Node sobre o `dist`), mas não vieram da ferramenta que o projeto declara como gate.
- **`dependency-cruiser` inutilizável.** As métricas de acoplamento vieram de parser próprio, cross-validado com `madge`. A cobertura é boa, mas nenhuma das duas ferramentas rodou em CI — logo, nenhuma dessas métricas é regressão-guardada hoje.
- **Sem análise de acessibilidade.** Nenhuma auditoria a11y foi conduzida. Os dois achados que tocam WCAG (contraste de `--primary`) entraram porque o **próprio código** documenta investigações de contraste contraditórias, não porque a auditoria mediu contraste.
- **Sem análise de segurança.** Nenhum SAST, nenhuma revisão de authz, nenhuma auditoria de CVE de dependências. O guard de open-redirect não usado (`safe-redirect.ts`) foi flagrado como **código morto**, e a possível lacuna de segurança está registrada como hipótese a verificar — não como vulnerabilidade confirmada.
- **Sem análise de i18n.** Não foi avaliada nenhuma estratégia de localização.
- **Sem verificação de contratos de backend.** Onde o cliente e o backend divergem (payload de `AddSecretSheet`, cadeias de fallback `active_env_count ?? …`), a auditoria observa o **lado do cliente**. Quais caudas de compat já podem ser cortadas depende de estado do backend que esta auditoria não pode observar — e isso é precisamente parte do problema registrado em D-14.
- **Cobertura de inspeção formal = 0%.** Os 724 arquivos permanecem `pending` na tabela de inventário: as fases operaram por análise dirigida por grafo e por ferramenta sobre o corpus completo, não por leitura arquivo-a-arquivo registrada. Isso significa que a auditoria é **exaustiva nas dimensões que ferramenta e grafo alcançam** e **amostral no que exige leitura semântica**.

### 10.4 Rigor: correções aplicadas ao próprio banco

Duas afirmações foram **removidas do banco por esta fase** após verificação adversarial —
registradas aqui como prova de método, não escondidas:

1. **`state_findings#6`** — a versão original recomendava virtualizar o `LogViewer` "com o mesmo `useVirtualizer` de `trace-detail/index.tsx`". **Esse precedente não existe:** `grep useVirtualizer` em `src/` e `e2e/` retorna 0 hits. A recomendação havia sido induzida por um docblock obsoleto — o mesmo artefato que a fase 4 desmascarou. Precedente fabricado, removido.
2. **`state_findings#14`** — a versão original afirmava que o import estático de `dev-mocks` incha o bundle de produção. **Medição no `dist/` refuta:** ambas as camadas de mock são tree-shaken. O defeito arquitetural (o ciclo) permanece; a consequência de bundle foi retirada.

O avaliador de qualidade verificou **106 pares `file:line` contra o disco** (104 resolvem
exatamente; 2 são alvos não-arquivo defensáveis) e **reproduziu independentemente, dígito a
dígito**, os números de bundle da fase 4.

### 10.5 Gates de qualidade

| Fase | Dimensão | Score | Status | Observação do avaliador |
|---|---|---|---|---|
| 2 | Fronteiras | **0,94** | keep | 19/19 achados com `file:line` que resolvem; anti-crying-wolf exemplar (o achado de calibragem impede leitura inflacionada do próprio relatório) |
| 3 | Fluxo/Estado | **0,82** | keep | Duas correções obrigatórias aplicadas (§10.4). Gap: o método da fase não foi registrado em `tool_runs` |
| 4 | Escala | **0,91** | keep | Números reproduzidos dígito a dígito pelo avaliador. Um achado **retirado pelo próprio auditor** com a trilha preservada. Limitação de ferramenta declarada em vez de mascarada |
| 5 | Deleção/Trade-offs | **0,92** | keep | 41/43 `file:line` resolvem. Sinal mais forte do banco: os falsos positivos do knip foram triados individualmente em vez de repassados como verdade |
| — | **Global** | **0,90** | keep | |

---

## 11. Apêndice

### 11.1 Contagens por tabela

| Tabela | Registros | Severidades |
|---|---|---|
| `files_inventoried` | 724 | — |
| `modules` | 22 | — |
| `boundary_findings` | 19 | 10 high · 8 medium · 1 info |
| `data_flows` | 15 | 8 `http_sync` · 7 `event_bus` · backpressure em 4 |
| `state_findings` | 19 | 10 high · 9 medium |
| `scaling_findings` | 10 | 5 high · 4 medium · 1 low (retirado) |
| `deletion_findings` | 24 | 6 high · 12 medium · 6 low |
| `tradeoff_decisions` | 19 | 5 high · 9 medium · 2 low · 3 info (8 documentadas / 11 não) |
| `system_design_findings` | 14 | 5 high · 9 medium (síntese da dimensão trade-offs) |
| `quality_gates` | 4 | todos `keep` |
| `tool_runs` | 4 | 3 OK · 1 inutilizável (declarado) |
| `meetings` | 0 | — |

**Distribuição de `severity_source`** (91 achados): `consensus` 58 · `heuristic` 33.
Nenhum achado `critical` foi levantado em nenhuma dimensão.

### 11.2 Inventário de módulos

| Módulo | Domínio | Tipo de fronteira | LOC | Arquivos |
|---|---|---|---|---|
| `src/pages` (raiz) | mixed | bounded_context | 34.137 | 140 |
| `src/components` | mixed | shared_kernel | 16.285 | 130 |
| `src/pages/lens` | observability | bounded_context | 8.285 | 45 |
| `src/lib` | utilities | shared_kernel | 7.863 | 52 |
| `src/hooks` | data_access | shared_kernel | 3.961 | 46 |
| `src/pages/memory` | memory | bounded_context | 3.287 | 13 |
| `src/pages/promptly` | promptly | bounded_context | 3.131 | 11 |
| `src/pages/rag` | rag | bounded_context | 3.107 | 14 |
| `src/lib/mocks` | testing | generic_subdomain | 2.847 | 9 |
| `src/pages/skills` | skills | bounded_context | 2.351 | 7 |
| `src/lib/api` | api_client | **anti_corruption_layer** | 1.081 | 5 |
| `src/pages/trust` | trust | bounded_context | 906 | 4 |
| `src/app.tsx` | routing | shared_kernel (entry) | **729** | 1 |
| `src/pages/deployment-tabs` | deploy | bounded_context | 550 | 4 |
| `src/pages/settings` | settings | bounded_context | 533 | 1 |
| `src/lib/auth` | auth | bounded_context | 373 | 5 |
| `src/components/ui` | design_system | shared_kernel | 222 | 3 |
| `src/test` | testing | generic_subdomain | 163 | 2 |
| `src/main.tsx` | bootstrap | shared_kernel (entry) | 120 | 1 |
| `src/build` | build | generic_subdomain | 99 | 2 |
| `src/vendor` | design_system | **anti_corruption_layer** | — | — |
| `e2e` | testing | generic_subdomain | — | — |

### 11.3 ADRs propostos

Oito rascunhos MADR 3.0 completos em `system-design-output/adrs/` — um por
`tradeoff_decisions.suggests_adr = 1`:

| Arquivo | Origem | Título |
|---|---|---|
| `0001-eixo-de-organizacao-e-regra-de-residencia.md` | T-1 | Eixo de organização do código e regra de residência |
| `0002-orcamento-de-loc-por-arquivo.md` | T-2 | Orçamento de LoC por arquivo: executável ou morto |
| `0003-split-usetheo-ui-e-theokit-ui.md` | T-4 | Divisão de responsabilidade entre `@usetheo/ui` e `@theokit/ui` |
| `0004-service-worker-requisito-ou-remocao.md` | T-12 | Service worker: declarar o requisito ou remover |
| `0005-politica-de-memoizacao-com-react-compiler.md` | T-13 | Política de memoização sob React Compiler |
| `0006-camada-de-acesso-a-dados-e-factory-de-query-key.md` | T-16 | Camada de acesso a dados e obrigatoriedade da factory de query key |
| `0007-modelo-de-consistencia-do-estado-de-servidor.md` | T-18 | Modelo de consistência do estado de servidor cacheado |
| `0008-adrs-versionados-no-repositorio.md` | T-19 | ADRs versionados no repositório |

### 11.4 Convenções deste relatório

- Todo número está marcado como **medido** (extraído de ferramenta, grep, grafo de import ou do artefato construído) ou **estimado** (projeção declarada como tal). Nenhum número foi inferido sem indicação.
- Severidades são as atribuídas pelos especialistas de cada fase; **não foram alteradas** por esta fase.
- Achados que aparecem em múltiplas fases foram deduplicados (§7.4) e a confirmação cruzada registrada como reforço de confiança.
- Termos técnicos e identificadores de código permanecem no original.
