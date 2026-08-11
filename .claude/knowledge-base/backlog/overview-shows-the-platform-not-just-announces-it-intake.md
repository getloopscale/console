---
slug: overview-shows-the-platform-not-just-announces-it
item: B-125
date: 2026-08-11
generated_by: backlog-item
status: completed
---

# Intake — a Overview anuncia a plataforma, mas não mostra a plataforma

## Proveniência das respostas

O grill de quatro perguntas **não foi conduzido pergunta-a-pergunta**, e o motivo fica registrado
em vez de omitido: as quatro respostas já existiam na conversa. O dono pediu para repensar a
metade inferior da tela, eu produzi o diagnóstico e a proposta em
`https://claude.ai/code/artifact/d530a10c-93ca-4ec5-9685-5491e5929392`, ele perguntou se a
Overview já estava profissional, eu medi no navegador e respondi que não — e ele mandou abrir o
item.

Re-perguntar o que já foi respondido é re-litigar decisão tomada. As respostas abaixo são
transcritas, com a medição que as sustenta.

## G2 — dedup

`grep` por `overview`, `quick actions`, `usage`, `attention` devolveu **um** bloco: `B-112`, que
está `[x]`.

**Não é regressão, e a distinção importa.** A DoD do `B-112` era *"toda capacidade declarada no
registro do menu aparece em `/`"*, e ela continua satisfeita — medi hoje: oito cards, oito
capacidades, com estado real. O que este item registra é o problema SEGUINTE, que só ficou visível
porque aquele fechou. Marcá-lo `regression_of: B-112` diria que algo quebrou; nada quebrou.

## Q1 — O que é, e o que mudou no NOSSO sistema

**Resposta (dono).** "Agora o nosso Overview está profissional? tem todos os dados da plataforma?"

**Medição (2026-08-11, `localhost:5174` em modo mock, via Chrome).** As seções da página são:

```
PLATFORM         8 capacidades, com estado real          ← entregue pelo B-112
USAGE            4/10 projetos · 145/1.000 builds · 2/3 ambientes · 3/10 assentos
DEPLOY ACTIVITY  uma capacidade
PROJECTS         3 de 4 + "ver todos os 4"
QUICK ACTIONS    3 botões que já são itens do menu
```

E o que a tela RESPONDE, medido por consulta ao texto renderizado:

| pergunta | responde |
|---|---|
| quais capacidades existem | **sim** |
| o que rodou além de deploys | não |
| tem algo errado agora | não |
| quanto custam os agentes | **não** — o único valor em dinheiro é `USD 20/mo`, o preço do plano |

**O QUE MUDOU:** o `B-112` entregou a faixa `PLATFORM` e, ao fazê-lo, tornou a contradição
visível. A página agora diz "esta plataforma faz oito coisas" e em seguida dedica quatro painéis a
uma delas mais cobrança. A contradição existia antes; ela não era legível.

**G5 — sem prior art.** A justificativa é inteiramente local: a nossa tela, medida no nosso
ambiente, contra o que o nosso próprio menu declara. Nenhuma referência a como outro produto
desenha a home dele.

## Q2 — Repo e domínio

`theo-cloud/dashboard` → domínio **`frontend-dashboard`**. Um domínio só; G3 não dispara.

Nota de fronteira: a faixa de custo depende de `lens/observability`, que **não tem mock** — em modo
mock ela mostraria "couldn't load" até isso ser fechado. É achado registrado no `B-112`, não um
segundo domínio.

## Q3 — Modo sugerido

**`evolve`** — o custo do status quo é mensurável (quais perguntas a tela não responde, e o que ela
gasta de espaço respondendo o que o menu já responde), e o trabalho é evolução de tela existente.
*Sugestão; `/discover` pode reclassificar.*

## Q4 — Definição de pronto

Discutida na proposta e transcrita no bloco do item. Os critérios foram escolhidos para falharem
de verdade:

1. **A tela responde "tem algo errado agora?"** — hoje nenhuma tela do produto responde isso,
   porque cada capacidade só enxerga a si mesma. É a pergunta mais valiosa que uma overview de
   plataforma pode responder.
2. **Nada na tela é a barra lateral desenhada de novo.** "Quick actions" leva a `/projects`,
   `/team` e `/domains` — os três são itens de um menu sempre visível. É o mesmo defeito que os
   cards de capacidade evitaram ao exigir um SINAL.
3. **Nenhuma série temporal com mais fontes do que o dado sustenta.** Medido: só
   `lens/observability`, `builds/stats` e `trust` têm série; `rag`, `memory` e `storage` servem só
   totais. Desenhar cinco séries alinhadas seria fabricar quatro.

## Decisão de escopo levantada no intake (não resolvida aqui)

A proposta remove "Quick actions" inteiro. É risco de produto real — alguém pode sentir falta dos
três botões. A defesa registrada: os três destinos ficam a um clique numa barra sempre visível, e
o espaço passa a responder o que nada mais responde. Se medição de uso mostrar que eram usados,
voltam como faixa própria. A decisão final é de `/to-plan`, com ADR.
