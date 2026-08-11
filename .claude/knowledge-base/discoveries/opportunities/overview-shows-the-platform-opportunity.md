# Oportunidade: a Overview anuncia a plataforma e não a mostra

**Item:** `B-125` · **Modo:** `evolve` · **Data:** 2026-08-11 · **Baseline:** `5377c7e2`

## Corner 1 — Evidence

### O que a tela responde, medido no navegador

`localhost:5174` em modo mock, consultando o texto renderizado:

| pergunta | responde |
|---|---|
| quais capacidades existem | **sim** — a faixa `PLATFORM` do `B-112` |
| o que rodou além de deploys | não |
| tem algo errado agora | não |
| quanto custam os agentes | **não** — o único valor em dinheiro é `USD 20/mo`, o preço do plano |

### O custo do status quo, em linhas

`pages/overview/overview.tsx` tem 365 linhas. Por seção:

```
Platform          122..130     9 linhas    <- responde "o que a plataforma faz"
Usage             131..186    56 linhas    <- cotas de cobrança
Deploy activity   187..196    10 linhas
Projects          197..313   117 linhas
Quick actions     314..364    51 linhas    <- três links que o menu já tem
```

**107 linhas — 29% do arquivo — em `Usage` + `Quick actions`**, isto é, em conteúdo que ou
duplica o menu ou pertence a `/billing`.

`Quick actions` é o caso mais claro: `Deploy a project` → `/projects`, `Invite teammates` →
`/team`, `Add a custom domain` → `/domains`. Os três são itens de uma barra lateral **sempre
visível**. É exatamente o defeito que os cards de capacidade evitaram ao exigir um SINAL — um
bloco cujo conteúdo é nome + link para um item do menu não é conteúdo.

### O que existe para colocar no lugar — e todos têm mock

| sinal | fonte | campo | mock |
|---|---|---|---|
| taxa de erro dos agentes | `lens/observability` | `traffic[].errorCount` / `errorRate` | **sim** (B-112) |
| custo por modelo | `lens/observability` | `tokensByModel[].costUsd` | **sim** (B-112) |
| retrievals sem resposta | `rag/analytics` | `totals.empty_retrieval_rate` | **sim** (B-112) |
| o que foi barrado | `trust/enforcement-events` | `decision` por evento | **sim** |
| deploys | `builds/stats` | série por dia | **sim** |

A cobertura de mock não é coincidência: o `B-112` criou `overview-handlers.ts` justamente porque
quatro desses agregados caíam no proxy e voltavam 500. Sem aquele item, esta fatia seria
inverificável no único ambiente onde alguém valida telas.

### O limite do dado, medido — e ele mata a ideia mais bonita

Só **três** fontes têm série temporal: `lens/observability`, `builds/stats` e `trust` (eventos com
data, agrupáveis). `rag`, `memory` e `storage` servem **apenas totais** — o próprio código do
memory registra isso: *"until the P2 usage aggregator ships multi-day series"*.

Uma faixa temporal honesta carrega duas ou três séries, não oito. Desenhar cinco alinhadas seria
fabricar quatro, e é o tipo de coisa que um desenho bonito esconde bem.

## Corner 2 — Constraint relation

**`unknown`.** `rules/current-constraint.md` está `status: undeclared`, e o ecossistema não
instrumenta fluxo.

## Corner 3 — Blast radius

Contido no dashboard, e **nenhuma mudança de contrato de API**: os cinco sinais já são servidos e
já são consumidos pelas páginas de capacidade.

- `pages/overview/overview.tsx` — as três faixas substituem quatro painéis
- componentes novos sob `pages/overview/`
- as chaves de query são as MESMAS das páginas de capacidade (decisão D3 do `platform-overview-plan`),
  então abrir a Overview segue aquecendo o cache em vez de duplicar busca

O risco real não é técnico: é **remover "Quick actions" e descobrir depois que alguém os usava**.
Registrado como risco no item, com a saída declarada (voltam como faixa própria, não misturados).

## Corner 4 — Verification

Ligada à DoD do `B-125`:

1. **A tela responde "tem algo errado agora?" a partir de MAIS DE UMA capacidade.** Um teste que
   afirme isso com um sinal só passaria verde sobre uma tela que continua sem enxergar a
   plataforma.
2. **Nenhum bloco é a barra lateral desenhada de novo** — verificável por teste que quantifique
   sobre o registro do menu, como `capabilities.test.ts` já faz.
3. **Nenhuma série com mais fontes do que o dado sustenta** — o teste conhece quais fontes têm
   série e reprova quando uma sem série entra num gráfico.
4. **O que a tela afirma sobre custo vem de custo medido**, não do preço do plano.

**Onde o limite se move depois:** com a Overview respondendo "o que precisa de mim", a pergunta
seguinte passa a ser "por que isso aconteceu" — e aí faz sentido ligar cada linha de atenção ao
trace que a produziu, o que hoje não teria onde aterrissar.

## Verdict

`SHIPPABLE` — a hipótese se confirma por medição do navegador e do código, o custo do status quo é
quantificado (107 linhas, 29% do arquivo), e as cinco fontes que substituem essas seções já
existem e já têm mock. Nada aqui depende de trabalho fora do dashboard.
