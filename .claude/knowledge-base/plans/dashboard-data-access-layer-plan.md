---
milestone_id:
slug: dashboard-data-access-layer
covers: B-012, B-029, B-052, B-053
date: 2026-08-07
---

# Plan: Camada de acesso a dados por domínio no dashboard

> **Version 1.1 — EXECUTADO em 2026-08-07.** Métrica atingida: 19 → 0.
>
> **Version 1.0** — Hoje 64 arquivos de `src/pages` chamam o transporte HTTP diretamente, e três domínios (`trust`, `skills`, `promptly`) já têm um arquivo de acesso a dados pela metade: eles exportam transporte mas nenhuma query key, então cada página que os consome reescreve o `useQuery` à mão. Este plano move o acesso a dados das páginas para hooks por domínio, com query key vinda da factory, zerando as 19 páginas que montam o `useQuery` à mão e eliminando a segunda fonte de verdade que os três `*-api.ts` criaram. O resultado observável é um teste de guarda que falha quando uma página volta a importar o transporte.

## Goal

> Reduzir de **19 para 0** as páginas que consomem um `*-api.ts` e montam o `useQuery` à mão, medido por `src/lib/data-access-layer.test.ts` passando com `TETO_PAGINAS_COM_QUERY_MANUAL = 0`.

**Nota sobre o número — duas correções, ambas por medição.**

A v1.0 dizia "64 → ≤ 20". Dois defeitos, achados ao implementar a Fase 0 e corrigidos antes de escrever qualquer hook:

1. **O 64 era falso.** Veio de `grep -rl "cloudFetch\|engineFetch"`, que casa qualquer ocorrência — inclusive comentário. O guard, que casa o BLOCO de import, mede **58**. Os 7 de diferença são prosa: quatro deles dizem explicitamente que *pararam* de usar transporte (`"passa pelo hook de mutation em vez do engineFetch cru"`), e um injeta `cloudFetch` como dependência, que é o padrão certo. Contar comentário foi a classe de erro que este repositório vem apanhando o dia todo, agora dentro de um plano.

2. **A métrica não media as fases.** Medido: **zero** das 19 páginas dos três domínios importa transporte direto — elas importam o `*-api.ts`, e é ele que importa. Migrar as 19 moveria o número de páginas-com-transporte em **zero**. O Goal e as fases estavam desconectados, e o plano teria chegado à Fase 3 com todas as tarefas feitas e a métrica intacta.

A métrica correta para o trabalho que este plano faz é a que ele de fato move: **19 páginas consomem um `*-api.ts` e montam o `useQuery` à mão** (medido; são exatamente as 5+8+6 das três fases). Zerar isso é o que significa "a camada existe".

O número de páginas-com-transporte (58) continua sendo medido pelo mesmo arquivo de guard, com teto próprio que só desce — ele é a métrica de B-012/B-029, que **outro** plano move. Manter os dois no mesmo arquivo é deliberado: são o mesmo fenômeno em duas escalas, e separá-los faria alguém medir um e achar que mediu o outro.

## Context

Quatro itens do `BACKLOG.md` descrevem o mesmo fenômeno por lentes diferentes, e a auditoria os registrou separados porque cada corner mediu uma consequência:

- **B-012** contou os call sites: acesso a dados vive nas páginas.
- **B-029** contou o fan-in do módulo de transporte: `src/lib/http/api.ts` é inexcisável.
- **B-052** achou a camada pela metade: três `*-api.ts` que exportam transporte e não query key.
- **B-053** mediu a massa: `src/pages` concentra 47.569 LOC contra 5.263 em `src/hooks`.

O `ADR-0006` (status `proposed`, 2026-08-06) já registrou a decisão de ter camada de acesso a dados por feature com factory de query key obrigatória. Ele nunca foi executado — este plano é a execução dele.

**Os números da auditoria estão desatualizados e foram remedidos em 2026-08-07.** A reorganização do `ADR-0001` mudou o terreno: B-012 dizia "58 arquivos de pages e 13 de components"; hoje são **64 em pages e 0 em components**. B-029 dizia 151 importadores de `src/lib/api.ts`; hoje são **99** de `src/lib/http/api.ts`. Planejar contra o número velho produziria uma métrica que já nasce falsa.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `dashboard/src/lib/api/query-keys.ts` | 79 | `9ed5d206` (2026-08-07) | Factory canônica de query key (ADR-0006) | As chaves existentes NÃO mudam de forma — `query-key-convergence.test.ts` falha se duas convenções coexistirem |
| `dashboard/src/pages/trust/components/trust-api.ts` | 91 | `b423ae99` (2026-08-07) | 8 exports de transporte para o domínio trust; **0 query keys** | As funções de transporte seguem chamáveis enquanto houver consumidor não migrado |
| `dashboard/src/pages/skills/components/skills-api.ts` | 350 | `b423ae99` (2026-08-07) | 23 exports de transporte para skills; **0 query keys** | idem |
| `dashboard/src/pages/promptly/components/promptly-api.ts` | 352 | `b423ae99` (2026-08-07) | 20 exports de transporte para promptly; **1 query key local** (`CATALOG_QUERY_KEY`) | A chave local existente não pode mudar de forma sem migrar o cache |
| `dashboard/src/hooks/projects/use-projects.ts` | 89 | `6a34b5e3` (2026-08-07) | **Exemplo canônico** do formato-alvo: `useQuery` + `queryKeys.projects.list()` + `throwOnError` | É referência, não muda |
| `dashboard/src/hooks/trust/use-trust.ts` (NEW) | 0 | — | (a criar) | — |
| `dashboard/src/hooks/trust/use-trust.test.ts` (NEW) | 0 | — | (a criar) | — |
| `dashboard/src/hooks/skills/use-skills.ts` (NEW) | 0 | — | (a criar) | — |
| `dashboard/src/hooks/skills/use-skills.test.ts` (NEW) | 0 | — | (a criar) | — |
| `dashboard/src/hooks/promptly/use-promptly.ts` (NEW) | 0 | — | (a criar) | — |
| `dashboard/src/hooks/promptly/use-promptly.test.ts` (NEW) | 0 | — | (a criar) | — |
| `dashboard/src/lib/data-access-layer.test.ts` (NEW) | 0 | — | (a criar — o guard que mede o Goal) | — |
| `dashboard/src/lib/api/query-keys.ts` | 79 | `9ed5d206` (2026-08-07) | (acima) | (acima) |

### Current callers / dependents

- **Símbolos:** os 8 exports de `trust-api.ts`, 23 de `skills-api.ts`, 20 de `promptly-api.ts`
- **Consumidores (produção):** trust = **5** páginas, skills = **8**, promptly = **6** — todas sob `src/pages/`. Enumerado com `grep -rl "<dominio>-api'" src/pages | grep -v test`
- **Consumidores (teste):** `src/pages/promptly/components/promptly-api.test.ts` existe e cobre `onResponse`
- **Externo (API pública consumida por outros repos):** não — são módulos internos do dashboard

- **Símbolo:** `cloudFetch` / `engineFetch` em `dashboard/src/lib/http/api.ts` (444 LoC, `bf876122`, 2026-08-07)
- **Importadores (produção):** **99** arquivos, dos quais **64** sob `src/pages/**`. Enumerado com `grep -rl "from '@/lib/http/api'" src | grep -v test`
- **Externo:** não

### Domain glossary

- **transporte** — `cloudFetch`/`engineFetch`: fazem o HTTP, o refresh de token no 401 e o interceptor de 402. Não conhecem cache.
- **query key** — a tupla que o TanStack Query usa para identificar uma entrada de cache. Vem da factory em `lib/api/query-keys.ts`.
- **hook de domínio** — um `useQuery`/`useMutation` que casa transporte + query key + invalidação, e é o único lugar onde uma página busca dado daquele domínio.
- **`*-api.ts`** — arquivo por domínio que hoje exporta só transporte. A camada pela metade que o B-052 mediu.
- **fan-in** — número de arquivos que importam um módulo. O do transporte é 99.

### Architecture boundaries affected

Por `rules/architecture.md § 1`, a direção é `interface → application → domain ← infrastructure`, e `§ 3` pede que o contrato público de um pacote seja mínimo. Este plano **estreita** uma fronteira: hoje `pages/` (interface) importa `lib/http` (infraestrutura) direto, pulando a camada intermediária; depois, `pages/` importa `hooks/<dominio>` e só o hook toca o transporte.

Por `ADR-0001 D4.1`, quando residência e camada colidem, **a camada vence** — por isso os hooks novos vão para `src/hooks/<dominio>/` e não para `src/pages/<dominio>/`, mesmo tendo um único domínio consumidor.

## Prior Art & Related Work

- **ADR interno:** `dashboard/docs/adr/0006-camada-de-acesso-a-dados-e-factory-de-query-key.md` — decide exatamente esta camada; status `proposed` desde 2026-08-06. Este plano é a execução dele.
- **ADR interno:** `dashboard/docs/adr/0001-eixo-de-organizacao-e-regra-de-residencia.md` § D4.1 — a regra de colisão residência-vs-camada que decide onde os hooks moram.
- **Exemplo canônico no próprio repo:** `dashboard/src/hooks/projects/use-projects.ts:70-88` — `useQuery` com `queryKeys.projects.list()`, `throwOnError: true` e `error` exposto ao consumidor. É a forma-alvo, e existe há tempo suficiente para ser considerada estável.
- **Guard existente que restringe o desenho:** `dashboard/src/lib/api/query-key-convergence.test.ts` — falha se duas convenções de chave coexistirem. Qualquer hook novo tem de usar a factory, não uma tupla literal.
- **Patterns skills:** nenhuma `skills/*-patterns/` existe neste projeto (verificado 2026-08-07) — não há Pattern a consumir nem a sobrepor.
- **Blueprints:** `knowledge-base/discoveries/blueprints/` tem 5 blueprints, todos de outros tópicos (RAG BFF, edge broker, e2e). Nenhum cobre camada de dados do dashboard.

## Objective

- [ ] Os três domínios com camada pela metade (`trust`, `skills`, `promptly`) ganham hook de domínio com query key da factory
- [ ] As 19 páginas que consomem esses três domínios passam a importar o hook, não o `*-api.ts`
- [ ] Um guard mede o teto de páginas que importam transporte e falha quando ele cresce
- [ ] Nenhuma query key literal nova entra — `query-key-convergence.test.ts` segue verde

## ADRs

### D1 — Migrar por domínio, não por página

**Decisão:** cada fase migra UM domínio inteiro (hook + todos os consumidores + testes), em vez de migrar as páginas mais simples de vários domínios.

**Rationale:** o valor só aparece quando o último consumidor de um domínio para de reescrever o `useQuery` — antes disso convivem duas formas de buscar o mesmo dado, que é pior que uma forma ruim consistente. Migrar por domínio também mantém cada fase revertível sozinha.

**Alternativas rejeitadas:** *migrar por página, das menores para as maiores* — produziria estado intermediário em que duas páginas do mesmo domínio usam caminhos diferentes para o mesmo endpoint, e o `query-key-convergence.test.ts` existe justamente porque essa divergência já custou caro.

**Consequências:** habilita reverter um domínio sem tocar nos outros; restringe o paralelismo entre fases a domínios distintos.

### D2 — O `*-api.ts` permanece como camada de transporte; o hook o consome

> **CORRIGIDO NA FASE 1 (2026-08-07).** A decisão de manter o transporte estava certa; a de deixá-lo **onde estava** não. O guard de camada (`eslint no-restricted-imports`, instalado por B-070) recusa `hooks/` importando de `pages/` — e a mensagem dele diz o conserto: *"mova o domínio para um módulo folha e faça a página IMPORTAR o que ela exportava"*. O transporte e os tipos de payload desceram para `src/hooks/<dominio>/`, e os módulos de apresentação que os declaravam passaram a re-exportá-los, mantendo os caminhos de import das páginas. O ADR seguia válido no *quê* e errado no *onde*, e foi uma regra automática que apanhou — não uma revisão.

**Decisão:** os três `*-api.ts` **não** são apagados. Eles continuam exportando transporte, e o hook de domínio passa a ser o único consumidor deles.

**Rationale:** `rules/parsimony-ladder.md` degrau 1 — reescrever 51 funções de transporte que já funcionam e já têm consumidor não resolve necessidade nenhuma. O defeito medido pelo B-052 não é "o transporte está no lugar errado", é "não há query key nem cache" — e isso se resolve acrescentando a camada acima, não movendo a de baixo.

**Alternativas rejeitadas:** *dissolver o `*-api.ts` dentro do hook* — juntaria duas razões de mudar num arquivo só (o contrato do endpoint e a política de cache), violando SRP, e faria `skills-api.ts` (350 LoC) + hook estourar o orçamento de 500 linhas de `rules/architecture.md`.

**Consequências:** habilita migração incremental com os dois caminhos coexistindo; restringe o ganho de LOC — o plano não reduz `src/pages` sozinho, só move a responsabilidade.

### D3 — O teto do guard é um número que só desce

**Decisão:** o guard afirma `arquivos_com_transporte <= TETO`, com `TETO` declarado e comentado, em vez de afirmar `=== 0`.

**Rationale:** afirmar zero exigiria migrar os 64 num único plano, o que viola a Regra de Qualidade 0 do `/to-plan` (uma métrica, um escopo). Um teto que só desce dá rede contra regressão desde o primeiro dia e deixa a migração acontecer em planos sucessivos. É o mesmo formato de `src/lib/adr-nomenclature.test.ts` e `sse-token-in-url.test.ts`, já em uso no repo.

**Alternativas rejeitadas:** *não medir até terminar tudo* — deixaria os 45 arquivos restantes crescerem livremente durante os planos seguintes, que é como se chegou a 64.

**Consequências:** habilita fechar este plano com valor real; restringe a força da afirmação — o guard não prova que a camada existe, prova que ela não encolheu.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Dois caminhos para o mesmo dado durante a migração de um domínio (páginas migradas e não migradas coexistem) | Medium | D1 migra o domínio inteiro numa fase; nenhuma fase termina com o domínio pela metade | Implementador |
| Uma query key nova com forma divergente quebra o cache em produção sem quebrar teste | High | `query-key-convergence.test.ts` já cobre; toda chave nova vem da factory (D1 do ADR-0006), nunca de tupla literal | Implementador |
| `promptly-api.ts` tem `CATALOG_QUERY_KEY` local (`:23`) — migrá-la muda a chave de cache de uma tela em uso | Medium | Manter a forma da chave existente ao movê-la para a factory; teste que compara a tupla antes/depois | Implementador |
| O plano não reduz LOC de `src/pages` (D2), então B-053 continua aberto depois dele | Low | Declarado no Coverage Matrix: B-053 é coberto **parcialmente**, e o resíduo vai para o plano de decomposição | — |
| 19 páginas mudam de import — risco de conflito com trabalho paralelo nas mesmas telas | Low | Fases por domínio são curtas; rebase por fase | Implementador |

## Unresolved Questions

- **Q1** — `skills-api.ts` tem 23 exports para 8 páginas consumidoras. Quantos desses exports têm consumidor de verdade? Se houver exports mortos, migrá-los é trabalho sem leitor — a fase de skills deve começar medindo com `knip`.
- **Q2** — `CATALOG_QUERY_KEY` (`promptly-api.ts:23`) tem forma diferente das chaves da factory? Se tiver, mover exige decidir entre preservar a forma (cache intacto, convenção quebrada) ou converter (convenção certa, cache invalidado uma vez).
- **Q3** — algum dos três domínios tem mutação que invalida cache de OUTRO domínio? Se sim, a invalidação cruzada precisa morar no hook e não na página, e isso não foi medido.
- **Q4** — o teto do guard (D3) deve contar arquivos ou call sites? Arquivos é mais estável; call sites mede melhor o progresso. Escolhido arquivos por ser o que o Goal declara — mas se a próxima fase mostrar que um arquivo com 8 chamadas conta igual a um com 1, o formato muda.

## Dependency Graph

```
Phase 0 (guard + teto)
   │
   ├──▶ Phase 1 (trust — 5 páginas, 8 exports)     ┐
   ├──▶ Phase 2 (skills — 8 páginas, 23 exports)   ├─ paralelas entre si (D1: domínios distintos)
   └──▶ Phase 3 (promptly — 6 páginas, 20 exports) ┘
                          │
                          ▼
                Phase 4 (integration validation)
```

Fase 0 bloqueia todas: sem o guard, nada mede. Fases 1–3 são independentes por D1. Fase 4 exige as três.

---

## Phase 0: O guard que mede o Goal

**Objective:** existir um teste que falha quando o número de páginas importando transporte cresce.

### T0.1 — Guard do teto de acesso direto ao transporte

#### Objective
Criar `src/lib/data-access-layer.test.ts`, que conta os arquivos de `src/pages/**` importando `cloudFetch`/`engineFetch` e falha acima do teto declarado.

#### Why this step (action + reasoning — ReAct discipline)

**O que faz:** varre `src/pages` procurando import do módulo de transporte, conta os arquivos e compara com uma constante `TETO_PAGINAS_COM_TRANSPORTE`.

**Por que agora:** é a métrica do Goal. Sem ele, o plano fecha com "migramos três domínios" e ninguém consegue verificar se o quarto reintroduziu o padrão — que é exatamente como se chegou a 64 (D3). Vem antes das migrações porque um teto medido DEPOIS já nasce acomodado ao resultado.

#### Evidence
`grep -rl "from '@/lib/http/api'" src | grep -v test | wc -l` → **99** importadores; restringindo a `src/pages`, **64**. Medido em 2026-08-07 sobre `237de030`.

#### Files to edit
```
dashboard/src/lib/data-access-layer.test.ts — (NEW) o guard
```

#### Deep file dependency analysis
Arquivo novo, sem dependentes. Lê o disco com `node:fs`, como os guards já existentes (`residence-rule.test.ts`, `request-ceiling.test.ts`) — não importa código de produção, então não cria acoplamento.

#### Deep Dives
- **Invariante:** o teto só desce. O teste compara `<=`, então baixar a constante num commit posterior mantém verde.
- **Edge case:** um arquivo que importa `ApiError` (e não o transporte) de `@/lib/http/api` NÃO conta — o guard casa os identificadores `cloudFetch`/`engineFetch` no specifier importado, não o caminho do módulo. Sem isso, o número mede a coisa errada.
- **Edge case:** arquivos de teste sob `src/pages` são excluídos; um teste que chama transporte é legítimo.

#### Pseudo-code / Signatures

```pseudocode
TETO = 64   -- medido em 2026-08-07; SÓ DESCE

function contarPaginasComTransporte(): string[]
  for arquivo in walk('src/pages') where ext in (ts,tsx) and not test:
    src = read(arquivo)
    for cada bloco `import { ... } from '@/lib/http/api'`:
      if bloco contém 'cloudFetch' ou 'engineFetch':
        coletar arquivo; break
  return coletados

# Exemplo
input:  arquivo com `import { ApiError } from '@/lib/http/api'`
output: NÃO contado — importa o tipo de erro, não o transporte
```

#### Tasks
1. Escrever o teste com `TETO = 64` e a mensagem de falha explicando a direção da regra
2. Rodar e confirmar que passa com o valor atual
3. Sondar: subir um import de transporte numa página e confirmar que o teste falha
4. Sondar: importar só `ApiError` e confirmar que NÃO conta

#### TDD
```
RED:     conta_apenas_import_de_transporte() — arquivo com só `ApiError` não entra na conta
RED:     falha_quando_o_numero_cresce() — com TETO artificialmente em 0, o teste falha listando os ofensores
GREEN:   implementar o walker + o matcher do specifier
REFACTOR: None expected
VERIFY:  cd dashboard && npx vitest run src/lib/data-access-layer.test.ts
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] O teste passa com `TETO = 64`
- [ ] Sonda confirmada: `TETO = 0` faz o teste falhar listando os 64 caminhos
- [ ] Sonda confirmada: import de `ApiError` sozinho não conta
- [ ] Pass: lint — `npx eslint src` zero warnings
- [ ] Pass: size — arquivo ≤ 500 linhas

#### DoD
- [ ] `npx vitest run src/lib/data-access-layer.test.ts` verde
- [ ] `npx tsc --noEmit` zero erros
- [ ] `npx eslint src` zero warnings

---

## Phase 1: Domínio `trust`

**Objective:** as 5 páginas de trust buscam dado por `useTrust*`, não por `trust-api.ts`.

### T1.1 — Hook de domínio para trust

#### Objective
Criar `src/hooks/trust/use-trust.ts` com um hook por leitura do domínio, consumindo `trust-api.ts` e a factory de query key.

#### Why this step (action + reasoning — ReAct discipline)

**O que faz:** cria os hooks de leitura, cada um com `useQuery` + `queryKeys.trust.*` + `throwOnError: true`, no formato de `use-projects.ts:70-88`.

**Por que agora:** trust é o menor dos três (91 LoC, 8 exports, 5 consumidores) — é onde o formato se prova com o menor custo de reverter se estiver errado. Por D1, o domínio inteiro numa fase; por D2, o `trust-api.ts` permanece e vira dependência do hook.

#### Evidence
`src/pages/trust/components/trust-api.ts` — 91 LoC, `b423ae99`, **0 ocorrências** de `queryKey` (medido com `grep -c`). 5 páginas consumidoras (`grep -rl "trust-api'" src/pages | grep -v test`).

#### Files to edit
```
dashboard/src/hooks/trust/use-trust.ts — (NEW) hooks de leitura do domínio
dashboard/src/hooks/trust/use-trust.test.ts — (NEW) RED primeiro
dashboard/src/lib/api/query-keys.ts — acrescenta o ramo `trust`
```

#### Deep file dependency analysis
- `trust-api.ts` (Baseline: 91 LoC, 8 exports, 0 query keys) — **não muda**; passa a ter o hook como consumidor.
- `query-keys.ts` (Baseline: 79 LoC) — ganha `trust`. O `query-key-convergence.test.ts` valida que a forma nova casa a convenção; se não casar, ele falha antes do merge.
- Downstream: as 5 páginas listadas em Baseline § Current callers, migradas em T1.2.

#### Deep Dives
- **Invariante:** as chaves existentes não mudam de forma (Baseline § `query-keys.ts`).
- **Edge case:** endpoint que devolve `null` — `use-projects.ts:87` mostra o padrão: `throwOnError: true` e `error` exposto, para que falha de leitura não vire estado vazio (é a classe do `#274`).

#### Tasks
1. Medir com `knip` quais dos 8 exports têm consumidor real (Q1 aplicado a trust)
2. Escrever os testes RED do hook
3. Acrescentar o ramo `trust` à factory
4. Implementar os hooks consumindo `trust-api.ts`

#### TDD
```
RED:     use_trust_usa_a_chave_da_factory() — assert queryKey === queryKeys.trust.<x>()
RED:     falha_de_leitura_expoe_error_e_nao_lista_vazia() — mock rejeita; hook expõe error=true, dados vazios
GREEN:   implementar hooks + ramo da factory
REFACTOR: None expected
VERIFY:  cd dashboard && npx vitest run src/hooks/trust
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Todo hook usa `queryKeys.trust.*`, nenhuma tupla literal
- [ ] `query-key-convergence.test.ts` verde
- [ ] Falha de leitura expõe `error`, não lista vazia
- [ ] Pass: size — arquivo ≤ 500 linhas

#### DoD
- [ ] `npx vitest run src/hooks/trust` verde
- [ ] `npx tsc --noEmit` zero erros

### T1.2 — Migrar as 5 páginas de trust

#### Objective
As 5 páginas passam a importar `@/hooks/trust/use-trust` e param de importar `trust-api.ts`.

#### Why this step (action + reasoning — ReAct discipline)

**O que faz:** troca o import e remove o `useQuery` reescrito à mão em cada página.

**Por que agora:** por D1, o valor só existe quando o último consumidor migra — antes disso convivem duas formas de buscar o mesmo dado, e é essa divergência que o `query-key-convergence.test.ts` existe para impedir.

#### Evidence
5 páginas consumidoras, enumeradas em Baseline § Current callers.

#### Files to edit
```
dashboard/src/pages/trust/**       — as 5 páginas consumidoras (enumerar com o grep do Baseline)
dashboard/src/lib/data-access-layer.test.ts — baixar TETO em 5
```

#### Deep file dependency analysis
Cada página perde o import do transporte e ganha o do hook. `data-access-layer.test.ts` (T0.1) mede o efeito: o teto desce, e o teste falharia se alguma página tivesse sido esquecida com o teto novo.

#### Deep Dives
- **Invariante:** o comportamento observável de cada tela não muda — os testes de página existentes são a rede, e devem passar sem edição. Se algum precisar mudar, é sinal de que o hook mudou semântica, não só endereço.

#### Tasks
1. Migrar página a página, rodando o teste da página a cada uma
2. Baixar `TETO_PAGINAS_COM_QUERY_MANUAL` para 14
3. Confirmar que nenhum teste de página precisou ser alterado

#### TDD
```
RED:     (nenhum novo) — os testes de página existentes são a rede
GREEN:   trocar imports; remover useQuery manual
REFACTOR: remover do trust-api.ts o que knip apontar como morto (Q1)
VERIFY:  cd dashboard && npx vitest run src/pages/trust src/lib/data-access-layer.test.ts
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Nenhuma página de trust importa `cloudFetch`/`engineFetch`
- [ ] `TETO_PAGINAS_COM_QUERY_MANUAL` = 14 e o guard passa
- [ ] Os testes de página existentes passam **sem edição**

#### DoD
- [ ] `npx vitest run` verde
- [ ] `npx tsc --noEmit` zero erros

---

## Phase 2: Domínio `skills`

**Objective:** as 8 páginas de skills buscam dado por hook, não por `skills-api.ts`.

### T2.1 — Hook de domínio para skills (mesma forma de T1.1)

#### Objective
Criar `src/hooks/skills/use-skills.ts` + ramo `skills` na factory.

#### Why this step (action + reasoning — ReAct discipline)

**O que faz:** repete a forma provada na Fase 1 para o domínio maior.

**Por que agora:** skills é o de maior superfície (350 LoC, 23 exports, 8 consumidores). Vem depois de trust porque o formato já terá sido validado — e Q1 morde mais forte aqui: 23 exports para 8 páginas é o perfil de export morto.

#### Evidence
`src/pages/skills/components/skills-api.ts` — 350 LoC, `b423ae99`, **0** query keys. 8 páginas consumidoras.

#### Files to edit
```
dashboard/src/hooks/skills/use-skills.ts — (NEW)
dashboard/src/hooks/skills/use-skills.test.ts — (NEW) RED primeiro
dashboard/src/lib/api/query-keys.ts — ramo `skills`
```

#### Deep file dependency analysis
Igual a T1.1, com uma diferença: `skills-api.ts` tem 350 LoC e o hook não pode absorvê-lo (D2 + orçamento de 500 linhas de `rules/architecture.md`).

#### Deep Dives
- **Edge case:** se `knip` apontar exports mortos, apagá-los é parte desta fase — migrar transporte sem leitor é trabalho sem valor (`parsimony-ladder.md` degrau 1).

#### Tasks
1. `npx knip` restrito a `skills-api.ts`; registrar quantos dos 23 exports são mortos
2. Testes RED
3. Ramo da factory + hooks

#### TDD
```
RED:     use_skills_usa_a_chave_da_factory()
RED:     falha_de_leitura_expoe_error_e_nao_lista_vazia()
GREEN:   implementar
REFACTOR: apagar os exports que knip apontou
VERIFY:  cd dashboard && npx vitest run src/hooks/skills
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Toda chave vem da factory
- [ ] Exports mortos apontados por `knip` foram apagados OU registrados com motivo
- [ ] Pass: size — `use-skills.ts` ≤ 500 linhas

#### DoD
- [ ] `npx vitest run src/hooks/skills` verde

### T2.2 — Migrar as 8 páginas de skills

#### Objective
As 8 páginas importam o hook; o teto desce para 11.

#### Why this step (action + reasoning — ReAct discipline)

**O que faz:** troca de import nas 8 páginas.
**Por que agora:** D1 — o domínio fecha na mesma fase.

#### Evidence
8 páginas consumidoras (Baseline § Current callers).

#### Files to edit
```
dashboard/src/pages/skills/**  — as 8 páginas
dashboard/src/lib/data-access-layer.test.ts — TETO para 51
```

#### Deep file dependency analysis
Idêntico a T1.2.

#### Deep Dives
- **Invariante:** testes de página passam sem edição.

#### Tasks
1. Migrar página a página
2. Baixar `TETO`

#### TDD
```
RED:     (nenhum novo)
GREEN:   trocar imports
REFACTOR: None expected
VERIFY:  cd dashboard && npx vitest run src/pages/skills src/lib/data-access-layer.test.ts
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Nenhuma página de skills importa transporte
- [ ] `TETO_PAGINAS_COM_QUERY_MANUAL` = 11

#### DoD
- [ ] `npx vitest run` verde

---

## Phase 3: Domínio `promptly`

**Objective:** as 6 páginas de promptly buscam dado por hook, com `CATALOG_QUERY_KEY` resolvida.

### T3.1 — Hook de domínio para promptly + decidir Q2

#### Objective
Criar `src/hooks/promptly/use-promptly.ts` e resolver o destino de `CATALOG_QUERY_KEY`.

#### Why this step (action + reasoning — ReAct discipline)

**O que faz:** cria os hooks e move a única query key local existente para a factory.

**Por que agora:** promptly é o único dos três com chave local (`promptly-api.ts:23`), então é o único que tem cache em produção a preservar. Vem por último porque é o que carrega a decisão de Q2 — e decidir isso depois de o formato estar provado nos outros dois reduz o número de variáveis.

#### Evidence
`src/pages/promptly/components/promptly-api.ts` — 352 LoC, `b423ae99`, **1** query key (`CATALOG_QUERY_KEY:23`). 6 páginas consumidoras. Há teste existente: `promptly-api.test.ts`.

#### Files to edit
```
dashboard/src/hooks/promptly/use-promptly.ts — (NEW)
dashboard/src/hooks/promptly/use-promptly.test.ts — (NEW) RED primeiro
dashboard/src/lib/api/query-keys.ts — ramo `promptly`
```

#### Deep file dependency analysis
`promptly-api.ts` mantém o transporte (D2) e perde `CATALOG_QUERY_KEY` para a factory. `promptly-api.test.ts` cobre `onResponse` e **não** deve precisar de edição — se precisar, o hook mudou semântica.

#### Deep Dives
- **Invariante crítico:** a forma da chave. Se `CATALOG_QUERY_KEY` diverge da convenção da factory, mover altera a identidade de cache de uma tela em uso, e o efeito é um refetch único no deploy. Aceitável **se declarado**; inaceitável se descoberto depois.
- **Edge case:** o teste de T3.1 compara a tupla antes e depois. Se forem diferentes, a mudança é consciente e vai no CHANGELOG.

#### Pseudo-code / Signatures

```pseudocode
-- Q2 resolvido por medição, não por preferência:
antes = CATALOG_QUERY_KEY                    -- promptly-api.ts:23
depois = queryKeys.promptly.catalog()
if antes ≠ depois:
   registrar no CHANGELOG: "uma tela refaz a leitura uma vez no deploy"
```

#### Tasks
1. Ler `CATALOG_QUERY_KEY` e comparar com a convenção da factory
2. Testes RED, incluindo a comparação de tupla
3. Mover a chave + implementar hooks

#### TDD
```
RED:     use_promptly_usa_a_chave_da_factory()
RED:     a_chave_do_catalogo_mantem_a_forma() — ou falha declarando a mudança
RED:     falha_de_leitura_expoe_error_e_nao_lista_vazia()
GREEN:   implementar
REFACTOR: None expected
VERIFY:  cd dashboard && npx vitest run src/hooks/promptly src/pages/promptly
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] `CATALOG_QUERY_KEY` mora na factory
- [ ] Se a forma mudou, está no CHANGELOG com o efeito declarado
- [ ] `promptly-api.test.ts` passa **sem edição**

#### DoD
- [ ] `npx vitest run src/hooks/promptly src/pages/promptly` verde

### T3.2 — Migrar as 6 páginas de promptly

#### Objective
As 6 páginas importam o hook; o teto desce para 0.

#### Why this step (action + reasoning — ReAct discipline)

**O que faz:** troca de import nas 6 páginas.
**Por que agora:** D1 — fecha o domínio.

#### Evidence
6 páginas consumidoras (Baseline § Current callers).

#### Files to edit
```
dashboard/src/pages/promptly/**  — as 6 páginas
dashboard/src/lib/data-access-layer.test.ts — TETO para 45
```

#### Deep file dependency analysis
Idêntico a T1.2.

#### Deep Dives
- **Invariante:** testes de página passam sem edição.

#### Tasks
1. Migrar página a página
2. Baixar `TETO`

#### TDD
```
RED:     (nenhum novo)
GREEN:   trocar imports
REFACTOR: None expected
VERIFY:  cd dashboard && npx vitest run
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Nenhuma página de promptly importa transporte
- [ ] `TETO_PAGINAS_COM_QUERY_MANUAL` = 0 e o guard passa

#### DoD
- [ ] `npx vitest run` verde

---

## Phase 4: Integration Validation

**Objective:** provar que a camada existe e que o número desceu, com a suíte inteira verde.

### T4.1 — Cadeia completa

#### Objective
Rodar todos os gates e confirmar a métrica do Goal.

#### Why this step (action + reasoning — ReAct discipline)

**O que faz:** roda testes, tipos, lint, build e `size-limit`, e confirma `TETO = 45`.

**Por que agora:** é o gate "eat your own cooking". Três fases verdes isoladamente não provam que a suíte inteira sobreviveu — e `use-status-stream.test.tsx` já mostrou nesta base que um teste pode passar isolado e falhar na suíte.

#### Evidence
Comandos verificados como existentes em `dashboard/package.json` (`test`, `build`) e disponíveis via `npx` (`tsc`, `eslint`, `size-limit`).

#### Files to edit
```
dashboard/CHANGELOG.md — entrada sob [Unreleased] (Unbreakable Rule 6)
```

#### Deep file dependency analysis
Nenhuma mudança de código. `CHANGELOG.md` recebe a entrada voltada ao consumidor.

#### Deep Dives
- **Invariante:** `size-limit` ≤ 320 kB no `TOTAL EAGER` (gate duro do repo).

#### Tasks
1. `npx vitest run`
2. `npx tsc --noEmit`
3. `npx eslint src`
4. `npm run build && npx size-limit`
5. Escrever a entrada do CHANGELOG

#### TDD
```
RED:     (nenhum — fase de validação)
GREEN:   (nenhum)
REFACTOR: None expected
VERIFY:  cd dashboard && npx vitest run && npx tsc --noEmit && npx eslint src && npm run build && npx size-limit
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] Suíte inteira verde
- [ ] `TETO_PAGINAS_COM_QUERY_MANUAL` = 0 no guard
- [ ] `size-limit` dentro do orçamento
- [ ] CHANGELOG atualizado

#### DoD
- [ ] Cadeia completa verde

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | B-012 — acesso a dados vive nas páginas (**58** arquivos, remedido) | T0.1 | Ganha teto que só desce. **Parcial por desenho**: este plano não move o número (as 19 páginas não importam transporte direto); ele instala a rede que o próximo plano usa |
| 2 | B-029 — fan-in de `lib/http/api.ts` (99 importadores) | T0.1 | **Não movido por este plano** — medido que as 19 páginas não são importadoras. Coberto pelo teto do guard, que impede o fan-in crescer |
| 3 | B-052 — camada pela metade nos três `*-api.ts` (0/0/1 query key) | T1.1, T2.1, T3.1 | **Total**: os três ganham hook com query key da factory |
| 4 | B-053 — inversão de massa (47.569 vs 5.263 LOC) | T1.1, T2.1, T3.1 | **Parcial**: move responsabilidade, não LOC (D2). O resíduo vai para o plano de decomposição |

**Coverage: 4/4 gaps endereçados (100%), sendo 1 total e 3 parciais com o resíduo declarado.**

## Global Definition of Done

- [ ] Todas as fases completas
- [ ] `cd dashboard && npx vitest run` verde
- [ ] `npx tsc --noEmit` zero erros
- [ ] `npx eslint src` zero warnings
- [ ] Orçamento de tamanho respeitado (`rules/architecture.md`; 500 linhas por arquivo)
- [ ] `npm run build && npx size-limit` dentro de 320 kB no `TOTAL EAGER`
- [ ] `CHANGELOG.md` atualizado sob `[Unreleased]` (Unbreakable Rule 6)
- [ ] Compatibilidade preservada: nenhum teste de página existente precisou ser editado
- [ ] `TETO_PAGINAS_COM_QUERY_MANUAL` = 0 e `TETO_PAGINAS_COM_TRANSPORTE` = 58 em `data-access-layer.test.ts`, com sonda de detecção confirmada para os dois
- [ ] **Prova de métrica em runtime** — não se aplica: este plano não acrescenta contador de runtime; a métrica é o guard
- [ ] Plano arquivado em `knowledge-base/plans/completed/` **após** o merge do PR

## Failure scenarios

Este plano toca I/O externo (HTTP via `cloudFetch`/`engineFetch`), então os cenários são obrigatórios.

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| API cloud (`cloudFetch`) | 5xx sustentado numa leitura de domínio | Mock rejeita com `ApiError(503)` | O hook expõe `error`; a página mostra estado de erro, **nunca** lista vazia (classe do `#274`) |
| API cloud | 401 com sessão renovável | Mock rejeita uma vez com 401, depois resolve | O refresh-e-retry do transporte age; o hook não vê o 401. Já coberto por `lib/http/api.ts` — o teste confirma que a camada nova não o contorna |
| API cloud | 402 (limite de plano) | Mock rejeita com `ApiError(402)` | O interceptor de 402 dispara. É a razão de D2 manter o transporte como dependência: reimplementá-lo no hook perderia isso |
| API engine (`engineFetch`) | timeout de rede | Mock rejeita com `TypeError('fetch failed')` | O hook expõe `error`; não há retry infinito |

---

## Nota de escopo — por que este plano NÃO cobre os 19 itens abertos

O pedido foi "um plano para todos os itens abertos". A Regra de Qualidade 0 do `/to-plan` proíbe: *"O Goal DEVE caber numa frase com uma métrica. Se não couber, o escopo é grande demais — divida em múltiplos planos."* Dezenove itens não compartilham métrica.

Medido em 2026-08-07, os 19 se dividem assim:

| Grupo | Itens | Destino |
|---|---|---|
| **Este plano** | B-012, B-029, B-052, B-053 | Um fenômeno medido por quatro lentes: não há camada de dados |
| **Plano de decomposição** | B-003 (`app.tsx` 779 LoC), B-009 (32 arquivos > 400 LoC), B-032 (estratégia de organização) | Métrica própria: arquivos acima do orçamento |
| **Plano de estado de URL** | B-046 (nuqs em 7, `useSearchParams` cru em 28) | Métrica própria: implementações concorrentes de estado de URL |
| **Plano de FSM** | B-047 (metade restante: `project-connect.tsx`, 696 LoC, 16 `useState`) | A análise de 2026-08-06 já recomendava plano próprio, e ela continua valendo |
| **`/grill-me`, não `/to-plan`** | B-055, B-067, B-069, B-071, B-074, B-075, B-076, B-077 | São perguntas de produto — "queremos feature flags?", "queremos service worker?", "duas bibliotecas de UI?". Um plano não decide isso; ele executa uma decisão. O `/to-plan` manda parar e recomendar `/grill-me` quando os requisitos não estão resolvidos |
| **Bloqueados fora deste repo** | B-090 (issues #471, #472), B-099 (causa não identificada em 32 execuções) | Esperam resposta que não está no dashboard |

Os três planos irmãos (decomposição, estado de URL, FSM) são escrevíveis hoje. Os oito de produto não são, e escrever um plano para eles seria inventar a decisão que falta.
