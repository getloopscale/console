---
status: proposed
date: 2026-08-06
decision-makers: time do dashboard theo-cloud
origem: tradeoff_decisions#16 · state_findings#1, #2, #13, #17, #19 · system_design_findings#12
---

# ADR-0006 — Camada de acesso a dados por feature e obrigatoriedade da factory de query key

## Contexto e enunciado do problema

Nao existe camada de acesso a dados. O estado de servidor e buscado direto das paginas
(medido):

- 102 das 126 chamadas `useQuery` e **as 75** `useMutation` fora de hooks moram em componentes de pagina.
- 58 arquivos de `src/pages` e 13 de `src/components` chamam `cloudFetch`/`engineFetch` diretamente.
- `src/pages` concentra 34.137 LOC contra 3.961 de `src/hooks` — a inversao de massa e o sintoma quantitativo.

E ha **tres convencoes concorrentes de query key** entre as 208 definicoes do repo:

| Convencao | Sites | Observacao |
|---|---|---|
| tupla ad-hoc `["cloud", <path literal>, ...]` | 130 (+5 `"engine"`) | a que venceu de fato |
| factory `queryKeys.*` de `src/lib/api/query-keys.ts` | 25 | a documentada |
| constantes locais de arquivo (`DOMAINS_KEY`, `labelsKey`, ...) | ~30 | por arquivo |

A factory **foi criada com o porque tecnico correto** (`src/lib/api/query-keys.ts:1-9`,
fold do EC-05: filtros na key para que mudanca de filtro produza cache key distinta) e
nunca virou obrigatoria: apenas 18 arquivos a importam contra 74 que chamam `useQuery`.

Consequencias medidas, todas de **correcao**, nao de estetica:

- Recurso `domains` tem dois namespaces disjuntos: mutations invalidam `["domains"]`, o polling guarda em `["engine", "/api/v1/domains/<nome>"]` — invalidar um nunca alcanca o outro (`state_findings#11`).
- O caminho de CREATE de `domains`, `environments` e `team members` vive dentro do sheet com `engineFetch` cru e **nao invalida cache**, enquanto o hook de mutation correspondente, que invalida corretamente, esta orfao (`state_findings#10`; confirmado como codigo morto em `deletion_findings#4/#5/#6`).
- `/v1/dashboard/rag/collections` e buscado de 7 paginas diferentes, cada uma com key e opcoes reescritas no local (`state_findings#12`).
- Um typo num path literal cria silenciosamente uma entrada de cache orfa que nunca invalida.

Existe um embriao correto da camada: `trust-api.ts`, `skills-api.ts` e `promptly-api.ts`
ja extraem o transporte por feature — mas moram em `src/components/<feature>/` e nao
exportam `queryKey` (`state_findings#17`).

## Opcoes consideradas

1. Migrar as 130 tuplas ad-hoc para `src/lib/api/query-keys.ts`.
2. Formalizar a convencao que venceu (path-as-key) com helpers derivaveis, e tornar o uso obrigatorio por lint.
3. Manter como esta.

## Decisao

Adotar a **opcao 2** — nao criar camada nova, tornar obrigatoria a que ja existe, na forma
que o codebase ja adotou:

1. `src/lib/api/keys.ts` expõe `cloudKey(path, ...parts)` / `engineKey(path, ...parts)`, e cada feature declara seus paths uma unica vez em `features/<f>/api/paths.ts`. `src/lib/api/query-keys.ts` fica como o caso especial dos dominios com filtro (projects/builds/secrets).
2. Regra ESLint `no-restricted-syntax` proibindo **array literal** como `queryKey`/`mutationKey`. Esta e a acao prioritaria: e a que fecha o buraco de invalidacao.
3. Cada feature ganha `features/<f>/api/` (client + keys) e `features/<f>/hooks/`. Os tres `*-api.ts` existentes sao promovidos para la e passam a exportar suas keys. **Meta declarada: nenhuma pagina declara `queryKey` nem chama `cloudFetch`.**

A migracao de (3) acontece junto com a migracao de pastas do ADR-0001 — as duas mudancas
tocam os mesmos arquivos e se pagam juntas.

## Consequencias

- Bom: `invalidate` passa a ter prefixo derivavel por dominio; o path literal existe uma vez.
- Bom: a regra de dados fica testavel sem montar a arvore de componentes inteira.
- Ruim: 130 call sites a migrar. Mitigacao: a regra de lint barra os novos imediatamente (baixo custo, alto retorno) e a migracao dos existentes acompanha o movimento de pastas, sem PR dedicado de 130 arquivos.
- Ruim: dois helpers de key (`cloudKey`/`queryKeys`) convivendo por um periodo. Aceito e delimitado: `queryKeys` cobre exclusivamente dominios com filtro.
