# Blueprint: Operar guardrails pelo dashboard — o que o prior art ensina

**Slug:** `trust-guardrails-operation`
**Plano:** `.claude/knowledge-base/discoveries/plans/trust-guardrails-operation-plan.md` (v1.1)
**Executado:** 2026-07-31
**Questões:** 7 respondidas · 0 bloqueadas
**Clones lidos:** `posthog b5da0869` (2026-07-22) · `langfuse 6f84672` (2026-06-30) · `phoenix b932e69` (2026-06-30)
**Verdict `/discover-confidence`:** registrado no rodapé após o score

> **A descoberta que mais importa, dita de saída:** nenhum dos dois peers torna o teste/revisão **obrigatório** antes de gravar. O PostHog testa a flag *depois* de ela existir, numa aba; o Langfuse oferece "Review changes" **ao lado** de um "Save" que pula a revisão. O DoD do M24 exige o contrário — e essa divergência é deliberada, não descuido: uma flag mal configurada erra um rollout, uma guardrail mal configurada **derruba conversa de produção inline**. O blueprint sustenta a exigência mais dura com a evidência de por que os peers podiam ser mais frouxos.

## Context

O M24 do `theo-cloud` está meio entregue e a metade que falta é a arriscada. Medido em 2026-07-31: o BFF de mutação existe (`internal/routes/trust_guardrails.go`, `internal/trust/write_client.go`, commit `2da373b`), a listagem existe (`internal/routes/trust_dashboard.go` `r.Get("/validators")`), e **não existe** nem a rota de auditoria de enforcement (`grep -rn "enforcement" internal/ --include=*.go` → zero) nem tela alguma de operação (`ls dashboard/src/pages/trust/` → só `violations.tsx`, de leitura, do M23).

O que distingue este milestone de todos os anteriores do dashboard: o objeto que a tela cria **bloqueia conversa real de produção** no `/v1/guard`. Uma tela de leitura errada mostra número errado; esta tela errada derruba tráfego do tenant. Antes de desenhar, valia perguntar como produtos maduros lidam com o mesmo formato de risco.

## Objective

Decidir a **forma da experiência de autoria de guardrail** — onde o dry-run entra no fluxo, como a proveniência plataforma↔tenant é representada, como o erro tipado do serviço atravessa BFF e UI, e que cerimônia cerca as ações que mudam produção — com evidência de prior art em vez de intuição, antes da primeira linha de tela.

---

## Coverage Corner 4 — Techniques

### Q1 — O teste antes de publicar é etapa obrigatória ou superfície opcional?

**Resposta: opcional nos dois, por caminhos diferentes. Nenhum é modelo para o M24.**

| Produto | Onde o teste vive | É gate? | Evidência |
|---|---|---|---|
| PostHog | Aba do objeto **já salvo** | Não | `FeatureFlag.tsx:313` monta `content: <FeatureFlagTestingTab featureFlag={featureFlag} />` — a aba recebe a flag existente, logo o objeto já foi gravado antes de qualquer teste |
| PostHog | — | Não | `FeatureFlagTestingTab.tsx:271` — o único `disabledReason` do botão é `!hasValidPerson ? 'Please select a person'`. Nada no salvar consulta se um teste rodou |
| Langfuse | Dialog que embrulha um botão de submit | **Não** | `NewPromptForm/index.tsx:455-469` embrulha "Review changes" no `ReviewPromptDialog` com `onConfirm={form.handleSubmit(onSubmit)}` — mas `index.tsx:471-478` põe um `<Button type="submit">Save new prompt version</Button>` **irmão**, que grava sem passar pelo dialog |

O que o PostHog testa é avaliação **retrospectiva**: `FeatureFlagTestingTab.tsx:130` — *"Test how this feature flag evaluates for a specific user, optionally at a historical timestamp"*. É depuração de uma flag viva, não validação de um rascunho.

O que o Langfuse mostra na revisão é o **diff**: `ReviewPromptDialog.tsx:15` importa `DiffViewer`, e `:17-23` recebe `initialPrompt` + `getNewPromptValues` — o dialog compara o que está no ar com o que será gravado. A ideia é boa; a execução deixa a porta ao lado aberta.

**Decisão que isto empurra para o M24 (ADR-1, abaixo):** o dry-run não pode ser um botão irmão do salvar. O caminho para gravar tem de **atravessar** o teste. O que se aproveita do Langfuse é a substância da revisão — mostrar o *efeito* (diff / veredito), não um "ok?" abstrato.

---

### Q2 — Como se representa configuração herdada vs. própria, e como se impede editar o herdado?

**Resposta: um componente separado, não um modo do mesmo componente.**

- `FeatureFlagReleaseConditionsReadonly.tsx:29-34` declara `FeatureFlagReleaseConditionsReadonlyProps { id, filters, isDisabled?, evaluationRuntime? }` — uma superfície de leitura própria, com sua própria assinatura. Não é o editor com uma flag `readonly`.
- Ela é usada onde se **lê**: `FeatureFlagOverview.tsx:261`. O editor (`FeatureFlagReleaseConditions.tsx`) é outro arquivo, usado onde se **edita**.

**Checkpoint EC-4 do plano — resolvido:** "default" no PostHog é herança real de nível superior, não valor-inicial-de-formulário. `defaultReleaseConditionsLogic.ts:19` busca em `/api/environments/${teamId}/default_release_conditions/` e devolve `{ enabled, default_groups }` (`:14-17`). É configuração **do ambiente** que as flags herdam — a analogia com plataforma↔tenant do M24 se sustenta.

**Decisão que isto empurra (ADR-2):** as linhas de plataforma do catálogo mesclado não são "linhas do tenant com um botão desabilitado". São outra coisa, e devem ser renderizadas por outro caminho — sem ação de remover, sem ação de editar, com a origem dita em palavras. Um botão desabilitado convida o operador a procurar como habilitá-lo; a ausência do botão não.

---

### Q3 — Coreografia de deleção/alteração de um objeto ativo em produção

**Resposta: confirmação com o impacto escrito por extenso. Nenhum dos dois exige digitar o nome.**

| Produto | O que exige | Evidência |
|---|---|---|
| PostHog | Modal cujo texto muda conforme a ação e nomeia o objeto | `ConfirmationModal.tsx:49` — ``title = `${actionCapitalized} feature flag "${featureFlag.key}"?` `` |
| PostHog | **Confirma até mudança não-destrutiva** de condições | `ConfirmationModal.tsx:65` — `` title = `Update rollout conditions for "${featureFlag.key}"?` ``; `:81` — `Confirm changes to feature flag` |
| Langfuse | Popover "Please confirm" + botão, com gate de permissão | `delete-prompt.tsx:39` (`<h2>Please confirm</h2>`), `:34` (`disabled={!hasAccess}`) |

O detalhe que vale mais que a deleção: **o PostHog confirma mudança de rollout**, não só remoção. A régua ali não é "isto apaga dados", é "isto muda o que acontece em produção agora". Guardrail é exatamente esse tipo de objeto.

**Decisão que isto empurra (ADR-3):** confirmação explícita para remover **e** para criar/ativar — porque criar uma guardrail é o evento que passa a bloquear tráfego. O `DESIGN.md § 2.2 Destructive action choreography` já governa a forma da remoção; o que o prior art acrescenta é estender a cerimônia ao ato de **ligar** uma regra.

---

## Coverage Corner 1 — Integration tests

### Q4 — Em que camada da pirâmide o ciclo de autoria é coberto?

**Resposta: quase tudo na camada de lógica. O e2e de browser não toca autoria de flag.**

| Arquivo | Tamanho | Casos | O que cobre |
|---|---|---|---|
| `featureFlagLogic.test.ts` | 2508 linhas | 71 | o ciclo de autoria inteiro — carregar, editar, salvar, erro |
| `featureFlagDeleteDialog.test.ts` | 75 linhas | 7 | só o diálogo de deleção |
| `defaultReleaseConditionsLogic.test.ts` | 50 linhas | (tabela parametrizada) | herança de defaults, incluindo `BigInt('9007199254740993')` — precisão além de `Number.MAX_SAFE_INTEGER` (`:32-33`) |

A lista de `posthog/playwright/e2e/` contém `auth.spec.ts`, `annotations.spec.ts`, `early-access-management.spec.ts`, `experiments/`, `persons/`, `product-analytics/` — e **nenhum spec de feature flag**. `playwright/page-models/` tem `cohortPage.ts`, `dashboardPage.ts`, `insightPage.ts`, `loginPage.ts`, e **nenhum** page-model de flag.

Um produto que vive de feature flags escolheu não levar a autoria delas ao browser. Isso confirma o EC-1 do edge-case review e alinha com `.claude/rules/testing.md` (e2e: poucos, estáveis, representativos).

**Decisão que isto empurra (ADR-4):** a massa de teste do M24 vai para lógica pura + componente. O e2e cobre **uma** jornada — a que o DoD exige de ponta a ponta — e nada além.

---

### Q5 — Existe teste que prove que a mensagem do backend chega à tela?

**Resposta: sim, e é o achado mais diretamente reaproveitável de toda a investigação.**

- `featureFlagLogic.test.ts:283` — `expect(toastSpy).toHaveBeenCalledWith('Nope')`. A asserção é sobre a **string que o backend mandou**, não sobre "algum erro apareceu". O par em `:305` (`expect(toastSpy).not.toHaveBeenCalledWith('Nope')`) prova o caso negativo — a mensagem *não* aparece quando não deve.
- `featureFlagsLogic.test.ts:331` — teste parametrizado: *"shows approval toast with `$expected` when toggling active=`$active` gets a **409**"*. Um código de status específico do backend mapeado para um texto específico na tela, por caso.

Este é o padrão que satisfaz o DoD *"erros tipados do serviço chegam ao usuário com a mensagem do serviço, nunca como 'erro genérico'"* — e satisfaz **na camada de lógica**, barata e rápida, sem depender de browser.

**Decisão que isto empurra (ADR-5):** para cada código tipado que o `theo-trust` devolve (`422 INVALID_SPEC`, `422 VALIDATOR_NAME_RESERVED`, `409 CONFLICT`), existe um teste que assere a mensagem **literal** renderizada. Um teste que só verifica "deu erro" não fecha o DoD.

---

## Coverage Corner 2 — Dependencies

### Q6 — O que a superfície de autoria realmente importa?

**Resposta: PostHog não usa lib de formulário; Langfuse usa zod. O dashboard não precisa de nenhuma das duas.**

- PostHog — `FeatureFlagReleaseConditions.tsx:3` importa `useActions, useValues` de `kea`, e o resto são componentes próprios (`@posthog/lemon-ui`, `lib/components/...`). **Nenhuma** biblioteca de formulário. Confirma o EC-3: procurar `zod|react-hook-form` no `package.json` do monorepo teria dado falso positivo.
- Langfuse — `NewPromptForm/validation.ts:1` importa `z` de `zod` e monta `NewPromptBaseSchema` (`:12-25`) reusando schemas de `@langfuse/shared` (`PromptNameSchema`, `PromptChatMessageListSchema`). A validação do cliente **reusa o schema do backend**, que é o que a torna legítima ali.

**Veredito de parsimônia (rung 4 da `parsimony-ladder.md`) — ADR-6:** não adicionar `zod` nem `react-hook-form`.

Duas razões independentes:

1. O dashboard não tem nenhuma das duas hoje (medido em `dashboard/package.json`), e o formulário do M24 tem três campos (nome, termos, ação). Duas dependências novas para isso é o inverso de parsimônia.
2. **A razão mais forte é de arquitetura, não de peso:** o Langfuse pode validar no cliente porque compartilha o schema com o servidor (`@langfuse/shared`). Nós **não** compartilhamos — o schema de validator vive no `theo-trust` e é aplicado lá (`validateValidatorSpec`, com guard de ReDoS). Reescrever esse schema em zod no dashboard criaria **duas fontes de verdade que divergem em silêncio**. O cliente valida o que é barato e local (campo vazio, termo duplicado); a autoridade sobre a spec continua sendo o `422` do serviço — que o ADR-5 obriga a exibir literalmente.

`guardrail-draft.ts` (já escrito, hoje untracked) segue exatamente essa divisão e é testável sem React. Fica.

---

## Coverage Corner 3 — Tools

### Q7 — Como o ambiente do e2e é levantado?

- `playwright.config.ts:64` — `baseURL: process.env.CI ? 'http://localhost:8000' : process.env.BASE_URL || 'http://localhost:8080'`. A URL é **injetada por ambiente**; o config não sobe serviço nenhum (não há bloco `webServer`).
- `playwright.config.ts:24` — `timeout: process.env.CI ? 90 * 1000 : 50 * 1000`. Prazos diferentes para CI e local, assumidos explicitamente.
- `playwright.config.ts:18` — `testDir: '..'`, para descobrir specs em duas localizações.
- `playwright.config.ts:79-82` — um projeto ativo, `Desktop Chrome`; os demais browsers estão comentados.

**Decisão que isto empurra (ADR-7):** o e2e do M24 aponta `BASE_URL` para a instância implantada em vez de tentar levantar a stack. O dashboard **já tem** `@playwright/test` e o script `test:e2e` (medido em `dashboard/package.json`) — rung 4: nada a instalar. Um browser só (Chromium), como o peer.

---

## Cross-cutting Comparison

Os cinco problemas do M24 contra os dois peers com superfície real. `phoenix` fica fora da tabela porque não contribuiu com decisão alguma (registrado em § O que este blueprint deliberadamente NÃO responde).

| Dimensão | PostHog | Langfuse | Decisão para o M24 |
|---|---|---|---|
| Teste antes de gravar | Aba sobre objeto **já salvo** (`FeatureFlag.tsx:313`) | Dialog com diff, mas **contornável** por um submit irmão (`index.tsx:471`) | **Passagem obrigatória** — mais duro que ambos (D1) |
| Herdado vs. próprio | Componente readonly separado (`FeatureFlagReleaseConditionsReadonly.tsx:29`) | não aplicável (não há herança de prompt) | Caminho próprio, sem ações (D2) |
| Ação que muda produção | Confirma até mudança de rollout (`ConfirmationModal.tsx:65`) | "Please confirm" simples (`delete-prompt.tsx:39`) | Confirmar remover **e** ativar (D3) |
| Camada de teste | 71 casos em lógica; **zero** e2e de flag | validação por schema compartilhado | Lógica + 1 e2e da jornada (D4) |
| Erro do backend na tela | Assere a **mensagem literal** (`featureFlagLogic.test.ts:283`) e o status (`featureFlagsLogic.test.ts:331`) | zod no cliente, schema compartilhado | Um teste por código tipado (D5) |
| Dependências de formulário | nenhuma — `kea` + componentes próprios | `zod` + schema de `@langfuse/shared` | Nenhuma nova (D6) |
| Ambiente de e2e | `BASE_URL` por env, sem `webServer` (`playwright.config.ts:64`) | — | Apontar para o deploy real (D7) |

## ADRs

### D1 — O dry-run é passagem obrigatória, não botão irmão do salvar

**Decisão:** o único caminho de gravação atravessa o teste. Não existe botão de salvar que pule o dry-run.

**Rationale:** nenhum dos dois peers faz isso (Q1) — e a diferença é de risco, não de capricho. Uma feature flag mal configurada erra um rollout que se corrige em minutos; uma guardrail mal configurada bloqueia conversa de produção inline, que é o "Top risk #1" que o próprio M24 declara. O Langfuse mostra o custo exato de deixar a porta aberta: `index.tsx:455-469` embrulha "Review changes" no dialog de diff, e `index.tsx:471-478` põe um `Save new prompt version` ao lado que ignora tudo isso.

**Alternativas consideradas:** (a) copiar a aba do PostHog — rejeitada: testa objeto já gravado, tarde demais; (b) copiar o Langfuse literalmente — rejeitada: o bypass é o defeito, não o recurso.

**Consequências:** divergimos do SOTA conscientemente. O plano precisa de um teste que prove a **ausência** de caminho alternativo de gravação — asserção negativa, não positiva.

### D2 — Linhas de plataforma renderizadas por caminho próprio, sem ações

**Decisão:** o catálogo mesclado renderiza linha de plataforma e linha de tenant por caminhos distintos. A linha de plataforma não tem botão de remover nem de editar — ausentes, não desabilitados.

**Rationale:** o PostHog resolve o mesmo problema com um componente separado (`FeatureFlagReleaseConditionsReadonly.tsx:29-34`), usado onde se lê (`FeatureFlagOverview.tsx:261`), e não com um modo do editor. Botão desabilitado convida o operador a procurar como habilitá-lo; a ausência do botão comunica que aquilo não lhe pertence.

**Alternativas consideradas:** um componente com prop `readonly` — rejeitada: acumula dois comportamentos num arquivo e o desabilitado vira dívida de UX.

**Consequências:** duas superfícies a manter. Aceito: a origem da regra é informação de segurança, não decoração.

### D3 — Confirmação explícita para remover E para ativar

**Decisão:** a cerimônia de confirmação cobre a remoção e também a criação/ativação de uma guardrail.

**Rationale:** `ConfirmationModal.tsx:65` confirma `Update rollout conditions for "..."` — mudança **não destrutiva**. A régua do PostHog não é "isto apaga dados", é "isto muda o que acontece em produção agora". Criar uma guardrail é exatamente o evento que passa a bloquear tráfego.

**Consequências:** estende `DESIGN.md § 2.2` (que trata do destrutivo) ao ato de ligar uma regra.

### D4 — Massa de teste em lógica/componente; e2e cobre uma jornada

**Decisão:** o grosso da cobertura vai para lógica pura e componente; o e2e cobre a jornada única que o DoD exige, ponta a ponta.

**Rationale:** o PostHog cobre o ciclo de autoria com 71 casos em `featureFlagLogic.test.ts` e **não tem nenhum spec de flag** em `playwright/e2e/` nem page-model em `playwright/page-models/` (Q4). Um produto que vive de feature flags escolheu não levá-las ao browser. Alinha com `.claude/rules/testing.md` (e2e poucos, estáveis, representativos).

**Consequências:** e2e barato e estável; regressão de comportamento é pega na camada rápida.

### D5 — Um teste por código tipado, asserindo a mensagem literal

**Decisão:** cada código tipado do `theo-trust` (`422 INVALID_SPEC`, `422 VALIDATOR_NAME_RESERVED`, `409 CONFLICT`) ganha um teste que assere o **texto renderizado**.

**Rationale:** é o padrão medido no peer — `featureFlagLogic.test.ts:283` (`expect(toastSpy).toHaveBeenCalledWith('Nope')`, a string do backend), com o caso negativo em `:305`, e `featureFlagsLogic.test.ts:331` mapeando um **409** a um texto específico. Um teste que só verifica "deu erro" não distingue a mensagem útil da genérica — e é exatamente essa distinção que o DoD do M24 cobra.

**Consequências:** três testes de mensagem no mínimo. Trocar o texto do serviço quebra o teste — desejável: o contrato é o texto.

### D6 — Sem `zod`/`react-hook-form`; a autoridade sobre a spec continua no serviço

**Decisão:** nenhuma dependência de formulário/validação nova. `guardrail-draft.ts` permanece lógica pura.

**Rationale:** duas razões independentes. (1) Rung 4 da `parsimony-ladder.md`: o dashboard não tem nenhuma das duas e o formulário tem três campos; o PostHog também não usa lib de formulário (`FeatureFlagReleaseConditions.tsx:3` — só `kea` e componentes próprios). (2) A mais forte, de arquitetura: o Langfuse pode validar no cliente porque **compartilha o schema** com o servidor (`validation.ts:1-10` reusa `PromptNameSchema` de `@langfuse/shared`); nós não compartilhamos — o schema vive no `theo-trust` com guard de ReDoS. Reescrevê-lo em zod no dashboard criaria duas fontes de verdade que divergem em silêncio.

**Alternativas consideradas:** adotar zod e duplicar o schema — rejeitada pelo motivo (2); adotar zod só para campos triviais — rejeitada: dependência inteira para checar string vazia.

**Consequências:** o cliente valida o barato e local (campo vazio, termo duplicado); a autoridade é o `422`, que D5 obriga a exibir literalmente.

### D7 — E2E via `BASE_URL` contra a instância implantada, Chromium apenas

**Decisão:** o e2e aponta `BASE_URL` para o deploy real; não tenta levantar a stack; um browser só.

**Rationale:** o peer faz assim — `playwright.config.ts:64` injeta `baseURL` por env e não há bloco `webServer`; `:79-82` mantém só `Desktop Chrome` ativo, os demais comentados. E o dashboard **já tem** `@playwright/test` e o script `test:e2e` (rung 4 — nada a instalar).

**Consequências:** o e2e prova o sistema que está no ar, que é o que o DoD do M24 exige ("contra a instância implantada"). Em troca, depende de o ambiente estar de pé — aceito, porque um e2e contra stack falsa não provaria o que o DoD pede.

## Recommendations

Em ordem de execução, para o `/to-plan` consumir:

1. **Fechar o BFF antes da tela.** A rota de auditoria (`GET /v1/dashboard/trust/enforcement-events`) é a única peça de servidor que falta; sem ela a tela de auditoria do DoD não tem o que ler. Mesmo padrão de leitura por tenant do M23.
2. **Fluxo de criação com dry-run como passagem (D1).** Um caminho só até o gravar. O teste que importa aqui é o negativo: não existe outro caminho.
3. **Catálogo mesclado com proveniência por caminho próprio (D2).** Plataforma sem ações; tenant com remover.
4. **Superfície de erro tipado (D5)** ligada aos três códigos que o serviço já devolve — com teste de mensagem literal por código.
5. **Remoção e ativação com confirmação (D3)**, sob `DESIGN.md § 2.2`.
6. **Tela de auditoria** lendo a rota do passo 1, com conteúdo redigido — nunca bruto.
7. **Um e2e (D4, D7)** cobrindo criar → testar → salvar → bloquear no `/v1/guard` → aparecer na auditoria, com `BASE_URL` apontando para o deploy.

Riscos que o plano deve absorver: (a) a rota de auditoria expõe conteúdo de conversa — a redação é requisito de segurança, não de UI; (b) o dry-run obrigatório muda o desenho do formulário, então decidi-lo depois de escrever a tela custa retrabalho; (c) o e2e depende de ambiente de pé — precisa de critério explícito de "não rodou" versus "rodou e falhou".

---

## O que este blueprint deliberadamente NÃO responde

- **Como modelar a spec de validator.** Excluído no plano (ADR D3): já resolvido no `theo-trust` M13 e fora do escopo do M24 por declaração do próprio milestone.
- **Se o schema de validator é hostil ao operador.** Se a implementação revelar que é, isso vira issue no `theo-trust`, não escopo do M24.
- **Nada sobre `phoenix`.** O budget de 0.5h foi consumido confirmando que o `playground` é experimentação de prompt sem gravação — mesma família do Langfuse, sem acrescentar decisão. Registrado por honestidade: o Phoenix não contribuiu com nenhuma linha das decisões acima.
- **Nenhuma linha de código dos peers foi portada** (ADR D5 do plano). O PostHog usa `kea`; o dashboard usa `@tanstack/react-query`. O que atravessa é decisão de produto.

## Referências lidas

| Path | Para quê |
|---|---|
| `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/FeatureFlag.tsx` | Q1 — montagem da aba |
| `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/FeatureFlagTestingTab.tsx` | Q1 — natureza do teste |
| `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/FeatureFlagReleaseConditionsReadonly.tsx` | Q2 — superfície de leitura |
| `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/FeatureFlagOverview.tsx` | Q2 — onde o readonly é usado |
| `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/defaultReleaseConditionsLogic.ts` | Q2 — herança de ambiente |
| `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/FeatureFlagReleaseConditions.tsx` | Q6 — imports reais |
| `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/ConfirmationModal.tsx` | Q3 — coreografia |
| `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/featureFlagLogic.test.ts` | Q4, Q5 |
| `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/featureFlagsLogic.test.ts` | Q5 — 409 → mensagem |
| `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/featureFlagDeleteDialog.test.ts` | Q4 |
| `.claude/knowledge-base/references/posthog/frontend/src/scenes/feature-flags/defaultReleaseConditionsLogic.test.ts` | Q4 |
| `.claude/knowledge-base/references/posthog/playwright/playwright.config.ts` | Q7 |
| `.claude/knowledge-base/references/langfuse/web/src/features/prompts/components/NewPromptForm/index.tsx` | Q1 — o bypass |
| `.claude/knowledge-base/references/langfuse/web/src/features/prompts/components/NewPromptForm/ReviewPromptDialog.tsx` | Q1 — o diff |
| `.claude/knowledge-base/references/langfuse/web/src/features/prompts/components/NewPromptForm/validation.ts` | Q6 — zod |
| `.claude/knowledge-base/references/langfuse/web/src/features/prompts/components/delete-prompt.tsx` | Q3 |
| `.claude/knowledge-base/references/phoenix/app/src/pages/playground` | Q1 — sem contribuição, registrado |
