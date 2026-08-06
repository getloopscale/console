---
status: proposed
date: 2026-08-06
decision-makers: time do dashboard theo-cloud
origem: tradeoff_decisions#4 · boundary_findings#11 · system_design_findings#4, #5
---

# ADR-0003 — Divisao de responsabilidade entre `@usetheo/ui` e `@theokit/ui`

## Contexto e enunciado do problema

O contrato de tema esta partido em tres fontes que nao se conhecem (medido):

1. **Componentes** — 192 dos 375 arquivos de producao importam de `@usetheo/ui@0.35.1`.
2. **Provider de tema** — vem de OUTRO pacote: `TheoUIProvider` + `violetForge` de `@theokit/ui@1.3.2` (`src/main.tsx:4`). Apenas 4 arquivos de `src/` importam `@theokit/ui`.
3. **Tokens CSS** — copia vendorizada de `@usetheo/ui@0.22` em `src/vendor/usetheo-ui/`, 13 minors atras do instalado, sem checagem de drift.

O split e **intencional upstream** — a `description` do `package.json` do `@theokit/ui`
declara: *"built for AI-agent surfaces... Generic, auth, and cloud-ops primitives live in
@usetheo/ui"*. Mas nenhum documento do dashboard o menciona, e `DESIGN.md:88` ainda nomeia
`@usetheo/ui@0.12.0-next.0` como *"canonical component library"* — 23 minors atras e sem
citar `@theokit/ui`.

Consequencia concreta e ativa: existem **duas teorias contraditorias** sobre quem e dono
do token `--primary`, com **valores diferentes** e cada uma documentada como sendo a que
vale em runtime:

- `src/main.tsx:91` — *"O `--primary` vem do tema via TheoUIProvider (o index.css NAO tem efeito no primary)"*, valor `oklch(0.57 0.13 302)`.
- `src/index.css:145-150` — *"This is the block the app actually uses at runtime; without it the fix ships dead"*, valor `oklch(0.50 0.16 296.97)`, citando correcao de contraste WCAG (Red Team #163 v2).

As duas nao podem estar certas. Se `main.tsx` estiver certo, a correcao de acessibilidade
do `index.css` e codigo morto. Se `index.css` estiver certo, o override do tema e que e
morto. Nenhum teste distingue os dois casos: **o contraste real da marca hoje e
indeterminado por leitura**.

## Opcoes consideradas

1. Consolidar num unico pacote (migrar o provider para `@usetheo/ui` e remover `@theokit/ui`).
2. Registrar o split e fixar o dono de cada camada por teste.
3. Manter como esta.

## Decisao

Adotar a **opcao 2**. O split e intencional upstream e consolidar seria brigar com a
decisao do publicador. Este ADR registra:

- `@usetheo/ui` e dono dos **componentes**.
- `@theokit/ui` e dono do **provider de tema** e do objeto de tema.
- `src/vendor/usetheo-ui/` e uma ACL temporaria de tokens CSS, com criterio de saida ja declarado no proprio README (`tradeoff_decisions#6` — o exemplo mais bem documentado do repositorio).
- Quando um bump de um pacote quebrar o outro, o dono do incidente e quem faz o bump.

**Acao obrigatoria de desempate, antes de fechar este ADR:** medir uma vez, com o app
buildado, `getComputedStyle(document.documentElement).getPropertyValue('--primary')`;
apagar a definicao perdedora; fixar a vencedora num teste Playwright de regressao
(jsdom nao resolve cascata de `@import`). E atualizar `DESIGN.md` secao 3.

## Consequencias

- Bom: o acoplamento cross-package deixa de ser folclore e passa a ter dono declarado.
- Bom: o teste de `--primary` transforma a duvida em gate e vale para todos os bumps futuros.
- Ruim: continuam sendo dois versionamentos independentes que precisam ser bumpados em coordenacao. Mitigacao: check de CI comparando os tokens vendorizados com os do `@usetheo/ui` instalado, hoje 13 minors defasados de forma invisivel.
