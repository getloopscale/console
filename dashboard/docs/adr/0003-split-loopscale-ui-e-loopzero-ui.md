---
status: accepted
date: 2026-08-06
executado-em: 2026-08-08
origem-da-execucao: B-007 (o gate de --primary) · B-071 (o split registrado)
decision-makers: time do dashboard loop-console
origem: tradeoff_decisions#4 · boundary_findings#11 · system_design_findings#4, #5
---

# ADR-0003 — Divisao de responsabilidade entre `@getloopscale/ui` e `@getloopscale/loopzero-ui`

## Contexto e enunciado do problema

O contrato de tema esta partido em tres fontes que nao se conhecem (medido):

1. **Componentes** — 192 dos 375 arquivos de producao importam de `@getloopscale/ui@0.35.1`.
2. **Provider de tema** — vem de OUTRO pacote: `LoopZeroUIProvider` + `violetForge` de `@getloopscale/loopzero-ui@1.3.2` (`src/main.tsx:4`). Apenas 4 arquivos de `src/` importam `@getloopscale/loopzero-ui`.
3. **Tokens CSS** — copia vendorizada de `@getloopscale/ui@0.22` em `src/vendor/loopscale-ui/`, 13 minors atras do instalado, sem checagem de drift.

O split e **intencional upstream** — a `description` do `package.json` do `@getloopscale/loopzero-ui`
declara: *"built for AI-agent surfaces... Generic, auth, and cloud-ops primitives live in
@getloopscale/ui"*. Mas nenhum documento do dashboard o menciona, e `DESIGN.md:88` ainda nomeia
`@getloopscale/ui@0.12.0-next.0` como *"canonical component library"* — 23 minors atras e sem
citar `@getloopscale/loopzero-ui`.

Consequencia concreta e ativa: existem **duas teorias contraditorias** sobre quem e dono
do token `--primary`, com **valores diferentes** e cada uma documentada como sendo a que
vale em runtime:

- `src/main.tsx:91` — *"O `--primary` vem do tema via LoopZeroUIProvider (o index.css NAO tem efeito no primary)"*, valor `oklch(0.57 0.13 302)`.
- `src/index.css:145-150` — *"This is the block the app actually uses at runtime; without it the fix ships dead"*, valor `oklch(0.50 0.16 296.97)`, citando correcao de contraste WCAG (Red Team #163 v2).

As duas nao podem estar certas. Se `main.tsx` estiver certo, a correcao de acessibilidade
do `index.css` e codigo morto. Se `index.css` estiver certo, o override do tema e que e
morto. Nenhum teste distingue os dois casos: **o contraste real da marca hoje e
indeterminado por leitura**.

## Opcoes consideradas

1. Consolidar num unico pacote (migrar o provider para `@getloopscale/ui` e remover `@getloopscale/loopzero-ui`).
2. Registrar o split e fixar o dono de cada camada por teste.
3. Manter como esta.

## Decisao

Adotar a **opcao 2**. O split e intencional upstream e consolidar seria brigar com a
decisao do publicador. Este ADR registra:

- `@getloopscale/ui` e dono dos **componentes**.
- `@getloopscale/loopzero-ui` e dono do **provider de tema** e do objeto de tema.
- `src/vendor/loopscale-ui/` e uma ACL temporaria de tokens CSS, com criterio de saida ja declarado no proprio README (`tradeoff_decisions#6` — o exemplo mais bem documentado do repositorio).
- Quando um bump de um pacote quebrar o outro, o dono do incidente e quem faz o bump.

**Acao obrigatoria de desempate, antes de fechar este ADR:** medir uma vez, com o app
buildado, `getComputedStyle(document.documentElement).getPropertyValue('--primary')`;
apagar a definicao perdedora; fixar a vencedora num teste Playwright de regressao
(jsdom nao resolve cascata de `@import`). E atualizar `DESIGN.md` secao 3.

## Consequencias

- Bom: o acoplamento cross-package deixa de ser folclore e passa a ter dono declarado.
- Bom: o teste de `--primary` transforma a duvida em gate e vale para todos os bumps futuros.
- Ruim: continuam sendo dois versionamentos independentes que precisam ser bumpados em coordenacao. Mitigacao: check de CI comparando os tokens vendorizados com os do `@getloopscale/ui` instalado, hoje 13 minors defasados de forma invisivel.

## O que foi executado (2026-08-08)

O ADR previa que *"o teste de `--primary` transforma a duvida em gate e vale para
todos os bumps futuros"*. Esse teste agora existe — e o que ele achou ao ser
escrito foi maior que a duvida original.

**A configuracao do tema tinha DOIS donos, nao um.** `main.tsx` montava a sua, e
`src/test/render.tsx` montava outra com o `violetForge` **cru**, sem o override
de `primary` e sem `respectSystemMode: false`. Medido:

| | `--primary` computado | modo |
|---|---|---|
| app | `oklch(0.57 0.13 302)` | escuro |
| suite inteira | `oklch(0.50 0.16 296.97)` | **claro** |

Toda a suite renderizava um produto travado em escuro no modo claro, com o roxo
que reprova o WCAG AA — o mesmo que o Red Team `loopscale/loopscale#163` mandou trocar. E
existe `src/test/a11y.test.tsx` nesta suite: ele media a cor errada.

A config virou `src/lib/theme/loopscale-theme.ts`, importada pelos dois lados.
Trocar a suite inteira de claro para escuro **nao quebrou nenhum teste** — 2725
verdes.

### A nota que dizia precisar de Playwright estava errada

`index.primary-token.test.ts` afirmava que fixar o valor COMPUTADO exigiria
Playwright, *"porque jsdom nao resolve cascade de `@import`"*. Medido: o tema nao
chega por `@import`. O provider injeta um `<style>` com seletor
`[data-theme="violet-forge"][data-mode="dark"]` e poe os atributos no `<html>` —
e jsdom **resolve** seletor de atributo em `getComputedStyle`, verificado
injetando `oklch(0.99 0.99 99)` no tema e lendo esse valor de volta.

O teste que faltava era escrevivel o tempo todo. A premissa que o adiava era
sobre o mecanismo errado.
