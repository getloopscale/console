# Plano: o dashboard fala uma língua só

**Slug:** `dashboard-english-only`
**Itens:** `B-108` (Promptly), `B-109` (Trust), `B-110` (resíduo)
**Branch:** `workspace`
**Baseline:** `07bbc3cc`

## Goal

Eliminar as **203** strings de interface em português do dashboard, de forma que um scanner de
AST executado na suíte encontre **zero** delas em `src/`, com `npm test`, `npm run typecheck`,
`npm run lint` e a suíte Playwright verdes.

## Context

O dono declarou que o produto inteiro deve estar em inglês. A varredura de 20 rotas em
navegador (2026-08-10, modo mock) mostrou que **dezoito já estão**: Projects, Billing,
Domains, Team, Memory, Knowledge Base, Workspace, Observability, Skills, Settings, Audit,
API Tokens, Lens, RAG, Environments, Secrets, Webhooks, Overview. Duas não: `/promptly`
(inteira) e `/trust` (parcial).

Não é, portanto, um produto bilíngue — são duas ilhas, mais um resíduo que a tela não revela
porque vive em estados de erro e vazio.

## Baseline Context (deep review of current state)

### Correção da medição (2026-08-10, durante a execução)

Este plano foi escrito sobre **203**. O número estava errado, e o scanner que o produziu tinha
**três buracos** — todos achados ao cruzar o resultado do guard com os localizadores dos testes,
não pelo guard sozinho:

| Buraco | Exemplo real | Efeito |
|---|---|---|
| Template COM substituição não era lido | ``aria-label={`Promover ${p.label} …`}`` | passava |
| Só posições "de nome visível" eram lidas | `texto: 'Nenhuma regra governa …'` | passava |
| Marcador por lista de palavras tem cauda | `Texto do prompt` — sem acento, fora da lista | passava |

Corrigido: o guard passou a marcar **qualquer literal por conteúdo** e a excluir o que
comprovadamente não é interface (tipo, comparação, chave de objeto, `className`, identificador
minúsculo de uma palavra só). O número real ficou em **~264 antes das exclusões de precisão** e
**219** depois delas.

A lição não é "faltou uma palavra". É que **um guard sozinho não se valida** — foram os testes,
uma fonte independente, que revelaram os três buracos. Por isso a varredura de tela em navegador
continua na DoD: duas redes que erram por motivos diferentes.

### Medição — por que scanner de AST e não `grep`

Este repositório **comenta em português por convenção**. Casar acento no arquivo inteiro
conta comentário como se fosse interface e infla o número. O scanner lê a árvore sintática e
considera apenas:

- `JsxText` (texto entre tags)
- atributos JSX de nome visível (`title`, `label`, `placeholder`, `aria-label`, `description`,
  `alt`, `confirmLabel`, `cancelLabel`, …)
- literais dentro de `JsxExpression`
- propriedades de objeto com nome visível — é onde vivem os rótulos de menu

A primeira versão do scanner varria só `.tsx` e perdeu 12 strings, entre elas os rótulos
`Catálogo` e `Nova revisão` do menu lateral, que moram num `.ts`. O número corrigido é 203.

### Superfície de produto

| Área | Strings | Observação |
|---|---|---|
| `src/pages/promptly` | **140** | a ilha maior; inclui 3 rotas em português |
| `src/pages/trust` | **44** | só texto — as rotas já estão em inglês |
| `src/pages/lens` | 9 | `usage-by-user.tsx`, `labeling-queue.tsx`, `alerts.tsx` |
| `src/pages/skills` | 4 | resíduo que `05132088` não pegou |
| `src/components/layout` | 2 | `app-sidebar-menus.ts:351,355` — `Catálogo`, `Nova revisão` |
| `src/pages/settings` | 2 | `audit.tsx`, `components/api-key-dialogs.tsx` |
| `src/app.tsx` | 1 | |
| `src/lib/mocks` | 1 | fixture, visível só em modo mock |

Arquivos de Promptly, com tamanho (`wc -l`, sha `07bbc3cc`):

```
491 catalogo.tsx      465 detail.tsx        441 playground.tsx    235 diff.tsx
214 tabs/producao.tsx 210 create.tsx        192 revision-columns  180 overview.tsx
160 tabs/consumo.tsx  126 tabs/config.tsx   104 detail/confirmacoes-de-ponteiro.tsx
 91 detail/tags-card  91 detail/discussao   88 detail/painel-de-abas
 82 detail/ambientes  76 detail/cabecalho   74 detail/texto-card   61 detail/revisoes-card
```

### Rotas em português (Promptly)

Declaradas em `src/routes/promptly-routes.tsx`:

```
/promptly/catalogo
/promptly/:promptName/producao
/promptly/:promptName/consumo
```

Expostas na barra de endereço pelas abas do detalhe: *"Uso em produção"* → `/producao`.

### Blast radius nos testes — o custo que não está na superfície

**176 localizadores** que casam texto em português, em **26 arquivos de teste**. São eles que
quebram no instante em que a string muda, e são também a única rede que prova que a tradução
não alterou comportamento.

```
 34 src/pages/promptly/detail.test.tsx        12 src/pages/promptly/tabs/producao.test.tsx
 12 e2e/promptly-authoring-journey.spec.ts    11 e2e/promptly-abas-journey.spec.ts
 10 src/pages/promptly/catalogo.test.tsx       8 src/pages/trust/overview.test.tsx
  7 src/pages/promptly/overview.test.tsx       7 e2e/promptly-journey.spec.ts
  … mais 18 arquivos
```

### Fronteiras que o plano NÃO atravessa

- Nenhuma mudança de contrato de API, nome de campo, ou dado do backend.
- Nenhum comentário de código traduzido — a convenção do repositório é português, e ela não é
  interface.

### Glossário

| Termo | Significado aqui |
|---|---|
| **string de interface** | texto que chega aos olhos ou ao leitor de tela do usuário |
| **localizador** | expressão de teste que encontra um elemento por texto (`getByText`, `getByRole({name})`) |
| **ilha** | área do produto num idioma diferente do resto |

## Prior Art & Related Work

**Precedente direto, no mesmo repositório:** commit `05132088` (2026-08-04),
*"fix(skills): painel de publicacao preso, rotas e rotulo em portugues"*. Migrou
`/skills/{catalogo,nova,descoberta}` → `{catalog,new,discovery}` e traduziu os rótulos.

Duas lições dele, e este plano herda as duas:

1. **As rotas antigas continuam resolvendo por redirect** — *"link salvo ou colado num ticket
   não pode virar 404"*. Há cobertura e2e em `skills-journey.spec.ts:829`.
2. **Ele não deixou guard.** Por isso 203 strings continuaram entrando depois dele, incluindo
   4 no próprio domínio Skills. É a diferença entre limpar e impedir que suje.

Precedente de catraca no repositório: `src/lib/loc-budget-ratchet.test.ts` — o número anotado
só desce. O guard deste plano nasce direto em zero e não precisa de catraca.

## Dependencies

Nenhuma nova. O scanner usa o `typescript` já instalado (Compiler API), como
`skills/implement` já faz em outros guards. Degrau 4 da ladder de parcimônia.

## Objective

Uma língua no produto, e um guard que a mantém.

## ADRs

### D1 — O guard mede a ÁRVORE SINTÁTICA, não o texto do arquivo

**Decisão.** O guard usa a TypeScript Compiler API e considera apenas nós que chegam ao
usuário.

**Rationale.** Este repositório comenta em português. Um guard baseado em `grep` acusaria cada
comentário e seria desligado na primeira semana — e um guard desligado é pior que nenhum,
porque dá a impressão de cobertura.

**Alternatives considered.** *`grep` por acento, ignorando linhas que começam com `//`.*
**Rejeitada:** não vê comentário de bloco, JSDoc, nem string multi-linha; e o falso positivo
mata o guard. *ESLint plugin de i18n.* **Rejeitada:** dependência nova para um problema que 60
linhas de Compiler API resolvem, e nenhum plugin conhece a convenção "comentário em português
é aceitável".

**Consequences.** O guard herda a precisão do parser. Constrange: strings montadas em runtime
(`` `${a} revisões` ``) só são vistas se o literal tiver marcador — declarado como limite.

### D2 — Rotas em inglês, com as antigas RESOLVENDO por redirect

**Decisão.** `/promptly/catalogo` → `/promptly/catalog`, `producao` → `production`, `consumo`
→ `consumption`. As três antigas viram `<Navigate replace>`.

**Rationale.** A URL é parte do que o usuário vê. E o precedente do Skills já decidiu o custo
de não quebrar links: um endereço colado num ticket, num favorito ou numa mensagem não pode
virar 404 porque o produto mudou de idioma.

**Alternatives considered.** *Trocar sem redirect.* **Rejeitada** pelo motivo acima.
*Manter as rotas em português e traduzir só a tela.* **Rejeitada:** deixaria a barra de
endereço contradizendo a aba que o usuário acabou de clicar.

**Consequences.** Três redirects a manter. Constrange pouco; o Skills já carrega três.

### D3 — Os nove arquivos com nome em português NÃO são renomeados

**Decisão.** `catalogo.tsx`, `tabs/producao.tsx`, `detail/revisoes-card.tsx` e os demais
mantêm o nome.

**Rationale.** Nome de arquivo não é interface. Renomear nove arquivos churna imports, quebra
`git log --follow` para quem não usa a flag, e não muda um pixel para o usuário. A DoD dos três
itens não pede isso — pedir mais que a DoD é escopo inventado (YAGNI, degrau 1 da ladder).

**Alternatives considered.** *Renomear junto, "já que estamos aqui".* **Rejeitada:** é
exatamente a frase que o `parsimony-ladder.md` nomeia como anti-pattern.

**Consequences.** Fica uma inconsistência interna visível a quem lê o repositório. Registrada
aqui em vez de silenciada, e disponível para virar item próprio se alguém a considerar cara.

### D4 — Sem framework de i18n

**Decisão.** As strings são traduzidas no lugar. Nenhuma biblioteca de internacionalização
entra.

**Rationale.** O pedido é *"o sistema deve estar em inglês"*, não *"o sistema deve suportar N
idiomas"*. Um framework de i18n para um único idioma é infraestrutura sem consumidor — a
generalização prematura que a ladder rejeita no degrau 1.

**Alternatives considered.** *Introduzir `react-i18next` agora "porque um dia vai precisar".*
**Rejeitada:** YAGNI explícito. Se o segundo idioma aparecer, as strings estarão em um idioma
só e extraí-las será mecânico — mais fácil do que hoje, não menos.

**Consequences.** Se um segundo idioma for pedido, haverá um passo de extração. Aceito.

### D5 — Tradução e localizador de teste mudam no MESMO commit

**Decisão.** Cada fatia traduz o código de produção e atualiza os localizadores dos seus
testes junto, no mesmo commit.

**Rationale.** 176 localizadores dependem do texto. Separar em dois commits deixa a suíte
vermelha entre eles — e uma suíte vermelha por design é como um time aprende a ignorar
vermelho. A rede de proteção só protege se estiver sempre esticada.

**Alternatives considered.** *Traduzir tudo, depois consertar os testes.* **Rejeitada** pelo
acima. *Afrouxar os localizadores para casar os dois idiomas.* **Rejeitada:** um localizador
que aceita qualquer coisa não afirma nada.

**Consequences.** Commits maiores. Aceito: a alternativa é uma janela vermelha.

## Drawbacks & Risks

| Risco | Severidade | Mitigação | Dono |
|---|---|---|---|
| Uma tradução muda o SENTIDO — texto de produto carrega decisão de produto, não só idioma | **Alta** | Traduzir preservando o que a frase afirma; onde o português diz algo que o inglês não tem palavra curta, manter a precisão e não a brevidade. Os testes cobrem comportamento, não nuance — a revisão humana no PR é o gate real | quem traduz |
| 176 localizadores quebram; um deles pode ser "consertado" para casar o texto errado e passar verde sobre uma tela quebrada | **Alta** | O localizador novo tem de casar a string nova EXATA; nenhum `/.*/ ` nem `toBeTruthy` entra como conserto | quem traduz |
| Um redirect esquecido transforma link salvo em 404 | Média | Teste e2e por rota antiga, na forma do que `skills-journey.spec.ts:829` já faz | quem migra |
| O guard tem falso positivo e alguém o desliga | Média | Marcadores inequívocos (acento + palavras que não existem em inglês); a lista de exceção exige motivo escrito, como em `cobertura-workflow-e2e.test.ts` | quem escreve o guard |
| Strings montadas em runtime escapam do scanner | Baixa | Declarado como limite conhecido no próprio guard; a varredura de tela em navegador é a rede complementar | — |

## Unresolved Questions

- Q1 — `Promptly` é nome de produto e permanece; mas *"Prompts"* no menu e *"prompt"* no corpo
  já são inglês. Nenhuma decisão pendente.
- Q2 — `/promptly/:name/diff` já está em inglês e fica. Confirmado por leitura das rotas.
- Q3 — A fixture em `src/lib/mocks` conta como interface? **Decidido:** sim, porque o dono
  valida telas em modo mock e ela aparece. Entra na fatia do resíduo.

## Dependency Graph

```
Fase 1 (guard, RED)  ──▶  Fase 2 (Promptly)  ──▶  Fase 3 (Trust)  ──▶  Fase 4 (resíduo)  ──▶  Fase 5 (validação)
```

O guard vem primeiro porque é ele que define "pronto" para as três fatias seguintes, e porque
nascer vermelho com 203 é o RED honesto deste plano.

---

## Phase 1: O guard existe e está vermelho

**Objective:** ter a medida antes de mexer no medido.

### T1.1 — RED: o guard acusa as 203

#### Why this step
O guard é o critério de fechamento dos três itens (é literalmente a DoD de `B-108`), e é o que
faltou no precedente `05132088` — sem ele, o Skills voltou a acumular 4 strings. Escrevê-lo
primeiro dá o número inicial e o alvo.

#### Files to edit
- `dashboard/src/lib/i18n-guard.ts` (NEW) — o scanner
- `dashboard/src/lib/i18n-guard.test.ts` (NEW) — o guard

#### TDD
`test_guard_acusa_string_de_interface_em_portugues` — o scanner sobre `src/` retorna > 0
achados hoje; o caso do guard falha nomeando arquivo e string.
`test_guard_ignora_comentario_em_portugues` — um arquivo de fixture com comentário em
português e interface em inglês produz zero achados. Sem este caso, o guard poderia estar
certo por acidente.

#### Acceptance criteria
- O guard falha hoje, com a lista dos arquivos.
- Um comentário em português não é acusado (provado por caso próprio).
- O guard não tem flag de bypass.

#### DoD
`npx vitest run src/lib/i18n-guard.test.ts` falha, e a mensagem nomeia `pages/promptly`.

---

## Phase 2: Promptly fala inglês (B-108)

### T2.1 — As 140 strings e os localizadores que dependem delas

#### Why this step
É a ilha maior e a tela que o dono mandou analisar. Traduz produção e teste no mesmo passo
(D5).

#### Files to edit
Os 18 arquivos de `src/pages/promptly/**` + os 10 arquivos de teste correspondentes
(unit e e2e) listados no Baseline Context.

#### TDD
Os testes existentes SÃO o RED: mudar a string quebra 176 localizadores, e cada um volta ao
verde casando a string nova exata. Nenhum localizador é afrouxado.

#### Acceptance criteria
- O scanner reporta 0 em `src/pages/promptly`.
- Nenhum localizador virou `/.*/`, `toBeTruthy` ou `getByTestId` só para passar.

#### DoD
`npx vitest run src/pages/promptly` e `npx playwright test e2e/promptly*` verdes.

### T2.2 — As três rotas em inglês, com as antigas resolvendo

#### Why this step
A URL é parte do que o usuário vê (D2), e o precedente do Skills já provou o custo de quebrar
link salvo.

#### Files to edit
- `dashboard/src/routes/promptly-routes.tsx`
- `dashboard/src/components/layout/app-sidebar-menus.ts`
- os arquivos de Promptly que constroem `to=`/`navigate()`
- `dashboard/e2e/promptly-abas-journey.spec.ts` (as abas e seus `href`)

#### TDD
`test_rota_antiga_redireciona_sem_virar_404` — para cada uma das três, na forma de
`skills-journey.spec.ts:829`.

#### Acceptance criteria
- `/promptly/catalogo`, `/producao` e `/consumo` respondem com redirect para a rota em inglês.
- Nenhum link interno aponta para a rota antiga.

#### DoD
Os três casos de redirect passam; a suíte e2e de promptly verde.

---

## Phase 3: Trust fala inglês (B-109)

### T3.1 — As 44 strings

#### Why this step
Segunda ilha. Independente da Fase 2 — Trust não tem rota nem arquivo em português, só
conteúdo —, então fecha sozinha.

#### Files to edit
`src/pages/trust/**` (7 arquivos) + `src/pages/trust/**/*.test.tsx` (4 arquivos).

#### TDD
Os 23 localizadores de Trust são o RED.

#### Acceptance criteria
- O scanner reporta 0 em `src/pages/trust`.

#### DoD
`npx vitest run src/pages/trust` verde.

---

## Phase 4: O resíduo (B-110)

### T4.1 — As 19 strings fora das ilhas

#### Why this step
São as que teste manual não acha — nenhuma apareceu na varredura de 20 rotas, o que indica
estado vazio ou de erro. É onde português escondido custa mais: aparece exatamente quando
alguém está tentando entender o que quebrou.

#### Files to edit
`pages/lens` (3 arquivos), `pages/skills` (2), `components/layout/app-sidebar-menus.ts`,
`pages/settings` (2), `app.tsx`, `lib/mocks` (1) + os testes correspondentes.

#### TDD
Os localizadores de `lens` e `layout` são o RED; para os estados que nenhum teste alcança, o
guard é o critério.

#### Acceptance criteria
- O scanner reporta **0 em `src/` inteiro**.

#### DoD
`npx vitest run src/lib/i18n-guard.test.ts` **verde**.

---

## Phase 5: Integration Validation

### T5.1 — A cadeia inteira

#### Why this step
"Eat your own cooking": o plano não está pronto porque cada fatia passou isolada.

#### DoD
- `npm test` exit 0
- `npm run typecheck` exit 0 (src e e2e)
- `npm run lint` 0 problemas
- `npx playwright test --project=chromium` sem falha
- Varredura de tela em navegador nas 20 rotas: zero marcador de português
- CHANGELOG atualizado sob `[Unreleased]`

## Coverage Matrix

| # | Requisito medido | Tarefa | Como fecha |
|---|---|---|---|
| 1 | 140 strings em `pages/promptly` | T2.1 | scanner reporta 0 na pasta |
| 2 | 3 rotas em português | T2.2 | rotas em inglês + 3 redirects testados |
| 3 | 44 strings em `pages/trust` | T3.1 | scanner reporta 0 na pasta |
| 4 | 19 strings de resíduo (lens 9, skills 4, layout 2, settings 2, app 1, mocks 1) | T4.1 | scanner reporta 0 em `src/` |
| 5 | 176 localizadores dependentes | T2.1, T3.1, T4.1 | suíte verde sem localizador afrouxado |
| 6 | Ausência de guard (a lição de `05132088`) | T1.1 | guard na suíte, sem bypass |

Cobertura: **6/6**.

## Global Definition of Done

- [ ] Scanner reporta **0** strings de interface em português em `src/`
- [ ] `npm test` sai 0
- [ ] `npm run typecheck` sai 0
- [ ] `npm run lint` sem erro
- [ ] `npx playwright test --project=chromium` sem falha
- [ ] As três rotas antigas de Promptly resolvem por redirect, com teste
- [ ] Nenhum localizador de teste foi afrouxado para passar
- [ ] Varredura em navegador das 20 rotas sem marcador de português
- [ ] CHANGELOG atualizado
- [ ] `B-108`, `B-109` e `B-110` marcados `shipped` com o fechamento medido

## Failure scenarios

(nenhum — o plano não toca I/O externo: é texto de interface, roteamento no cliente e testes.)
