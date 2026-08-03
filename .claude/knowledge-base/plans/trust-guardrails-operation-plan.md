---
slug: trust-guardrails-operation
target_project: theo-cloud
milestone_id: M24
created_at: 2026-07-31
goal: Entregar ao operador o ciclo completo de guardrails pelo dashboard — criar, testar antes de salvar, remover e auditar — provado por um e2e que bloqueia tráfego real no /v1/guard.
---

# Plano: Operar guardrails pelo dashboard (M24)

## Goal

Entregar no dashboard o ciclo **criar → testar → salvar → bloquear → auditar** de uma guardrail de tenant, com métrica observável única: **o e2e `guardrails-journey.spec.ts` passa contra a instância implantada**, provando que um termo criado pela tela bloqueia de fato uma chamada ao `/v1/guard` e que o bloqueio aparece na tela de auditoria.

## Context

O M24 está meio entregue. O commit `2da373b` levou o caminho de **mutação** ao BFF (criar/testar/remover) com três decisões de segurança já testadas: cliente de escrita separado do de leitura (menor privilégio vira propriedade da chave, não de uma checagem esquecível), dry-run como rota própria e não flag do create, e corpo repassado intacto ao upstream. O M23 (`[x]`) entregou o caminho de leitura e as telas `/trust` e `/trust/violations`.

O que falta é a metade que o operador vê — e a única peça de servidor que ainda não existe: a rota de auditoria. Medido em 2026-07-31: `grep -rn "enforcement" internal/ --include=*.go` não retorna rota alguma, e `ls dashboard/src/pages/trust/` tem só `violations.tsx`.

O blueprint `.claude/knowledge-base/discoveries/blueprints/trust-guardrails-operation-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89, 17 citações verificadas) investigou como PostHog e Langfuse resolvem os mesmos cinco problemas, e produziu sete decisões que este plano consome. A mais consequente: **nenhum dos dois peers torna o teste obrigatório antes de gravar** — o M24 vai ser mais duro que o SOTA, e o blueprint documenta por quê.

## Baseline Context

### Files that will be touched

| Arquivo | LoC hoje | Último commit | Por que existe |
|---|---|---|---|
| `internal/routes/trust_dashboard.go` | 118 | `e50b653` 2026-07-31 | BFF de leitura do M23; declara a porta `trustReader` pelo consumidor (ISP+DIP) |
| `internal/routes/trust_guardrails.go` | 118 | `2da373b` 2026-07-31 | BFF de mutação do M24 (create/test/delete), já entregue |
| `internal/trust/data_client.go` | 143 | `e50b653` 2026-07-31 | Cliente de leitura por tenant; `keyResolver` consultado ANTES de qualquer rede (`:93-96`) |
| `internal/trust/write_client.go` | 85 | `2da373b` 2026-07-31 | Cliente de escrita, porta separada por menor privilégio |
| `cmd/trust_dashboard_wiring.go` | 62 | `2da373b` 2026-07-31 | Wiring dos dois clientes + montagem das rotas |
| `dashboard/src/components/trust/trust-api.ts` | 18 | `b9e3c8e` 2026-07-31 | Base `/v1/dashboard/trust` do cliente de dados |
| `dashboard/src/components/trust/guardrail-draft.ts` | 131 | **untracked** | Lógica de rascunho já escrita, sem teste commitado |
| `dashboard/src/pages/trust.tsx` | 150 | `0c327cf` 2026-07-31 | Visão geral (M23) |
| `dashboard/src/pages/trust/violations.tsx` | 181 | `aeb363a` 2026-07-31 | Lista de violações (M23) |
| `dashboard/src/components/layout/app-sidebar.tsx` | 594 | `31521ed` 2026-07-31 | Menu; **já acima de 500 LoC** — ver Drawbacks R3 |
| `dashboard/src/app.tsx` | 635 | `b9e3c8e` 2026-07-31 | Rotas; **já acima de 500 LoC** — ver Drawbacks R3 |

### Current callers / dependents

- `MountTrustDashboard` — chamado em `cmd/main.go:539` (log `dashboard trust enabled`). Único caller de produção.
- `MountTrustGuardrails` — chamado em `cmd/main.go:547` (log `dashboard trust guardrails enabled`). Único caller de produção.
- `trust.DataClient` — construído em `cmd/trust_dashboard_wiring.go`; testado sem HTTP via a porta declarada em `trust_dashboard.go`.
- `TrustOverviewPage` / `TrustViolationsPage` — `dashboard/src/app.tsx:135,138` (lazy import) e `:481,482` (rotas).
- Entrada de menu — `dashboard/src/components/layout/app-sidebar.tsx:125` (item Trust) e `:235-243` (submenu com Overview e Violations).

### Architecture boundaries affected

O BFF é a única fronteira. O contrato, herdado do M23 e reafirmado aqui: o tenant vem **sempre** do contexto derivado do JWT, nunca de parâmetro de requisição (CWE-441); o corpo do upstream é repassado sem re-modelagem; a porta é declarada pelo consumidor (`trust_dashboard.go:7-9`), não pelo pacote que a implementa. O dashboard nunca fala com o `theo-trust` diretamente — só com `/v1/dashboard/trust/*`.

### Domain glossary

| Termo | Definição |
|---|---|
| **validator** | Regra declarativa de guardrail armazenada no `theo-trust` (kinds: `ban-list`, `regex-match`, `pii`, `jailbreak`, `credential-mask`, `moderation`) |
| **catálogo mesclado** | A listagem que soma validators de **plataforma** (built-ins, herdados por todo tenant) e do **tenant** (criados por ele) |
| **dry-run** | `POST /v1/validators:test` — avalia uma spec candidata sem gravar nada |
| **enforcement event** | Registro do M17 de um bloqueio inline, com `category`, `decision`, `direction` e o marcador **redigido** — conteúdo bruto nunca chega a essa tabela |
| **leg / direction** | A perna da conversa onde a regra atua (`input`, `tool_input`, `output`, `tool_output`) |

## Prior Art & Related Work

- **Blueprint interno** `.claude/knowledge-base/discoveries/blueprints/trust-guardrails-operation-blueprint.md` — sete ADRs derivados de PostHog e Langfuse. Este plano os consome nominalmente nos ADRs abaixo.
- **M23 no mesmo repositório** — `internal/routes/trust_dashboard.go` é o padrão de BFF a replicar; `trust-series.ts` é o padrão de projeção pura.
- **Nenhuma `*-patterns` skill existe** neste projeto (`ls .claude/skills/*-patterns/` → vazio), logo não há pattern a citar ou sobrepor.

## ADRs

### D1 — O dry-run é passagem obrigatória, não botão irmão do salvar

**Decisão:** o formulário de criação tem **um** caminho até gravar, e ele atravessa o dry-run. Não existe botão que salve sem testar.

**Rationale:** consome a decisão de dry-run como passagem obrigatória do blueprint. Nenhum peer faz isso: o PostHog testa a flag depois de gravada, e o Langfuse põe um `Save` ao lado do `Review changes` que pula a revisão. A diferença é de risco: guardrail errada bloqueia conversa de produção inline — o "Top risk #1" que o próprio M24 declara. Vale a divergência do SOTA.

**Alternativas rejeitadas:** (a) dry-run opcional com destaque visual — rejeitada: é exatamente o desenho do Langfuse, e o botão irmão prova que o destaque não segura ninguém; (b) dry-run automático em `onChange` — rejeitada: gasta chamada a cada tecla e transforma o veredito em ruído de fundo que ninguém lê.

**Consequência:** exige um teste **negativo** — provar que não existe caminho de gravação sem dry-run. Asserção sobre ausência, não sobre presença.

### D2 — Proveniência por caminho de renderização próprio, sem ações desabilitadas

**Decisão:** linha de plataforma e linha de tenant são renderizadas por caminhos distintos. A de plataforma não tem botão de remover — ausente, não desabilitado.

**Rationale:** consome a decisão de proveniência por caminho próprio do blueprint. O PostHog usa um componente separado (`FeatureFlagReleaseConditionsReadonly`), não um modo do editor. Botão desabilitado convida o operador a procurar como habilitá-lo; a ausência comunica que aquilo não lhe pertence. Alinha com `DESIGN.md § 10` (tabela para decisão: a coluna existe para diferenciar).

**Alternativas rejeitadas:** (a) uma tabela com botão desabilitado nas linhas de plataforma — rejeitada pelo convite implícito; (b) duas tabelas separadas — rejeitada: o operador quer ver o que está valendo em conjunto, e separar esconde a soma.

**Consequência:** a projeção que monta a tabela precisa carregar a origem por linha, e isso vira um teste de projeção pura.

### D3 — Confirmação cobre remover e ativar

**Decisão:** remoção segue `DESIGN.md § 2.2` integralmente (zona destrutiva, frase digitada verbatim, reversibilidade declarada). A criação exige confirmação explícita do veredito do dry-run antes de gravar.

**Rationale:** consome a decisão de confirmar também o ativar. `ConfirmationModal.tsx:65` do PostHog confirma até mudança de rollout — a régua não é "isto apaga dados", é "isto muda produção agora". Criar uma guardrail é o evento que passa a bloquear tráfego.

**Alternativas rejeitadas:** confirmar só a remoção — rejeitada: seria proteger o desfazer e deixar o fazer desprotegido, quando é o fazer que liga o bloqueio.

### D4 — Massa de teste em lógica pura; um único e2e

**Decisão:** projeções e regras de rascunho testadas como funções puras; um e2e cobre a jornada do DoD.

**Rationale:** consome a decisão de concentrar teste em lógica + `.claude/rules/testing.md` (e2e poucos, estáveis, representativos). O PostHog tem 71 casos de lógica para feature flags e **zero** spec de flag em `playwright/e2e/`.

**Alternativas rejeitadas:** cobrir cada tela com e2e — rejeitada: lento, frágil, e o peer que mais depende do recurso não faz isso.

### D5 — Um teste por código tipado, asserindo a mensagem literal

**Decisão:** `422 INVALID_SPEC`, `422 VALIDATOR_NAME_RESERVED` e `409 CONFLICT` ganham cada um um teste que assere o **texto renderizado**.

**Rationale:** consome a decisão de asserir a mensagem literal. É o padrão medido no peer (`featureFlagLogic.test.ts:283` compara a string do backend; `featureFlagsLogic.test.ts:331` mapeia um 409 a um texto). Um teste que só verifica "deu erro" não distingue a mensagem útil da genérica — e é essa distinção que o DoD cobra.

**Alternativas rejeitadas:** asserção genérica de "erro exibido" — rejeitada: passaria mesmo com "ocorreu um erro", que é o anti-pattern proibido em `DESIGN.md § 6.3`.

### D6 — Nenhuma dependência nova de formulário ou validação

**Decisão:** sem `zod`, sem `react-hook-form`. A validação local fica em lógica pura; a autoridade sobre a spec continua no serviço.

**Rationale:** consome a decisão de não adicionar dependência + rung 4 da `parsimony-ladder.md`. O Langfuse pode validar no cliente porque **compartilha o schema** com o servidor; nós não — o schema vive no `theo-trust` com guard de ReDoS. Reescrevê-lo aqui criaria duas fontes de verdade que divergem em silêncio.

**Alternativas rejeitadas:** adotar `zod` para o formulário — rejeitada por (a) duplicação de fonte de verdade e (b) dependência inteira para três campos.

### D7 — E2E contra a instância implantada, por `BASE_URL`

**Decisão:** o e2e aponta `BASE_URL` para o deploy real; não levanta stack; Chromium apenas.

**Rationale:** consome a decisão de e2e por BASE_URL. É o desenho do peer (`playwright.config.ts:64` injeta `baseURL` por env, sem bloco `webServer`), e o DoD do M24 exige explicitamente "contra a instância implantada". Playwright já está instalado (`@playwright/test` + script `test:e2e`) — rung 4, nada a instalar.

**Alternativas rejeitadas:** e2e contra mock — rejeitada: não provaria o que o DoD pede, que é o sistema no ar.

## Dependencies

Nenhuma dependência nova é adicionada (ADR D6, D7). Todas as bibliotecas usadas já estão declaradas:

| Dependência | Versão declarada | Onde já é usada | Rule 9 (não reinventar) |
|---|---|---|---|
| `@playwright/test` | já em `dashboard/package.json` devDeps | script `test:e2e` | ferramenta padrão de e2e; nada a construir |
| `@tanstack/react-query` | já em `dashboard/package.json` deps | telas do M23 | cache/estado de servidor; não reimplementar |
| `@usetheo/ui` / `@theokit/ui` | já em deps | design system do dashboard | composites do `DESIGN.md` |
| `github.com/go-chi/chi/v5` | já em `go.mod` | todas as rotas do BFF | roteador já adotado |

Nenhum manifesto é alterado. `/deps-audit` deve confirmar zero CVE nas já declaradas.

## Dependency Graph

```
Fase 0 (CVE HIGH) ─> desbloqueia o resto

Fase 1 (BFF auditoria) ─┐
                        ├─> Fase 3 (cliente de dados) ─> Fase 4 (registro) ─> Fase 5 (criar+dry-run) ─> Fase 6 (remover)
Fase 2 (domínio draft) ─┘                                      │                                              │
                                                               └──────────> Fase 7 (auditoria) <──────────────┘
                                                                                   │
                                                                                   v
                                                                    Fase 8 (Integration Validation + e2e)
```

Fases 1 e 2 paralelizam (Go e TS, sem contato). Fase 8 depende de todas.

## Fase 0 — Pré-requisito de segurança

### T0.1 — Fechar as duas CVEs HIGH na superfície que este milestone amplia

#### Why this step

**Ação:** subir `react-router` para além de 7.17.0 e `postcss` para além de 8.5.17, ambos **dentro do range semver já declarado** (`react-router-dom: ^7.0.0`, `postcss: ^8.4.0`).

**Raciocínio:** `npm audit --omit=dev` reporta 2 HIGH + 4 MODERATE. As HIGH são *"Open redirect via backslash in `<Link>` and `useNavigate`"* + XSS no `react-router` 7.17.0, e path traversal de source map no `postcss`. Este plano acrescenta três telas que navegam com `<Link>`/`useNavigate` — ou seja, **amplia exatamente a superfície do open redirect**, num painel autenticado. Pelo `deps-audit-golden-rule.md § 2`, HIGH em dep declarada é `FAIL_INSECURE` (cap 49) e bloqueia o gate; entregar o M24 por cima disso seria construir sobre uma base que o próprio projeto reprova. Não é troca de major — é refazer o lockfile dentro do range que já está no `package.json`.

#### Files to edit

- `dashboard/package-lock.json` / `dashboard/pnpm-lock.yaml` (conforme o gerenciador em uso)
- `dashboard/package.json` **apenas se** o range precisar de piso mínimo explícito

#### Deep file dependency analysis

`react-router` é transitivo de `react-router-dom@7.18.1`. `app.tsx` importa `react-router-dom` para todas as rotas (`:481-482` entre outras) — é o caminho de navegação inteiro do dashboard, o que torna a regressão fácil de detectar: se o roteador quebrar, nenhuma rota renderiza.

#### TDD

Bump de dependência não tem RED próprio; a rede de proteção é a suíte existente + o próprio `npm audit` como oráculo:

- RED (oráculo): `npm audit --omit=dev` reporta HIGH **antes** do bump.
- GREEN: após o bump, zero HIGH; suíte, typecheck, lint e build permanecem verdes.

#### Concurrency tests

(none — single-threaded)

#### Resultado medido (2026-07-31) — parcial, e por quê

- **`postcss` FECHADO:** 8.5.17 → **8.5.25**. A HIGH de path traversal saiu do relatório.
- **`react-router` NÃO fechável sem major:** subiu 7.17.0 → **7.18.2**, mas o advisory cobre `7.12.0 - 8.2.0`, e **o `latest` publicado de `react-router-dom` é 7.18.2** — ou seja, *não existe versão de `react-router-dom` fora do range vulnerável*. A correção real é migrar para `react-router` **8.3.0**, que absorveu o `-dom` e é troca de major sobre todo o roteamento do dashboard (`app.tsx`, 635 LoC).

Migrar roteador dentro do M24 misturaria escopo e ampliaria o diff de revisão sem relação com guardrails. **Vira issue própria**, não silêncio: a CVE de open redirect segue aberta e é conhecida.

#### Acceptance criteria

- `npm audit --omit=dev` sem `postcss` HIGH (atingido).
- `npx vitest run`, `npx tsc --noEmit`, `npx eslint .` e `npm run build` verdes.
- Nenhuma rota do dashboard quebrada (a suíte de `app.test.tsx` cobre a montagem).

#### DoD

```bash
cd dashboard && npm audit --omit=dev && npx vitest run && npx tsc --noEmit && npx eslint . && npm run build
```

## Fase 1 — A rota de auditoria no BFF

### T1.1 — `GET /v1/dashboard/trust/enforcement-events`

#### Why this step

**Ação:** acrescentar ao cliente de leitura o método `EnforcementEvents(ctx, limit)`, declarar o verbo na porta consumida por `trust_dashboard.go`, registrar a rota sob `requireJWT` e ligar no wiring.

**Raciocínio:** é a única peça de servidor que falta (medido: `grep -rn "enforcement" internal/ --include=*.go` → zero rotas), e todas as telas de auditoria dependem dela — por isso é a primeira fase. O upstream já garante a redação na origem (`packages/api/src/server/handlers/enforcement-events.ts:3-4` — *"Only redacted markers are stored/returned; raw content never reaches this table"*), então o BFF **repassa** e não redige: reimplementar redação aqui criaria uma segunda fonte de verdade sobre o que é seguro exibir. Segue o padrão do M23 (Baseline Context § Fronteiras).

#### Files to edit

- `internal/trust/data_client.go` — método `EnforcementEvents`
- `internal/routes/trust_dashboard.go` — verbo na porta + handler + rota
- `internal/routes/trust_dashboard_test.go` — testes
- `internal/trust/data_client_test.go` — teste do cliente

#### Deep file dependency analysis

`data_client.go:96` (`getRaw`) consulta o `keyResolver` **antes** de qualquer rede — propriedade que o teste do M23 já trava ("resolver falhou ⇒ zero requisição upstream"). O novo método reusa `getRaw`, herdando a propriedade por construção. `MountTrustDashboard` tem um único caller (`cmd/main.go:539`), então adicionar rota não afeta outro ponto.

#### TDD

- RED `TestEnforcementEvents_RequiresScope`: requisição sem `trust:read` → **403**, e zero chamada upstream.
- RED `TestEnforcementEvents_TenantFromJWTNotQuery`: `?tenant=outro` é ignorado; o Bearer cunhado é o do JWT.
- RED `TestEnforcementEvents_PassesLimitThrough`: `?limit=5` chega ao upstream como `limit=5`; `limit` inválido devolve o **422** do upstream sem re-modelar.
- RED `TestEnforcementEvents_ResolverFailureMeansNoUpstreamCall`: resolver falha → zero requisição.
- GREEN: implementar o método e a rota.

#### Concurrency tests

O handler é servido concorrentemente pelo `net/http`. A suíte roda com `go test -race` (padrão já usado no commit `2da373b`). Não há estado mutável compartilhado novo: o cliente é imutável após construção e o `keyResolver` recebe o `ctx` por chamada.

#### Acceptance criteria

- `go build ./...` exit 0; `go test ./internal/... ./cmd/... -race` verde.
- Chave sem `trust:read` recebe 403 (não 200 com dado de outro tenant).
- Nenhum campo do upstream é re-serializado: o corpo sai como veio.

#### DoD

```bash
go build ./... && go test ./internal/routes/ ./internal/trust/ ./cmd/ -race
```

## Fase 2 — O domínio do rascunho

### T2.1 — Travar `guardrail-draft.ts` com testes

#### Why this step

**Ação:** escrever os testes da lógica de rascunho que já existe untracked e commitá-la junto.

**Raciocínio:** o arquivo carrega uma decisão de produto forte — o operador só escolhe `ban-list`, porque `regex-match` convida a um padrão catastrófico, `moderation` responde 422 neste deploy (sem classificador) e os demais já vêm ligados como padrão de plataforma. Decisão desse peso sem teste é decisão que se perde no próximo refactor. É lógica pura, testável sem React (ADR D4).

#### Files to edit

- `dashboard/src/components/trust/guardrail-draft.ts` (existe, untracked)
- `dashboard/src/components/trust/guardrail-draft.test.ts` (NEW)

#### Deep file dependency analysis

Sem dependências: o módulo não importa React nem rede. Nenhum caller hoje — a Fase 5 será o primeiro.

#### TDD

- RED: rascunho vazio não pode ser salvo; nome vazio, termos vazios e termo duplicado cada um com sua mensagem.
- RED: ação `modify` exige `replacement`; ação `block` não.
- RED (edge): termo com espaços nas bordas é normalizado; lista com um único termo válido é salvável.
- RED (negativo): nome que colide com built-in de plataforma é rejeitado localmente com mensagem própria — e o teste declara que a autoridade final continua sendo o `422 VALIDATOR_NAME_RESERVED` do serviço (ADR D6).
- GREEN/REFACTOR conforme necessário.

#### Concurrency tests

(none — single-threaded) — funções puras sem I/O.

#### Acceptance criteria

`vitest run` verde; o arquivo deixa de ser untracked.

#### DoD

```bash
cd dashboard && npx vitest run src/components/trust/guardrail-draft.test.ts
```

## Fase 3 — Cliente de dados do dashboard

### T3.1 — Verbos de guardrail em `trust-api.ts`

#### Why this step

**Ação:** acrescentar `listValidators`, `createGuardrail`, `testGuardrail`, `deleteGuardrail` e `listEnforcementEvents`, cada um devolvendo erro **tipado** que preserva `code` e `message` do serviço.

**Raciocínio:** é a costura onde a mensagem do serviço se perde ou sobrevive. Se este módulo colapsar `{code,message}` em `Error('erro')`, nenhuma tela conseguirá cumprir o DoD depois — por isso o tipo do erro é decidido aqui e não na tela (ADR D5).

#### Files to edit

- `dashboard/src/components/trust/trust-api.ts` (18 LoC hoje)
- `dashboard/src/components/trust/trust-api.test.ts` (NEW)

#### Deep file dependency analysis

`trust-api.ts:14` define `const BASE = '/v1/dashboard/trust'`. As rotas de mutação vivem sob `${BASE}/guardrails` (`internal/routes/trust_guardrails.go:112`) e a auditoria sob `${BASE}/enforcement-events` (T1.1).

#### TDD

- RED: `422 {code:'INVALID_SPEC', message:'...'}` vira erro tipado que **carrega a mensagem original**.
- RED: `409 CONFLICT` idem.
- RED: resposta 200 devolve o corpo sem remodelar.
- RED (negativo): corpo não-JSON em erro não estoura — vira erro tipado com mensagem de fallback declarada.

#### Failure scenarios

| Dependência | Falha | Como o teste reproduz | Comportamento esperado |
|---|---|---|---|
| BFF HTTP | 500 do upstream | fetch stub devolve 500 sem corpo | erro tipado com mensagem de fallback; nunca "sucesso" |
| BFF HTTP | rede indisponível | fetch stub rejeita | erro tipado; a tela mostra estado de erro, não lista vazia |
| BFF HTTP | 422 com corpo tipado | fetch stub devolve `{code,message}` | `code` e `message` preservados até a tela |

#### Concurrency tests

(none — single-threaded) — o cliente não compartilha estado entre chamadas.

#### Acceptance criteria

Todo caminho de erro preserva `code` e `message`. Nenhum `throw new Error('...')` genérico no módulo.

#### DoD

```bash
cd dashboard && npx vitest run src/components/trust/trust-api.test.ts && npx tsc --noEmit
```

## Fase 4 — Tela de registro (catálogo mesclado)

### T4.1 — Projeção do catálogo com proveniência

#### Why this step

**Ação:** função pura que recebe a resposta de `/validators` e devolve as linhas com `origin: 'platform' | 'tenant'` e as ações permitidas por linha.

**Raciocínio:** ADR D2 exige caminhos de renderização distintos; a decisão de qual linha recebe qual ação é **regra**, não pintura, então vive numa função pura testável (ADR D4), no mesmo espírito de `trust-series.ts` do M23.

#### Files to edit

- `dashboard/src/components/trust/guardrail-catalog.ts` (NEW)
- `dashboard/src/components/trust/guardrail-catalog.test.ts` (NEW)

#### TDD

- RED: catálogo com built-ins e linhas de tenant produz origem correta por linha.
- RED: linha de plataforma **não** expõe ação de remover (asserção sobre ausência, não sobre `disabled`).
- RED (edge): catálogo só com plataforma; catálogo vazio → estado vazio distinguível de erro.
- RED: a coluna de legs (`directions`) aparece por linha (o `/v1/validators` já a serve).

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

Nenhuma linha de plataforma carrega ação destrutiva em nenhuma forma.

#### DoD

```bash
cd dashboard && npx vitest run src/components/trust/guardrail-catalog.test.ts
```

### T4.2 — Página `/trust/guardrails`

#### Why this step

**Ação:** renderizar o catálogo mesclado, com empty state de 4 elementos (`DESIGN.md § 5.1`) e erro de 6 elementos (`DESIGN.md § 6.1`); registrar rota e entrada de submenu.

**Raciocínio:** o M23 já provou o caminho (rota lazy em `app.tsx`, submenu em `app-sidebar.tsx:235-243`); repetir o padrão evita inventar navegação nova. Sem entrada de menu, a rota existe e ninguém a encontra — foi um defeito real do M23, corrigido em `31521ed`.

#### Files to edit

- `dashboard/src/pages/trust/guardrails.tsx` (NEW)
- `dashboard/src/pages/trust/guardrails.test.tsx` (NEW)
- `dashboard/src/app.tsx` (rota)
- `dashboard/src/components/layout/app-sidebar.tsx` (submenu)

#### TDD

- RED: lista renderiza plataforma e tenant distinguíveis por texto (não só por cor — acessibilidade).
- RED: falha de carga renderiza erro com título+causa+impacto+ação, nunca lista vazia.
- RED: catálogo vazio renderiza empty state com CTA de criar.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

`/trust/guardrails` acessível pelo menu; 5Q-3s do `DESIGN.md § 1` validável por revisor.

#### DoD

```bash
cd dashboard && npx vitest run src/pages/trust/ && npx tsc --noEmit && npx eslint .
```

## Fase 5 — Criar com dry-run obrigatório

### T5.1 — O fluxo em que o salvar atravessa o teste

#### Why this step

**Ação:** formulário de criação em que a ação de gravar só existe **depois** de um dry-run bem-sucedido exibido ao operador.

**Raciocínio:** ADR D1 — a decisão mais consequente do plano. O erro do Langfuse (`NewPromptForm/index.tsx:471`, um `Save` irmão que pula a revisão) é exatamente o que o teste negativo desta task impede. O dry-run já existe como rota própria no BFF (`trust_guardrails.go:87`), com teste provando que não grava nada — a UI apenas honra esse desenho.

#### Files to edit

- `dashboard/src/pages/trust/guardrail-new.tsx` (NEW)
- `dashboard/src/pages/trust/guardrail-new.test.tsx` (NEW)
- `dashboard/src/app.tsx` (rota)

#### Deep file dependency analysis

Consome `guardrail-draft.ts` (T2.1) para validade local e `trust-api.ts` (T3.1) para `testGuardrail`/`createGuardrail`.

#### TDD

- RED (**o teste que define a task**): com rascunho válido e **sem** dry-run executado, não existe elemento acionável que dispare `createGuardrail` — asserção sobre **ausência** de caminho, não sobre botão desabilitado.
- RED: após dry-run com veredito, a ação de gravar aparece e chama `createGuardrail` com a spec **testada** (mesmos bytes).
- RED: alterar o rascunho após o dry-run invalida o veredito e remove novamente a ação de gravar (senão salva-se algo diferente do que foi testado). **A invalidação compara a serialização da spec** — os mesmos bytes enviados ao dry-run — e não a identidade do objeto (EC-2 do edge-case review): uma implementação que compara referência passaria no teste ingênuo e ainda assim gravaria spec diferente da testada.
- RED (EC-2, par): editar um campo **para o mesmo valor** NÃO invalida o veredito; editar para valor diferente invalida. Os dois casos juntos são o que fixa a semântica de "a spec testada".
- RED (D5): `422 INVALID_SPEC` renderiza a **mensagem do serviço** literalmente.
- RED (D5): `422 VALIDATOR_NAME_RESERVED` idem, com texto próprio.
- RED (D5): `409 CONFLICT` idem.
- RED: dry-run que devolve `block` mostra o veredito e o conteúdo modificado quando houver.

#### Failure scenarios

| Dependência | Falha | Reprodução | Esperado |
|---|---|---|---|
| `POST /guardrails/test` | 500 | stub 500 | erro de 6 elementos; ação de gravar **não** aparece |
| `POST /guardrails/test` | timeout/rede | stub rejeita | idem; o rascunho é preservado |
| `POST /guardrails` | 409 após dry-run ok | stub 409 | mensagem do serviço; rascunho preservado para correção |

#### Concurrency tests

(none — single-threaded) — sem corrida no cliente; a UI serializa as ações.

#### Acceptance criteria

Não existe, em nenhum estado da tela, caminho que grave sem dry-run da spec vigente.

#### DoD

```bash
cd dashboard && npx vitest run src/pages/trust/guardrail-new.test.tsx && npx tsc --noEmit
```

## Fase 6 — Remoção com confirmação

### T6.1 — Zona destrutiva conforme `DESIGN.md § 2.2`

#### Why this step

**Ação:** remoção de validator de tenant com zona destrutiva, diálogo com impacto, reversibilidade e **frase digitada verbatim**, botão `variant="destructive"`.

**Raciocínio:** ADR D3 + `DESIGN.md § 2.2`, que é contrato travado e exige explicitamente a frase digitada. Remover uma guardrail desliga uma proteção ativa — o impacto a declarar é esse, não "o item some da lista".

#### Files to edit

- `dashboard/src/pages/trust/guardrails.tsx` (ação por linha de tenant)
- `dashboard/src/components/trust/guardrail-delete-dialog.tsx` (NEW)
- `dashboard/src/components/trust/guardrail-delete-dialog.test.tsx` (NEW)

#### TDD

- RED: confirmar exige a frase exata; frase errada mantém a ação bloqueada.
- RED: o diálogo declara o impacto (a proteção deixa de valer) e a irreversibilidade.
- RED: erro do serviço na remoção mostra a mensagem do serviço; a linha **permanece** na lista (não some otimisticamente).
- RED: linha de plataforma não tem caminho de remoção (reforça T4.1 na camada de tela).

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

Nenhuma remoção sem frase digitada. Nenhum `variant="primary"` em ação destrutiva.

#### DoD

```bash
cd dashboard && npx vitest run src/components/trust/guardrail-delete-dialog.test.tsx
```

## Fase 7 — Tela de auditoria

### T7.1 — `/trust/enforcement`

#### Why this step

**Ação:** listar eventos de enforcement com categoria, direção, decisão, validator e o marcador redigido.

**Raciocínio:** fecha o ciclo entre configurar e observar o efeito — o motivo declarado do M24. O conteúdo já chega redigido da origem (Baseline Context § Glossário), então a tela **exibe** o marcador; se ela tentasse redigir, criaria a ilusão de que o dado bruto passou por aqui.

#### Files to edit

- `dashboard/src/pages/trust/enforcement.tsx` (NEW)
- `dashboard/src/pages/trust/enforcement.test.tsx` (NEW)
- `dashboard/src/components/trust/enforcement-rows.ts` (NEW — projeção pura)
- `dashboard/src/components/trust/enforcement-rows.test.ts` (NEW)
- `dashboard/src/app.tsx`, `dashboard/src/components/layout/app-sidebar.tsx`

#### TDD

- RED: evento com `decision: 'block'` é visualmente distinguível de `allow` **por texto**, não só por cor.
- RED: nenhum campo de conteúdo bruto é renderizado — a projeção só expõe o marcador redigido (asserção sobre ausência).
- RED (edge): lista vazia → empty state distinguível de falha de carga.
- RED: falha de carga → erro de 6 elementos.
- RED (EC-5): a tela pede um `limit` **explícito** ao servidor; o teste fixa o valor. Sem isso a tela herda o teto `MAX_ROWS` do upstream sem saber, e a primeira renderização lenta seria atribuída à tela e não à escolha implícita.

#### Concurrency tests

(none — single-threaded)

#### Acceptance criteria

Zero conteúdo bruto na tela; empty state ≠ erro; `limit` explícito.

#### DoD

```bash
cd dashboard && npx vitest run src/pages/trust/enforcement.test.tsx src/components/trust/enforcement-rows.test.ts
```

## Fase 8 — Integration Validation

### T8.1 — E2E da jornada + cadeia completa de gates

#### Why this step

**Ação:** um spec Playwright que percorre criar → testar → salvar → provocar bloqueio real no `/v1/guard` → ver o evento na auditoria, com `BASE_URL` apontando para a instância implantada; depois rodar a cadeia inteira de gates.

**Raciocínio:** ADR D4/D7 e o DoD do M24 ("Funcional e2e ... contra a instância implantada"). É a métrica única do Goal. Um milestone que compila e testa mas cuja tela não opera o serviço real **não fecha** — é a regra que o M23 estabeleceu e este plano herda.

#### Files to edit

- `dashboard/e2e/guardrails-journey.spec.ts` (NEW)
- `dashboard/e2e/page-models/guardrails-page.ts` (NEW)

#### TDD

- RED: o spec falha enquanto a jornada não estiver completa (escrito antes das telas existirem funcionalmente ponta a ponta).
- GREEN: passa contra o deploy.

#### Contenção do efeito colateral (EC-1 — obrigatório)

O spec **cria uma guardrail de verdade**, que passa a bloquear tráfego real do tenant. Sem contenção explícita, um teste de qualidade vira incidente — a materialização exata do risco R1. Portanto:

- O termo bloqueado é deliberadamente improvável e namespaced por execução (`zzz-e2e-<runId>`), de modo que nenhuma conversa humana o contenha.
- Limpeza em `afterEach` **e** varredura idempotente no início do spec, removendo sobras de execuções anteriores (o `afterEach` não roda se o processo morrer).
- Asserção final: o validator criado **não existe mais** no catálogo ao fim do spec.

#### Failure scenarios

| Dependência | Falha | Reprodução | Esperado |
|---|---|---|---|
| instância implantada | fora do ar | `BASE_URL` inacessível | o e2e **falha com mensagem de ambiente**, distinguível de falha de produto — nunca é reportado como "passou" |
| `/v1/guard` | não bloqueia o termo criado | asserção da jornada | falha explícita: a guardrail não teve efeito real |

#### Concurrency tests

(none — single-threaded) — o spec é sequencial por desenho.

#### Acceptance criteria

- `go build ./... && go test ./... -race` verde.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` verdes.
- `BASE_URL=<deploy> npx playwright test e2e/guardrails-journey.spec.ts` verde, com evidência capturada.
- CHANGELOG `[Unreleased]` atualizado.

#### DoD

```bash
go build ./... && go test ./... -race
cd dashboard && npx tsc --noEmit && npx eslint . && npx vitest run
cd dashboard && BASE_URL=<deploy> npx playwright test e2e/guardrails-journey.spec.ts
```

## Critical paths

Caminhos onde um defeito é caro, para a auditoria de mutação do `/code-quality`:

- `dashboard/src/components/trust/guardrail-draft.ts` — decide o que pode virar regra de produção.
- `dashboard/src/components/trust/guardrail-catalog.ts` — decide que linha recebe ação destrutiva.
- `dashboard/src/components/trust/trust-api.ts` — decide se a mensagem do serviço sobrevive.
- `internal/routes/trust_dashboard.go` — decide isolamento por tenant.

## Coverage Matrix

| # | Item do DoD do M24 (ROADMAP.md § M24) | Task(s) |
|---|---|---|
| 1 | Rotas BFF create/test/delete com escopo correspondente | **já entregue** em `2da373b`; re-verificado em T8.1 |
| 2 | Rota BFF de listagem | já entregue (M23) + auditoria em **T1.1** |
| 3 | Catálogo mesclado distinguindo herdado de criado | **T4.1, T4.2** |
| 4 | Testar antes de salvar obrigatório no fluxo | **T5.1** |
| 5 | Erro tipado com a mensagem do serviço | **T3.1, T5.1** |
| 6 | Remoção como ação destrutiva isolada com confirmação | **T6.1** |
| 7 | Auditoria lendo enforcement-events, conteúdo redigido | **T1.1, T7.1** |
| 8 | Funcional e2e da jornada contra a instância implantada | **T8.1** |
| 9 | (pré-requisito, EC-3) Zero CVE HIGH na superfície de navegação que o milestone amplia | **T0.1** |

**Cobertura: 9/9 (100%)**

Checkpoints herdados do edge-case review (`.claude/knowledge-base/reviews/trust-guardrails-operation-edge-cases-plan-2026-07-31.md`): EC-4 — antes de fechar, abrir `internal/routes/trust_guardrails_test.go` e **confirmar** que o teste de escopo existe para os três verbos, em vez de herdar o item de DoD por confiança no commit `2da373b`; EC-5 — T7.1 declara explicitamente o `limit` pedido ao servidor.

## Drawbacks & Risks

| # | Risco | Severidade | Mitigação | Dono |
|---|---|---|---|---|
| R1 | A tela passa a criar objetos que bloqueiam tráfego inline do tenant; uma regra ruim derruba conversa em produção | **Alta** | Dry-run como passagem obrigatória (D1) + o `422` fail-fast do serviço na fronteira + confirmação do veredito antes de gravar (D3) | implementador |
| R2 | Erro de escopo vira ação destrutiva: `DELETE` de validator é irreversível pela UI | **Alta** | `trust:delete` separado de `trust:write` (já existe no serviço e no catálogo de escopos) + frase digitada verbatim (`DESIGN.md § 2.2`) | implementador |
| R3 | `app.tsx` (635 LoC) e `app-sidebar.tsx` (594 LoC) já excedem o orçamento de 500 LoC; este plano acrescenta rotas a ambos | Média | Acrescentar **apenas** as linhas de rota/menu (≈ 8 linhas somadas); registrar a dívida. Refatorar os dois arquivos aqui misturaria escopo e ampliaria o diff de revisão sem relação com o M24 | revisor |
| R4 | O e2e depende da instância implantada estar de pé; um ambiente fora do ar pode ser lido como falha de produto | Média | Falha de ambiente é distinguível por mensagem própria (T8.1 § Failure scenarios); nunca reportar "não rodou" como "passou" (Regra 3) | implementador |
| R5 | `moderation` responde `422` neste deploy (sem classificador ligado); expor o kind produziria uma opção que só dá erro | Baixa | `guardrail-draft.ts` já restringe a escolha a `ban-list`; o teste de T2.1 trava a decisão | implementador |

## Unresolved Questions

- Q1 — **Paginação da auditoria.** O upstream aceita `?limit=` com teto `MAX_ROWS`, mas não oferece cursor. Para o volume atual, `limit` basta; se a tela precisar paginar, o verbo tem de nascer no `theo-trust` primeiro. Fora do escopo deste plano — vira issue no `theo-trust` se a necessidade aparecer.
- Q2 — **Edição de validator (PUT).** O serviço não expõe update, só create/delete. O M24 já declara isso fora do escopo. Permanece fora.

## Failure scenarios

Consolidado das tasks (o plano toca I/O HTTP em três pontos): BFF↔`theo-trust` em T1.1, dashboard↔BFF em T3.1/T5.1/T7.1, e e2e↔deploy em T8.1. Cada seção `#### Failure scenarios` acima declara falha, reprodução e comportamento esperado. A regra transversal: **falha de leitura nunca é renderizada como ausência de dado** — num painel de segurança, "nenhuma violação" e "não consegui ler" significam coisas opostas. Foi a regra que o M23 estabeleceu e este plano herda.

## Global Definition of Done

- [ ] Todas as tasks com TDD RED→GREEN→REFACTOR cumprido
- [ ] `go build ./... && go test ./... -race` verde
- [ ] `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` verdes no dashboard
- [ ] E2E da jornada verde contra a instância implantada, com evidência capturada
- [ ] Nenhuma dependência nova adicionada (D6, D7)
- [ ] Nenhum arquivo novo acima de 500 LoC
- [ ] `/code-quality` ∉ {FAIL_HARD, INVALID}
- [ ] `/review` = READY_TO_MERGE
- [ ] CHANGELOG `[Unreleased]` atualizado
- [ ] `ROADMAP.md § M24` marcado `[x]` pelo `/release`
