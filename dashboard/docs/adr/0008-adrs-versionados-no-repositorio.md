---
status: proposed
date: 2026-08-06
decision-makers: time do dashboard loop-console
origem: tradeoff_decisions#19 · boundary_findings#16 · system_design_findings#14
---

# ADR-0008 — ADRs versionados no repositorio

## Contexto e enunciado do problema

A cultura de decidir e registrar existe e e forte. Medido: **236 referencias** a
`ADR D<n>` / `ADR:` em comentarios de `dashboard/src/`, muitas com o numero da decisao e o
modo de falha que ela evita — `ADR D1` em `manual-chunks.ts:8` (com prior art citando tres
issues do Vite), `ADR D3` em `main.tsx:11`, `ADR D2` em `vite.config.ts:8`.

O que nao existe e a **durabilidade**:

- `.claude/knowledge-base/adrs/`, `plans/` e `reviews/` estao **os tres vazios**.
- `DESIGN.md:8` declara que os artefatos `audit`, `plan` e `architecture` foram *"removidos do versionamento"*.
- 12+ slugs de plano sao citados como autoridade em `src/` e **nenhum resolve**: `2026-05-27-backend-frontend-integration`, `2026-06-07-preview-as-category-single-slot-plan`, `2026-06-08-dashboard-screens-review-fixes`, `2026-06-11-code-review-remediation`, entre outros.
- `DESIGN.md:794-797` lista quatro cross-references; nenhuma resolve.

Um docblock que diz *"per ADR D2"* e util enquanto alguem lembra o que D2 decidiu; depois
vira ruido com aparencia de rigor. Esta e a mesma raiz do orcamento de 500 LoC citando um
`architecture.md` inexistente (ADR-0002) — **o codigo sobreviveu a propria documentacao**.

## Opcoes consideradas

1. Manter as decisoes apenas em docblocks (estado atual).
2. Versionar como arquivos apenas os ADRs que continuam vinculantes.
3. Reconstruir retroativamente os 236 ADRs citados.

## Decisao

Adotar a **opcao 2**. Sao versionados como arquivos em `dashboard/docs/adrs/` apenas os
ADRs ainda **vinculantes** — os candidatos ja estao identificados por esta auditoria e sao
sete, cabendo em duas paginas:

1. Eixo de organizacao do codigo e regra de residencia (ADR-0001)
2. Orcamento de LoC por arquivo (ADR-0002)
3. Split `@getloopscale/ui` vs `@getloopscale/loopzero-ui` (ADR-0003)
4. Justificativa do service worker (ADR-0004)
5. Politica do React Compiler (ADR-0005)
6. Obrigatoriedade da factory de query key (ADR-0006)
7. Modelo de consistencia do estado de servidor (ADR-0007)

Regra a partir daqui: **uma referencia `per ADR X` num docblock so e valida se `X`
resolver como arquivo no repositorio.** As referencias a planos removidos do versionamento
sao reescritas para o ADR correspondente ou removidas.

A opcao 3 e rejeitada: reconstruir 236 decisoes historicas nao paga o custo, e a maioria
ja foi absorvida pelo codigo.

## Consequencias

- Bom: `per ADR X` volta a ser verificavel, e o gate `check_evidence_citations` do proprio ecossistema passa a ter o que checar.
- Bom: sete arquivos substituem uma memoria institucional que ja falhou pelo menos duas vezes de forma medida (`architecture.md`, planos citados).
- Ruim: as decisoes historicas nao reconstruidas ficam sem registro formal. Aceito e declarado, em vez de fingido.
- Ruim: `DESIGN.md` precisa ter as cross-references corrigidas na mesma passada, senao continua apontando para diretorios inexistentes.
