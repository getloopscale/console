---
status: proposed
date: 2026-08-06
decision-makers: time do dashboard theo-cloud
origem: tradeoff_decisions#2 · boundary_findings#15, #16 · system_design_findings#2
---

# ADR-0002 — Orcamento de LoC por arquivo: executavel ou morto

## Contexto e enunciado do problema

Tres modulos de producao justificam a propria estrutura invocando um orcamento de
500 LoC atribuido a um documento `architecture.md`:

- `src/pages/lens/trace-detail.tsx:4-5` — *"was a 680-LoC view that already breached the 500-LoC `architecture.md` budget"*
- `src/pages/lens/trace-detail/helpers.ts:5` — *"stays under the 500-LoC budget"*
- `src/pages/use-workspace-selection.ts:12` — *"Extracted from workspace.tsx to keep that file under the LoC budget"*

**O documento nao existe** (medido): nao ha `architecture.md` em `dashboard/`, nem em
`theo-cloud/docs/architecture/` (que contem apenas `index.md` e `mcp-broker.md`), nem em
`.claude/knowledge-base/architecture/`. O unico `architecture.md` do workspace e
`.claude/rules/architecture.md`, regra generica do plugin, que nao contem a string "500".

A regra sobreviveu ao documento que a definia. O unico enforcement existente e um teste
para **um** arquivo: `src/pages/login-loc-budget.test.ts:10` (`const BUDGET = 500`),
aplicado somente a `src/pages/login.tsx`.

Incoerencia interna medida: `src/app.tsx` tem **729 linhas** — 49 a mais que o
`trace-detail.tsx` que foi refatorado por "estourar 500 LoC". A regra e aplicada nas
folhas e ignorada na raiz. Ha 32 arquivos `.tsx` acima de 400 LoC, somando 17.735 LoC.

## Opcoes consideradas

1. Manter o estado atual — regra citada, nao localizavel, nao executavel.
2. Promover a regra executavel (ESLint `max-lines`) com allowlist congelada dos arquivos legados.
3. Declarar o orcamento morto e remover as citacoes.

## Decisao

Adotar a **opcao 2**. `eslint.config.js` passa a declarar `max-lines` com limite 500 para
`src/**/*.tsx` e `src/**/*.ts`, acompanhado de uma **allowlist explicita dos 15 arquivos
atuais** que excedem o limite. A allowlist e congelada: nenhum arquivo novo entra nela, e
cada arquivo removido dela e um item fechado. `src/pages/login-loc-budget.test.ts` e
substituido pela regra generalizada.

`src/app.tsx` entra na allowlist **com prazo**, nao permanentemente: ele sai quando o
roteamento for fatiado por feature (ADR-0001).

A opcao 1 e o pior dos tres estados: cara de cumprir, impossivel de auditar.

## Consequencias

- Bom: a regra passa a existir num lugar que qualquer pessoa pode abrir e o CI pode executar. As citacoes ao documento fantasma sao removidas dos tres docblocks.
- Bom: a divida fica travada no tamanho atual sem exigir refactor de 32 arquivos de uma vez.
- Ruim: `max-lines` e uma metrica grosseira — um arquivo de 480 LoC com um unico componente e pior que um de 520 com cinco componentes bem separados. Por isso este ADR e complementar ao trabalho de componentizacao, nao substituto dele (ver `boundary_findings#15`: apenas 4 arquivos tem 5+ componentes; 18 dos 30 maiores `.tsx` declaram exatamente UM).
- Ruim: allowlists tendem a crescer. Mitigacao: o crescimento e o proprio sinal de falha e deve reprovar a review.
