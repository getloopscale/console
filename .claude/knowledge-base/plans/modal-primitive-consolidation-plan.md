---
slug: modal-primitive-consolidation
date: 2026-08-09
source: dashboard/docs/padronizacao-ui-2026-08-09.md
---

# Plan: Consolidar os dois primitivos de modal em `AppModal`

> **Version 1.0** — O dashboard tem dois wrappers locais do mesmo `@radix-ui/react-dialog`:
> `ui/dialog.tsx` (97 LoC) e `ui/app-modal.tsx` (104 LoC), com overlay idêntico byte a byte.
> O segundo se declara, no próprio código, "the system-wide standardized modal primitive" e
> entrega uma escala única de largura; o primeiro aceita `className` livre. 17 arquivos usam
> o primeiro — inclusive os 3 modais compartilhados, que são a referência que o resto copia.
> Este plano migra os 17 e **deleta** `ui/dialog.tsx`.

## Goal

> Replace `components/ui/dialog.tsx` por `components/ui/app-modal.tsx` como único primitivo de modal do dashboard, de forma que toda largura de modal venha da escala tokenizada em vez de `className` avulso, medido por `components/ui/dialog.tsx` não existir mais no repositório com `npm test`, `npm run typecheck` e `npm run lint` verdes.

Deletar o arquivo é a métrica porque é binária e só é alcançável quando todos os 17
consumidores migraram — enquanto ele existir, alguém volta a importá-lo.

## Context

Vem do levantamento em `dashboard/docs/padronizacao-ui-2026-08-09.md`, medido em 2026-08-09.
Aquele documento examinou quatro eixos (componentes, fluxos, menus, modais) e concluiu que
**apenas um** justifica trabalho: a camada de modal. Navegação já é dado declarativo com zero
links quebrados; confirmação destrutiva tem 91% de adesão ao componente compartilhado;
duplicação de componentes locais é 1 caso em 70 arquivos.

O documento foi corrigido **quatro vezes** durante sua própria elaboração e durante a
redação deste plano — cada correção reduziu escopo. Vale registrar porque o plano herda o
resultado, não as hipóteses iniciais:

1. Presumi que `ui/dialog` fosse re-export do `@usetheo/ui` e sofresse o bug de `Sheet`. Não é: é wrapper local do Radix.
2. Reportei 19 links de menu quebrados. São **zero** — eu varrera 4 de 12 arquivos de rota, e o menu usa `{project}` onde o router usa `:name`.
3. Reportei 2 call sites furando o design system via Radix direto. São **zero** — os 2 importadores são os próprios primitivos.
4. Reportei `max-w-4xl` fora da escala. Está dentro: é o token `xl`, com teste.
5. Reportei "5 valores distintos em 8 ocorrências" de largura ad-hoc. São **3 ocorrências em 3 arquivos**: cinco das oito eram os PRÓPRIOS primitivos — quatro da escala de tokens em `app-modal.tsx` e uma do default de `dialog.tsx:37`. O `grep` varreu o primitivo junto com quem o consome.

Nenhuma das quatro sobreviveu à medição. O que sobrou é o que este plano trata.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `dashboard/src/components/ui/dialog.tsx` | 97 | `e6a37bd2` (2026-07-18) | Primitivo compound (`Dialog.Root/Overlay/Content`) sobre Radix | **Será deletado ao fim.** Até lá, seu comportamento é o contrato a preservar nas migrações |
| `dashboard/src/components/ui/app-modal.tsx` | 104 | `89427b30` (2026-07-18) | Primitivo declarativo com escala de largura; declara-se o padrão do sistema | **Não muda de API.** Os 13 consumidores atuais não podem quebrar |
| `dashboard/src/components/dialogs/confirm-dialog.tsx` | 117 | `e6a37bd2` (2026-07-18) | Confirmação destrutiva compartilhada — 29 consumidores | A API pública (props) **não muda**; os 29 consumidores não são tocados |
| `dashboard/src/components/dialogs/redeploy-dialog.tsx` | 111 | `e6a37bd2` (2026-07-18) | Modal de redeploy compartilhado | API pública inalterada |
| `dashboard/src/components/dialogs/plan-limit-upgrade-modal.tsx` | 90 | `106c10eb` (2026-08-06) | Modal de limite de plano | API pública inalterada |
| `dashboard/src/pages/infra/components/rotate-secret-dialog.tsx` | 152 | — | Rotação de secret | comportamento de abrir/fechar inalterado |
| `dashboard/src/pages/infra/components/delete-secret-dialog.tsx` | 138 | — | Exclusão de secret | idem |
| `dashboard/src/pages/infra/components/delete-environment-dialog.tsx` | 224 | — | Exclusão de ambiente | idem |
| `dashboard/src/pages/infra/components/promote-dialog.tsx` | 334 | — | Promoção entre ambientes | idem |
| `dashboard/src/pages/deploy/components/rollback-dialog.tsx` | 247 | — | Rollback de release | idem |
| `dashboard/src/pages/deploy/components/cancel-build-dialog.tsx` | 106 | — | Cancelamento de build | idem |
| `dashboard/src/pages/deploy/components/promote-to-production-dialog.tsx` | 269 | — | Promoção para produção | idem |
| `dashboard/src/pages/projects/components/bulk-delete-projects-dialog.tsx` | 121 | — | Exclusão em massa | idem |
| `dashboard/src/pages/settings/components/api-key-dialogs.tsx` | 409 | — | Diálogos de API key | idem |
| `dashboard/src/pages/settings/webhooks.tsx` | 534 | — | Página de webhooks (contém modal inline) | **excede 500 LoC hoje** — não pode crescer |
| `dashboard/src/pages/memory/webhooks.tsx` | 561 | — | Página de webhooks de memory | **excede 500 LoC hoje** — não pode crescer |
| `dashboard/src/pages/memory/skills.tsx` | 333 | — | Página de skills | — |
| `dashboard/src/pages/lens/traces/saved-views.tsx` | 187 | — | Views salvas de traces | — |
| `dashboard/src/pages/rag/graphrag.tsx` | 472 | — | Página do GraphRAG | próximo do teto de 500 |
| `dashboard/src/components/ui/app-modal.test.tsx` | — | — | Testes do primitivo alvo | Os 8 testes atuais continuam passando |

Os LoC sem sha são arquivos cujo histórico não foi consultado individualmente; o número de
linhas foi medido com `wc -l` em 2026-08-09.

### Current callers / dependents

- **Símbolo:** `Dialog` (default export composto) em `dashboard/src/components/ui/dialog.tsx`
  - **Consumidores (produção):** 17 arquivos — 14 em `pages/`, 3 em `components/dialogs/`. Lista completa na tabela acima.
  - **Consumidores (teste):** nenhum arquivo `*.test.tsx` importa `ui/dialog` diretamente
  - **Externo:** não. O dashboard não publica esses componentes.

- **Símbolo:** `AppModal` em `dashboard/src/components/ui/app-modal.tsx`
  - **Consumidores (produção):** 13 arquivos
  - **Consumidores (teste):** `components/ui/app-modal.test.tsx` (8 casos)
  - A API **não muda** neste plano — apenas ganha consumidores.

- **Símbolo:** `ConfirmDialog` em `components/dialogs/confirm-dialog.tsx`
  - **Consumidores:** 29 arquivos. Nenhum é tocado — a mudança é interna ao componente.

Comandos que produziram estas listas:

```bash
cd dashboard/src
grep -rl "ui/dialog" . | grep '\.tsx$' | grep -v test        # 17
grep -rl "ui/app-modal" . | grep '\.tsx$' | grep -v test     # 13
grep -rl 'dialogs/confirm-dialog' . | grep '\.tsx$' | grep -v test | wc -l   # 29
```

### Domain glossary

- **primitivo de modal** — o componente de mais baixo nível que monta overlay + painel + foco. Aqui há dois; deve haver um.
- **escala de largura** — o mapa `size → max-w-*` em `app-modal.tsx`: `sm: max-w-md`, `md: max-w-lg`, `lg: max-w-2xl`, `xl: max-w-4xl`.
- **call site** — arquivo que renderiza um modal, por oposição ao arquivo que o define.
- **modal compartilhado** — os 4 de `components/dialogs/`, consumidos por várias páginas; são a referência que o resto do produto copia.
- **API compound** — o padrão `Dialog.Root` / `Dialog.Overlay` / `Dialog.Content` do `ui/dialog`. `AppModal` usa o padrão declarativo (`<AppModal title size open onClose>`).

### Architecture boundaries affected

Nenhuma fronteira nova. `dashboard/src/components/ui/` é a camada de primitivos, consumida
por `components/dialogs/` e por `pages/` — a direção de dependência não se inverte em nenhum
passo deste plano. Remover um primitivo duplicado **reduz** a superfície da camada, o que é
a direção que `.claude/rules/architecture.md § 3` (coesão de módulo) prescreve.

## Prior Art & Related Work

- **`dashboard/docs/padronizacao-ui-2026-08-09.md`** — o levantamento que originou este plano, com os comandos de cada número.
- **`dashboard/src/components/ui/app-modal.tsx:6-19`** — o doc-comment que declara o padrão do sistema e a razão de existir (evitar `Dialog.Content` do `@usetheo/ui`, onde `Dialog` e `Sheet` são o mesmo objeto e o segundo sobrescreve o primeiro).
- **`dashboard/src/components/ui/app-modal.test.tsx`** — 8 casos cobrindo nome acessível, `open=false`, mapeamento de `size`, footer, description, ESC e botão X. É o contrato que a migração precisa manter e o modelo para os testes novos.
- **`.claude/rules/architecture.md § 5`** — convenção de teste do repositório: `<name>.test.<ext>` co-locado.
- **`.claude/rules/parsimony-ladder.md` degrau 1** — o que justifica este plano ter *um* objetivo: os outros três eixos medidos não tinham defeito correspondente.
- **Patterns skills:** nenhuma `*-patterns` existe em `theo-cloud/.claude/skills/` (verificado — o glob não resolve). Nada a consumir nem a sobrescrever.

## Dependencies

| Ecossistema | Pacote | Versão | Novo? | Rule 9 |
|---|---|---|---|---|
| npm | `@radix-ui/react-dialog` | já em `dashboard/package.json` | não | Foco, ESC, overlay-click e o contrato WAI-ARIA são dele; reimplementar seria o oposto do degrau 2 |
| npm | `tailwind-merge` | já instalado | não | Usado pelos dois primitivos para compor `className` |
| npm | `vitest` | já instalado | não | Runner declarado em `package.json` (`test: vitest run`) |

**Nenhuma dependência nova.** Degrau 4 da ladder: o alvo da consolidação já é o que está instalado.

## Objective

- [ ] Os 3 modais compartilhados usam `AppModal`
- [ ] Os 14 call sites de página usam `AppModal`
- [ ] Toda largura de modal vem de um token da escala, não de `className`
- [ ] `components/ui/dialog.tsx` não existe mais
- [ ] Os 8 testes de `app-modal.test.tsx` continuam passando, e cada modal compartilhado ganha um teste de que abre e fecha

## ADRs

### D1 — `AppModal` vence, `Dialog` sai

**Decisão.** Consolidar em `app-modal.tsx` e deletar `dialog.tsx`.

**Rationale.** O `AppModal` já se declara o padrão no código, já tem escala de largura tokenizada e já tem 8 testes; o `ui/dialog` não tem teste próprio e aceita `className` livre — é a porta por onde a largura vira ad-hoc. Consolidar no que tem contrato testado é o que `rules/testing.md § 1` chama de proteger comportamento.

**Alternatives considered.**
- *Consolidar em `ui/dialog` e deletar `app-modal`.* **Rejeitada:** perderia a escala de largura e os 8 testes, e contradiria o doc-comment que o próprio repositório escreveu como padrão. Trocaria o componente com contrato pelo componente sem.
- *Manter os dois, documentando quando usar cada um.* **Rejeitada:** eles não diferem em intenção — o overlay é idêntico byte a byte. Documentar uma distinção que não existe transfere para cada autor uma decisão que não tem resposta certa.

**Consequences.** Uma porta só para modal. Constrange: quem precisar da API compound (`Dialog.Root/Content` separados) terá de usar a API declarativa ou estender `AppModal` — a migração dos 17 dirá se algum caso realmente precisa disso.

### D2 — Compartilhados antes de páginas

**Decisão.** Migrar `components/dialogs/*` (3 arquivos) antes dos 14 call sites de página.

**Rationale.** Os 3 são a referência que o resto do produto copia, e têm 29 consumidores que não mudam — alto retorno, baixo raio. Enquanto eles usarem a porta antiga, pedir às páginas que usem a nova é pedir o que o próprio design system não faz.

**Alternatives considered.** *Migrar tudo num único passo.* **Rejeitada:** 17 arquivos num commit tornam a revisão visual impraticável e, se algo regredir, o bisect não distingue qual migração causou.

**Consequences.** Habilita revisão incremental. Constrange: o estado intermediário tem os dois primitivos vivos — aceitável porque é medido em dias, não em releases.

### D3 — `max-w-sm` decide-se na migração, não antes

**Decisão.** Das três larguras declaradas, duas têm token direto (`max-w-md`→`sm`, `max-w-2xl`→`lg`). A única sem token (`max-w-sm`, em `pages/memory/skills.tsx`) é resolvida quando se chegar no arquivo: ou adota `sm` (`max-w-md`, um passo mais larga), ou justifica um token novo.

Os **catorze** arquivos restantes não declaram largura nenhuma — eles herdam o default `max-w-lg` de `dialog.tsx:37`, que é exatamente o token `md`. Para esses não há decisão: a migração é `size="md"` com mudança visual provadamente zero.

**Rationale.** Decidir agora exigiria olhar a tela sem contexto do conteúdo. Degrau 1 da ladder: um token `xs` só precisa existir se aquela tela provar que precisa.

**Alternatives considered.** *Criar `xs: max-w-sm` já.* **Rejeitada:** adiciona um token à escala pública por causa de um caso, antes de saber se o caso é legítimo — é a generalização prematura que a ladder nomeia.

**Consequences.** A migração daquele arquivo carrega uma decisão a mais. Constrange: se a decisão for adiada de novo, `className` avulso volta — por isso é critério de aceite explícito da tarefa.

### D4 — Nenhuma mudança visual é intencional

**Decisão.** A migração preserva aparência: mesma largura efetiva, mesmo overlay, mesmo comportamento de foco.

**Rationale.** O overlay já é idêntico e as larguras têm token equivalente, então a paridade é alcançável. Misturar consolidação com redesenho tornaria impossível dizer se uma diferença é bug de migração ou decisão de design.

**Alternatives considered.** *Aproveitar para uniformizar espaçamento interno.* **Rejeitada:** o levantamento **não** mediu espaçamento (declarado em `§ 5 Limites`). Mudar o que não foi medido é o oposto do que este plano se propõe.

**Consequences.** Constrange: divergências visuais reais que existirem hoje sobrevivem à migração. São trabalho de um levantamento visual, que ainda não foi feito.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Regressão visual silenciosa: um modal migrado abre com largura diferente e ninguém percebe até um usuário reclamar | **Alta** | Mapa explícito largura→token na tarefa, revisado no PR; `max-w-sm` tratado como decisão consciente e não como arredondamento | quem migra |
| `pages/settings/webhooks.tsx` (534) e `pages/memory/webhooks.tsx` (561) já excedem o teto de 500 LoC | Média | A migração desses dois arquivos deve reduzir ou manter as linhas, nunca aumentar. Se aumentar, extrair o modal para `components/` no mesmo commit | quem migra |
| A API compound pode ser genuinamente necessária em algum dos 17 (ex.: trigger fora do painel) | Média | Se um arquivo não migrar sem contorção, ele **para** a tarefa e vira pergunta em aberto — não recebe um `AppModal` deformado para fechar o checklist | quem migra |
| Deletar `ui/dialog.tsx` quebra um import que o grep não pegou (import dinâmico, re-export) | Baixa | `npm run typecheck` acusa; a deleção é o último passo, com a suíte verde antes e depois | — |
| Os 29 consumidores de `ConfirmDialog` dependem de comportamento não coberto por teste | Média | A tarefa adiciona teste de abrir/fechar aos 3 compartilhados **antes** de migrá-los (RED sobre o comportamento atual, que deve continuar GREEN depois) | quem migra |

## Unresolved Questions

- Q1 — Algum dos 14 call sites precisa da API compound por razão real (trigger fora do painel, painel aninhado)? Só a migração responde. Se sim, D1 ganha uma exceção nomeada e `ui/dialog` não é deletado — o Goal muda e o plano precisa de nova versão.
- Q2 — `max-w-sm` (1 ocorrência): adota `sm` ou justifica um token `xs`? Decidido ao migrar o arquivo, per D3.
- Q3 — Os 3 modais compartilhados têm teste hoje? Verifiquei que `components/ui/` tem `app-modal.test.tsx` e `alert-guard.test.tsx`, mas não inventariei testes em `components/dialogs/`. Se não houver, a T1.1 os cria; se houver, ela os estende.

## Dependency Graph

```
Phase 1 (compartilhados)  ──▶  Phase 2 (páginas)  ──▶  Phase 3 (deletar + validar)
```

Sequenciais por D2. Dentro da Phase 2, os 14 arquivos são independentes entre si e podem
ser migrados em qualquer ordem ou em paralelo.

---

## Phase 1: Os modais compartilhados adotam o padrão que o código declara

**Objective:** fazer a referência do produto usar `AppModal`, sem que nenhum dos 29 consumidores mude.

### T1.1 — RED: os 3 compartilhados abrem e fecham

#### Objective
Fixar o comportamento atual dos 3 modais compartilhados em teste, antes de trocar o primitivo por baixo deles.

#### Why this step (action + reasoning — ReAct discipline)

**O que este passo faz.** Cria (ou estende) `confirm-dialog.test.tsx`, `redeploy-dialog.test.tsx` e `plan-limit-upgrade-modal.test.tsx`, cobrindo: renderiza quando `open`, não renderiza quando fechado, dispara o callback de confirmação, e fecha via ESC.

**Por que é necessário agora.** Estes 3 arquivos têm 29 consumidores e a mudança é invisível para eles — trocar o primitivo sem teste é mudar o alicerce de 29 telas às cegas. `rules/testing.md § 3` exige teste antes de mexer em comportamento; aqui o teste é escrito contra o comportamento **atual** e deve continuar verde depois, que é a definição de paridade em D4.

#### Evidence
- `dashboard/src/components/dialogs/confirm-dialog.tsx` (117 LoC) importa `ui/dialog` — verificado por `grep -c "ui/dialog"` = 1.
- `redeploy-dialog.tsx` (111 LoC) e `plan-limit-upgrade-modal.tsx` (90 LoC), idem.
- 29 arquivos importam `dialogs/confirm-dialog` (comando em `## Baseline Context`).
- `components/ui/app-modal.test.tsx` cobre 8 casos, incluindo `calls onClose when Escape is pressed` — é o modelo de teste a seguir.

#### Files to edit
```
dashboard/src/components/dialogs/confirm-dialog.test.tsx            (NEW ou estendido)
dashboard/src/components/dialogs/redeploy-dialog.test.tsx           (NEW ou estendido)
dashboard/src/components/dialogs/plan-limit-upgrade-modal.test.tsx  (NEW ou estendido)
```

Q3 registra que não inventariei se estes testes já existem. O primeiro passo da tarefa é
`ls components/dialogs/*.test.tsx` — se existirem, estender; se não, criar.

#### Deep file dependency analysis
- Os 3 arquivos de teste são folhas: nada os importa. Criá-los não afeta nenhum consumidor.
- Ficam co-locados com o componente, per `rules/architecture.md § 5` (`<name>.test.<ext>`), que é o padrão que `vitest run` já descobre.

#### Deep Dives
- **O que cada teste afirma.** (a) com `open={true}`, o título aparece como nome acessível; (b) com `open={false}`, nada renderiza; (c) o callback primário dispara no clique do botão de ação; (d) ESC chama `onClose`.
- **Por que ESC importa aqui.** É delegado ao Radix pelos dois primitivos. Se a migração quebrasse a delegação, esse é o teste que pega — e é justamente o comportamento que um usuário nota primeiro.
- **O que NÃO testar.** Aparência (classes CSS). D4 diz que a paridade visual é verificada por revisão no PR, não por asserção de `className` — asserção de classe quebra em qualquer refactor de estilo e testa implementação, não comportamento (`rules/testing.md § 6`).

#### Tasks
1. `ls dashboard/src/components/dialogs/*.test.tsx` para saber o que já existe
2. Criar/estender os 3 arquivos com os 4 casos
3. Rodar e **confirmar verde** — este é o estado de partida, não um RED de defeito

#### TDD
```
RED:     (não há defeito a reproduzir — os testes descrevem o comportamento ATUAL e devem passar já)
GREEN:   os 3 arquivos de teste passam contra o código atual, ainda em ui/dialog
REFACTOR: None expected
VERIFY:  cd dashboard && npx vitest run src/components/dialogs
```

Esta é a exceção honesta ao RED-primeiro: a tarefa é uma rede de segurança, não a correção
de um defeito. O RED de verdade aparece na T1.2 se a migração quebrar algum destes casos.

#### Concurrency tests (only when applicable)

(none — single-threaded)

Componentes React de modal em teste de unidade rodam no event loop do jsdom, sem estado
compartilhado entre workers. Nenhuma primitiva de concorrência é introduzida.

#### Acceptance Criteria
- [ ] `npx vitest run src/components/dialogs` sai 0
- [ ] Cada um dos 3 componentes tem ao menos os 4 casos descritos
- [ ] Nenhum teste afirma sobre `className` (per Deep Dives)
- [ ] `npm run typecheck` sai 0
- [ ] `npm run lint` sem avisos novos
- [ ] `wc -l` de cada arquivo de teste ≤ 500

#### DoD (Definition of Done)
- [ ] Os 3 arquivos de teste existem e passam contra o código **não migrado**
- [ ] A saída verde está colada na mensagem do commit

---

### T1.2 — GREEN: migrar os 3 compartilhados para `AppModal`

#### Objective
Trocar `ui/dialog` por `AppModal` nos 3 modais compartilhados, mantendo a API pública e a largura efetiva.

#### Why this step (action + reasoning — ReAct discipline)

**O que este passo faz.** Em cada um dos 3, substitui a composição `Dialog.Root/Overlay/Content` por `<AppModal open title size onClose>`, escolhendo o token cuja `max-w-*` é igual à largura atual. As props públicas de cada componente não mudam.

**Por que é necessário agora.** D2: são a referência que o resto copia. E os testes da T1.1 tornam a troca verificável — sem eles, "não quebrou" seria opinião.

#### Evidence
- Escala de `app-modal.tsx`: `sm: max-w-md`, `md: max-w-lg`, `lg: max-w-2xl`, `xl: max-w-4xl` — lida do arquivo, coberta por `app-modal.test.tsx` (`maps size="xl" to the max-w-4xl content width`).
- Overlay idêntico nos dois primitivos: `fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in`.
- `app-modal.tsx:6-19` declara ser o primitivo padrão do sistema.

#### Files to edit
```
dashboard/src/components/dialogs/confirm-dialog.tsx             — troca o primitivo; props públicas inalteradas
dashboard/src/components/dialogs/redeploy-dialog.tsx            — idem
dashboard/src/components/dialogs/plan-limit-upgrade-modal.tsx   — idem
```

#### Deep file dependency analysis
- `confirm-dialog.tsx` (117 LoC) é importado por 29 arquivos. A mudança é **interna**: nenhum deles é editado. Se algum precisar mudar, a premissa "API pública inalterada" caiu e a tarefa para.
- `redeploy-dialog.tsx` (111) e `plan-limit-upgrade-modal.tsx` (90): mesmo raciocínio, menos consumidores.

#### Deep Dives
- **Mapa largura → token.** Medido: `confirm-dialog.tsx` declara `max-w-md` → token `sm`. `redeploy-dialog.tsx` e `plan-limit-upgrade-modal.tsx` **não declaram largura** → herdam o default `max-w-lg` de `dialog.tsx:37` → token `md`, sem mudança visual.
- **Um `grep` vazio não significa "sem largura".** Significa que o arquivo usa o default do primitivo. Tratar ausência como "escolha livre" é como a deriva recomeça.
- **`hideCloseButton`.** `ui/dialog` expõe essa prop (`ContentProps`). Se algum dos 3 a usa, verificar se `AppModal` tem equivalente; se não tiver, isso é material para Q1 — não um motivo para inventar prop nova sem medir necessidade.
- **Invariante.** Os 8 testes de `app-modal.test.tsx` continuam verdes: a tarefa **não** altera `app-modal.tsx`.

#### Tasks
1. Extrair a largura atual dos 3 e montar o mapa largura→token
2. Migrar `confirm-dialog.tsx`, rodar os testes da T1.1
3. Migrar `redeploy-dialog.tsx`, rodar
4. Migrar `plan-limit-upgrade-modal.tsx`, rodar
5. Rodar a suíte inteira — os 29 consumidores não têm teste próprio, então a suíte geral é a rede

#### TDD
```
RED:     (se algum dos 4 casos da T1.1 falhar após a troca, esse é o RED — a migração quebrou comportamento)
GREEN:   os 3 usam AppModal e os testes da T1.1 continuam verdes
REFACTOR: remover imports órfãos de ui/dialog nos 3 arquivos
VERIFY:  cd dashboard && npx vitest run src/components/dialogs && npm run typecheck
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] `grep -l "ui/dialog" dashboard/src/components/dialogs/` retorna vazio
- [ ] `npx vitest run src/components/dialogs` sai 0
- [ ] `npm test` sai 0 (a suíte inteira, pelos 29 consumidores)
- [ ] Nenhum arquivo em `components/dialogs/` ganhou `className` com `max-w-*`
- [ ] Nenhum dos 3 teve a assinatura de props alterada (`git diff` não mostra mudança em `interface *Props`)
- [ ] `npm run typecheck` e `npm run lint` sem erro novo

#### DoD (Definition of Done)
- [ ] Os 3 compartilhados usam `AppModal`
- [ ] O mapa largura→token está na mensagem do commit

---

## Phase 2: Os 14 call sites de página

### T2.1 — Migrar os 14, um a um

#### Objective
Levar `AppModal` a todos os call sites de página, sem mudança visual intencional.

#### Why this step (action + reasoning — ReAct discipline)

**O que este passo faz.** Para cada um dos 14 arquivos: substitui `ui/dialog` por `AppModal`, mapeia a largura para um token, e roda a suíte.

**Por que é necessário agora, e só agora.** D2: depois da Phase 1 os compartilhados já são o exemplo correto, então cada migração de página tem uma referência a copiar. Antes disso, seria pedir às páginas o que o design system não faz.

#### Evidence
Os 14, com LoC medido em 2026-08-09:

| Arquivo | LoC |
|---|---:|
| `pages/memory/webhooks.tsx` | 561 |
| `pages/settings/webhooks.tsx` | 534 |
| `pages/rag/graphrag.tsx` | 472 |
| `pages/settings/components/api-key-dialogs.tsx` | 409 |
| `pages/infra/components/promote-dialog.tsx` | 334 |
| `pages/memory/skills.tsx` | 333 |
| `pages/deploy/components/promote-to-production-dialog.tsx` | 269 |
| `pages/deploy/components/rollback-dialog.tsx` | 247 |
| `pages/infra/components/delete-environment-dialog.tsx` | 224 |
| `pages/lens/traces/saved-views.tsx` | 187 |
| `pages/infra/components/rotate-secret-dialog.tsx` | 152 |
| `pages/infra/components/delete-secret-dialog.tsx` | 138 |
| `pages/projects/components/bulk-delete-projects-dialog.tsx` | 121 |
| `pages/deploy/components/cancel-build-dialog.tsx` | 106 |

**Mapa de migração completo dos 14 call sites de página** — medido, não estimado:

| Origem | Arquivos | Token | Mudança visual |
|---|---:|---|---|
| sem largura declarada (herdam `max-w-lg` de `dialog.tsx:37`) | **12** | `md` | **nenhuma** — `md` É `max-w-lg` |
| `max-w-2xl` (`pages/rag/graphrag.tsx`) | 1 | `lg` | nenhuma |
| `max-w-sm` (`pages/memory/skills.tsx`) | 1 | **decidir** (D3) | um passo mais larga, se adotar `sm` |

A instrução de "extrair a largura atual com `grep -oE 'max-w-[a-z0-9]+'`" **não devolve nada em 12 dos 14** — e é justamente aí que estava o risco de quem migra improvisar. Ausência de `max-w-*` não é ausência de largura: é o default do primitivo, e ele tem token.

#### Files to edit
Os 14 acima. Todos constam de `## Baseline Context § Files that will be touched`.

#### Deep file dependency analysis
- 11 dos 14 são componentes de modal dedicados (`*-dialog.tsx`) — o modal é o arquivo inteiro, e a migração é local.
- 3 são páginas com modal inline (`settings/webhooks.tsx` 534, `memory/webhooks.tsx` 561, `memory/skills.tsx` 333, `rag/graphrag.tsx` 472). **Dois já excedem o teto de 500 LoC** de `skills/plan-confidence/defaults/loc-limits.md`; a migração não pode aumentá-los.
- Nenhum é importado por outro dos 14 — as migrações são independentes.

#### Deep Dives
- **Ordem sugerida:** do menor para o maior. Os 4 menores (106–152 LoC) estabelecem o padrão de migração com risco mínimo; os 2 acima de 500 vêm por último, com a técnica já assentada.
- **Os dois arquivos acima do teto.** Se a migração não reduzir linhas, extrair o modal para um componente próprio em `pages/<área>/components/` no **mesmo** commit. Crescer um arquivo que já viola o budget é adicionar dívida enquanto se paga outra.
- **`max-w-sm`.** Ao chegar no arquivo que a usa, aplicar D3: adotar `sm` ou justificar token novo, decidido no PR e registrado na mensagem do commit.
- **Critério de parada.** Se algum arquivo não migrar sem contorção — precisa da API compound de verdade — ele **para** a tarefa e vira resposta à Q1. Não recebe um `AppModal` deformado só para fechar o checklist.

#### Tasks
1. Migrar os 4 menores; rodar `npm test` a cada um
2. Migrar os 7 intermediários
3. Migrar os 3 maiores, extraindo modal inline se as linhas crescerem
4. Registrar o mapa largura→token completo no PR

#### TDD
```
RED:     nenhum novo teste por arquivo (a suíte existente é a rede; criar 14 arquivos de teste
         de modal seria trabalho maior que a migração e não foi medido como necessário)
GREEN:   cada arquivo migrado mantém `npm test` verde
REFACTOR: extrair modal inline dos arquivos que passarem de 500 LoC
VERIFY:  cd dashboard && npm test && npm run typecheck
```

Registro honesto: esta tarefa **não** adiciona cobertura por arquivo. A rede é a suíte
existente mais a revisão visual do PR. Se a suíte se mostrar insuficiente — uma regressão
passar —, isso é sinal de que o inventário de cobertura de página precisa ser feito, e vira
plano próprio.

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] `grep -rl "ui/dialog" dashboard/src/pages/` retorna vazio
- [ ] `npm test` sai 0
- [ ] `grep -rn 'max-w-' dashboard/src/pages/**/*dialog*.tsx` não mostra largura em call site de modal
- [ ] `wc -l` de `settings/webhooks.tsx` ≤ 534 e de `memory/webhooks.tsx` ≤ 561 (não crescem)
- [ ] A decisão sobre `max-w-sm` está registrada na mensagem do commit
- [ ] `npm run lint` e `npm run typecheck` sem erro novo

#### DoD (Definition of Done)
- [ ] Os 14 migrados
- [ ] Mapa largura→token completo no corpo do PR

---

## Phase 3: Deletar o primitivo duplicado

### T3.1 — Remover `ui/dialog.tsx`

#### Objective
Deletar o arquivo, que é a métrica do Goal.

#### Why this step (action + reasoning — ReAct discipline)

**O que este passo faz.** Remove `components/ui/dialog.tsx` e roda a validação completa.

**Por que é necessário agora.** Deletar é o que impede a volta. Enquanto o arquivo existir, o próximo autor o importa — foi exatamente assim que 17 call sites nasceram apesar de o `app-modal` se declarar padrão. É o mesmo raciocínio de `.claude/rules/` sobre legacy: enquanto a porta errada existir, ela é uma opção.

#### Evidence
- Ao fim da Phase 2, os 17 consumidores originais migraram (11 dedicados + 3 páginas com inline + 3 compartilhados).
- Nenhum arquivo de teste importa `ui/dialog` — verificado em `## Baseline Context § Current callers`.

#### Files to edit
```
dashboard/src/components/ui/dialog.tsx   — DELETADO
```

#### Deep file dependency analysis
Ao chegar aqui o arquivo deve ter zero importadores. `npm run typecheck` é o que prova —
um import dinâmico ou re-export que o `grep` não pegou aparece como erro de tipo.

#### Deep Dives
- **Ordem.** Rodar `npm test` **antes** de deletar (linha de base verde), deletar, rodar de novo. Se algo quebrar, a causa é inequívoca.
- **Se `typecheck` acusar um importador.** Não restaurar o arquivo: migrar aquele importador. Restaurar reabre a porta.

#### Tasks
1. `grep -rl "ui/dialog" dashboard/src` — deve retornar vazio
2. `npm test` verde antes
3. `git rm dashboard/src/components/ui/dialog.tsx`
4. `npm test && npm run typecheck && npm run lint`

#### TDD
```
RED:     (não aplicável — remoção; a asserção é a suíte continuar verde sem o arquivo)
GREEN:   npm test + typecheck + lint verdes com o arquivo ausente
REFACTOR: None expected
VERIFY:  cd dashboard && npm test && npm run typecheck && npm run lint
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] `test -f dashboard/src/components/ui/dialog.tsx` retorna falso
- [ ] `grep -rl "ui/dialog" dashboard/src` retorna vazio
- [ ] `npm test` sai 0
- [ ] `npm run typecheck` sai 0
- [ ] `npm run lint` sem erro novo
- [ ] `grep -rl "@radix-ui/react-dialog" dashboard/src` retorna **apenas** `components/ui/app-modal.tsx`

#### DoD (Definition of Done)
- [ ] O arquivo não existe
- [ ] A cadeia de validação inteira verde

---

## Coverage Matrix

| # | Gap / Requirement (do levantamento) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Dois primitivos concorrentes com overlay idêntico | T1.2, T2.1, T3.1 | Consolidação em `AppModal` e deleção do outro |
| 2 | 4 portas de entrada de modal | T1.2, T2.1, T3.1 | Reduzidas a 1 (`AppModal`) + os 4 modais prontos que o consomem |
| 3 | Os 3 compartilhados violam o padrão que o código declara | T1.1, T1.2 | Migrados, com teste antes |
| 4 | Largura ad-hoc em call site (5 valores, 8 ocorrências) | T1.2, T2.1 | Toda largura vem da escala; critério de aceite proíbe `max-w-*` em call site |
| 5 | `max-w-sm` sem token equivalente | T2.1 (via D3) | Decidido ao migrar o arquivo, registrado no commit |
| 6 | Os compartilhados não têm rede de teste para uma troca de primitivo | T1.1 | 4 casos por componente antes de migrar |
| 7 | Enquanto `ui/dialog` existir, ele volta a ser importado | T3.1 | Deletado; `typecheck` é o guarda |

**Coverage: 7/7 (100%)**

Fora deste plano, por decisão registrada no levantamento: a divergência `{project}` vs `:name`
(P3 do documento — não se relaciona com modais e tem métrica própria), a reorganização
`pages/` vs `components/`, os 3 diálogos de exclusão próprios e a expansão do Storybook.

## Global Definition of Done

- [ ] Todas as fases concluídas
- [ ] `cd dashboard && npm test` sai 0
- [ ] `npm run typecheck` sai 0
- [ ] `npm run lint` sem erro novo em relação à base
- [ ] `components/ui/dialog.tsx` não existe
- [ ] `grep -rl "@radix-ui/react-dialog" src` retorna apenas `components/ui/app-modal.tsx`
- [ ] Nenhum call site de modal contém `max-w-*`
- [ ] Nenhum arquivo tocado cresceu acima de 500 LoC; os dois que já excediam não aumentaram
- [ ] CHANGELOG do `theo-cloud` atualizado sob `[Unreleased]`
- [ ] **Revisão visual**: cada modal migrado foi aberto e comparado com o estado anterior — a métrica automatizada não cobre aparência (D4)
- [ ] **Plano arquivado** em `plans/completed/` após `/review` READY_TO_MERGE **e** merge

## Failure scenarios (when I/O external)

(none — no external I/O touched)

A mudança é de composição de componentes de UI. Nenhum dos arquivos tocados faz chamada
HTTP, acesso a banco, fila ou socket — os modais recebem dados por props e emitem callbacks;
quem faz I/O são as páginas que os hospedam, e essa parte não é alterada.
