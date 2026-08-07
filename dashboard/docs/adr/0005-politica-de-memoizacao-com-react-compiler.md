---
status: proposed
date: 2026-08-06
decision-makers: time do dashboard theo-cloud
origem: tradeoff_decisions#13 · system_design_findings#10
---

# ADR-0005 — Politica de memoizacao sob React Compiler

## Contexto e enunciado do problema

O React Compiler (`babel-plugin-react-compiler`) esta **ativo em todo o build**, sem
allowlist e sem gating por diretorio (`vite.config.ts:66-74`). O registro existente e uma
nota de tarefa:

> T0.2: React Compiler (auto-memoizacao). React 19 GA, babel-plugin@1.0. Auto-memoiza
> components + hooks sem useMemo/useCallback/memo() manuais. Build-time only, zero runtime
> overhead. Existing 6 manual memos convivem.

Isso diz **o que** e afirma o custo como zero, mas nao registra a consequencia que importa
para o time: **a partir dessa flag, a politica de memoizacao do codebase mudou**. Escrever
`useMemo` passa a ser redundante na maioria dos casos, e violar as Rules of React passa a
ser uma desistencia silenciosa do compilador em vez de apenas um re-render a mais.

Medido: nenhuma mencao a React Compiler, memoizacao ou Rules of React em `DESIGN.md`
(803 linhas), `TESTING.md` (184) ou `docs/governance/dashboard.md` (243). E
`eslint-plugin-react-compiler` **nao esta ativo** em `eslint.config.js` — ele consta no
`package.json:125` como devDependency e nao e referenciado por nenhuma config
(`deletion_findings#10`), ou seja, esta instalado e desligado.

A afirmacao *"zero runtime overhead"* tambem nao foi medida neste repositorio — o compiler
adiciona caches por componente.

Implicacao pratica para esta auditoria: **memoizacao manual ausente NAO e um achado
valido neste codebase**, e nenhum foi levantado. Isso e uma calibragem, nao uma omissao.

## Opcoes consideradas

1. Manter o compiler ligado sem politica escrita (estado atual).
2. Manter ligado, ativar o lint companheiro e escrever a politica.
3. Desligar o compiler e voltar a memoizacao manual como politica.

## Decisao

Adotar a **opcao 2**. O compiler fica ligado — a escolha esta correta. O que falta e
tornar a politica implicita explicita e observavel:

1. Ativar `eslint-plugin-react-compiler` em `eslint.config.js`. Ele e o mecanismo que
   transforma *"o compiler desistiu deste componente"* em sinal visivel; sem ele a adocao
   e cega e a dependencia ja instalada e peso morto.
2. Registrar a politica em `TESTING.md` ou num documento de convencoes, em tres linhas:
   **memo/useMemo/useCallback manual so com justificativa medida**, anexada em comentario.
3. Nao remover os 6 memos manuais existentes em massa; remove-los quando o arquivo for
   tocado por outro motivo.

## Consequencias

- Bom: componentes que o compiler pula deixam de ser invisiveis.
- Bom: o time para de escrever memoizacao redundante, que hoje e ruido de review.
- Ruim: o lint vai acusar violacoes de Rules of React em codigo existente. Isso e informacao, nao regressao — pode entrar como warning antes de virar error.
- Ruim: a afirmacao "zero runtime overhead" continua nao medida. Ela nao e pre-requisito da decisao, mas nao deve ser repetida como fato ate haver medicao.
