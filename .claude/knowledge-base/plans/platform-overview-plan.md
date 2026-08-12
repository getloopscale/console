# Plano: a Overview passa a ser da plataforma

**Slug:** `platform-overview` · **Item:** `B-112` · **Branch:** `workspace` · **Baseline:** `bff55580`

## Goal

Fazer a Overview representar a plataforma inteira, de forma que um teste que **itera o registro
de capacidades** encontre todas as 8 na tela `/`, com `npm test`, `npm run typecheck`,
`npm run lint` e a suíte Playwright verdes.

## Context

A tela chama-se Overview e é o overview de um subsistema: consome `useProjects`,
`useBuildStats` e billing, e nada mais. As oito capacidades que o menu declara —
Memory, Knowledge Base, Databases (Soon), Workspace, Observability, Trust, Skills, Prompts —
não aparecem. Cada uma tem a **sua própria** página de overview; a plataforma não tem a dela.

Medição completa em
`knowledge-base/discoveries/opportunities/platform-overview-covers-all-capabilities-opportunity.md`.

## Baseline Context (deep review of current state)

| Arquivo | LoC | Papel hoje |
|---|---|---|
| `src/pages/overview/overview.tsx` | — | a tela; consome `useProjects`, `useBuildStats`, `useCloudApi` (billing) |
| `src/components/layout/app-sidebar-menus.ts` | — | declara o grupo `Capabilities` com os 8 itens; hoje só a barra lateral o lê |

### O que cada capacidade já expõe (medido)

| Capacidade | Fonte | Forma | Custo de um sinal |
|---|---|---|---|
| Memory | `/v1/dashboard/memory/metrics` | agregado | 1 req pequena |
| Knowledge Base | `/v1/dashboard/rag/analytics` | agregado | 1 req pequena |
| Observability | `/v1/dashboard/lens/observability` | agregado | 1 req pequena |
| Workspace | `/v1/dashboard/storage/usage` | agregado | 1 req pequena |
| Trust | `/v1/dashboard/trust/…` | lista, aceita `limit` | `limit=1` |
| Skills | `/v1/dashboard/skills` | lista, aceita `limit` | `limit=1` |
| Prompts | `/v1/dashboard/promptly` | lista, aceita `limit` | `limit=1` |
| Databases | — | `comingSoon: true` | nenhum |

### O caveat que o DISCOVER carregou

Os quatro agregados **não têm mock**. Em modo mock escapam para o proxy do Vite e voltam 500 —
foi assim que a medição os achou. Sem tratar isso, a tela nova é validada mostrando
"não consegui ler" em metade dos cards, e o dono não consegue distinguir o produto do ambiente.

### Glossário

| Termo | Aqui significa |
|---|---|
| **capacidade** | um item do grupo `Capabilities` do registro do menu |
| **sinal** | o dado que resume a capacidade — um número, ou a resposta a "está em uso?" |
| **adotada** | a capacidade tem pelo menos um objeto do usuário |

## Prior Art & Related Work

**No próprio repositório:** `LENS_CAPABILITIES` (`src/components/lens/…`) foi criado, no M70,
para que *"a barra lateral e a grade da Overview nunca divirjam"* — o mesmo problema, um nível
abaixo, já resolvido pela mesma forma: **um registro, dois consumidores.** Este plano estende o
padrão do domínio Observability para a plataforma.

`rules/parsimony-ladder.md` degrau 1 é a pergunta mais afiada deste plano, e está respondida em
`D1`.

## Dependencies

Nenhuma nova. TanStack Query, o registro do menu e os hooks de cada capacidade já existem.

## ADRs

### D1 — O card mostra ESTADO; sem estado, ele não existe

**Decisão.** Cada card carrega o estado da capacidade — `em uso` (com o sinal), `não adotada`,
`não consegui ler`, `em breve`. Um card que mostrasse apenas nome e link **não entra**.

**Rationale.** Degrau 1 da ladder: *isto precisa existir?* Um grid de nome + link é a barra
lateral desenhada de outro jeito — custa uma tela e não responde nada que o menu já não
responda. O que transforma a lista em **overview** é o estado: *o que eu uso, e o que existe que
eu não uso.*

**Alternatives considered.** *Grid só de navegação.* **Rejeitada** pelo acima. *Não mexer e
melhorar o menu.* **Rejeitada:** o menu já lista tudo; o problema não é a lista, é que a tela
inicial não representa o produto.

**Consequences.** Constrange: cada capacidade precisa de um sinal, e três delas só têm lista.
Resolvido em `D2`.

### D2 — Agregado onde existe; `limit=1` onde não existe

**Decisão.** Quatro capacidades usam o agregado que o backend já serve. As três de lista
respondem apenas *"está em uso?"* com `limit=1`.

**Rationale.** Contar por lista é pagar o transporte de N itens para saber se N > 0. `limit=1`
responde a pergunta com o menor pedido possível, e é honesto sobre o que sabe: mostra
**adotada**, não um número que seria mentira de página.

**Alternatives considered.** *Buscar a lista e contar.* **Rejeitada:** paga por dado que a tela
descarta, na página mais visitada. *Pedir agregado novo ao backend para as três.* **Rejeitada
para esta fatia:** depende de trabalho fora do dashboard e não é necessário para o Goal — fica
registrado como evolução, com o número entrando sem mudar a tela.

**Consequences.** Três cards mostram presença e não quantidade. Declarado no próprio card.

### D3 — Mesmas chaves de query das páginas de capacidade

**Decisão.** Cada card usa a **mesma** `queryKey` que a página da capacidade usa.

**Rationale.** Isto converte o custo em antecipação: abrir a Overview aquece o cache, e clicar na
capacidade renderiza sem esperar. Sem isso, sete requisições novas seriam desperdício; com isso,
são as mesmas requisições, mais cedo.

**Alternatives considered.** *Chaves próprias da Overview.* **Rejeitada:** duplicaria a busca e
transformaria prefetch em custo.

**Consequences.** Acopla a Overview às chaves das capacidades. Aceito: divergir de chave já é um
defeito hoje (`B-…` registrou colisões de chave em trust e skills), e compartilhar é o conserto.

### D4 — A tela é útil ANTES da primeira resposta

**Decisão.** O grid renderiza do registro, sem esperar rede. Cada card busca o seu sinal e
degrada sozinho.

**Rationale.** O problema que o item descreve — a plataforma não se anunciar — é resolvido pelo
grid, não pelos números. Bloquear a tela em sete requisições trocaria um defeito de descoberta
por um de latência na página mais visitada.

**Alternatives considered.** *Esperar tudo e renderizar de uma vez.* **Rejeitada** pelo acima.

**Consequences.** Estados de carregamento por card. É o custo de não ter uma tela que pisca.

### D5 — Os quatro agregados ganham mock nesta fatia

**Decisão.** `memory/metrics`, `rag/analytics`, `lens/observability` e `storage/usage` recebem
handler de mock.

**Rationale.** Sem eles, a tela é validada mostrando "não consegui ler" em quatro de sete cards,
e quem valida não distingue produto de ambiente. A DoD exige que os três estados sejam
distinguíveis — em modo mock, hoje, dois deles são indistinguíveis.

**Alternatives considered.** *Deixar para outro item.* **Rejeitada:** tornaria a própria DoD
desta fatia inverificável no único ambiente onde ela é verificada.

**Consequences.** Mais quatro handlers. Pequenos, e eles faltavam de qualquer forma.

## Drawbacks & Risks

| Risco | Severidade | Mitigação | Dono |
|---|---|---|---|
| Sete requisições a mais na página mais visitada | **Alta** | `D3` as torna prefetch das páginas de capacidade, não custo novo; `D4` garante que a tela é útil antes delas; payloads são agregados ou `limit=1` | quem implementa |
| Um card "não adotada" por falha de leitura silenciosa convida a concluir que a capacidade não serve | **Alta** | Três estados separados no tipo, não no texto; teste que os distingue | quem implementa |
| O registro do menu ganha um segundo consumidor e alguém acrescenta campo pensando só na barra lateral | Média | Teste que quantifica sobre o registro — uma capacidade nova sem card reprova | quem implementa |
| A tela vira um segundo menu, sem valor próprio | Média | `D1` — sem estado, o card não entra | revisor do PR |
| Os mocks novos divergem do contrato real do backend | Baixa | Modelados a partir do que as páginas de capacidade já consomem | quem implementa |

## Unresolved Questions

- Q1 — As três capacidades de lista merecem agregado próprio no backend? Fica para quando a
  pergunta "qual capacidade está pior?" existir; hoje `limit=1` responde o que a tela precisa.
- Q2 — `Databases` é `comingSoon`. Entra como card com o estado `em breve` — a mesma decisão que
  o menu já tomou, e que o `B-…` de Databases registrou: anunciar antes do clique é mais barato
  que descobrir depois de navegar.

## Dependency Graph

```
Fase 1 (registro + estados, RED)  ──▶  Fase 2 (a tela)  ──▶  Fase 3 (mocks)  ──▶  Fase 4 (validação)
```

---

## Phase 1: O contrato — registro e estados

### T1.1 — RED: o sinal de cada capacidade é um TIPO, não um texto

#### Why this step
O defeito que `B-111` acabou de fechar foi decidir comportamento a partir de texto de interface.
Aqui a tentação é a mesma: distinguir "vazio" de "falhou" pela frase. O estado nasce como dado
discriminado, e o teste trava isso antes de existir tela.

#### Files to edit
- `dashboard/src/pages/overview/capabilities.ts` (NEW) — o registro derivado + o tipo do sinal
- `dashboard/src/pages/overview/capabilities.test.ts` (NEW)

#### TDD
`test_toda_capacidade_do_menu_tem_card` — itera o grupo `Capabilities` do registro do menu e
exige um descritor para cada. Falha quando alguém acrescenta capacidade e esquece a Overview.
`test_os_quatro_estados_sao_distintos` — `em-uso` ≠ `nao-adotada` ≠ `nao-lida` ≠ `em-breve`,
afirmado sobre o discriminante, nunca sobre a mensagem.

#### Acceptance criteria
- O registro da Overview **deriva** do registro do menu; não há segunda lista escrita à mão.
- Nenhum estado é inferido de string.

#### DoD
`npx vitest run src/pages/overview/capabilities.test.ts` verde.

---

## Phase 2: A tela

### T2.1 — O grid de capacidades na Overview

#### Why this step
É o entregável do item: a tela inicial passa a representar a plataforma.

#### Files to edit
- `dashboard/src/pages/overview/capability-grid.tsx` (NEW)
- `dashboard/src/pages/overview/overview.tsx`
- `dashboard/src/pages/overview/overview.test.tsx`

#### TDD
`test_o_grid_mostra_as_oito_capacidades` — quantifica sobre o registro.
`test_capacidade_que_falhou_diz_que_falhou` — e **não** aparece como não adotada.
`test_a_tela_renderiza_antes_de_qualquer_resposta` — o grid existe com todas as queries pendentes.

#### Acceptance criteria
- Cada card leva à sua capacidade.
- `Databases` aparece com `em breve` e não oferece caminho.

#### DoD
`npx vitest run src/pages/overview` verde.

---

## Phase 3: O ambiente onde isto é validado

### T3.1 — Mock dos quatro agregados

#### Why this step
Sem eles, a DoD "os três estados são distinguíveis" é inverificável no único ambiente onde
alguém a verifica.

#### Files to edit
- `dashboard/src/lib/mocks/handlers.ts` ou módulo irmão por capacidade

#### TDD
Os testes da Fase 2 sobre estado `em-uso` passam a ser exercitáveis em modo mock.

#### DoD
As quatro rotas respondem 200 em modo mock; nenhuma escapa para o proxy.

---

## Phase 4: Integration Validation

#### DoD
- `npm test` exit 0
- `npm run typecheck` exit 0
- `npm run lint` 0 problemas
- `npx playwright test --project=chromium` sem falha
- Varredura de tela: `/` mostra as 8 capacidades
- CHANGELOG atualizado

## Coverage Matrix

| # | Requisito (do B-112) | Tarefa | Como fecha |
|---|---|---|---|
| 1 | toda capacidade do registro aparece em `/` | T1.1, T2.1 | teste que itera o registro |
| 2 | três estados distinguíveis | T1.1, T2.1, T3.1 | discriminante no tipo + teste + mock que permite exercitar `em-uso` |
| 3 | custo por carregamento declarado | D2, D3, D4 | ADRs: agregado onde existe, `limit=1` onde não, chaves compartilhadas, tela útil antes da rede |

Cobertura: **3/3**.

## Global Definition of Done

- [ ] As 8 capacidades aparecem em `/`, afirmado por teste que itera o registro
- [ ] Os quatro estados são discriminados no tipo, nunca por texto
- [ ] `npm test` sai 0
- [ ] `npm run typecheck` sai 0
- [ ] `npm run lint` sem erro
- [ ] Playwright sem falha
- [ ] Os quatro agregados respondem em modo mock
- [ ] CHANGELOG atualizado
- [ ] `B-112` marcado `shipped` com o fechamento medido

## Failure scenarios

| Dependência | Falha | O teste reproduz | Comportamento esperado |
|---|---|---|---|
| agregado de uma capacidade | 5xx / timeout | mock rejeita | card mostra **não consegui ler** — nunca zero, nunca "não adotada" |
| lista com `limit=1` | 5xx | mock rejeita | idem |
| todas as sete | falham juntas | todas rejeitam | o grid continua na tela com os nomes e os caminhos; a plataforma segue se anunciando |
