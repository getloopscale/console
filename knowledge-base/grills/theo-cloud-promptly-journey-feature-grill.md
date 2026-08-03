---
slug: theo-cloud-promptly-journey
generated_by: roadmap-feature
date: 2026-08-03
status: completed
target_roadmap: theo-cloud/ROADMAP.md
new_milestone_id: M27
---

# Grill — a jornada completa de gestão de prompts

## Pré-flight (Step 0)

27 milestones, último `M26 [x]` → **M27 livre**. `ROADMAP.md`, `CHANGELOG.md` e
`knowledge-base/grills` OK. Árvore limpa.

## Step 3 — Cross-check de escopo: a exclusão CAI, por decisão explícita

`theo-promptly/ROADMAP.md` § Explicitly out of scope:

> **UI rica/colaborativa no V1** (editor em tempo real, **diff visual**)

**Sobreposição real, não coincidência de palavra.** Uma jornada SOTA de gestão de prompts tem
diff entre revisões — o peer tem `PromptVersionDiffDialog`
(`theo-lens/knowledge-base/references/langfuse/web/src/features/prompts/components/`).

**Decisão do dono (2026-08-03): revisar a exclusão.** `removed_from_out_of_scope: "UI
rica/colaborativa no V1 (editor em tempo real, diff visual)"` — parcial: cai o **diff visual**
e a autoria; **permanece fora** a edição colaborativa em tempo real (multi-cursor, presença),
que é o que "colaborativa" nomeia.

**A edição da exclusão acompanha este milestone.** O contrato do `/roadmap-feature` pede
"mesmo commit"; aqui é fisicamente impossível — a exclusão vive em **outro repositório**. São
dois commits feitos em sequência, cada um citando o outro, e a razão está escrita nos dois. O
que o contrato quer impedir é a exclusão contradita **em silêncio**, que foi o `b95552e`; dois
commits que se referenciam cumprem o propósito.

## Q1 — O que é, e por que AGORA?

A jornada completa: **autorar → inspecionar → comparar → promover → reverter**.

**Por que agora — medido na tela, não no código.** Abri o dashboard em `127.0.0.1:5174` e
percorri as duas telas do M25:

- **Catálogo:** três colunas de texto e links. **Zero botões.**
- **Detalhe:** um único verbo, `Promover`. Todo o resto é `StaticText`. A coluna do conteúdo é
  *"TRECHO DO CONTEÚDO"* — num gerenciador de prompts, **não dá nem para ler o prompt inteiro**.
- **Estado vazio do catálogo:** *"Crie a primeira revisão pela CLI ou pelo SDK para que ela
  apareça aqui."* Um dashboard que manda o usuário sair do dashboard. A referência (`trust`)
  oferece `<Link to="/trust/guardrails/new">Criar a primeira guardrail</Link>`.

**O erro foi meu, e não foi o roadmap.** Eu escrevi a justificativa do M25: *"a promoção já
cobre o ato central"*. Está errada nos próprios termos — promover só é central **se já
existirem prompts**. Num workspace novo o ato central é criar. Otimizei a ponta errada da
jornada.

**E o agravante:** quase nada disso precisa de backend novo. Medido contra `develop`:

| ação | endpoint | medido |
|---|---|---|
| criar revisão | `POST /prompts` | **201** |
| ler integral + `variables` | `GET /prompts/:name?version=N` | **200**, devolve `content` e `variables` |
| diff entre revisões | duas leituras acima | dado suficiente |
| render com variáveis | `variables: ["nome"]` vem da API | sem inventar campo |
| reverter | `POST /prompts/:name/rollback` | ver Q3 |

Deixei de fora **por escolha**, não por falta de API.

## Q2 — Dependências

**`M25 [x]`** — catálogo, detalhe e promoção. Este milestone **estende** aquelas telas; sem
elas não há onde pendurar autoria e diff.

Nenhuma dependência cross-repo: os cinco endpoints existem e foram medidos hoje.

## Q3 — DoD, derivada por medição

O achado que muda o desenho: **rollback NÃO move ponteiro — cria revisão nova.**

```
POST /prompts/m27/rollback  {"toVersion":1,"label":"prod"}
  -> 201 {version: 3, content: "Ola {{nome}}, v1",
          labelsMoved: ["prod"], currentLabels: [{label:"prod", version:3}]}
```

Reverter para a v1 **cria a v3** com o conteúdo da v1. O histórico é append-only e nada é
reescrito. Uma confirmação que dissesse *"o prompt volta para a v1"* seria falsa — e o
operador que a lesse esperaria o histórico encolher.

E o contrato de recusa, medido:

```
POST /prompts/m27/rollback  {"toVersion":1}      (sem label, com labels existindo)
  -> 400 {"error":"label_required",
          "message":"rollback de \"m27\" precisa do label a reverter — existentes: prod",
          "availableLabels":["prod"]}
```

Erro **tipado com a lista** — a tela pode oferecer a escolha em vez de repetir a falha.

Ver `## Definition of done` no milestone.

## Q4 — Os dois riscos NOVOS

1. **A tela passa a ESCREVER conteúdo, e revisão é imutável.** Até aqui a única escrita era
   mover um ponteiro (reversível movendo de volta). Criar revisão é **append permanente**: não
   há `DELETE`, e um erro de digitação fica no histórico para sempre. *Mitigação:* preview do
   render **antes** de salvar (com as `variables` que a API declara, não adivinhadas), e o
   formulário diz explicitamente que a revisão é imutável — a saída para um engano é criar
   outra, não apagar.

2. **O diff pode afirmar diferença que não existe.** Comparar dois textos no cliente é fácil de
   errar em espaço em branco, quebra de linha e normalização — e um diff que mostra ruído
   ensina o operador a ignorá-lo, que é pior que não ter. *Mitigação:* a lógica de diff vive
   **fora do React**, testada sem browser, com casos de igualdade exata (mesmo conteúdo →
   **zero** blocos alterados) além dos de diferença. O par que discrimina, não só o caso feliz.

## Step 5 — SOTA delta

**Não.** O `langfuse` já está clonado e foi lido no blueprint do M25
(`theo-cloud-promptly-dashboard-blueprint.md`), incluindo a existência do
`PromptVersionDiffDialog`. Nenhum peer novo; `_catalog.md` intocado.
