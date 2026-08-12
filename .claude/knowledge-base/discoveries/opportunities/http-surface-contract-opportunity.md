# Oportunidade: o contrato de superfície HTTP, e quem pode carregá-lo

**Item:** `B-115` · **Modo:** `review` · **Data:** 2026-08-10 · **Baseline:** `b814ce9e`

## Corner 1 — Evidence

### O buraco na minha própria proposta de intake

Filei o item dizendo que o contrato deve morar em `theo-contracts` "como código verificável".
Medido: **`theo-contracts` é um módulo Go** (`go.mod`, pacotes `jwt`/`serviceauth`/`plan`),
consumido por `theo` e `theo-cloud`. Os **seis serviços TypeScript não podem importá-lo.**

A proposta, como escrita, não alcança metade do ecossistema.

### O portador que já existe

| serviço | framework | OpenAPI |
|---|---|---|
| theo-lens, theo-memory, theo-rag, theo-trust, theo-skills, theo-promptly | **Hono** (todos) | memory/rag/promptly já têm `@hono/zod-openapi`; **lens já versiona `packages/sdk/openapi.snapshot.json`** e falha no diff |
| theo-cloud | Go | já mantém `openapi/promptly.yaml` e `openapi/themory.yaml` |

O escopo npm `@usetheo/*` já é usado (`@usetheo/ui`, `@usetheo/lens-sdk`, `@usetheo/lens-core`), e
`theo-lens` já publica `sdk-go` e `sdk-py` — empacotamento poliglota tem precedente.

**Portanto o contrato é um conjunto de regras sobre documentos OpenAPI**, não uma biblioteca Go.
Isso é neutro de linguagem por construção e não exige que um repo Go importe TypeScript.

### A divergência é PIOR do que eu registrei: ela está dentro de um serviço só

Medido no `openapi.snapshot.json` do `theo-lens` — 30 caminhos, OpenAPI 3.0.3:

```
TraceListResponse      { traces, total?, limit?, offset? }   required: apenas `traces`
SessionListResponse    { sessions, total?, limit?, offset? } required: apenas `sessions`
DatasetsResponse       { datasets }
ScoresResponse         { range, scores }
GuardsListResponse     { monitors, guards }      ← DUAS coleções na mesma resposta
SpanFacetsResponse     { }                       ← nenhuma propriedade
```

Seis formas de lista, **num serviço**. O item afirmava divergência entre serviços; ela também é
interna, e por isso não se resolve serviço a serviço sem um contrato comum.

### O erro: dois de três já concordam

```
theo-lens     ApiError  { code, message, details?[{field, issue}] }   required: code, message
theo-cloud              { code, message }                             (device.go:162)
theo-storage            { error: { code, message } }                  (authz.go:57)
```

**A forma plana já é maioria.** Escolhê-la custa uma mudança a um repo; escolher a aninhada custa
a oito. A decisão é medida, não preferida.

E a prova de que isso já cobra: dentro da MESMA camada de mock do dashboard existem duas funções
`err()` — `handlers.ts:80` plana, `domain-handlers.ts:31` aninhada. Cada uma imita fielmente o
backend que representa.

### O spec não descreve a superfície operacional

O snapshot do `theo-lens` tem **zero** caminhos de saúde ou versão, embora o código sirva
`/v1/healthz`, `/v1/healthz/ready` e `/v1/version`. Um contrato sobre OpenAPI só governa o que o
documento descreve — então "emitir um documento completo" é pré-requisito, e é trabalho dos itens
de conformação, não deste.

## Corner 2 — Constraint relation

**`unknown`.** `rules/current-constraint.md` está `status: undeclared`.

## Corner 3 — Blast radius

O maior do backlog até hoje: **doze repositórios** com superfície HTTP, mais quatro consumidores
(`theo-cli`, `theokit-sdk`, `theokit-gateways`, `theokit-plugins`) e o que clientes escreveram.

Este item **não muda rota nenhuma** — ele publica o contrato e o verificador. O raio se realiza
nos itens `B-116..B-124`, e por isso a estratégia de migração aditiva é parte da DoD *deste*
item: se ela não estiver no contrato, cada repo inventa a sua.

## Corner 4 — Verification

1. **O verificador reprova um serviço real hoje.** Rodar contra o snapshot do `theo-lens` deve
   falhar — ele viola lista, saúde e nome de recurso. Um contrato que passa em tudo que já existe
   não é um contrato, é uma descrição.
2. **Neutro de linguagem.** Um repo Go não precisa de runtime TypeScript para ser verificado.
3. **A migração é aditiva por contrato**, não por disciplina de quem implementa.

**Onde o limite se move depois:** com o contrato publicado, a pergunta passa a ser quanto de cada
serviço o seu OpenAPI realmente descreve — e o `theo-lens` já mostra que a resposta é "menos do
que ele serve".

## Verdict

`SHIPPABLE_WITH_CAVEATS` — a hipótese se confirma e **cresce**: a divergência é intra-serviço além
de inter-serviço. O caveat é a correção da minha própria proposta: o contrato não pode ser uma
biblioteca Go, porque metade do ecossistema não fala Go.
