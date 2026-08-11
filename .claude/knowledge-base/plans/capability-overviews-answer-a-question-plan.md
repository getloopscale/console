# Plano: toda overview de capacidade responde uma pergunta

**Item:** `B-126` · **Data:** 2026-08-11 · **Baseline:** `34137fcf`

## Goal

Fazer `skills/overview.tsx` responder uma pergunta antes de listar, e tornar o aviso de
parcialidade um contrato de toda tela que resume sobre leitura truncada — verificado por um teste
que quantifica sobre as sete overviews em vez de inspecionar uma a uma.

## Context

O `B-125` estabeleceu, na Overview de plataforma, que uma tela inicial existe para responder uma
pergunta e não para listar. Aplicada às capacidades, a mesma régua expôs dois fatos que
contrariam a premissa de que "promptly, skills e trust divergem":

- Cinco das sete já respondem. `promptly` está entre elas.
- `skills` não responde nada — abre num `<Card>` com `<h2>Published skills</h2>` e um `DataTable`.
- `trust` responde **melhor** que as cinco: um veredito com julgamento embutido.

## Baseline Context (revisão do estado atual)

| tela | linhas | abre respondendo | trunca? | avisa? |
|---|---|---|---|---|
| `pages/lens/overview.tsx` | 254 | KPIs + gráfico | não (agregado) | n/a |
| `pages/memory/overview.tsx` | 280 | KPIs | não (agregado) | n/a |
| `pages/rag/overview.tsx` | 166 | KPIs | não (agregado) | n/a |
| `pages/promptly/overview.tsx` | 180 | KPIs | **sim** | **sim** (`overview.tsx:86`) |
| `pages/trust/overview.tsx` | 190 | **veredito** (`overview.tsx:118-124`) | teto 200 | não |
| `pages/skills/overview.tsx` | 262 | **nada** | **sim** (`next_page_token`) | **não** |
| `pages/workspace/overview.tsx` | 491 | lista de arquivos | sim | — |

### O que já está certo, e por isso não entra no escopo

- `PageShell`, tratamento de erro e estado de carregamento: as **sete** têm.
- O primitivo de KPI já é unificado em `MetricCard`, com guard próprio
  (`lib/kpi-primitive-unification.test.ts`, M88/#138).

### Callers

`skills/overview.tsx` é montado em `/skills` pelo registro de rotas; nenhum outro módulo o importa.
`useSkillsCatalog` é compartilhado com `skills/catalog.tsx` — a chave de cache é a mesma por
decisão do `B-052`, e este plano não a toca.

### Glossário

- **veredito** — uma frase com julgamento embutido ("3 policies are not being blocked"), em
  oposição a um número que exige interpretação.
- **parcialidade** — a propriedade de um resumo calculado sobre leitura truncada.
- **lifecycle** — `active | draft | deprecated` numa skill.
- **`latest_revision_id`** — a revisão vigente; `null` significa que a skill não pode ser carregada.

## Prior Art & Related Work

- `B-125` (`overview-shows-the-platform-opportunity.md`) — a régua "responde ou lista".
- `B-114` / `B-120` — a disciplina de declarar truncamento (`has_more`), aqui aplicada a um resumo
  em vez de a uma lista.
- `trust/overview.tsx:118-124` — o veredito que este plano promove a padrão.
- `promptly/overview.tsx:86` — o aviso de parcialidade que este plano promove a contrato.

## ADRs

### D1 — Veredito onde existe uma REGRA; KPI onde não existe

**Decisão.** Uma overview responde com **veredito** quando a capacidade tem uma regra contra a
qual o estado pode ser julgado, e com **KPI** quando o que existe é volume de atividade.

| tela | tem regra? | forma |
|---|---|---|
| trust | sim — toda política observada deveria estar sendo bloqueada | veredito ✓ (já) |
| skills | sim — uma skill publicada deveria ser carregável | **veredito** (novo) |
| memory, rag, lens, promptly | não — são contagens de atividade | KPI ✓ (já) |

**Rationale.** Um número exige interpretação; um veredito já a carrega. Mas um veredito só é
possível quando há um "deveria": `1.284 memórias` não é bom nem ruim, e transformá-lo numa frase
de julgamento seria inventar um critério que ninguém definiu — pior que o número.

O `skills` tem o "deveria" nos dados que já busca: `latest_revision_id: null` significa uma skill
publicada que **agente nenhum consegue carregar**. Isso é julgável, e é mais útil do que
"N skills publicadas".

**Alternatives considered.**
*Uniformizar tudo em KPIs, por maioria (cinco de sete).* **Rejeitada:** trocaria a resposta do
trust por um dado, e maioria não é argumento — cinco telas usarem KPIs não prova que KPIs
respondem melhor.
*Uniformizar tudo em vereditos.* **Rejeitada:** exigiria inventar um critério de julgamento para
contagens que não têm um, que é fabricação com aparência de opinião informada.

**Consequences.** Duas formas convivem, e a escolha entre elas passa a ter um teste: uma tela nova
declara qual usa e por quê. O risco aceito é alguém escolher errado; a mitigação é que a escolha
fica explícita em vez de implícita.

### D2 — Parcialidade é propriedade da LEITURA, não do promptly

**Decisão.** Toda tela cujo resumo é calculado sobre leitura truncada declara isso. O `promptly`
já o faz (`"These values are minimums, not totals"`); o `skills` trunca por `next_page_token` e
não declara.

**Rationale.** É a mesma disciplina de `has_more` do `B-114`, um nível acima: lá era uma lista que
truncava em silêncio, aqui é um RESUMO calculado sobre uma lista truncada — o que é pior, porque um
número parcial apresentado como total não tem como ser desconfiado por quem lê.

**Alternatives considered.**
*Remover o aviso do promptly, por ser o único.* **Rejeitada:** a assimetria se resolve pelo lado
certo. O aviso está certo; a ausência nos outros é que é o defeito.
*Buscar todas as páginas para o total ser exato.* **Rejeitada:** paga N requisições na abertura de
uma tela para transformar "pelo menos 100" em "103".

**Consequences.** O `skills` ganha o aviso. Telas que leem agregado (memory, rag, lens) não são
afetadas — elas não truncam.

## Dependency Graph

```
T1 (contrato: veredito do skills)  →  T2 (a tela usa)  →  T3 (guard sobre as sete)
                                       T2 inclui a parcialidade (D2)
```

## Phase 1: O contrato

### T1.1 — O veredito do acervo de skills

#### Why this step
O julgamento é lógica de negócio: qual estado de uma skill a torna inútil para um agente. Ele
precisa ser testável sem montar tela, como `coverageGap` do trust já é.

#### Files to edit
- `dashboard/src/pages/skills/catalog-verdict.ts` (NEW)
- `dashboard/src/pages/skills/catalog-verdict.test.ts` (NEW)

#### TDD
`test_skill_sem_revisao_e_o_veredito` — `latest_revision_id: null` é a linha que importa.
`test_deprecada_com_revisao_nao_e_a_mesma_coisa` — depreciada ainda carrega; é aviso, não falha.
`test_acervo_saudavel_diz_isso_em_vez_de_ficar_mudo` — a contraparte.
`test_leitura_truncada_marca_o_veredito_como_parcial` — D2.

#### Acceptance criteria
- O veredito distingue "não consigo ler" de "está tudo bem".
- Nenhuma frase é montada por concatenação de números sem sujeito.

#### DoD
`npx vitest run src/pages/skills` verde.

## Phase 2: A tela

### T2.1 — `/skills` responde antes de listar

#### Why this step
É o entregável do item.

#### Files to edit
- `dashboard/src/pages/skills/overview.tsx`
- `dashboard/src/pages/skills/overview.test.tsx`

#### TDD
`test_a_tela_responde_antes_de_listar` — o veredito aparece acima do `DataTable`.
`test_a_tela_avisa_quando_o_acervo_foi_truncado` — D2.

#### Acceptance criteria
- A tabela continua onde está; nada de informação se perde.

#### DoD
`npx vitest run src/pages/skills` verde.

## Phase 3: O guard

### T3.1 — Quantificar sobre as sete

#### Why this step
Consertar o `skills` não impede a oitava tela de nascer sem resposta. O guard é o que muda isso.

#### Files to edit
- `dashboard/src/lib/capability-overview.test.ts` (NEW)

#### TDD
`test_toda_overview_de_capacidade_declara_sua_forma` — cada uma é KPI ou veredito, e a que não for
nenhuma reprova com o nome do arquivo.

#### Acceptance criteria
- O guard lê o disco, não uma lista escrita à mão.

#### DoD
`npx vitest run src/lib/capability-overview.test.ts` verde.

## Phase 4: Integration Validation

#### DoD
- `npm test` exit 0 · `npm run typecheck` exit 0 · `npm run lint` 0 problemas
- Varredura de tela: `/skills` responde antes de listar
- CHANGELOG atualizado

## Coverage Matrix

| DoD do B-126 | tarefa |
|---|---|
| toda overview responde antes de listar, verificado por teste que quantifica | T1.1, T2.1, **T3.1** |
| a escolha KPI vs veredito registrada em ADR com alternativa rejeitada | **D1** |
| nenhuma tela perde informação que só ela mostra | T2.1 (a tabela fica) |
| o aviso de parcialidade vira contrato ou some | **D2**, T1.1, T2.1 |

## Drawbacks & Risks

| risco | severidade | mitigação |
|---|---|---|
| O veredito do skills julga por um critério que o produto não confirmou (`latest_revision_id: null` = inútil) | média | O campo é o que o próprio serviço usa para resolver uma skill; se estiver errado, o erro é do modelo de dados e aparece aqui em vez de ficar escondido |
| O guard da T3.1 vira burocracia se a heurística for frouxa | média | Ele exige um marcador explícito por tela, não adivinha — uma tela nova declara sua forma |
| Duas formas convivendo confundem quem chega | baixa | O ADR D1 é o lugar onde a pergunta "qual uso?" é respondida |

## Unresolved Questions

- O `workspace/overview.tsx` (491 linhas) abre com uma lista de arquivos. Ele é uma overview de
  capacidade ou um navegador de arquivos? A T3.1 vai forçar a resposta; se for navegador, sai do
  conjunto por declaração explícita e não por omissão.

## Failure scenarios

(nenhuma I/O externa nova — as duas telas consomem consultas que já existem)
