# Oportunidade: a Overview da plataforma cobre só um subsistema

**Item:** `B-112` · **Modo:** `evolve` · **Data:** 2026-08-10 · **Baseline:** `bff55580`

## Corner 1 — Evidence

### O que a tela é hoje

`src/pages/overview/overview.tsx` consome exatamente três fontes: `useProjects`,
`useBuildStats` e `useCloudApi` (billing). O texto renderizado, lido do navegador em modo mock:

```
PROJECTS 4 · DEPLOYS (7D) 19 · ACTIVE ENVS 0 · PLAN USD 20/mo
USAGE (this billing period) · DEPLOY ACTIVITY (last 7 days)
PROJECTS (acme-web, acme-payments, acme-marketing) · QUICK ACTIONS
```

### O que a plataforma declara ter

`src/components/layout/app-sidebar-menus.ts`, grupo `Capabilities` — **oito** itens:

| # | Capacidade | Rota | Observação |
|---|---|---|---|
| 1 | Memory | `/memory` | |
| 2 | Knowledge Base | `/rag` | |
| 3 | Databases | `/databases` | `comingSoon: true` |
| 4 | Workspace | `/workspaces` | |
| 5 | Observability | `/observability` | |
| 6 | Trust | `/trust` | |
| 7 | Skills | `/skills` | |
| 8 | Prompts | `/promptly` | |

**Zero delas aparece na Overview.** A cobertura é 0/8.

### A assimetria que torna isto caro

Cada capacidade **já tem a sua própria** página de overview — `lens/overview.tsx`,
`memory/overview.tsx`, `promptly/overview.tsx`, `rag/overview.tsx`. A plataforma tem sete
overviews de capacidade e **nenhuma overview de plataforma**. Quem chega pela primeira vez
conclui, da tela inicial, que o produto é um PaaS de deploy.

### O custo de um número por capacidade — MEDIDO, e diferente do que eu estimei no intake

No intake eu afirmei que *"não existe endpoint de resumo por capacidade"*. **Estava errado.** O
grep procurou `summary|overview|stats|counts` e perdeu `metrics` e `analytics`. A medição
correta:

| Capacidade | Endpoint que a app já chama | Forma |
|---|---|---|
| Memory | `/v1/dashboard/memory/metrics` | **agregado** |
| Knowledge Base | `/v1/dashboard/rag/analytics` | **agregado** |
| Observability | `/v1/dashboard/lens/observability` | **agregado** |
| Workspace | `/v1/dashboard/storage/usage` | **agregado** |
| Trust | `/v1/dashboard/trust/...` | lista — aceita `limit` |
| Skills | `/v1/dashboard/skills` | lista — aceita `limit` |
| Prompts | `/v1/dashboard/promptly` | lista — aceita `limit` |

**Quatro das sete já têm agregado servido pelo backend.** As outras três aceitam `limit`, então
a pergunta *"esta capacidade está em uso?"* custa `limit=1` — não a lista.

### Um achado colateral, registrado sem ser resolvido aqui

`memory/metrics`, `rag/analytics`, `lens/observability` e `storage/usage` **não têm mock**. Em
modo mock elas escapam para o proxy do Vite e voltam 500 — foi assim que a medição as
encontrou. Isso significa que, no ambiente onde o dono valida telas, essas quatro capacidades
não conseguem mostrar número algum hoje. É defeito do ambiente de demonstração, não do produto,
e vira item próprio se o plano não o absorver.

## Corner 2 — Constraint relation

**`unknown`.** `rules/current-constraint.md` está `status: undeclared`, e o ecossistema não
instrumenta fluxo. Declarar uma relação com o constraint aqui seria assertar, não medir — o que
o gate G5 do intake existe para recusar.

## Corner 3 — Blast radius

Contido no dashboard:

- `src/pages/overview/overview.tsx` — a tela
- `src/components/layout/app-sidebar-menus.ts` — o registro de capacidades vira fonte de dados
  além de fonte de navegação
- os hooks de cada capacidade, se o número entrar

**Não atravessa repo.** Nenhuma mudança de contrato de API é necessária para a primeira fatia;
os agregados que existem já são consumidos pelas páginas de capacidade.

O risco real de raio não é técnico: é que o registro do menu passe a ter **dois consumidores**
com necessidades diferentes, e alguém acrescente um campo pensando só na barra lateral. O
precedente do próprio repositório resolve isso — `LENS_CAPABILITIES` foi criado exatamente para
que *"a barra lateral e a grade da Overview nunca divirjam"*.

## Corner 4 — Verification

Ligada à DoD do `B-112`:

1. **Cobertura quantificada sobre o registro.** Um teste que enumere as capacidades à mão
   passaria verde no dia em que a nona fosse criada e esquecida — este mesmo defeito, um nível
   acima. O teste itera o registro.
2. **Três estados distinguíveis.** `em uso` ≠ `não adotada` ≠ `não consegui ler`. Uma capacidade
   que aparece vazia por falha de leitura convida a concluir que ela não serve para nada.
3. **Custo declarado.** A tela mais visitada do produto não passa a disparar uma requisição por
   capacidade sem ADR.

**Onde o limite se move depois:** com a Overview cobrindo a plataforma, a próxima pergunta passa
a ser *"qual capacidade está pior?"* — e aí faz sentido um sinal de saúde por card, que hoje não
existiria para nada.

## Verdict

`SHIPPABLE_WITH_CAVEATS` — a hipótese do item foi confirmada por medição, e a estimativa de
custo que eu registrei no intake foi **corrigida para melhor**: quatro das sete capacidades já
têm agregado, o que torna a primeira fatia mais barata do que eu disse ao dono.

**Caveat carregado para o plano:** os quatro agregados não têm mock, então a validação em modo
mock não verá números reais para eles sem que o plano trate isso.
