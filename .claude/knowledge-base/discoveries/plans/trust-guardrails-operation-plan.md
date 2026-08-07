# Discovery Plan: Operar guardrails pelo dashboard — prior art de autoria de regra com dry-run

> **Version 1.0** — Investiga como produtos maduros resolvem os cinco problemas que o M24 do `theo-cloud` precisa resolver ao dar ao operador o poder de **criar regras que bloqueiam tráfego inline em produção**: catálogo mesclado plataforma+tenant com proveniência visível, um passo de teste que não vira teatro, erro tipado do backend chegando íntegro ao operador, auditoria com conteúdo redigido, e coreografia de ação destrutiva. Referências em escopo: `posthog` (autoria de feature flag — o análogo mais próximo), `langfuse` (versionamento/edição de prompt), `phoenix` (playground). Saída esperada: um blueprint com decisões concretas de design de UI e de fronteira BFF↔serviço, com citação linha-exata por afirmação.

**Slug:** `trust-guardrails-operation`
**Owner:** paulohenriquevn
**Created:** 2026-07-31
**Revised:** 2026-07-31 → **v1.1**, absorvendo os 3 MUST FIX e os 3 SHOULD TEST de `.claude/knowledge-base/reviews/trust-guardrails-operation-edge-cases-2026-07-31.md`. Os três MUST FIX eram de **mira**, não de pergunta: os alvos originais de Q4, Q5 e Q6 não continham a resposta. Os alvos corrigidos são melhores que os originais — `NewPromptForm/ReviewPromptDialog.tsx` do langfuse é literalmente um passo de revisão antes de salvar, e o posthog tem `featureFlagDeleteDialog.test.ts` e `featureFlagConfirmationSettingsLogic.test.ts`.
**Time budget:** 5h (posthog 3h · langfuse 1.5h · phoenix 0.5h — quebra em D1)

**Versão dos clones lidos** (registrada porque `--depth 1` não deixa histórico para reconstruir depois):

| Projeto | SHA | Data |
|---|---|---|
| `posthog` | `b5da0869` | 2026-07-22 |
| `langfuse` | `6f84672` | 2026-06-30 |
| `phoenix` | `b932e69` | 2026-06-30 |

## Context

O M24 (`ROADMAP.md § M24 — [ ] Operar guardrails pelo dashboard`) está **parcialmente entregue** e a parte que falta é justamente a arriscada. Medido em 2026-07-31 no repositório:

| O que foi medido | Comando | Resultado |
|---|---|---|
| BFF de mutação (create/test/delete) | `git show --stat 2da373b` | **existe** — `internal/routes/trust_guardrails.go`, `internal/trust/write_client.go`, 10 testes |
| BFF de listagem | `grep -n "r\.Get" internal/routes/trust_dashboard.go` | **existe** — `r.Get("/validators", h.Validators)` |
| BFF de auditoria de enforcement | `grep -rn "enforcement" internal/ --include=*.go` | **ausente** — zero rotas |
| Telas React de operação | `ls dashboard/src/pages/trust/` | **ausente** — só `violations.tsx` (leitura, M23) |
| Lógica de rascunho de guardrail | `git status` | `dashboard/src/components/trust/guardrail-draft.ts` **untracked**, sem teste commitado |

O que torna este milestone diferente de todos os anteriores do dashboard: **o objeto criado pela tela bloqueia conversa real de produção no `/v1/guard`**. Uma tela de leitura errada mostra número errado; esta tela errada derruba tráfego do tenant. O `DESIGN.md § 2.2 Destructive action choreography` e o `§ 6 Errors as diagnostics` (contrato travado, 803 linhas) já governam a forma; o que não está resolvido é a **substância**: como um produto maduro impede que o passo de teste vire um botão que ninguém aperta, e como distingue o que é herdado do que é do tenant sem que o operador edite o que não pode.

Regras do projeto que qualquer padrão emprestado deve respeitar: `.claude/rules/architecture.md` (fronteiras e DIP — o BFF já separou leitor de escritor por porta, ISP), `.claude/rules/testing.md` (pirâmide: unit em lógica pura, integração na fronteira, e2e só no fluxo crítico) e `.claude/rules/error-handling.md` (erro tipado, nunca genérico — que é literalmente um item do DoD do M24).

## Objective

Decidir, com evidência de prior art, **a forma da experiência de autoria de guardrail** — onde o dry-run entra no fluxo, como a proveniência plataforma/tenant é representada, e como o erro tipado do serviço atravessa BFF e UI sem degradar — antes de escrever a primeira linha de tela.

- [ ] Todas as research questions respondidas com citação a `.claude/knowledge-base/references/`
- [ ] Tabela comparativa cross-cutting preenchida para posthog · langfuse · phoenix
- [ ] Seção de recomendações com ao menos uma proposta de decisão concreta por questão
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `.claude/knowledge-base/references/posthog/` | `frontend/src/scenes/feature-flags/`, `playwright/` | Feature flag é o análogo estrutural exato: objeto de configuração criado por operador que **altera comportamento de produção na hora**, com defaults de plataforma, condições, teste e arquivamento. 5230 arquivos `.tsx` — o maior corpo de prior art disponível |
| `.claude/knowledge-base/references/langfuse/` | `web/src/features/prompts/components/` | Autoria + versionamento + deleção de um objeto de configuração de tenant, em stack próxima da nossa (React/TS) |
| `.claude/knowledge-base/references/phoenix/` | `app/src/pages/playground/` | Playground = a forma canônica de "experimentar antes de comprometer". **Escopo reduzido em v1.1 (EC-2):** `app/__tests__/` saiu — medido que contém só `authFetch.test.ts`, e `app/src/__tests__/` só `installTestStorage.ts`; não há teste de formulário/erro a aprender. Phoenix responde a Q1 e nada mais, e o budget caiu de 1h para 0.5h |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `.claude/knowledge-base/references/posthog/frontend/src/scenes/` (exceto `feature-flags/`) | Superfícies não análogas (insights, dashboards de produto); o budget não paga varredura ampla |
| `.claude/knowledge-base/references/helicone/` | Tem UI (961 `.tsx`), mas é observabilidade de LLM — sobrepõe M23 (leitura), que já está `[x]`. Nada a aprender para autoria |
| `.claude/knowledge-base/references/guardrails-ai/`, `nemo-guardrails/` | Verificado: `tsx=0` e `tsx=1`. São bibliotecas de motor, não superfícies de operação. O modelo de domínio de validator já está resolvido no `theo-trust` (M13) e não é a pergunta aberta |
| `*/node_modules/`, `dist/`, `build/`, `.venv/` | Artefatos de build |
| Qualquer projeto NÃO clonado em `.claude/knowledge-base/references/` | Cross-Project Rule: nunca afirmar comportamento de um projeto sem ler a fonte |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** posthog 3h · langfuse 1.5h · phoenix 0.5h. Total 5h. *(v1.1: a meia hora que saiu do Phoenix foi para o PostHog, que absorveu os alvos de teste que o Phoenix não tinha — ver EC-1/EC-2.)*

**Rationale:** o peso segue a proximidade estrutural medida, não a fama do projeto. Feature flag do PostHog é o único peer que tem, no mesmo objeto, **os cinco** problemas do M24 (default de plataforma, override de tenant, aba de teste, confirmação destrutiva, e e2e próprio). Langfuse entra pela stack quase idêntica à nossa (React + TS + tabela + modal), útil para a forma do código, não da decisão. Phoenix entra só pela pergunta do playground.

**Alternatives considered:** (a) divisão igual em 3 — rejeitada: trataria phoenix, que responde uma pergunta, como posthog, que responde cinco; (b) só posthog — rejeitada: uma fonte única viola a regra de ≥ 2 referências independentes do `cycle-discover.md`; (c) incluir helicone/guardrails-ai para "cobrir mais" — rejeitada por medição (`tsx=0`), seria teatro de amplitude.

**Stop condition — per question (mandatory):** quando a Fase A de uma questão retornar zero matches após 3 tentativas com variantes de query diferentes (padrão AST → busca por nome de símbolo → caminho alternativo → escopo mais amplo), marcar a questão BLOCKED com motivo "Fase A exhausted — no hotspots found" e seguir. NUNCA preencher com hotspots de outra questão.

**Stop condition — per project (mandatory):** budget esgotado com questões pendentes → marcar as restantes daquele projeto BLOCKED com motivo "budget exhausted" e avançar. Se todo projeto restante estiver nesse estado, emitir `<promise>BLUEPRINT_BLOCKED</promise>` — nunca `BLUEPRINT_COMPLETE` a partir de estado com questão bloqueada.

**Anti-pattern:** NUNCA fabricar resposta de Fase B para fechar questão cuja Fase A se esgotou. BLOCKED honesto é obrigatório (Unbreakable Rule 3).

**Consequences:** o blueprint pode sair com questões bloqueadas listadas em `## Blocked questions`, que viram semente da próxima discovery. Aceito: é melhor um blueprint honestamente incompleto que um completo por invenção.

### D2 — Investigation depth: duas fases, e por quê

**Decision:** toda questão de forma-de-código roda **Fase A** (mapa de hotspots via `ast-grep`/Grep) e depois **Fase B** (Read integral de cada hotspot). Questões de forma-de-texto (config, README, `package.json`) pulam a Fase A.

**Rationale:** `posthog/frontend/src/scenes/feature-flags/` tem dezenas de arquivos; ler tudo estoura o budget e ler só o nome do arquivo produz afirmação sem lastro. O corte em duas fases é o que permite citação **linha-exata** dentro do orçamento — e citação linha-exata é o que o `discover-blueprint-golden-rule.md` cobra como hard cap.

**Alternatives considered:** (a) só Grep — rejeitada: acha a linha, perde a intenção e o comentário, que é justamente onde mora o "porquê" que queremos; (b) só Read integral — rejeitada por budget.

**Consequences:** a Fase A pode retornar hotspot irrelevante; a Fase B descarta e isso é registrado, não escondido.

### D3 — A pergunta que NÃO vamos fazer

**Decision:** não investigar como os peers **modelam** a spec do validator (schema, kinds, taxonomia).

**Rationale:** YAGNI (`parsimony-ladder.md` rung 1) — essa decisão já está tomada e implantada no `theo-trust` M13 (`validateValidatorSpec`, seis kinds, guard de ReDoS), e o M24 declara explicitamente que **não** altera o serviço. Investigar modelagem produziria conhecimento que não pode virar código neste milestone.

**Consequences:** o blueprint não opinará sobre o schema de validator. Se a UI revelar que o schema é hostil ao operador, isso vira issue no `theo-trust`, não escopo do M24.

### D4 — Os clones são fotografias datadas, e isso é aceito (EC-7)

**Decision:** ler os clones no estado em que estão (`posthog b5da0869`/2026-07-22, `langfuse 6f84672`/2026-06-30, `phoenix b932e69`/2026-06-30) sem re-clonar.

**Rationale:** a alternativa — re-clonar antes de cada discovery — gasta banda e tempo para mitigar um risco que **não afeta a decisão que estamos tomando**. Buscamos a forma da experiência (onde o teste entra no fluxo, o que é readonly), que muda em anos, não em semanas. Um padrão de UI que o PostHog mantém há releases não vira outro em cinco semanas.

**Consequences:** o blueprint registra o SHA de cada clone, para que qualquer releitura futura saiba exatamente o que foi lido. Se uma recomendação depender criticamente de um detalhe recente, isso é sinalizado na própria recomendação.

### D5 — A transferência é conceitual, nunca literal (EC-8)

**Decision:** nenhuma linha de código dos peers será portada. O blueprint recomenda **decisões de produto**, não implementação.

**Rationale:** duas razões independentes. (1) `reference-provenance.md § 3`: a zona é para ler e entender; copiar carrega a licença do original para dentro deste repositório — problema legal, não estilístico. (2) Técnica: o PostHog usa `kea` para estado (visível em `FeatureFlagTestingTab.tsx:1`) e o dashboard usa `@tanstack/react-query` + estado local; um port literal traria um modelo de estado alheio junto.

**Consequences:** o blueprint fala em "o teste é uma etapa do fluxo, não uma aba" — não em "copiem `FeatureFlagTestingTab`". Recomendação escrita no nível de implementação é rejeitada na revisão do blueprint.

## Research Questions

| # | Question | Corner | Reference project(s) | Fase A (broad — mapa de hotspots) | Fase B (deep — Read por hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | O passo de testar/revisar antes de publicar é **etapa obrigatória do fluxo** ou superfície opcional que o operador pode ignorar? Se opcional, o que o produto faz para que ele não seja ignorado? | techniques | `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/`, `.claude/knowledge-base/references/langfuse/web/src/features/prompts/components/NewPromptForm/` | Dois hotspots verificados, um por produto: `posthog/.../FeatureFlagTestingTab.tsx` (526 linhas; importa `featureFlagTestingLogic` com tipos `ConditionAnalysis`/`TestResult` — confirmado que é avaliação de flag, não A/B test) e `langfuse/.../NewPromptForm/ReviewPromptDialog.tsx` (revisão antes de commit) | Read integral de ambos + do componente que decide quando cada um aparece; capturar se existe gate no submit ou apenas convite | Descrição do fluxo por produto, + veredito "obrigatório / opcional / incentivado", + citação `path:line` do gate (ou da ausência dele). **Duas fontes independentes** — requisito do `cycle-discover.md` |
| Q2 | Como o PostHog representa configuração **herdada de default** vs **definida pelo objeto**, e como impede a edição do que é herdado? | techniques | `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/` | Grep `Readonly|default` em `feature-flags/`; hotspots verificados: `FeatureFlagReleaseConditionsReadonly.tsx`, `DefaultReleaseConditions.tsx`, `defaultReleaseConditionsLogic.ts` | Read dos três; comparar o componente editável com o readonly — o que muda visualmente e o que muda no estado | Tabela: sinal visual → mecanismo de bloqueio de edição → citação; mapeada ao nosso caso plataforma-vs-tenant |
| Q3 | Qual a coreografia de deleção/arquivamento de um objeto que está **ativo em produção** — confirmação simples, digitar o nome, soft-delete reversível? | techniques | `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/`, `.claude/knowledge-base/references/langfuse/web/src/features/prompts/components/` | Hotspots verificados: `posthog/.../ConfirmationModal.tsx`, `posthog/.../featureFlagArchiveDialog.tsx`, `langfuse/.../delete-prompt.tsx` | Read dos três; capturar o que é exigido do usuário e se a ação é reversível | Comparativo de 3 linhas (produto → exigência → reversibilidade) + recomendação para o DELETE de validator, confrontada com `DESIGN.md § 2.2` |
| Q4 | Em que **camada da pirâmide** o PostHog cobre o ciclo criar→configurar→salvar de uma flag, e o que ele deliberadamente NÃO leva a e2e de browser? | tests | `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/`, `.claude/knowledge-base/references/posthog/playwright/` | **Corrigido em v1.1 (EC-1):** medido que `playwright/page-models/` tem apenas `cohortPage/dashboardPage/insightPage/loginPage` — **não há page-model de flag**; o ciclo de autoria é coberto por teste de lógica/componente. Fase A varre `feature-flags/*.test.ts*` (verificado: `featureFlagLogic.test.ts`, `defaultReleaseConditionsLogic.test.ts`, `FeatureFlagReleaseConditions.cohortOperator.test.tsx`, entre outros) | Read de 3-4 desses testes + do `playwright.config.ts` para contrastar o que subiu a e2e e o que não subiu | Mapa camada→o-que-cobre, + a decisão transferível de **onde** colocar cada teste do M24 (o Playwright já está instalado no dashboard), + citações `path:line` |
| Q5 | Existe teste que prove que a **mensagem de erro do backend** (422/409) chega à tela, em vez de virar mensagem genérica? | tests | `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/`, `.claude/knowledge-base/references/langfuse/web/src/features/prompts/components/` | **Corrigido em v1.1 (EC-2):** Phoenix REMOVIDO desta questão — medido que `phoenix/app/__tests__/` tem só `authFetch.test.ts` e `phoenix/app/src/__tests__/` só `installTestStorage.ts`; não há teste de erro de formulário. Substituído pelos testes de `feature-flags/` (verificados) + `NewPromptForm/validation.ts` do langfuse | Read dos testes que casarem em `error|422|409|toast|message`; capturar a asserção exata — a mensagem do serviço é comparada literalmente ou só se checa que "deu erro"? | Padrão replicável para o DoD "erro tipado com a mensagem do serviço, nunca 'erro genérico'". Duas fontes independentes mantidas |
| Q6 | Que dependências de formulário/validação a **superfície de autoria** desses peers realmente importa — e o dashboard do `theo-cloud` já tem equivalente instalado? | deps | `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/FeatureFlagReleaseConditions.tsx`, `.claude/knowledge-base/references/langfuse/web/src/features/prompts/components/NewPromptForm/`, + `dashboard/package.json` local | **Corrigido em v1.1 (EC-3):** grep em `package.json` de monorepo dá falso positivo (a dep existe no repo sem ser usada na tela — o PostHog usa `kea`, visível em `FeatureFlagTestingTab.tsx:1`). Fase A passa a ler os **imports** dos componentes de autoria verificados acima | Read do bloco de imports + de `NewPromptForm/validation.ts` para ver se a validação é lib ou função pura; `package.json` serve só para confirmar versão, nunca como evidência primária | Veredito de parsimônia (rung 4): adotar dep OU manter lógica pura como `guardrail-draft.ts` já faz, com justificativa ancorada no que a tela do peer de fato importa |
| Q7 | Qual o tooling que sobe o ambiente para o e2e (backend real? fixtures? seed?) e quanto custa rodar? | tools | `.claude/knowledge-base/references/posthog/playwright/` | SKIP Fase A — forma-de-texto. Glob `playwright.config.ts`, `README.md`, scripts do `package.json` | Read integral de cada um | Passo a passo do que o M24 precisa para ter e2e honesto contra a instância implantada, e o que fica fora |

## Coverage Matrix

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4, Q5 | Covered |
| Dependencies | Q6 | Covered |
| Tools | Q7 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

Orçamento de questões: 7 no total (faixa 5-10 ✓), máximo 3 por corner ✓, mínimo 1 por corner ✓.

## Halt-loop Checkpoints

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| **EC-4 — Q2, antes de fechar** | `DefaultReleaseConditions.tsx` trata de configuração **herdada de um nível superior**, não de "valor pré-preenchido do formulário" | Se for valor-inicial, a analogia plataforma↔tenant não se sustenta: responder Q2 por `FeatureFlagReleaseConditionsReadonly.tsx` (inequivocamente "exibir sem permitir editar") e **registrar a correção no blueprint**, não escondê-la |
| **EC-5 — ordem Q4 → Q7** | Q4 executa antes de Q7 | Se Q4 concluir que o peer não cobre autoria por e2e (provável, ver EC-1), Q7 responde pelo `playwright.config.ts` que existe e **declara explicitamente** que a receita de e2e do M24 não tem espelho direto no peer — em vez de inventar um |
| **EC-6 — teto de leitura por questão** | Máximo **4 arquivos** lidos integralmente na Fase B de cada questão | Ao atingir o quarto sem resposta fechada, marcar BLOCKED por budget em vez de continuar puxando o fio (`feature-flags/` tem dezenas de arquivos e convida a scope creep) |
| Antes de responder Qx | Todo path declarado na Fase A de Qx existe | Marcar Qx BLOCKED com motivo "path not found"; seguir |
| Budget de Fase A por questão | Fase A devolveu ≥ 1 hotspot OU 3 variantes de query tentadas | Após 3 tentativas vazias, BLOCKED "Fase A exhausted"; seguir |
| Depois de responder Qx | A seção de Qx no blueprint tem ≥ 1 citação `path:line` | Reiterar Qx (1 retry) |
| Sanidade de meio de loop | Densidade de citação ≥ 1 por 200 palavras de prosa | Adicionar citação aos parágrafos sem lastro (1 retry) |
| Budget por projeto | Budget do projeto não esgotado | Ao esgotar, BLOCKED "budget exhausted" nas restantes; avançar |
| Antes de prometer completo | Os 4 corners têm seção populada no blueprint | Recusar a promessa; continuar iterando |
| **Específico deste plano** | Toda recomendação de UI é confrontada com o `DESIGN.md` (§ 2.2 destrutivo, § 5 empty state, § 6 erro, § 10 tabela) | Recomendação sem confronto é reescrita — o DESIGN.md é contrato travado, não sugestão |

## Acceptance Criteria

- [ ] Todas as 7 questões respondidas OU marcadas BLOCKED com motivo
- [ ] Os 4 coverage corners com seção populada no blueprint
- [ ] Toda citação aponta para path real sob `.claude/knowledge-base/references/`
- [ ] ≥ 1 seção de ADR no blueprint sintetizando as decisões de design que entram no `/to-plan`
- [ ] Time budget respeitado por projeto
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint salvo em `.claude/knowledge-base/discoveries/blueprints/trust-guardrails-operation-blueprint.md`

## Global Definition of Done

- [ ] Todas as fases concluídas (plan → edge-cases → plan-confidence → execute → confidence → improve se necessário)
- [ ] Verdict final do `/discover-confidence` registrado no cabeçalho do blueprint
- [ ] Nenhuma citação fabricada
- [ ] Coverage Matrix 100%
- [ ] ADRs referenciam princípio/regra do projeto: D1 e D2 apoiam-se em `.claude/rules/testing.md` (pirâmide — e2e é caro, poucos e representativos) e `.claude/rules/architecture.md` (fronteira BFF↔serviço); D3 apoia-se em `.claude/rules/parsimony-ladder.md` rung 1 (YAGNI)
